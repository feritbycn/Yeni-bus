import { describe, expect, it } from 'vitest';
import { makeEnv } from './helpers';
import { BUS_BY_ID } from '../src/data/buses';
import { GarageManager } from '../src/systems/GarageManager';

describe('GarageManager', () => {
  it('buying deducts cash only on success', () => {
    const { ctx } = makeEnv();
    ctx.state.company.level = 5;
    ctx.state.cash = BUS_BY_ID.standard.price - 1;
    const r = ctx.garage.buy('standard');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('funds');
    expect(ctx.state.cash).toBe(BUS_BY_ID.standard.price - 1);
    expect(ctx.state.buses.length).toBe(1);

    ctx.state.cash = BUS_BY_ID.standard.price + 100;
    const ok = ctx.garage.buy('standard');
    expect(ok.ok).toBe(true);
    expect(ctx.state.cash).toBe(100);
    expect(ctx.state.buses.length).toBe(2);
  });

  it('respects level requirement and garage slots', () => {
    const { ctx } = makeEnv();
    ctx.state.cash = 10_000_000;
    expect(ctx.garage.buy('luxury').error).toBe('level');
    ctx.state.company.level = 10;
    expect(ctx.garage.buy('eco').ok).toBe(true); // 2 slots
    expect(ctx.garage.buy('eco').error).toBe('slots');
  });

  it('a purchased bus unlock bypasses the level requirement', () => {
    const { ctx } = makeEnv();
    ctx.state.cash = 10_000_000;
    ctx.state.purchases.entitlements.unlockedBusIds.push('luxury');
    ctx.state.company.officeLevel = 2;
    expect(ctx.garage.buy('luxury').ok).toBe(true);
  });

  it('non-owned buses cannot be selected or driven', () => {
    const { ctx } = makeEnv();
    expect(ctx.garage.select('nope').ok).toBe(false);
    expect(ctx.garage.canDrive('nope').error).toBe('notOwned');
  });

  it('selling pays resale value, keeps at least one bus', () => {
    const { ctx } = makeEnv();
    ctx.state.cash = 10_000_000;
    ctx.state.company.level = 10;
    ctx.state.company.officeLevel = 3;
    const b = ctx.garage.buy('standard').value!;
    const before = ctx.state.cash;
    const expected = ctx.garage.resaleValue(b);
    const r = ctx.garage.sell(b.uid);
    expect(r.ok).toBe(true);
    expect(ctx.state.cash).toBe(before + expected);
    expect(expected).toBeLessThan(BUS_BY_ID.standard.price);
    const last = ctx.state.buses[0];
    expect(ctx.garage.sell(last.uid).error).toBe('lastBus');
  });

  it('upgrade uses the right balance, stops at max level', () => {
    const { ctx } = makeEnv();
    ctx.state.cash = 1_000_000;
    const b = ctx.state.buses[0];
    const cost = ctx.garage.upgradeCost(b.uid, 'engine');
    const before = ctx.state.cash;
    const r = ctx.garage.upgrade(b.uid, 'engine');
    expect(r.ok).toBe(true);
    expect(ctx.state.cash).toBe(before - cost);
    expect(b.upgrades.engine).toBe(1);
    ctx.garage.upgrade(b.uid, 'engine');
    ctx.garage.upgrade(b.uid, 'engine');
    expect(ctx.garage.upgrade(b.uid, 'engine').error).toBe('maxUpgrade');
    expect(ctx.garage.effectiveStats(b).powerKw).toBeGreaterThan(BUS_BY_ID.eco.powerKw);
  });

  it('upgrade fails without funds and does not charge', () => {
    const { ctx } = makeEnv();
    ctx.state.cash = 10;
    const b = ctx.state.buses[0];
    expect(ctx.garage.upgrade(b.uid, 'comfort').error).toBe('funds');
    expect(ctx.state.cash).toBe(10);
    expect(b.upgrades.comfort).toBe(0);
  });

  it('refuel and repair charge correct amounts; fuel discount boost applies once', () => {
    const { ctx } = makeEnv();
    const b = ctx.state.buses[0];
    b.fuel = 50;
    b.damage = 20;
    const full = ctx.garage.refuelCost(b.uid);
    ctx.state.boosts.fuelDiscount = 1;
    const disc = ctx.garage.refuelCost(b.uid);
    expect(disc).toBeCloseTo(full * 0.7, 1);
    const before = ctx.state.cash;
    const r = ctx.garage.refuel(b.uid);
    expect(r.ok).toBe(true);
    expect(ctx.state.cash).toBeCloseTo(before - disc, 1);
    expect(b.fuel).toBe(BUS_BY_ID.eco.tankCapacity);
    expect(ctx.state.boosts.fuelDiscount).toBe(0);
    expect(ctx.garage.repair(b.uid).ok).toBe(true);
    expect(b.damage).toBe(0);
  });

  it('validates plates', () => {
    const { ctx } = makeEnv();
    const b = ctx.state.buses[0];
    expect(ctx.garage.setPlate(b.uid, 'a').error).toBe('invalidPlate');
    expect(ctx.garage.setPlate(b.uid, '<script>').error).toBe('invalidPlate');
    expect(ctx.garage.setPlate(b.uid, '34 abc 123').ok).toBe(true);
    expect(b.plate).toBe('34 ABC 123');
  });

  it('cosmetics must be bought before they can be applied', () => {
    const { ctx, time } = makeEnv();
    const b = ctx.state.buses[0];
    expect(ctx.garage.applyCosmetic(b.uid, 'paint_red', time.now).ok).toBe(false);
    ctx.state.cash = 5000;
    expect(ctx.garage.buyCosmetic('paint_red').ok).toBe(true);
    expect(ctx.garage.applyCosmetic(b.uid, 'paint_red', time.now).ok).toBe(true);
    expect(b.paint).toBe('paint_red');
  });

  it('compare returns all stat rows', () => {
    const r = GarageManager.compare(BUS_BY_ID.eco, BUS_BY_ID.luxury);
    expect(r.length).toBe(10);
  });
});
