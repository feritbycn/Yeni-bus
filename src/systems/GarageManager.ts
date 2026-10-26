import type { BusUpgrades, GameEvents, GameState, OwnedBus } from '../core/types';
import type { EventBus } from '../core/EventBus';
import type { EconomyManager } from './EconomyManager';
import type { PremiumService } from '../services/PremiumService';
import { BUS_BY_ID, type BusModelDef } from '../data/buses';
import {
  BASE_GARAGE_SLOTS,
  ENERGY_PRICE_PER_KWH,
  FUEL_PRICE_PER_L,
  GARAGE_EXPANSION_SLOTS,
  MAX_UPGRADE_LEVEL,
  PLATE_REGEX,
  REPAIR_COST_FACTOR,
  UPGRADE_COST_FRACTIONS,
} from '../data/constants';
import { COSMETIC_BY_ID, DEFAULT_COSMETICS, type CosmeticKind } from '../data/cosmetics';
import { clamp, round2 } from '../core/utils';
import { createOwnedBus } from '../core/state';

export type GarageError =
  | 'unknownModel'
  | 'level'
  | 'funds'
  | 'slots'
  | 'notOwned'
  | 'lastBus'
  | 'assigned'
  | 'maxUpgrade'
  | 'invalidPlate'
  | 'notUnlocked'
  | 'premiumRequired'
  | 'nothingToDo'
  | 'unknownCosmetic'
  | 'wrongKind';

export interface GarageResult<T = undefined> {
  ok: boolean;
  error?: GarageError;
  value?: T;
}

export interface EffectiveStats {
  maxSpeedKmh: number;
  powerKw: number;
  consumptionPer100: number;
  comfort: number;
  grip: number;
  massKg: number;
  seats: number;
  luggageCapacity: number;
  tankCapacity: number;
}

const fail = <T = undefined>(error: GarageError): GarageResult<T> => ({ ok: false, error });

export class GarageManager {
  constructor(
    private readonly state: GameState,
    private readonly bus: EventBus<GameEvents>,
    private readonly economy: EconomyManager,
    private readonly premium: PremiumService,
  ) {}

  model(bus: OwnedBus): BusModelDef {
    return BUS_BY_ID[bus.modelId];
  }

  getBus(uidValue: string | null | undefined): OwnedBus | undefined {
    return uidValue ? this.state.buses.find((b) => b.uid === uidValue) : undefined;
  }

  selectedBus(): OwnedBus | undefined {
    return this.getBus(this.state.selectedBusUid) ?? this.state.buses[0];
  }

  slots(): number {
    return (
      BASE_GARAGE_SLOTS +
      this.state.company.officeLevel +
      (this.premium.hasGarageExpansion() ? GARAGE_EXPANSION_SLOTS : 0)
    );
  }

  effectiveStats(bus: OwnedBus): EffectiveStats {
    const m = this.model(bus);
    const u = bus.upgrades;
    const dmg = clamp(bus.damage, 0, 100);
    return {
      maxSpeedKmh: m.maxSpeedKmh * (1 + 0.02 * u.engine) * (1 - dmg / 400),
      powerKw: m.powerKw * (1 + 0.07 * u.engine) * (1 - dmg / 300),
      consumptionPer100: m.consumptionPer100 * (1 - 0.02 * u.engine) * (1 + dmg / 500),
      comfort: clamp(m.comfort + 6 * u.comfort - dmg / 4, 0, 100),
      grip: (0.85 + (m.handling / 100) * 0.3) * (1 + 0.04 * u.handling) * (1 - dmg / 500),
      massKg: m.massKg,
      seats: m.seats,
      luggageCapacity: m.luggageCapacity,
      tankCapacity: m.tankCapacity,
    };
  }

  // ---------- buy / sell / select ----------

  buyPrice(modelId: string): number {
    return BUS_BY_ID[modelId]?.price ?? 0;
  }

  canBuy(modelId: string): GarageResult {
    const m = BUS_BY_ID[modelId];
    if (!m) return fail('unknownModel');
    if (this.state.company.level < m.unlockLevel && !this.premium.hasBusUnlock(modelId)) return fail('level');
    if (this.state.buses.length >= this.slots()) return fail('slots');
    if (!this.economy.canAfford('cash', m.price)) return fail('funds');
    return { ok: true };
  }

  /** Cash is only deducted once every check has passed. */
  buy(modelId: string): GarageResult<OwnedBus> {
    const check = this.canBuy(modelId);
    if (!check.ok) return fail(check.error!);
    const m = BUS_BY_ID[modelId];
    if (!this.economy.spend('cash', m.price, 'busPurchase', { ref: modelId, description: `buy ${modelId}` })) return fail('funds');
    const b = createOwnedBus(modelId, m.price);
    this.state.buses.push(b);
    this.state.stats.busesPurchased += 1;
    this.bus.emit('busPurchased', { modelId, uid: b.uid });
    this.bus.emit('stateChanged', undefined);
    return { ok: true, value: b };
  }

  resaleValue(bus: OwnedBus): number {
    const m = this.model(bus);
    const base = bus.purchasePrice > 0 ? bus.purchasePrice : m.price * 0.5;
    const value = base * m.resaleRate * (1 - clamp(bus.damage, 0, 100) / 150) + bus.upgradeSpent * 0.5;
    return Math.max(0, Math.round(value));
  }

  sell(uidValue: string): GarageResult<number> {
    const b = this.getBus(uidValue);
    if (!b) return fail('notOwned');
    if (this.state.buses.length <= 1) return fail('lastBus');
    if (b.assignedDriverId) return fail('assigned');
    const value = this.resaleValue(b);
    this.state.buses = this.state.buses.filter((x) => x.uid !== uidValue);
    if (this.state.selectedBusUid === uidValue) this.state.selectedBusUid = this.state.buses[0]?.uid ?? null;
    this.economy.add('cash', value, 'busSale', { ref: b.modelId, description: `sell ${b.modelId}` });
    this.bus.emit('busSold', { modelId: b.modelId, uid: uidValue });
    return { ok: true, value };
  }

  /** Only owned buses that are not assigned to an AI driver can be driven. */
  canDrive(uidValue: string): GarageResult {
    const b = this.getBus(uidValue);
    if (!b) return fail('notOwned');
    if (b.assignedDriverId) return fail('assigned');
    return { ok: true };
  }

  select(uidValue: string): GarageResult {
    const c = this.canDrive(uidValue);
    if (!c.ok) return c;
    this.state.selectedBusUid = uidValue;
    this.bus.emit('stateChanged', undefined);
    return { ok: true };
  }

  // ---------- cosmetics ----------

  /** Cost after Premium discount. */
  cosmeticCost(id: string): { cash?: number; gold?: number } {
    const def = COSMETIC_BY_ID[id];
    if (!def) return {};
    const d = 1 - this.premium.garageDiscount();
    return {
      cash: def.cost.cash ? Math.round(def.cost.cash * d) : undefined,
      gold: def.cost.gold ? Math.round(def.cost.gold * d) : undefined,
    };
  }

  ownsCosmetic(id: string): boolean {
    const def = COSMETIC_BY_ID[id];
    if (!def) return false;
    if (this.state.unlockedCosmetics.includes(id)) return true;
    if (def.pack && this.state.purchases.entitlements.cosmeticPacks.includes(def.pack)) return true;
    if (def.premiumOnly && this.premium.isPremium()) return true;
    const t = this.state.tempCosmetic;
    if (t && t.cosmeticId === id) return true; // time-limited check happens in isUsable
    return false;
  }

  isUsable(id: string, now: number): boolean {
    const def = COSMETIC_BY_ID[id];
    if (!def) return false;
    if (def.premiumOnly && !this.premium.isPremium()) {
      // allow the rewarded 24h trial on premium cosmetics
      const t = this.state.tempCosmetic;
      return !!t && t.cosmeticId === id && t.expiresAt > now;
    }
    if (this.state.unlockedCosmetics.includes(id)) return true;
    if (def.pack && this.state.purchases.entitlements.cosmeticPacks.includes(def.pack)) return true;
    return def.premiumOnly === true && this.premium.isPremium();
  }

  buyCosmetic(id: string): GarageResult {
    const def = COSMETIC_BY_ID[id];
    if (!def) return fail('unknownCosmetic');
    if (def.premiumOnly) return fail('premiumRequired');
    if (def.pack) return fail('notUnlocked');
    if (this.state.unlockedCosmetics.includes(id)) return fail('nothingToDo');
    const cost = this.cosmeticCost(id);
    if (cost.cash && !this.economy.canAfford('cash', cost.cash)) return fail('funds');
    if (cost.gold && !this.economy.canAfford('gold', cost.gold)) return fail('funds');
    if (cost.cash) this.economy.spend('cash', cost.cash, 'cosmetic', { ref: id });
    if (cost.gold) this.economy.spend('gold', cost.gold, 'cosmetic', { ref: id });
    this.state.unlockedCosmetics.push(id);
    this.bus.emit('stateChanged', undefined);
    return { ok: true };
  }

  applyCosmetic(uidValue: string, id: string, now: number): GarageResult {
    const b = this.getBus(uidValue);
    if (!b) return fail('notOwned');
    const def = COSMETIC_BY_ID[id];
    if (!def) return fail('unknownCosmetic');
    if (!this.isUsable(id, now)) return fail(def.premiumOnly ? 'premiumRequired' : 'notUnlocked');
    b[def.kind as CosmeticKind] = id;
    this.bus.emit('stateChanged', undefined);
    return { ok: true };
  }

  /**
   * What is actually drawn. If Premium ended (or a trial expired) a premium-only cosmetic
   * silently falls back to the default so rights always match the membership.
   */
  effectiveCosmetic(bus: OwnedBus, kind: CosmeticKind, now: number): string {
    const id = bus[kind];
    return this.isUsable(id, now) ? id : DEFAULT_COSMETICS[kind];
  }

  setPlate(uidValue: string, plate: string): GarageResult {
    const b = this.getBus(uidValue);
    if (!b) return fail('notOwned');
    const p = plate.toUpperCase().trim().replace(/\s+/g, ' ');
    if (!PLATE_REGEX.test(p)) return fail('invalidPlate');
    b.plate = p;
    this.bus.emit('stateChanged', undefined);
    return { ok: true };
  }

  // ---------- upgrades ----------

  upgradeCost(uidValue: string, kind: keyof BusUpgrades): number {
    const b = this.getBus(uidValue);
    if (!b) return 0;
    const lvl = b.upgrades[kind];
    if (lvl >= MAX_UPGRADE_LEVEL) return 0;
    const m = this.model(b);
    let cost = m.price * UPGRADE_COST_FRACTIONS[lvl];
    cost *= 1 - this.premium.garageDiscount();
    if (this.state.boosts.upgradeDiscount > 0) cost *= 0.75;
    return Math.round(cost);
  }

  upgrade(uidValue: string, kind: keyof BusUpgrades): GarageResult<number> {
    const b = this.getBus(uidValue);
    if (!b) return fail('notOwned');
    if (b.upgrades[kind] >= MAX_UPGRADE_LEVEL) return fail('maxUpgrade');
    const cost = this.upgradeCost(uidValue, kind);
    if (!this.economy.spend('cash', cost, 'upgrade', { ref: `${b.modelId}:${kind}`, description: `upgrade ${kind}` })) return fail('funds');
    if (this.state.boosts.upgradeDiscount > 0) this.state.boosts.upgradeDiscount -= 1;
    b.upgrades[kind] += 1;
    b.upgradeSpent += cost;
    this.state.stats.upgradesDone += 1;
    this.bus.emit('busUpgraded', { uid: uidValue, kind, level: b.upgrades[kind] });
    this.bus.emit('stateChanged', undefined);
    return { ok: true, value: cost };
  }

  // ---------- maintenance & fuel ----------

  repairCost(uidValue: string): number {
    const b = this.getBus(uidValue);
    if (!b || b.damage <= 0) return 0;
    const m = this.model(b);
    let cost = b.damage * m.price * REPAIR_COST_FACTOR;
    if (this.state.boosts.maintenanceDiscount > 0) cost *= 0.7;
    cost *= 1 - this.premium.garageDiscount() * 0.5;
    return Math.round(cost);
  }

  repair(uidValue: string): GarageResult<number> {
    const b = this.getBus(uidValue);
    if (!b) return fail('notOwned');
    if (b.damage <= 0) return fail('nothingToDo');
    const cost = this.repairCost(uidValue);
    if (!this.economy.spend('cash', cost, 'repair', { ref: b.modelId, description: 'repair' })) return fail('funds');
    if (this.state.boosts.maintenanceDiscount > 0) this.state.boosts.maintenanceDiscount -= 1;
    b.damage = 0;
    this.bus.emit('stateChanged', undefined);
    return { ok: true, value: cost };
  }

  unitPrice(bus: OwnedBus): number {
    return this.model(bus).powertrain === 'electric' ? ENERGY_PRICE_PER_KWH : FUEL_PRICE_PER_L;
  }

  /** Cost of filling `units` (or to full). */
  refuelCost(uidValue: string, units?: number): number {
    const b = this.getBus(uidValue);
    if (!b) return 0;
    const m = this.model(b);
    const missing = m.tankCapacity - b.fuel;
    const amount = clamp(units ?? missing, 0, missing);
    let cost = amount * this.unitPrice(b);
    if (this.state.boosts.fuelDiscount > 0) cost *= 0.7;
    return round2(cost);
  }

  refuel(uidValue: string, units?: number): GarageResult<number> {
    const b = this.getBus(uidValue);
    if (!b) return fail('notOwned');
    const m = this.model(b);
    const missing = m.tankCapacity - b.fuel;
    if (missing <= 0.5) return fail('nothingToDo');
    const amount = clamp(units ?? missing, 0, missing);
    const cost = this.refuelCost(uidValue, amount);
    if (!this.economy.spend('cash', cost, 'fuel', { ref: b.modelId, description: 'refuel' })) return fail('funds');
    if (this.state.boosts.fuelDiscount > 0) this.state.boosts.fuelDiscount -= 1;
    b.fuel = Math.min(m.tankCapacity, b.fuel + amount);
    this.bus.emit('stateChanged', undefined);
    return { ok: true, value: cost };
  }

  /** Free fill (used by the "fuel pack" product after a verified purchase). */
  fillFree(uidValue: string): void {
    const b = this.getBus(uidValue);
    if (b) b.fuel = this.model(b).tankCapacity;
  }

  /** Side-by-side comparison rows for two models. */
  static compare(a: BusModelDef, b: BusModelDef): { key: string; a: number; b: number; higherIsBetter: boolean }[] {
    return [
      { key: 'maxSpeed', a: a.maxSpeedKmh, b: b.maxSpeedKmh, higherIsBetter: true },
      { key: 'power', a: a.powerKw, b: b.powerKw, higherIsBetter: true },
      { key: 'consumption', a: a.consumptionPer100, b: b.consumptionPer100, higherIsBetter: false },
      { key: 'tank', a: a.tankCapacity, b: b.tankCapacity, higherIsBetter: true },
      { key: 'seats', a: a.seats, b: b.seats, higherIsBetter: true },
      { key: 'luggage', a: a.luggageCapacity, b: b.luggageCapacity, higherIsBetter: true },
      { key: 'price', a: a.price, b: b.price, higherIsBetter: false },
      { key: 'maintenance', a: a.maintenancePerKm, b: b.maintenancePerKm, higherIsBetter: false },
      { key: 'comfort', a: a.comfort, b: b.comfort, higherIsBetter: true },
      { key: 'handling', a: a.handling, b: b.handling, higherIsBetter: true },
    ];
  }
}
