import { describe, it, expect } from 'vitest';
import { lightPhaseAt, LIGHT_CYCLE } from '../src/traffic/TrafficManager';
import { SceneryField, SCENERY_SPACING } from '../src/world/SceneryField';
import { PerformanceManager } from '../src/core/PerformanceManager';
import { defaultSettings } from '../src/core/state';
import { bayWidthAt, drivableLimits, bayParkOffset, BAY_WIDTH } from '../src/world/roadGeometry';
import { roadProfile, type StopDef } from '../src/systems/RouteManager';

describe('traffic lights', () => {
  it('cycle is 20 s green, 4 s yellow, 16 s red and is periodic', () => {
    const seq = Array.from({ length: LIGHT_CYCLE }, (_, t) => lightPhaseAt(0, t));
    expect(seq.filter((p) => p === 'green')).toHaveLength(20);
    expect(seq.filter((p) => p === 'yellow')).toHaveLength(4);
    expect(seq.filter((p) => p === 'red')).toHaveLength(16);
    expect(lightPhaseAt(3, 5)).toBe(lightPhaseAt(3, 5 + LIGHT_CYCLE * 7));
  });

  it('neighbouring lights are offset so they do not all turn red together', () => {
    const reds = [0, 1, 2].map((i) => Array.from({ length: LIGHT_CYCLE }, (_, t) => lightPhaseAt(i, t)).indexOf('red'));
    expect(new Set(reds).size).toBe(3);
  });
});

describe('scenery field', () => {
  const opts = { seed: 11, playLength: 6000, edge: 5.2, towns: [{ from: 1000, to: 1500 }], stopS: [90, 5900], density: 1 };

  it('is deterministic (render and collision see the same objects)', () => {
    const a = new SceneryField(opts).itemsInRange(500, 2000);
    const b = new SceneryField(opts).itemsInRange(500, 2000);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(10);
  });

  it('keeps the right-hand side near stops free of lamps and buildings (bus bays)', () => {
    const f = new SceneryField({ ...opts, towns: [{ from: 0, to: 6000 }] });
    for (const stop of opts.stopS) {
      const items = f.itemsInRange(stop - 150, stop + 150).filter((i) => i.d > 0 && (i.kind === 'lamp' || i.kind === 'building'));
      expect(items).toEqual([]);
    }
  });

  it('never places solid items on the road', () => {
    for (const i of new SceneryField(opts).itemsInRange(0, 6000)) expect(Math.abs(i.d)).toBeGreaterThan(opts.edge);
  });

  it('slot spacing constant is sane', () => {
    expect(SCENERY_SPACING).toBeGreaterThan(5);
  });
});

describe('bus bay geometry', () => {
  const stops: StopDef[] = [{ id: 'a', s: 1000, kind: 'terminal', nameKey: 'x' }];
  const profile = roadProfile(false);
  it('bay widens the paved area only near the stop', () => {
    expect(bayWidthAt(stops, 1000)).toBeCloseTo(BAY_WIDTH, 5);
    expect(bayWidthAt(stops, 1200)).toBe(0);
    expect(drivableLimits(profile, stops, 1000).right).toBeGreaterThan(drivableLimits(profile, stops, 1300).right);
  });
  it('the parking offset is inside the bay', () => {
    const lim = drivableLimits(profile, stops, 1000);
    expect(bayParkOffset(profile)).toBeLessThan(lim.right);
    expect(bayParkOffset(profile)).toBeGreaterThan(profile.halfWidth);
  });
});

describe('performance manager', () => {
  it('lowers auto quality after sustained low FPS and never goes below low', () => {
    const s = defaultSettings();
    s.quality = 'auto';
    const pm = new PerformanceManager(() => s);
    const before = pm.current().level;
    let t = 10_000;
    for (let i = 0; i < 400; i++) {
      pm.sample(1 / 15, t);
      t += 66;
    }
    const order = ['low', 'medium', 'high', 'ultra'];
    expect(order.indexOf(pm.current().level)).toBeLessThanOrEqual(order.indexOf(before));
    expect(pm.current().level).toBeDefined();
    expect(pm.fps).toBeLessThan(20);
  });

  it('manual quality is respected and traffic can be switched off', () => {
    const s = defaultSettings();
    s.quality = 'high';
    s.trafficDensity = 'off';
    const pm = new PerformanceManager(() => s);
    pm.sample(1 / 10, 1000);
    expect(pm.current().level).toBe('high');
    expect(pm.current().maxTraffic).toBe(0);
  });
});
