import { describe, expect, it } from 'vitest';
import { makeEnv } from './helpers';
import { computeDemand, createManifest } from '../src/systems/PassengerManager';
import { mulberry32 } from '../src/core/utils';
import type { TripConfig, TripOutcome } from '../src/systems/TripManager';
import { BUS_BY_ID } from '../src/data/buses';

function config(ctx: ReturnType<typeof makeEnv>['ctx'], over: Partial<TripConfig> = {}): TripConfig {
  const spec = ctx.routes.resolve('kuzeyliman-yesilvadi', false, 'highway');
  return {
    connectionId: 'kuzeyliman-yesilvadi',
    reverse: false,
    variant: 'highway',
    busUid: ctx.state.buses[0].uid,
    departureHour: 7,
    ticketPrice: spec.ticketRefPrice,
    ...over,
  };
}

function ok(ctx: ReturnType<typeof makeEnv>['ctx'], over: Partial<TripConfig> = {}) {
  const r = ctx.trips.prepare(config(ctx, over));
  if (!r.ok) throw new Error(`prepare failed: ${r.error}`);
  return r.plan;
}

describe('passenger capacity', () => {
  it('sold + reservations never exceed seats, with or without boosts', () => {
    const { ctx } = makeEnv();
    const route = ctx.routes.resolve('kuzeyliman-ortasehir', false, 'highway');
    for (const boost of [false, true]) {
      for (const rep of [0, 50, 100]) {
        const d = computeDemand({ route, hourDemand: 1.15, weatherDemand: 1, reputation: rep, ticketPrice: 1, seats: 41, demandBoost: boost, companyLevel: 20 });
        expect(d.sold + d.reservations).toBeLessThanOrEqual(41);
      }
    }
  });

  it('a 50 seat bus carries at most 50 passengers even when more are waiting', () => {
    const { ctx } = makeEnv();
    const route = ctx.routes.resolve('kuzeyliman-yesilvadi', false, 'highway');
    const m = createManifest(route, 50, 30, 100, { demand: 999, sold: 999, reservations: 20 }, mulberry32(1));
    expect(m.sold + m.reservations).toBeLessThanOrEqual(50);
    m.arriveAtStop(route.stops[0], false);
    let guard = 0;
    while (guard++ < 500) if (m.step(0.5).done) break;
    expect(m.onboard).toBeLessThanOrEqual(50);
    expect(m.board(100)).toBe(0);
    expect(m.empty).toBeGreaterThanOrEqual(0);
  });

  it('boarding and alighting at the terminal completes and collects ticket revenue', () => {
    const { ctx } = makeEnv();
    const route = ctx.routes.resolve('kuzeyliman-yesilvadi', false, 'highway');
    const m = createManifest(route, 40, 30, 100, { demand: 30, sold: 30, reservations: 2 }, mulberry32(2));
    m.arriveAtStop(route.stops[0], false);
    for (let i = 0; i < 200 && !m.step(0.5).done; i++);
    expect(m.boardedTotal).toBe(32);
    m.finishStop();
    const last = route.stops[route.stops.length - 1];
    m.arriveAtStop(last, true);
    for (let i = 0; i < 200 && !m.step(0.5).done; i++);
    expect(m.onboard).toBe(0);
    expect(m.alightedTotal).toBeGreaterThanOrEqual(32);
    expect(m.ticketRevenue).toBeGreaterThan(0);
  });

  it('extra reservations from boosts only fill empty seats', () => {
    const { ctx } = makeEnv();
    const route = ctx.routes.resolve('kuzeyliman-yesilvadi', false, 'highway');
    const d = computeDemand({ route, hourDemand: 1, weatherDemand: 1, reputation: 100, ticketPrice: 1, seats: 41, demandBoost: true, companyLevel: 1 });
    expect(d.sold).toBe(41);
    expect(d.reservations).toBe(0);
  });
});

describe('trip lifecycle', () => {
  it('prepare validates bus, fuel and price', () => {
    const { ctx } = makeEnv();
    expect(ctx.trips.prepare(config(ctx, { busUid: 'x' })).ok).toBe(false);
    expect(ctx.trips.prepare(config(ctx, { ticketPrice: 1 })).ok).toBe(false);
    ctx.state.buses[0].fuel = 1;
    const r = ctx.trips.prepare(config(ctx));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('fuel');
  });

  it('cannot drive locked routes or buses assigned to drivers', () => {
    const { ctx } = makeEnv();
    const locked = ctx.trips.prepare(config(ctx, { connectionId: 'ortasehir-turkuazkent' }));
    expect(locked.ok).toBe(false);
    ctx.state.buses[0].assignedDriverId = 'drv';
    const asg = ctx.trips.prepare(config(ctx));
    expect(asg.ok).toBe(false);
  });

  it('settlement pays revenue, updates bus fuel/damage/odometer, stats and emits event', () => {
    const { ctx } = makeEnv();
    const plan = ok(ctx);
    ctx.trips.commit(plan);
    // simulate boarding everyone
    plan.manifest.arriveAtStop(plan.route.stops[0], false);
    for (let i = 0; i < 400 && !plan.manifest.step(0.5).done; i++);
    plan.manifest.finishStop();
    plan.manifest.arriveAtStop(plan.route.stops[plan.route.stops.length - 1], true);
    for (let i = 0; i < 400 && !plan.manifest.step(0.5).done; i++);
    const cash0 = ctx.state.cash;
    let got = 0;
    ctx.bus.on('tripCompleted', () => (got += 1));
    const outcome: TripOutcome = { status: 'completed', durationSec: 300, endFuel: plan.startFuel - plan.fuelNeeded, damageDelta: 0, fines: 0, lateSeconds: 0 };
    const s = ctx.trips.settle(plan, outcome);
    expect(s.status).toBe('completed');
    expect(s.revenue).toBeGreaterThan(0);
    expect(ctx.state.cash).toBeGreaterThan(cash0);
    expect(ctx.state.stats.tripsCompleted).toBe(1);
    expect(ctx.state.trips.length).toBe(1);
    expect(got).toBe(1);
    const bus = ctx.state.buses[0];
    expect(bus.fuel).toBeCloseTo(plan.startFuel - plan.fuelNeeded, 3);
    expect(bus.odometerKm).toBe(plan.route.distanceKm);
    expect(ctx.state.company.xp + ctx.state.company.level).toBeGreaterThan(1);
  });

  it('a trip is profitable at default price (economy sanity)', () => {
    const { ctx } = makeEnv();
    const plan = ok(ctx);
    plan.manifest.arriveAtStop(plan.route.stops[0], false);
    for (let i = 0; i < 400 && !plan.manifest.step(0.5).done; i++);
    plan.manifest.finishStop();
    plan.manifest.arriveAtStop(plan.route.stops[plan.route.stops.length - 1], true);
    for (let i = 0; i < 400 && !plan.manifest.step(0.5).done; i++);
    const s = ctx.trips.settle(plan, { status: 'completed', durationSec: 200, endFuel: plan.startFuel - plan.fuelNeeded, damageDelta: 0, fines: 0, lateSeconds: 0 });
    expect(s.profit).toBeGreaterThan(1000);
  });

  it('failed trips give no revenue and cost reputation', () => {
    const { ctx } = makeEnv();
    const plan = ok(ctx);
    const rep = ctx.state.company.reputation;
    const cash = ctx.state.cash;
    const s = ctx.trips.settle(plan, { status: 'outOfFuel', durationSec: 100, endFuel: 0, damageDelta: 0, fines: 0, lateSeconds: 0 });
    expect(s.revenue).toBe(0);
    expect(ctx.state.company.reputation).toBeLessThan(rep);
    expect(ctx.state.cash).toBeLessThanOrEqual(cash);
    expect(ctx.state.cash).toBeGreaterThanOrEqual(0);
    expect(ctx.state.stats.tripsCompleted).toBe(0);
  });

  it('one-trip boosts are consumed once at commit', () => {
    const { ctx } = makeEnv();
    ctx.state.boosts.revenue = 1;
    ctx.state.boosts.demand = 1;
    const plan = ok(ctx);
    ctx.trips.commit(plan);
    ctx.trips.commit(plan);
    expect(ctx.state.boosts.revenue).toBe(0);
    expect(ctx.state.boosts.demand).toBe(0);
    expect(plan.boosts.revenue).toBe(true);
  });

  it('fuel amount and economy are consistent with the bus model', () => {
    const { ctx } = makeEnv();
    const plan = ok(ctx);
    const m = BUS_BY_ID.eco;
    expect(plan.fuelNeeded).toBeCloseTo((plan.route.distanceKm * m.consumptionPer100) / 100, 5);
  });
});
