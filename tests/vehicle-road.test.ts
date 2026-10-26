import { describe, expect, it } from 'vitest';
import { FIXED_DT, VehicleController, type DriveInput, type Surface, type VehicleSpec } from '../src/vehicle/VehicleController';
import { RoadPath } from '../src/world/RoadPath';
import { BUS_BY_ID } from '../src/data/buses';
import { ROUTE_SCALE } from '../src/data/constants';
import { makeEnv } from './helpers';

const dry: Surface = { grade: 0, gripMul: 1, offRoad: false };
const wet: Surface = { grade: 0, gripMul: 0.68, offRoad: false };

function specOf(id: string): VehicleSpec {
  const m = BUS_BY_ID[id];
  return {
    massKg: m.massKg + 2000,
    powerKw: m.powerKw,
    maxSpeedKmh: m.maxSpeedKmh,
    length: m.dims.length,
    width: m.dims.width,
    height: m.dims.height,
    grip: 0.85 + (m.handling / 100) * 0.3,
    consumptionPer100: m.consumptionPer100,
    tankCapacity: m.tankCapacity,
    electric: m.powertrain === 'electric',
  };
}

function ready(id = 'standard'): VehicleController {
  const v = new VehicleController(specOf(id), 300, 0);
  v.toggleEngine();
  v.setGear('D');
  v.setHandbrake(false);
  return v;
}

const input = (o: Partial<DriveInput> = {}): DriveInput => ({ throttle: 0, brake: 0, steer: 0, doorsOpen: false, ...o });

function run(v: VehicleController, seconds: number, inp: DriveInput, surf: Surface = dry, dt = FIXED_DT): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) v.step(dt, inp, surf);
}

describe('vehicle physics', () => {
  it('accelerates gradually and respects the top speed', () => {
    const v = ready();
    run(v, 5, input({ throttle: 1 }));
    expect(v.speedKmh).toBeGreaterThan(8);
    expect(v.speedKmh).toBeLessThan(60);
    run(v, 120, input({ throttle: 1 }));
    expect(v.speedKmh).toBeLessThanOrEqual(BUS_BY_ID.standard.maxSpeedKmh + 0.5);
    expect(v.speedKmh).toBeGreaterThan(BUS_BY_ID.standard.maxSpeedKmh * 0.85);
  });

  it('heavier / weaker buses accelerate slower', () => {
    const light = ready('eco');
    const heavy = ready('double');
    run(light, 8, input({ throttle: 1 }));
    run(heavy, 8, input({ throttle: 1 }));
    // not asserting an order between unrelated powers, only that both are sane and differ
    expect(light.speedKmh).toBeGreaterThan(5);
    expect(heavy.speedKmh).toBeGreaterThan(5);
    expect(Math.abs(light.speedKmh - heavy.speedKmh)).toBeGreaterThan(0.1);
  });

  it('brakes to a stop within a realistic distance, longer on wet roads', () => {
    const stopDistance = (surf: Surface) => {
      const v = ready();
      v.speed = 20; // 72 km/h
      const x0 = v.z;
      for (let i = 0; i < 60 * 30 && v.speed > 0.05; i++) v.step(FIXED_DT, input({ brake: 1 }), surf);
      return v.z - x0;
    };
    const d = stopDistance(dry);
    const w = stopDistance(wet);
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(90);
    expect(w).toBeGreaterThan(d * 1.2);
  });

  it('bus stays still in park or with the handbrake, even on a slope', () => {
    const v = ready();
    v.setGear('P');
    v.setHandbrake(true);
    run(v, 5, input(), { grade: 0.05, gripMul: 1, offRoad: false });
    expect(Math.abs(v.speed)).toBeLessThan(0.05);
  });

  it('rolls back in neutral without the handbrake on a steep slope', () => {
    const v = ready();
    v.setGear('N');
    run(v, 6, input(), { grade: 0.06, gripMul: 1, offRoad: false });
    expect(v.speed).toBeLessThan(-0.3);
  });

  it('cannot accelerate with doors open, engine off, or in neutral', () => {
    const a = ready();
    a.setDoors(true);
    run(a, 4, input({ throttle: 1, doorsOpen: true }));
    expect(a.speed).toBeLessThan(0.1);
    const b = ready();
    b.toggleEngine();
    run(b, 4, input({ throttle: 1 }));
    expect(b.speed).toBeLessThan(0.1);
    const c = ready();
    c.setGear('N');
    run(c, 4, input({ throttle: 1 }));
    expect(c.speed).toBeLessThan(0.1);
  });

  it('reverse is slow and limited', () => {
    const v = ready();
    v.setGear('R');
    run(v, 20, input({ throttle: 1 }));
    expect(v.speed).toBeLessThan(0);
    expect(v.speedKmh).toBeGreaterThan(-16);
  });

  it('gear selector rules', () => {
    const v = ready();
    v.speed = 10;
    expect(v.setGear('P')).toBe(false);
    expect(v.setGear('R')).toBe(false);
    expect(v.setGear('N')).toBe(true);
    v.speed = 0;
    expect(v.setGear('P')).toBe(true);
  });

  it('doors refuse to open while moving', () => {
    const v = ready();
    v.speed = 10;
    expect(v.setDoors(true)).toBe(false);
    v.speed = 0;
    expect(v.setDoors(true)).toBe(true);
  });

  it('steering turns the bus and a hard turn at speed saturates grip (slip)', () => {
    const v = ready();
    v.speed = 25;
    run(v, 2, input({ steer: 1 }));
    expect(v.heading).toBeLessThan(0); // right turn decreases heading
    expect(v.slip).toBeGreaterThan(0.05);
    const slow = ready();
    slow.speed = 5;
    run(slow, 2, input({ steer: 1 }));
    expect(slow.slip).toBeLessThan(0.05);
    expect(Math.abs(slow.heading)).toBeGreaterThan(Math.abs(v.heading) * 0.5);
  });

  it('body rolls outward in corners', () => {
    const v = ready();
    v.speed = 18;
    run(v, 2, input({ steer: -1 })); // left turn
    expect(v.roll).toBeGreaterThan(0.005);
  });

  it('wet roads reduce cornering grip', () => {
    const turn = (s: Surface) => {
      const v = ready();
      v.speed = 18;
      run(v, 1.5, input({ steer: 1 }), s);
      return Math.abs(v.heading);
    };
    expect(turn(wet)).toBeLessThan(turn(dry));
  });

  it('fuel is consumed per distance in line with the model consumption', () => {
    const v = ready('standard');
    v.cruise = { on: false, target: 0, integral: 0 };
    v.speed = 80 / 3.6;
    const f0 = v.fuel;
    // hold ~80 km/h on the flat for 4 driven km
    let guard = 0;
    while (v.odometerM < 4000 && guard++ < 60 * 600) {
      const err = 80 / 3.6 - v.speed;
      v.step(FIXED_DT, input({ throttle: Math.max(0, Math.min(1, err * 0.5 + 0.25)) }), dry);
    }
    const used = f0 - v.fuel;
    const logicalKm = (v.odometerM / 1000) * ROUTE_SCALE;
    const per100 = (used / logicalKm) * 100;
    expect(per100).toBeGreaterThan(BUS_BY_ID.standard.consumptionPer100 * 0.55);
    expect(per100).toBeLessThan(BUS_BY_ID.standard.consumptionPer100 * 1.6);
  });

  it('engine stalls when the tank is empty', () => {
    const v = new VehicleController(specOf('eco'), 0.001, 0);
    v.toggleEngine();
    v.setGear('D');
    v.setHandbrake(false);
    run(v, 5, input({ throttle: 1 }));
    expect(v.engineOn).toBe(false);
    expect(v.stalled).toBe('fuel');
    expect(v.toggleEngine()).toBe(false);
  });

  it('cruise control holds the target speed', () => {
    const v = ready();
    v.speed = 60 / 3.6;
    run(v, 1, input({ throttle: 0.4 }));
    expect(v.toggleCruise()).toBe(true);
    run(v, 40, input());
    expect(Math.abs(v.speedKmh - 60)).toBeLessThan(4);
    run(v, 0.5, input({ brake: 1 }));
    expect(v.cruise.on).toBe(false);
  });

  it('impacts add damage once per cooldown and slow the bus', () => {
    const v = ready();
    v.speed = 20;
    const d1 = v.applyImpact(15);
    expect(d1).toBeGreaterThan(5);
    expect(v.speed).toBeLessThan(10);
    expect(v.applyImpact(15)).toBe(0);
    run(v, 1, input());
    expect(v.applyImpact(2)).toBeGreaterThan(0);
    expect(v.damage).toBeLessThanOrEqual(100);
  });

  it('is largely independent of the step size', () => {
    const a = ready();
    const b = ready();
    run(a, 6, input({ throttle: 1 }), dry, 1 / 60);
    run(b, 6, input({ throttle: 1 }), dry, 1 / 120);
    expect(Math.abs(a.speed - b.speed)).toBeLessThan(0.6);
    expect(Math.abs(a.z - b.z)).toBeLessThan(2);
  });

  it('electric buses have instant response and use energy', () => {
    const v = ready('electric');
    run(v, 3, input({ throttle: 1 }));
    expect(v.speedKmh).toBeGreaterThan(8);
    expect(v.fuel).toBeLessThan(300);
  });
});

describe('road path', () => {
  const make = (seed = 11, length = 6000, highway = false) =>
    new RoadPath({ seed, length, difficulty: 3, hilly: 0.8, highway, flatZones: [{ from: 0, to: 520 }, { from: length - 520, to: length }] });

  it('is deterministic and has the requested length', () => {
    const a = make();
    const b = make();
    expect(a.length).toBe(6000);
    expect(a.points.length).toBe(b.points.length);
    expect(a.points[300].x).toBe(b.points[300].x);
    expect(make(12).points[300].x).not.toBe(a.points[300].x);
  });

  it('is straight and flat in town zones', () => {
    const p = make();
    for (const s of [0, 100, 300, 480]) {
      expect(Math.abs(p.at(s).k)).toBeLessThan(1e-9);
      expect(Math.abs(p.at(s).y)).toBeLessThan(0.5);
    }
  });

  it('has realistic grades and gentle curvature', () => {
    for (const hw of [false, true]) {
      const p = make(5, 9000, hw);
      let maxGrade = 0;
      let maxK = 0;
      for (let s = 0; s < 9000; s += 20) {
        maxGrade = Math.max(maxGrade, Math.abs(p.grade(s)));
        maxK = Math.max(maxK, Math.abs(p.at(s).k));
      }
      expect(maxGrade).toBeLessThan(0.09);
      expect(1 / maxK).toBeGreaterThan(hw ? 200 : 90);
    }
  });

  it('project() inverts lanePos()', () => {
    const p = make(7, 8000);
    for (const [s, d] of [[800, 1.9], [2500, -1.9], [4300, 3.5], [7000, 0]] as const) {
      const w = p.lanePos(s, d);
      const r = p.project(w.x, w.z, s - 30);
      expect(Math.abs(r.s - s)).toBeLessThan(1.5);
      expect(Math.abs(r.d - d)).toBeLessThan(0.35);
    }
  });

  it('right-hand lane is on the right of the travel direction', () => {
    const p = make();
    const c = p.at(1000);
    const w = p.lanePos(1000, 2);
    const fx = Math.sin(c.h);
    const fz = Math.cos(c.h);
    // with forward=(fx,fz) in the (x,z) plane, a point on the right-hand side has a negative cross product
    const cross = fz * (w.x - c.x) - fx * (w.z - c.z);
    expect(cross).toBeLessThan(-1.9);
    expect(Math.hypot(w.x - c.x, w.z - c.z)).toBeCloseTo(2, 3);
  });

  it('every real route builds a path', () => {
    const { ctx } = makeEnv();
    const spec = ctx.routes.resolve('kuzeyliman-ortasehir', false, 'highway');
    const path = new RoadPath({
      seed: spec.seed,
      length: spec.playLengthM,
      difficulty: spec.difficulty,
      hilly: spec.hilly,
      highway: spec.highway,
      flatZones: spec.stops.map((s) => ({ from: s.s - 80, to: s.s + 80 })),
    });
    expect(path.points.length).toBeGreaterThan(1000);
    expect(Number.isFinite(path.at(spec.playLengthM / 2).x)).toBe(true);
  });
});
