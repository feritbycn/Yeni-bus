import type { Driver, DriverCandidate, GameEvents, GameState, RouteVariant } from '../core/types';
import type { EventBus } from '../core/EventBus';
import type { EconomyManager } from './EconomyManager';
import type { GarageManager } from './GarageManager';
import type { RouteManager } from './RouteManager';
import type { ClockService } from './ClockService';
import { computeDemand } from './PassengerManager';
import { BAGGAGE_FEE } from './PassengerManager';
import {
  BASE_DRIVER_SLOTS,
  COMPANY_NAME_MAX,
  DRIVER_BASE_SALARY,
  MAX_OFFICE_LEVEL,
  OFFICE_COSTS,
  OFFLINE_CAP_HOURS,
  OFFLINE_CAP_TRIPS,
  TERMINAL_FEE_RATE,
  xpForLevel,
} from '../data/constants';
import { FIRST_NAMES, LAST_NAMES } from '../data/drivers';
import { CONNECTION_BY_ID } from '../data/world';
import { clamp, dayKey, hashString, mulberry32, pick } from '../core/utils';

export const COMPANY_COLORS = ['#f5a524', '#e5484d', '#3b82f6', '#22c55e', '#a855f7', '#14b8a6', '#f97316', '#e5e7eb'];
export const COMPANY_LOGOS = ['logo_bus', 'logo_star', 'logo_bolt', 'logo_shield', 'logo_leaf', 'logo_road'];

export interface DriverTripResult {
  driverId: string;
  revenue: number;
  expenses: number;
  profit: number;
  passengers: number;
}

export interface OfflineReport {
  elapsedMs: number;
  trips: number;
  revenue: number;
  expenses: number;
  salary: number;
  profit: number;
  perDriver: { driverId: string; name: string; trips: number; profit: number; status: Driver['status'] }[];
}

export type CompanyError = 'name' | 'funds' | 'level' | 'max' | 'slots' | 'notFound' | 'salary' | 'busBusy' | 'routeLocked' | 'noBus';

export class CompanyManager {
  constructor(
    private readonly state: GameState,
    private readonly bus: EventBus<GameEvents>,
    private readonly economy: EconomyManager,
    private readonly garage: GarageManager,
    private readonly routes: RouteManager,
    private readonly clock: ClockService,
  ) {}

  // ---------- identity ----------

  setName(name: string): { ok: boolean; error?: CompanyError } {
    const n = name.replace(/[<>]/g, '').trim().replace(/\s+/g, ' ');
    if (n.length < 2 || n.length > COMPANY_NAME_MAX) return { ok: false, error: 'name' };
    this.state.company.name = n;
    this.bus.emit('stateChanged', undefined);
    return { ok: true };
  }

  setColor(color: string): boolean {
    if (!COMPANY_COLORS.includes(color)) return false;
    this.state.company.color = color;
    this.bus.emit('stateChanged', undefined);
    return true;
  }

  setLogo(logo: string): boolean {
    if (!COMPANY_LOGOS.includes(logo)) return false;
    this.state.company.logo = logo;
    this.bus.emit('stateChanged', undefined);
    return true;
  }

  // ---------- level / reputation ----------

  addXp(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const c = this.state.company;
    c.xp += amount;
    while (c.xp >= xpForLevel(c.level)) {
      c.xp -= xpForLevel(c.level);
      c.level += 1;
      this.bus.emit('levelUp', { level: c.level });
      this.bus.emit('toast', { kind: 'success', text: `toast.levelUp:${c.level}` });
    }
    this.bus.emit('stateChanged', undefined);
  }

  changeReputation(delta: number): void {
    const c = this.state.company;
    c.reputation = clamp(c.reputation + delta, 0, 100);
    this.state.stats.maxReputation = Math.max(this.state.stats.maxReputation, c.reputation);
    this.bus.emit('reputationChanged', { value: c.reputation });
    this.bus.emit('stateChanged', undefined);
  }

  // ---------- office ----------

  officeUpgradeCost(): number | null {
    const lvl = this.state.company.officeLevel;
    return lvl >= MAX_OFFICE_LEVEL ? null : OFFICE_COSTS[lvl];
  }

  buyOffice(): { ok: boolean; error?: CompanyError } {
    const cost = this.officeUpgradeCost();
    if (cost === null) return { ok: false, error: 'max' };
    if (this.state.company.level < this.state.company.officeLevel + 2) return { ok: false, error: 'level' };
    if (!this.economy.spend('cash', cost, 'office', { description: 'office upgrade' })) return { ok: false, error: 'funds' };
    this.state.company.officeLevel += 1;
    this.bus.emit('stateChanged', undefined);
    return { ok: true };
  }

  // ---------- drivers ----------

  driverSlots(): number {
    return BASE_DRIVER_SLOTS + this.state.company.officeLevel;
  }

  /** Deterministic per day, so refreshing the page does not re-roll candidates. */
  candidates(now = this.clock.now()): DriverCandidate[] {
    const rnd = mulberry32(hashString(`cand:${dayKey(now)}:${this.state.createdAt}`));
    const out: DriverCandidate[] = [];
    for (let i = 0; i < 4; i++) {
      const experience = 1 + Math.floor(rnd() * Math.min(10, 2 + this.state.company.level * 1.5));
      const skill = Math.round(clamp(38 + experience * 5 + rnd() * 22, 20, 98));
      const fuelEfficiency = Math.round(clamp(35 + experience * 4 + rnd() * 30, 20, 98));
      const customerSatisfaction = Math.round(clamp(40 + experience * 4 + rnd() * 30, 20, 98));
      const fair = Math.round(DRIVER_BASE_SALARY + experience * 120 + skill * 4);
      out.push({
        id: `cand_${dayKey(now)}_${i}`,
        name: `${pick(rnd, FIRST_NAMES)} ${pick(rnd, LAST_NAMES)}`,
        experience,
        skill,
        fuelEfficiency,
        customerSatisfaction,
        fairSalary: fair,
        hiringFee: fair * 2,
      });
    }
    return out;
  }

  hire(candidateId: string): { ok: boolean; error?: CompanyError; driver?: Driver } {
    const cand = this.candidates().find((c) => c.id === candidateId);
    if (!cand) return { ok: false, error: 'notFound' };
    if (this.state.drivers.length >= this.driverSlots()) return { ok: false, error: 'slots' };
    if (this.state.drivers.some((d) => d.id === `drv_${cand.id}`)) return { ok: false, error: 'notFound' };
    if (!this.economy.spend('cash', cand.hiringFee, 'hiring', { ref: cand.id, description: `hire ${cand.name}` })) return { ok: false, error: 'funds' };
    const now = this.clock.now();
    const d: Driver = {
      id: `drv_${cand.id}`,
      name: cand.name,
      experience: cand.experience,
      skill: cand.skill,
      fuelEfficiency: cand.fuelEfficiency,
      customerSatisfaction: cand.customerSatisfaction,
      salaryPerDay: cand.fairSalary,
      assignedBusUid: null,
      assignedConnectionId: null,
      assignedVariant: 'old',
      hiredAt: now,
      lastTickAt: now,
      tripsDone: 0,
      revenueGenerated: 0,
      profitGenerated: 0,
      status: 'idle',
      lastReport: '',
    };
    this.state.drivers.push(d);
    this.state.stats.driversHired += 1;
    this.bus.emit('driverHired', { driverId: d.id });
    this.bus.emit('stateChanged', undefined);
    return { ok: true, driver: d };
  }

  fairSalary(d: Driver): number {
    return Math.round(DRIVER_BASE_SALARY + d.experience * 120 + d.skill * 4);
  }

  setSalary(driverId: string, salary: number): { ok: boolean; error?: CompanyError } {
    const d = this.state.drivers.find((x) => x.id === driverId);
    if (!d) return { ok: false, error: 'notFound' };
    const fair = this.fairSalary(d);
    if (!Number.isFinite(salary) || salary < fair * 0.8 || salary > fair * 1.6) return { ok: false, error: 'salary' };
    d.salaryPerDay = Math.round(salary);
    this.bus.emit('stateChanged', undefined);
    return { ok: true };
  }

  fire(driverId: string): boolean {
    const d = this.state.drivers.find((x) => x.id === driverId);
    if (!d) return false;
    this.unassign(d);
    this.state.drivers = this.state.drivers.filter((x) => x.id !== driverId);
    this.bus.emit('stateChanged', undefined);
    return true;
  }

  private unassign(d: Driver): void {
    const b = this.garage.getBus(d.assignedBusUid);
    if (b) b.assignedDriverId = null;
    d.assignedBusUid = null;
    d.assignedConnectionId = null;
    d.status = 'idle';
  }

  assign(driverId: string, busUid: string | null, connectionId: string | null, variant: RouteVariant): { ok: boolean; error?: CompanyError } {
    const d = this.state.drivers.find((x) => x.id === driverId);
    if (!d) return { ok: false, error: 'notFound' };
    if (busUid === null || connectionId === null) {
      this.unassign(d);
      this.bus.emit('stateChanged', undefined);
      return { ok: true };
    }
    const b = this.garage.getBus(busUid);
    if (!b) return { ok: false, error: 'noBus' };
    if (b.assignedDriverId && b.assignedDriverId !== driverId) return { ok: false, error: 'busBusy' };
    if (this.state.selectedBusUid === busUid && this.state.buses.length === 1) return { ok: false, error: 'busBusy' };
    if (!this.routes.isConnectionUnlocked(connectionId)) return { ok: false, error: 'routeLocked' };
    this.unassign(d);
    d.assignedBusUid = busUid;
    d.assignedConnectionId = connectionId;
    d.assignedVariant = variant;
    d.lastTickAt = this.clock.now();
    d.status = 'working';
    b.assignedDriverId = d.id;
    if (this.state.selectedBusUid === busUid) {
      const other = this.state.buses.find((x) => x.uid !== busUid && !x.assignedDriverId);
      this.state.selectedBusUid = other?.uid ?? busUid;
    }
    this.bus.emit('stateChanged', undefined);
    return { ok: true };
  }

  // ---------- AI driver simulation (also used for offline progress) ----------

  /** Duration of one AI round trip leg in hours. */
  aiTripHours(d: Driver, distanceKm: number, highway: boolean): number {
    const speed = (highway ? 82 : 60) * (0.85 + d.skill / 400);
    return distanceKm / speed + 0.35;
  }

  /** Simulates one trip for an AI driver and applies the money. Returns null when it cannot run. */
  simulateDriverTrip(d: Driver, rnd: () => number): DriverTripResult | null {
    const bus = this.garage.getBus(d.assignedBusUid);
    if (!bus || !d.assignedConnectionId) return null;
    if (bus.damage >= 80) {
      d.status = 'brokenDown';
      d.lastReport = 'brokenDown';
      return null;
    }
    const spec = this.routes.resolve(d.assignedConnectionId, d.tripsDone % 2 === 1, d.assignedVariant, { timestamp: this.clock.now(), hour: 12 });
    const model = this.garage.model(bus);
    const eff = this.garage.effectiveStats(bus);
    const price = spec.ticketRefPrice;
    const dem = computeDemand({
      route: spec,
      hourDemand: 0.9,
      weatherDemand: 1,
      reputation: this.state.company.reputation,
      ticketPrice: price,
      seats: eff.seats,
      demandBoost: false,
      companyLevel: this.state.company.level,
    });
    const satMult = 0.8 + d.customerSatisfaction / 500;
    const pax = Math.min(eff.seats, Math.round((dem.sold + dem.reservations) * satMult));
    const salaryFactor = clamp(0.9 + 0.1 * (d.salaryPerDay / this.fairSalary(d)), 0.9, 1.06);
    const revenue = Math.round((pax * price * 0.92 + Math.min(eff.luggageCapacity, pax * 0.7) * BAGGAGE_FEE) * salaryFactor);
    const fuelUnits = ((spec.distanceKm * eff.consumptionPer100) / 100) * (1.2 - d.fuelEfficiency / 500);
    const fuelCost = fuelUnits * this.garage.unitPrice(bus);
    const maint = spec.distanceKm * model.maintenancePerKm;
    const fee = revenue * TERMINAL_FEE_RATE;
    const upfront = fuelCost + spec.toll;
    if (this.state.cash < upfront) {
      d.status = 'noFunds';
      d.lastReport = 'noFunds';
      return null;
    }
    this.economy.spend('cash', fuelCost, 'fuel', { ref: d.id, description: 'AI trip fuel' });
    if (spec.toll > 0) this.economy.spend('cash', spec.toll, 'toll', { ref: d.id, description: 'AI trip toll' });
    this.economy.add('cash', revenue, 'tripRevenue', { ref: d.id, description: `AI ${spec.id}` });
    this.economy.spendUpTo(maint, 'maintenance', { ref: d.id, description: 'AI trip maintenance' });
    this.economy.spendUpTo(fee, 'terminalFee', { ref: d.id, description: 'AI trip fee' });
    bus.odometerKm += spec.distanceKm;
    bus.damage = clamp(bus.damage + (0.4 + rnd() * 1.2) * (1.3 - d.skill / 100), 0, 100);
    this.state.stats.totalKm += spec.distanceKm;
    this.state.stats.totalPassengers += pax;
    d.tripsDone += 1;
    const profit = revenue - fuelCost - spec.toll - maint - fee;
    d.revenueGenerated += revenue;
    d.profitGenerated += profit;
    d.status = 'working';
    d.lastReport = 'ok';
    this.addXp(8 + spec.distanceKm / 40);
    return { driverId: d.id, revenue, expenses: fuelCost + spec.toll + maint + fee, profit, passengers: pax };
  }

  /**
   * Advances every AI driver up to `now`. Offline time is capped (OFFLINE_CAP_HOURS and
   * OFFLINE_CAP_TRIPS per driver) so leaving the game for weeks cannot create unlimited money.
   */
  tickDrivers(now = this.clock.now()): OfflineReport {
    const report: OfflineReport = { elapsedMs: 0, trips: 0, revenue: 0, expenses: 0, salary: 0, profit: 0, perDriver: [] };
    const capMs = OFFLINE_CAP_HOURS * 3_600_000;
    for (const d of this.state.drivers) {
      let since = d.lastTickAt;
      if (now - since > capMs) since = now - capMs;
      const elapsed = Math.max(0, now - since);
      if (elapsed <= 0) continue;
      report.elapsedMs = Math.max(report.elapsedMs, elapsed);

      // salary accrues continuously, whether or not the driver is working
      const salary = (d.salaryPerDay * elapsed) / 86_400_000;
      const sal = this.economy.spendUpTo(salary, 'salary', { ref: d.id, description: `salary ${d.name}` });
      report.salary += sal.paid;
      report.expenses += sal.paid;
      let trips = 0;
      let profit = -sal.paid;
      let cursor = since;

      if (d.assignedBusUid && d.assignedConnectionId) {
        const conn = CONNECTION_BY_ID[d.assignedConnectionId];
        const highway = d.assignedVariant === 'highway' && !!conn?.motorway;
        const spec = this.routes.resolve(d.assignedConnectionId, false, d.assignedVariant);
        const legMs = this.aiTripHours(d, spec.distanceKm, highway) * 3_600_000;
        const rnd = mulberry32(hashString(`${d.id}:${Math.floor(since / 60000)}`));
        while (cursor + legMs <= now && trips < OFFLINE_CAP_TRIPS) {
          const r = this.simulateDriverTrip(d, rnd);
          if (!r) break;
          trips += 1;
          cursor += legMs;
          report.revenue += r.revenue;
          report.expenses += r.expenses;
          profit += r.profit;
        }
      }
      report.trips += trips;
      report.profit += profit;
      // partial progress is dropped on purpose: no hoarding of half-finished trips
      d.lastTickAt = Math.max(d.lastTickAt, now);
      if (sal.unpaid > 0) d.status = 'noFunds';
      report.perDriver.push({ driverId: d.id, name: d.name, trips, profit, status: d.status });
    }
    if (report.trips > 0 || report.salary > 0) this.bus.emit('stateChanged', undefined);
    return report;
  }
}
