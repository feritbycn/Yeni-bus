import type { GameEvents, GameState, RouteVariant, TripRecord, Weather } from '../core/types';
import type { EventBus } from '../core/EventBus';
import type { EconomyManager } from './EconomyManager';
import type { GarageManager } from './GarageManager';
import type { RouteManager, RouteSpec } from './RouteManager';
import type { CompanyManager } from './CompanyManager';
import type { ClockService } from './ClockService';
import { slotDemand, weatherFor } from './RouteManager';
import { computeDemand, createManifest, type DemandResult, type TripManifest } from './PassengerManager';
import { MAX_TRIPS, TERMINAL_FEE_RATE, TOW_COST } from '../data/constants';
import { WEATHER_DEMAND } from '../data/world';
import { capArray, clamp, hashString, mulberry32, uid } from '../core/utils';

export interface TripConfig {
  connectionId: string;
  reverse: boolean;
  variant: RouteVariant;
  busUid: string;
  departureHour: number;
  ticketPrice: number;
}

export interface TripPlan {
  id: string;
  config: TripConfig;
  route: RouteSpec;
  busUid: string;
  modelId: string;
  weather: Weather;
  hour: number;
  demand: DemandResult;
  manifest: TripManifest;
  startFuel: number;
  startDamage: number;
  fuelNeeded: number;
  boosts: { revenue: boolean; demand: boolean; consumed: boolean };
}

export type TripError =
  | 'noBus'
  | 'busAssigned'
  | 'routeLocked'
  | 'fuel'
  | 'damaged'
  | 'price'
  | 'unknownRoute';

export interface TripOutcome {
  status: 'completed' | 'outOfFuel' | 'abandoned' | 'wrecked';
  durationSec: number;
  endFuel: number;
  damageDelta: number;
  fines: number;
  lateSeconds: number;
}

export interface TripSummary {
  status: TripOutcome['status'];
  record?: TripRecord;
  revenue: number;
  ticketRevenue: number;
  baggageRevenue: number;
  boostRevenue: number;
  toll: number;
  maintenance: number;
  terminalFee: number;
  fines: number;
  fuelValue: number;
  towing: number;
  profit: number;
  rating: number;
  passengers: number;
  seats: number;
  xp: number;
  reputationDelta: number;
  satisfaction: number;
}

export class TripManager {
  constructor(
    private readonly state: GameState,
    private readonly bus: EventBus<GameEvents>,
    private readonly economy: EconomyManager,
    private readonly garage: GarageManager,
    private readonly routes: RouteManager,
    private readonly company: CompanyManager,
    private readonly clock: ClockService,
  ) {}

  /** Price the player may set: 50%..180% of the reference fare. */
  priceRange(spec: RouteSpec): { min: number; max: number } {
    return { min: Math.max(1, Math.round(spec.ticketRefPrice * 0.5)), max: Math.round(spec.ticketRefPrice * 1.8) };
  }

  prepare(config: TripConfig): { ok: true; plan: TripPlan } | { ok: false; error: TripError } {
    const bus = this.garage.getBus(config.busUid);
    if (!bus) return { ok: false, error: 'noBus' };
    if (bus.assignedDriverId) return { ok: false, error: 'busAssigned' };
    if (!this.routes.isConnectionUnlocked(config.connectionId)) return { ok: false, error: 'routeLocked' };
    const now = this.clock.now();
    let spec: RouteSpec;
    try {
      spec = this.routes.resolve(config.connectionId, config.reverse, config.variant, { timestamp: now, hour: config.departureHour });
    } catch {
      return { ok: false, error: 'unknownRoute' };
    }
    const range = this.priceRange(spec);
    if (!Number.isFinite(config.ticketPrice) || config.ticketPrice < range.min || config.ticketPrice > range.max) {
      return { ok: false, error: 'price' };
    }
    if (bus.damage >= 90) return { ok: false, error: 'damaged' };
    const eff = this.garage.effectiveStats(bus);
    const fuelNeeded = (spec.distanceKm * eff.consumptionPer100) / 100;
    if (bus.fuel < fuelNeeded * 1.02) return { ok: false, error: 'fuel' };

    const weather = weatherFor(config.connectionId, now, config.departureHour);
    const demand = computeDemand({
      route: spec,
      hourDemand: slotDemand(config.departureHour),
      weatherDemand: WEATHER_DEMAND[weather] ?? 1,
      reputation: this.state.company.reputation,
      ticketPrice: config.ticketPrice,
      seats: eff.seats,
      demandBoost: this.state.boosts.demand > 0,
      companyLevel: this.state.company.level,
    });
    const rnd = mulberry32(hashString(`${spec.id}:${now}`));
    const manifest = createManifest(spec, eff.seats, eff.luggageCapacity, config.ticketPrice, demand, rnd);
    return {
      ok: true,
      plan: {
        id: uid('trip'),
        config,
        route: spec,
        busUid: bus.uid,
        modelId: bus.modelId,
        weather,
        hour: config.departureHour,
        demand,
        manifest,
        startFuel: bus.fuel,
        startDamage: bus.damage,
        fuelNeeded,
        boosts: { revenue: false, demand: false, consumed: false },
      },
    };
  }

  /** Called when the trip really starts: consumes one-trip boosts (once). */
  commit(plan: TripPlan): void {
    if (plan.boosts.consumed) return;
    plan.boosts.consumed = true;
    if (this.state.boosts.revenue > 0) {
      this.state.boosts.revenue -= 1;
      plan.boosts.revenue = true;
    }
    if (this.state.boosts.demand > 0) {
      this.state.boosts.demand -= 1;
      plan.boosts.demand = true;
    }
    this.bus.emit('stateChanged', undefined);
  }

  /** Applies the result of a driven trip to money, bus, stats, reputation, missions. */
  settle(plan: TripPlan, outcome: TripOutcome): TripSummary {
    const bus = this.garage.getBus(plan.busUid);
    const model = this.garage.model(bus!);
    const m = plan.manifest;
    const route = plan.route;
    const status = outcome.status;

    // bus state is always updated, whatever happened
    if (bus) {
      bus.fuel = clamp(outcome.endFuel, 0, model.tankCapacity);
      bus.damage = clamp(bus.damage + outcome.damageDelta, 0, 100);
      const fraction = status === 'completed' ? 1 : clamp((m.boardedTotal > 0 ? 0.5 : 0.1), 0, 1);
      bus.odometerKm += route.distanceKm * fraction;
    }

    const fuelUsed = Math.max(0, plan.startFuel - outcome.endFuel);
    const unit = bus ? this.garage.unitPrice(bus) : 0;
    const fuelValue = fuelUsed * unit;

    const summary: TripSummary = {
      status,
      revenue: 0,
      ticketRevenue: 0,
      baggageRevenue: 0,
      boostRevenue: 0,
      toll: 0,
      maintenance: 0,
      terminalFee: 0,
      fines: outcome.fines,
      fuelValue,
      towing: 0,
      profit: 0,
      rating: 0,
      passengers: m.boardedTotal,
      seats: m.seats,
      xp: 0,
      reputationDelta: 0,
      satisfaction: m.satisfaction,
    };

    if (status !== 'completed') {
      // failed trip: no revenue; fines are still due
      if (outcome.fines > 0) this.economy.spendUpTo(outcome.fines, 'fine', { ref: plan.id, description: 'trip fines' });
      if (status === 'outOfFuel' || status === 'wrecked') {
        const paid = this.economy.spendUpTo(TOW_COST, 'towing', { ref: plan.id, description: 'towing' });
        summary.towing = paid.paid;
      }
      const rep = status === 'abandoned' ? -3 : -5;
      this.company.changeReputation(rep);
      summary.reputationDelta = rep;
      summary.profit = -(summary.towing + outcome.fines);
      this.state.stats.cleanStreak = 0;
      this.bus.emit('stateChanged', undefined);
      return summary;
    }

    // ---- completed ----
    const comfortBonus = bus ? (this.garage.effectiveStats(bus).comfort - 50) / 10 : 0;
    const late = outcome.lateSeconds > 0;
    if (late) m.satisfactionEvent('late');
    const rating = m.rating(comfortBonus);
    const satMult = 0.7 + (rating / 5) * 0.4; // unhappy riders pay less (refunds / complaints)
    const ticket = m.ticketRevenue * satMult;
    const baggage = m.baggageRevenue();
    let revenue = ticket + baggage;
    let boost = 0;
    if (plan.boosts.revenue) {
      boost = revenue * 0.25;
      revenue += boost;
    }
    revenue = Math.round(revenue);

    const toll = route.toll;
    const maintenance = route.distanceKm * model.maintenancePerKm;
    const fee = revenue * TERMINAL_FEE_RATE;

    this.economy.add('cash', revenue, 'tripRevenue', { ref: plan.id, description: `trip ${route.id}` });
    if (toll > 0) this.economy.spendUpTo(toll, 'toll', { ref: plan.id, description: 'toll' });
    this.economy.spendUpTo(maintenance, 'maintenance', { ref: plan.id, description: 'running maintenance' });
    this.economy.spendUpTo(fee, 'terminalFee', { ref: plan.id, description: 'terminal fee' });
    if (outcome.fines > 0) this.economy.spendUpTo(outcome.fines, 'fine', { ref: plan.id, description: 'trip fines' });

    const expenses = toll + maintenance + fee + outcome.fines + fuelValue;
    const profit = revenue - expenses;

    // reputation and xp
    const repDelta = clamp((rating - 3) * 1.4, -4, 3.5);
    this.company.changeReputation(repDelta);
    const xp = Math.round((20 + m.boardedTotal * 0.6 + route.distanceKm * 0.12) * (0.6 + rating / 5 * 0.7));
    this.company.addXp(xp);

    const clean = outcome.damageDelta <= 0.001;
    const st = this.state.stats;
    st.tripsCompleted += 1;
    st.totalKm += route.distanceKm;
    st.totalPassengers += m.boardedTotal;
    st.cleanStreak = clean ? st.cleanStreak + 1 : 0;
    st.bestCleanStreak = Math.max(st.bestCleanStreak, st.cleanStreak);
    if (rating >= 4.5) st.fiveStarTrips += 1;

    const record: TripRecord = {
      id: plan.id,
      time: this.clock.now(),
      connectionId: route.connectionId,
      variant: route.variant,
      fromId: route.fromId,
      toId: route.toId,
      busModelId: plan.modelId,
      seats: m.seats,
      passengers: m.boardedTotal,
      revenue,
      expenses,
      profit,
      rating,
      distanceKm: route.distanceKm,
      fuelUsed,
      damageDelta: outcome.damageDelta,
      byDriverId: null,
      durationMin: Math.round(outcome.durationSec / 60),
    };
    this.state.trips.push(record);
    capArray(this.state.trips, MAX_TRIPS);

    const fuelPer100 = route.distanceKm > 0 ? (fuelUsed / route.distanceKm) * 100 : 0;
    this.bus.emit('tripCompleted', {
      connectionId: route.connectionId,
      variant: route.variant,
      fromId: route.fromId,
      toId: route.toId,
      passengers: m.boardedTotal,
      seats: m.seats,
      rating,
      damageDelta: outcome.damageDelta,
      fuelUsed,
      fuelPer100,
      modelConsumption: this.garage.effectiveStats(bus!).consumptionPer100,
      revenue,
      profit,
      distanceKm: route.distanceKm,
      byDriver: false,
      clean,
    });
    this.bus.emit('stateChanged', undefined);

    summary.record = record;
    summary.revenue = revenue;
    summary.ticketRevenue = Math.round(ticket);
    summary.baggageRevenue = baggage;
    summary.boostRevenue = Math.round(boost);
    summary.toll = toll;
    summary.maintenance = Math.round(maintenance);
    summary.terminalFee = Math.round(fee);
    summary.profit = Math.round(profit);
    summary.rating = rating;
    summary.xp = xp;
    summary.reputationDelta = repDelta;
    summary.satisfaction = m.satisfaction;
    return summary;
  }
}
