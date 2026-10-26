import { describe, expect, it } from 'vitest';
import { DAY, makeEnv } from './helpers';
import { DAILY_REWARDS } from '../src/data/shop';

function fireTrip(ctx: ReturnType<typeof makeEnv>['ctx'], over: Record<string, unknown> = {}) {
  ctx.bus.emit('tripCompleted', {
    connectionId: 'kuzeyliman-yesilvadi',
    variant: 'highway',
    fromId: 'kuzeyliman',
    toId: 'yesilvadi',
    passengers: 40,
    seats: 41,
    rating: 4,
    damageDelta: 0,
    fuelUsed: 20,
    fuelPer100: 20,
    modelConsumption: 27,
    revenue: 4000,
    profit: 3000,
    distanceKm: 100,
    byDriver: false,
    clean: true,
    ...over,
  } as never);
}

describe('missions', () => {
  it('progress is computed from game events', () => {
    const { ctx } = makeEnv();
    fireTrip(ctx);
    const v = ctx.missions.list().find((m) => m.def.id === 'm_first_trip')!;
    expect(v.progress).toBe(1);
    expect(v.complete).toBe(true);
    const pax = ctx.missions.list().find((m) => m.def.id === 'm_pax_100')!;
    expect(pax.progress).toBe(40);
  });

  it('reward is paid exactly once', () => {
    const { ctx } = makeEnv();
    fireTrip(ctx);
    const c0 = ctx.state.cash;
    const r1 = ctx.missions.claim('m_first_trip');
    expect(r1.ok).toBe(true);
    const c1 = ctx.state.cash;
    expect(c1).toBeGreaterThan(c0);
    expect(ctx.missions.claim('m_first_trip').ok).toBe(false);
    expect(ctx.missions.claim('m_first_trip').ok).toBe(false);
    expect(ctx.state.cash).toBe(c1);
  });

  it('cannot claim incomplete or locked missions', () => {
    const { ctx } = makeEnv();
    const r = ctx.missions.claim('m_first_trip');
    expect(r.ok).toBe(false);
    fireTrip(ctx);
    fireTrip(ctx);
    // m_clean_trip is locked until m_first_trip is claimed
    const lock = ctx.missions.claim('m_clean_trip');
    expect(lock.ok).toBe(false);
    if (!lock.ok) expect(lock.reason).toBe('locked');
  });

  it('daily missions reset on a new day and cannot be re-claimed within the day', () => {
    const { ctx, time } = makeEnv();
    const view = () => ctx.missions.list().filter((m) => m.def.kind === 'daily');
    const first = view();
    expect(first.length).toBe(3);
    fireTrip(ctx);
    fireTrip(ctx);
    fireTrip(ctx);
    const claimable = view().find((m) => m.claimable);
    if (claimable) {
      expect(ctx.missions.claim(claimable.def.id).ok).toBe(true);
      expect(ctx.missions.claim(claimable.def.id).ok).toBe(false);
    }
    time.now += DAY;
    const next = view();
    expect(next.every((m) => m.progress === 0 && !m.claimed)).toBe(true);
  });

  it('premium missions require an active Premium membership', () => {
    const { ctx, time } = makeEnv();
    expect(ctx.missions.list().some((m) => m.def.premiumOnly)).toBe(false);
    ctx.premium.activateSubscription('premium_monthly', 'tx1', time.now + DAY, 'store');
    const list = ctx.missions.list();
    expect(list.some((m) => m.def.premiumOnly)).toBe(true);
  });

  it('achievements unlock from stats and pay once', () => {
    const { ctx } = makeEnv();
    ctx.state.stats.tripsCompleted += 1; // TripManager.settle updates stats before emitting the event
    fireTrip(ctx);
    expect(ctx.state.achievements.unlocked['a_first_trip']).toBeTruthy();
    const c = ctx.state.cash;
    expect(ctx.missions.claimAchievement('a_first_trip')).toBe(true);
    expect(ctx.missions.claimAchievement('a_first_trip')).toBe(false);
    expect(ctx.state.cash).toBeGreaterThan(c);
    expect(ctx.missions.claimAchievement('a_trips_100')).toBe(false);
  });
});

describe('daily rewards', () => {
  it('can only be claimed once per day', () => {
    const { ctx } = makeEnv();
    const r1 = ctx.daily.claim();
    expect(r1.ok).toBe(true);
    const cash = ctx.state.cash;
    for (let i = 0; i < 5; i++) expect(ctx.daily.claim().ok).toBe(false);
    expect(ctx.state.cash).toBe(cash);
  });

  it('streak grows on consecutive days and resets after a gap', () => {
    const { ctx, time } = makeEnv();
    ctx.daily.claim();
    time.now += DAY;
    const r2 = ctx.daily.claim();
    expect(r2.ok && r2.streak).toBe(2);
    time.now += DAY;
    ctx.daily.claim();
    time.now += 3 * DAY;
    const r4 = ctx.daily.claim();
    expect(r4.ok && r4.streak).toBe(1);
  });

  it('day 7 gives the special reward', () => {
    const { ctx, time } = makeEnv();
    let last = null as ReturnType<typeof ctx.daily.claim> | null;
    for (let i = 0; i < 7; i++) {
      last = ctx.daily.claim();
      time.now += DAY;
    }
    expect(last && last.ok && last.reward).toEqual(DAILY_REWARDS[6]);
  });

  it('setting the device clock back does not allow another claim', () => {
    const { ctx, time } = makeEnv();
    ctx.daily.claim();
    ctx.clock.now();
    time.now -= 2 * DAY; // player moves the clock back
    const trusted = ctx.clock.now();
    expect(trusted).toBeGreaterThan(time.now);
    expect(ctx.daily.claim().ok).toBe(false);
  });

  it('premium reward is separate, premium-only and once per day', () => {
    const { ctx, time } = makeEnv();
    expect(ctx.daily.claimPremium().ok).toBe(false);
    ctx.premium.activateSubscription('premium_monthly', 'tx1', time.now + 5 * DAY, 'store');
    expect(ctx.daily.claimPremium().ok).toBe(true);
    expect(ctx.daily.claimPremium().ok).toBe(false);
  });

  it('doubling requires a claim first and works once', () => {
    const { ctx } = makeEnv();
    expect(ctx.daily.applyDouble().ok).toBe(false);
    ctx.daily.claim();
    expect(ctx.daily.applyDouble().ok).toBe(true);
    expect(ctx.daily.applyDouble().ok).toBe(false);
  });
});
