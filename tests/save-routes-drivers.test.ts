import { describe, expect, it } from 'vitest';
import { DAY, FakeAdAdapter, T0, makeEnv } from './helpers';
import { MemoryStorage, SaveManager, mergeDefaults } from '../src/systems/SaveManager';
import { createGameContext } from '../src/core/GameContext';
import { createInitialState } from '../src/core/state';
import { SAVE_BACKUP_KEY, SAVE_KEY } from '../src/data/constants';
import { CONNECTIONS } from '../src/data/world';
import { RouteManager } from '../src/systems/RouteManager';

describe('save system', () => {
  it('saves and reloads the full state', () => {
    const { ctx, storage } = makeEnv();
    ctx.state.cash = 12345;
    ctx.state.company.name = 'Test Co';
    ctx.state.buses[0].paint = 'paint_red';
    expect(ctx.save.save(ctx.state).ok).toBe(true);
    const sm = new SaveManager(storage, () => T0);
    const r = sm.load();
    expect(r.source).toBe('primary');
    expect(r.state.cash).toBe(12345);
    expect(r.state.company.name).toBe('Test Co');
    expect(r.state.buses[0].paint).toBe('paint_red');
  });

  it('starts a new game when there is no save', () => {
    const sm = new SaveManager(new MemoryStorage(), () => T0);
    const r = sm.load();
    expect(r.source).toBe('new');
    expect(r.corrupted).toBe(false);
    expect(r.state.buses.length).toBe(1);
  });

  it('a corrupt save does not block the game and recovers from backup', () => {
    const storage = new MemoryStorage();
    const sm = new SaveManager(storage, () => T0);
    const s = createInitialState(T0);
    s.cash = 777;
    sm.save(s);
    s.cash = 888;
    sm.save(s); // primary = 888, backup = 777
    storage.setItem(SAVE_KEY, '{"v":1,"data": broken');
    const r = sm.load();
    expect(r.corrupted).toBe(true);
    expect(r.recoveredFromBackup).toBe(true);
    expect(r.state.cash).toBe(777);
  });

  it('falls back to a new game when primary and backup are both corrupt', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, 'garbage');
    storage.setItem(SAVE_BACKUP_KEY, 'garbage');
    const r = new SaveManager(storage, () => T0).load();
    expect(r.source).toBe('new');
    expect(r.corrupted).toBe(true);
    expect(r.state.cash).toBeGreaterThan(0);
  });

  it('detects tampering/corruption via checksum', () => {
    const storage = new MemoryStorage();
    const sm = new SaveManager(storage, () => T0);
    sm.save(createInitialState(T0));
    const raw = JSON.parse(storage.getItem(SAVE_KEY)!);
    raw.data.cash = 999999999;
    storage.setItem(SAVE_KEY, JSON.stringify(raw));
    expect(sm.load().corrupted).toBe(true);
  });

  it('runs versioned migrations in order', () => {
    const storage = new MemoryStorage();
    const old = new SaveManager(storage, () => T0, {}, 1);
    const s = createInitialState(T0);
    s.cash = 500;
    old.save(s);
    const sm = new SaveManager(
      storage,
      () => T0,
      {
        1: (d) => ({ ...d, cash: (d.cash as number) + 1 }),
        2: (d) => ({ ...d, cash: (d.cash as number) * 2 }),
      },
      3,
    );
    const r = sm.load();
    expect(r.state.cash).toBe((500 + 1) * 2);
    expect(r.state.schemaVersion).toBe(3);
  });

  it('sanitizes impossible values', () => {
    const storage = new MemoryStorage();
    const sm = new SaveManager(storage, () => T0);
    const s = createInitialState(T0);
    (s as { cash: number }).cash = -50;
    s.buses[0].damage = 500;
    s.buses[0].fuel = 99999;
    sm.save(s);
    const r = sm.load().state;
    expect(r.cash).toBe(0);
    expect(r.buses[0].damage).toBe(100);
    expect(r.buses[0].fuel).toBeLessThan(1000);
  });

  it('mergeDefaults fills missing fields from defaults', () => {
    const m = mergeDefaults({ a: 1, b: { c: 2, d: 'x' } }, { b: { c: 5 } });
    expect(m).toEqual({ a: 1, b: { c: 5, d: 'x' } });
  });

  it('export / import round-trips', () => {
    const { ctx } = makeEnv();
    ctx.state.cash = 4242;
    const text = ctx.save.exportText(ctx.state);
    const r = ctx.save.importText(text);
    expect(r.ok).toBe(true);
    expect(r.state!.cash).toBe(4242);
    expect(ctx.save.importText('nope').ok).toBe(false);
  });

  it('context boot loads an existing save', () => {
    const storage = new MemoryStorage();
    const first = createGameContext({ storage, now: () => T0, adAdapter: new FakeAdAdapter() });
    first.ctx.state.cash = 9999;
    first.ctx.save.save(first.ctx.state);
    const second = createGameContext({ storage, now: () => T0 + 1000, adAdapter: new FakeAdAdapter() });
    expect(second.ctx.state.cash).toBe(9999);
  });
});

describe('routes', () => {
  it('resolves every connection in both directions and variants consistently', () => {
    const { ctx } = makeEnv();
    for (const c of CONNECTIONS) {
      for (const rev of [false, true]) {
        for (const variant of ['highway', 'old'] as const) {
          const r = ctx.routes.resolve(c.id, rev, variant, { timestamp: T0, hour: 12 });
          expect(r.distanceKm).toBeGreaterThan(30);
          expect(r.playLengthM).toBeGreaterThan(1500);
          expect(r.stops[0].kind).toBe('terminal');
          expect(r.stops[r.stops.length - 1].kind).toBe('terminal');
          const sorted = [...r.stops].sort((a, b) => a.s - b.s);
          expect(sorted.map((s) => s.id)).toEqual(r.stops.map((s) => s.id));
          for (const z of r.speedZones) {
            expect(z.from).toBeGreaterThanOrEqual(0);
            expect(z.to).toBeLessThanOrEqual(r.playLengthM);
          }
          expect(r.expectedDriveSeconds).toBeGreaterThan(60);
          if (variant === 'old') expect(r.toll).toBe(0);
          if (rev) expect(r.fromId).toBe(c.b);
        }
      }
    }
  });

  it('old road is longer and free, motorway has tolls', () => {
    const { ctx } = makeEnv();
    const hw = ctx.routes.resolve('kuzeyliman-yesilvadi', false, 'highway');
    const old = ctx.routes.resolve('kuzeyliman-yesilvadi', false, 'old');
    expect(old.distanceKm).toBeGreaterThan(hw.distanceKm);
    expect(hw.toll).toBeGreaterThan(0);
    expect(old.toll).toBe(0);
  });

  it('is deterministic', () => {
    const { ctx } = makeEnv();
    const a = ctx.routes.resolve('kuzeyliman-ortasehir', false, 'highway', { timestamp: T0, hour: 7 });
    const b = ctx.routes.resolve('kuzeyliman-ortasehir', false, 'highway', { timestamp: T0, hour: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('speed limits follow zones', () => {
    const { ctx } = makeEnv();
    const r = ctx.routes.resolve('kuzeyliman-yesilvadi', false, 'highway');
    expect(ctx.routes.speedLimitAt(r, 100)).toBe(50);
    expect(ctx.routes.speedLimitAt(r, r.playLengthM / 2)).toBeGreaterThanOrEqual(80);
  });

  it('cities unlock with level and funds, only once', () => {
    const { ctx } = makeEnv();
    expect(ctx.routes.canUnlockCity('dagbasi').reason).toBe('level');
    ctx.state.company.level = 2;
    ctx.state.cash = 100;
    expect(ctx.routes.canUnlockCity('dagbasi').reason).toBe('funds');
    ctx.state.cash = 50_000;
    expect(ctx.routes.unlockCity('dagbasi').ok).toBe(true);
    expect(ctx.state.cash).toBe(35_000);
    expect(ctx.routes.unlockCity('dagbasi').ok).toBe(false);
    expect(ctx.routes.isConnectionUnlocked('kuzeyliman-dagbasi')).toBe(true);
    expect(ctx.routes.isConnectionUnlocked('dagbasi-ortasehir')).toBe(false);
  });

  it('base distance helper is positive', () => {
    for (const c of CONNECTIONS) expect(RouteManager.baseDistanceKm(c)).toBeGreaterThan(40);
  });
});

describe('company and drivers', () => {
  it('hiring costs money, respects slots, and candidates are stable within a day', () => {
    const { ctx } = makeEnv();
    const c1 = ctx.company.candidates();
    const c2 = ctx.company.candidates();
    expect(c1).toEqual(c2);
    const cash = ctx.state.cash;
    const r = ctx.company.hire(c1[0].id);
    expect(r.ok).toBe(true);
    expect(ctx.state.cash).toBe(cash - c1[0].hiringFee);
    expect(ctx.company.hire(c1[1].id).error).toBe('slots');
    expect(ctx.company.hire(c1[0].id).ok).toBe(false);
  });

  it('salary must stay within the allowed range', () => {
    const { ctx } = makeEnv();
    const d = ctx.company.hire(ctx.company.candidates()[0].id).driver!;
    const fair = ctx.company.fairSalary(d);
    expect(ctx.company.setSalary(d.id, fair * 3).ok).toBe(false);
    expect(ctx.company.setSalary(d.id, fair * 1.2).ok).toBe(true);
  });

  function setupDriver() {
    const env = makeEnv();
    const { ctx } = env;
    ctx.state.cash = 200_000;
    ctx.state.company.officeLevel = 2;
    ctx.state.company.level = 4;
    ctx.garage.buy('eco');
    const d = ctx.company.hire(ctx.company.candidates()[0].id).driver!;
    const second = ctx.state.buses[1];
    expect(ctx.company.assign(d.id, second.uid, 'kuzeyliman-yesilvadi', 'highway').ok).toBe(true);
    return { ...env, d, second };
  }

  it('assigned buses cannot be driven by the player or sold', () => {
    const { ctx, second } = setupDriver();
    expect(ctx.garage.canDrive(second.uid).error).toBe('assigned');
    expect(ctx.garage.sell(second.uid).error).toBe('assigned');
  });

  it('offline earnings are positive, tied to time, and capped', () => {
    const { ctx, time, d } = setupDriver();
    time.now += 3 * 3_600_000;
    const r3 = ctx.company.tickDrivers(time.now);
    expect(r3.trips).toBeGreaterThanOrEqual(1);
    expect(r3.salary).toBeGreaterThan(0);

    const cashBefore = ctx.state.cash;
    time.now += 30 * DAY;
    const huge = ctx.company.tickDrivers(time.now);
    expect(huge.trips).toBeLessThanOrEqual(12);
    expect(huge.elapsedMs).toBeLessThanOrEqual(8 * 3_600_000 + 1);
    expect(ctx.state.cash).toBeGreaterThanOrEqual(0);
    void cashBefore;
    void d;
  });

  it('salary is paid even when the driver is idle, and cash never goes negative', () => {
    const { ctx, time } = makeEnv();
    const d = ctx.company.hire(ctx.company.candidates()[0].id).driver!;
    ctx.state.cash = 50;
    time.now += 6 * 3_600_000;
    const r = ctx.company.tickDrivers(time.now);
    expect(r.trips).toBe(0);
    expect(ctx.state.cash).toBeGreaterThanOrEqual(0);
    expect(d.status).toBe('noFunds');
  });

  it('a heavily damaged bus makes the AI driver stop', () => {
    const { ctx, time, second, d } = setupDriver();
    second.damage = 95;
    time.now += 5 * 3_600_000;
    const r = ctx.company.tickDrivers(time.now);
    expect(r.trips).toBe(0);
    expect(d.status).toBe('brokenDown');
  });

  it('company name validation and level-ups', () => {
    const { ctx } = makeEnv();
    expect(ctx.company.setName('A').ok).toBe(false);
    expect(ctx.company.setName('<b>Hack</b>').ok).toBe(true);
    expect(ctx.state.company.name).not.toContain('<');
    ctx.company.addXp(100000);
    expect(ctx.state.company.level).toBeGreaterThan(5);
  });

  it('office upgrade costs money and raises slots', () => {
    const { ctx } = makeEnv();
    ctx.state.company.level = 5;
    ctx.state.cash = 100_000;
    const slots = ctx.garage.slots();
    expect(ctx.company.buyOffice().ok).toBe(true);
    expect(ctx.garage.slots()).toBe(slots + 1);
  });
});
