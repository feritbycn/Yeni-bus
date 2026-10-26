import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ALL_BUS_MODELS, BUS_BY_ID, BUS_MODELS } from '../src/data/buses';
import { RM_CATALOG, rmFile, rmId } from '../src/data/rmBuses';
import { parseShell } from '../src/vehicle/BusAssets';
import { tr } from '../src/i18n/tr';
import { en } from '../src/i18n/en';
import { makeEnv } from './helpers';

const rm = ALL_BUS_MODELS.filter((m) => m.glb);

async function load(file: string) {
  const buf = readFileSync(new URL(`../public/models/${file}`, import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise<{ scene: import('three').Object3D }>((res, rej) => new GLTFLoader().parse(ab as ArrayBuffer, '', res as never, rej));
  return parseShell(gltf.scene);
}

describe('imported 3D coaches: data', () => {
  it('adds 50 models on top of the 6 built-in ones', () => {
    expect(BUS_MODELS).toHaveLength(6);
    expect(rm).toHaveLength(50);
    expect(ALL_BUS_MODELS).toHaveLength(56);
    expect(new Set(ALL_BUS_MODELS.map((m) => m.id)).size).toBe(56);
  });
  it('every model file exists and matches the catalogue', () => {
    for (const [n, , length, width, height, color, seats, speed] of RM_CATALOG) {
      const m = BUS_BY_ID[rmId(n)];
      expect(m, rmId(n)).toBeDefined();
      expect(m.glb).toBe(rmFile(n));
      expect(existsSync(new URL(`../public/models/${m.glb}`, import.meta.url)), m.glb).toBe(true);
      expect(m.dims).toEqual({ length, width, height });
      expect(m.seats).toBe(seats);
      expect(m.maxSpeedKmh).toBe(speed);
      expect(m.factoryColor).toBe(color);
    }
  });
  it('balance values are sane and electric buses use kWh', () => {
    for (const m of rm) {
      expect(m.price).toBeGreaterThan(50_000);
      expect(m.unlockLevel).toBeGreaterThanOrEqual(2);
      expect(m.comfort).toBeLessThanOrEqual(100);
      expect(m.handling).toBeLessThanOrEqual(100);
      expect(m.powertrain === 'electric').toBe(m.style === 'electric');
    }
    expect(Math.max(...rm.map((m) => m.price))).toBeGreaterThan(Math.min(...rm.map((m) => m.price)) * 3);
  });
  it('has TR and EN names for every imported model', () => {
    for (const m of rm) for (const k of ['name', 'desc', 'class']) {
      expect(tr[`bus.${m.id}.${k}`], `tr ${m.id}.${k}`).toBeTruthy();
      expect(en[`bus.${m.id}.${k}`], `en ${m.id}.${k}`).toBeTruthy();
    }
  });
  it('can be bought through the garage once level and cash allow it, and survive a save round-trip', () => {
    const { ctx } = makeEnv();
    ctx.state.company.level = 20;
    ctx.state.cash = 5_000_000;
    ctx.state.buses.length = 1;
    expect(ctx.garage.canBuy('rm50').ok).toBe(true);
    const r = ctx.garage.buy('rm50');
    expect(r.ok).toBe(true);
    const back = ctx.save.sanitize(JSON.parse(JSON.stringify(ctx.state)));
    expect(back.buses.some((b) => b.modelId === 'rm50')).toBe(true);
    expect(ctx.garage.effectiveStats(r.value!).seats).toBe(BUS_BY_ID.rm50.seats);
  });
});

describe('imported 3D coaches: GLB conversion (all 50 files)', () => {
  it('finds 4 wheels (2 steering), a door, body and glass and matches the catalogue size', async () => {
    for (const m of rm) {
      const t = await load(m.glb!);
      expect(t.wheels, m.id).toHaveLength(4);
      expect(t.wheels.filter((w) => w.front), m.id).toHaveLength(2);
      for (const w of t.wheels) {
        expect(w.rim, m.id).not.toBeNull();
        expect(Math.abs(w.center.y - 0.64), m.id).toBeLessThan(0.1);
      }
      expect(t.body, m.id).not.toBeNull();
      expect(t.glass, m.id).not.toBeNull();
      expect(t.door, m.id).not.toBeNull();
      expect(t.door!.x, m.id).toBeLessThan(0); // passenger door on the right (-x)
      expect(t.roofFront, m.id).not.toBeNull();
      expect(t.bounds.max.z - t.bounds.min.z).toBeCloseTo(m.dims.length, 1);
      expect(t.bounds.max.y).toBeGreaterThan(m.dims.height - 0.1);
      expect(t.bounds.max.y).toBeLessThan(m.dims.height + 0.1);
      // nose is +z: the head lamps sit at the front
      t.headLamps!.computeBoundingBox();
      expect(t.headLamps!.boundingBox!.min.z).toBeGreaterThan(0);
    }
  });
});
