import * as THREE from 'three';
import type { RouteSpec } from '../systems/RouteManager';
import type { RoadPath } from '../world/RoadPath';
import { buildTrafficBody, type TrafficBody, type TrafficKind } from '../vehicle/BusModel';
import { clamp, mulberry32 } from '../core/utils';
import type { LightPhase } from '../world/RoadWorld';

export const LIGHT_CYCLE = 40;
const GREEN = 20;
const YELLOW = 4;

/** Phase of traffic light `index` at game-independent time `t` (seconds). Deterministic. */
export function lightPhaseAt(index: number, t: number): LightPhase {
  const x = (((t + index * 13) % LIGHT_CYCLE) + LIGHT_CYCLE) % LIGHT_CYCLE;
  if (x < GREEN) return 'green';
  if (x < GREEN + YELLOW) return 'yellow';
  return 'red';
}

export interface PlayerBody {
  x: number;
  z: number;
  heading: number;
  length: number;
  width: number;
  /** m/s along heading */
  speed: number;
  s: number;
  d: number;
}

export interface TrafficCollision {
  relSpeed: number;
  kind: TrafficKind;
  /** unit vector (world) pointing from the other vehicle to the player */
  nx: number;
  nz: number;
}

export interface TrafficFrame {
  collisions: TrafficCollision[];
  tailgating: boolean;
  /** an ambulance is closing in from behind in our lane */
  ambulanceBehind: boolean;
  /** metres to the nearest vehicle ahead in our lane (Infinity if none) */
  gapAhead: number;
}

interface Veh {
  id: number;
  kind: TrafficKind;
  s: number;
  d: number;
  dir: 1 | -1;
  v: number;
  v0: number;
  body: TrafficBody;
  length: number;
  width: number;
  /** seconds of enforced stop after a crash */
  stunned: number;
  braking: boolean;
  x: number;
  z: number;
  h: number;
}

const COLORS = [0xc9d1d9, 0x1f3a5f, 0x8a1c1c, 0x2d5f3a, 0x111418, 0xe2b53a, 0x5b6470, 0xf2f2f2, 0x6b3fa0, 0xd0652b];

function randomKind(rnd: () => number, highway: boolean): TrafficKind {
  const r = rnd();
  if (r < 0.62) return 'car';
  if (r < 0.78) return 'van';
  if (r < (highway ? 0.93 : 0.9)) return 'truck';
  if (r < 0.985) return 'bus';
  return 'ambulance';
}

export interface TrafficOptions {
  route: RouteSpec;
  path: RoadPath;
  maxVehicles: number;
  spawnRadius: number;
}

/**
 * Lightweight traffic simulation along the road: IDM car-following, red-light stopping, jams,
 * speed limits, an opposing flow and OBB collisions with the player. Deterministic per route seed.
 */
export class TrafficManager {
  readonly group = new THREE.Group();
  private vehicles: Veh[] = [];
  private nextId = 1;
  private rnd: () => number;
  private spawnTimer = 0;
  private time = 0;
  private lastPlayerS = 0;
  enabled = true;
  maxVehicles: number;

  constructor(private readonly o: TrafficOptions) {
    this.rnd = mulberry32(o.route.seed ^ 0x5f3759df);
    this.maxVehicles = o.maxVehicles;
  }

  get count(): number {
    return this.vehicles.length;
  }

  /** Read-only snapshot used by tests and the minimap. */
  snapshot(): { s: number; d: number; dir: 1 | -1; v: number; kind: TrafficKind }[] {
    return this.vehicles.map((v) => ({ s: v.s, d: v.d, dir: v.dir, v: v.v, kind: v.kind }));
  }

  private levelFactor(): number {
    const l = this.o.route.trafficLevel;
    return l === 'light' ? 0.5 : l === 'heavy' ? 1.5 : 1;
  }

  private limitAt(s: number): number {
    let lim = this.o.route.highway ? 100 : 70;
    for (const z of this.o.route.speedZones) if (s >= z.from && s <= z.to) lim = Math.min(lim, z.limit);
    return lim / 3.6;
  }

  private inJam(s: number): boolean {
    for (const j of this.o.route.jams) if (s >= j.from && s <= j.to) return true;
    return false;
  }

  private spawn(playerS: number, ahead: boolean, opposite: boolean): void {
    const { route, path, spawnRadius } = this.o;
    const rnd = this.rnd;
    const lanes = opposite ? route.profile.lanesOpposite : route.profile.lanesSame;
    if (!lanes.length) return;
    const lane = lanes[Math.floor(rnd() * lanes.length)];
    const dist = ahead ? 120 + rnd() * (spawnRadius - 120) : -(80 + rnd() * 120);
    const s = playerS + dist;
    if (s < 40 || s > route.playLengthM - 40) return;
    // keep out of bays / terminals
    for (const st of route.stops) if (Math.abs(s - st.s) < 70) return;
    const kind = randomKind(rnd, route.highway);
    const body = buildTrafficBody(kind, COLORS[Math.floor(rnd() * COLORS.length)]);
    // no overlap with an existing vehicle in the same lane
    for (const v of this.vehicles) if (Math.abs(v.d - lane) < 1 && Math.abs(v.s - s) < body.length + v.length + 10) {
      return;
    }
    const lim = this.limitAt(s);
    const v0 = lim * (kind === 'truck' ? 0.82 : kind === 'bus' ? 0.88 : kind === 'ambulance' ? 1.25 : 0.88 + rnd() * 0.17);
    const dir: 1 | -1 = opposite ? -1 : 1;
    const veh: Veh = { id: this.nextId++, kind, s, d: lane, dir, v: v0 * 0.85, v0, body, length: body.length, width: body.width, stunned: 0, braking: false, x: 0, z: 0, h: 0 };
    this.place(veh, path);
    this.group.add(body.group);
    this.vehicles.push(veh);
  }

  private place(v: Veh, path: RoadPath): void {
    const p = path.lanePos(v.s, v.d);
    v.x = p.x;
    v.z = p.z;
    v.h = v.dir === 1 ? p.h : p.h + Math.PI;
    v.body.group.position.set(p.x, p.y, p.z);
    v.body.group.rotation.y = v.h;
  }

  private remove(v: Veh): void {
    this.group.remove(v.body.group);
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
  }

  /** Fill the road around the player at the start of a trip. */
  prime(playerS: number): void {
    const target = Math.round(this.maxVehicles * 0.6 * this.levelFactor());
    for (let i = 0; i < target * 4 && this.vehicles.length < target; i++) this.spawn(playerS, true, this.rnd() < 0.4);
  }

  update(dt: number, player: PlayerBody, pcount = 1): TrafficFrame {
    const frame: TrafficFrame = { collisions: [], tailgating: false, ambulanceBehind: false, gapAhead: Infinity };
    if (!this.enabled) return frame;
    this.time += dt;
    const { route, path, spawnRadius } = this.o;
    const lights = route.trafficLights;
    const lanesSame = route.profile.lanesSame;
    // spawning
    this.spawnTimer -= dt;
    const cap = Math.min(this.maxVehicles, Math.round(this.maxVehicles * this.levelFactor() * 0.8) + 2);
    if (this.spawnTimer <= 0 && this.vehicles.length < cap) {
      const movingBack = player.speed < -1;
      this.spawn(player.s, !movingBack, this.rnd() < 0.42);
      if (this.rnd() < 0.25) this.spawn(player.s, false, false);
      this.spawnTimer = 0.6 / this.levelFactor();
    }
    // jam zones are packed with slow vehicles
    for (const j of route.jams) {
      if (player.s > j.from - 250 && player.s < j.to + 50 && this.vehicles.length < cap + 6 && this.rnd() < 0.05) {
        const s = j.from + this.rnd() * (j.to - j.from);
        const lane = lanesSame[Math.floor(this.rnd() * lanesSame.length)];
        if (lane === undefined) continue;
        const kind = randomKind(this.rnd, route.highway);
        const body = buildTrafficBody(kind === 'ambulance' ? 'car' : kind, COLORS[Math.floor(this.rnd() * COLORS.length)]);
        let clash = false;
        for (const v of this.vehicles) if (Math.abs(v.d - lane) < 1 && Math.abs(v.s - s) < body.length + v.length + 6) clash = true;
        if (clash || Math.abs(s - player.s) < 60) continue;
        const veh: Veh = { id: this.nextId++, kind: kind === 'ambulance' ? 'car' : kind, s, d: lane, dir: 1, v: 3, v0: 3, body, length: body.length, width: body.width, stunned: 0, braking: false, x: 0, z: 0, h: 0 };
        this.place(veh, path);
        this.group.add(body.group);
        this.vehicles.push(veh);
      }
    }

    // sort same-direction vehicles per lane for leader lookup
    const byLane = new Map<number, Veh[]>();
    for (const v of this.vehicles) {
      const key = v.dir * 1000 + Math.round(v.d * 10);
      let a = byLane.get(key);
      if (!a) byLane.set(key, (a = []));
      a.push(v);
    }
    for (const a of byLane.values()) a.sort((p, q) => p.dir * (q.s - p.s));

    const playerLaneIdx = lanesSame.reduce((best, l, i) => (Math.abs(l - player.d) < Math.abs(lanesSame[best] - player.d) ? i : best), 0);
    void playerLaneIdx;

    for (const a of byLane.values()) {
      for (let i = 0; i < a.length; i++) {
        const v = a[i];
        if (v.stunned > 0) {
          v.stunned -= dt;
          v.v = Math.max(0, v.v - 14 * dt);
          v.braking = true;
          this.advance(v, dt);
          continue;
        }
        const limit = this.limitAt(v.s);
        let v0 = Math.min(v.v0, v.kind === 'ambulance' ? limit * 1.25 : limit * 1.02);
        if (v.dir === 1 && this.inJam(v.s)) v0 = Math.min(v0, 4);
        // leader gap (net bumper distance) and speed
        let gap = 1e9;
        let lv = v.v;
        const leader = a[i - 1];
        if (leader && (leader.s - v.s) * v.dir > 0) {
          gap = Math.abs(leader.s - v.s) - (leader.length + v.length) / 2;
          lv = leader.v;
        }
        // the player as a leader (same direction, overlapping lane)
        if (v.dir === 1) {
          const ahead = player.s - v.s;
          if (ahead > 0 && Math.abs(player.d - v.d) < (player.width + v.width) / 2 + 0.4) {
            const g = ahead - (player.length + v.length) / 2;
            if (g < gap) {
              gap = g;
              lv = Math.max(0, player.speed);
            }
          }
          // red light stopping
          for (let li = 0; li < lights.length; li++) {
            const ls = lights[li];
            const dist = ls - 8 - v.s - v.length / 2;
            if (dist > -2 && dist < 90) {
              const ph = lightPhaseAt(li, this.time);
              const stop = ph === 'red' || (ph === 'yellow' && dist > v.v * 1.6);
              if (stop && dist < gap) {
                gap = Math.max(0.1, dist);
                lv = 0;
              }
            }
          }
        } else {
          // opposite flow obeys the same lights with a half-cycle offset (visual realism only)
          for (let li = 0; li < lights.length; li++) {
            const ls = lights[li];
            const dist = v.s - (ls + 8) - v.length / 2;
            if (dist > -2 && dist < 90) {
              const ph = lightPhaseAt(li, this.time + 20);
              if ((ph === 'red' || ph === 'yellow') && dist < gap) {
                gap = Math.max(0.1, dist);
                lv = 0;
              }
            }
          }
        }
        // IDM
        const aMax = v.kind === 'truck' || v.kind === 'bus' ? 1.1 : 1.8;
        const b = 3.2;
        const T = 1.3;
        const s0 = 2.5;
        const dv = v.v - lv;
        const sStar = s0 + Math.max(0, v.v * T + (v.v * dv) / (2 * Math.sqrt(aMax * b)));
        let acc = aMax * (1 - Math.pow(v.v / Math.max(1, v0), 4) - Math.pow(sStar / Math.max(0.5, gap), 2));
        acc = clamp(acc, -9, aMax);
        v.braking = acc < -1.2;
        v.v = Math.max(0, v.v + acc * dt);
        this.advance(v, dt);
      }
    }

    // despawn
    for (const v of [...this.vehicles]) {
      const rel = (v.s - player.s) * 1;
      if (rel > spawnRadius + 120 || rel < -260 || v.s < 10 || v.s > route.playLengthM - 10) this.remove(v);
    }

    // player interaction
    const cs = Math.cos(player.heading);
    const sn = Math.sin(player.heading);
    for (const v of this.vehicles) {
      // gap / tailgating (same lane ahead)
      if (v.dir === 1) {
        const ds = v.s - player.s;
        if (ds > 0 && ds < 80 && Math.abs(v.d - player.d) < (player.width + v.width) / 2 + 0.3) {
          const g = ds - (player.length + v.length) / 2;
          frame.gapAhead = Math.min(frame.gapAhead, g);
          if (player.speed > 8 && g < player.speed * 0.9 && g > 0) frame.tailgating = true;
        }
        if (v.kind === 'ambulance') {
          const back = player.s - v.s;
          if (back > 0 && back < 140 && Math.abs(v.d - player.d) < 3.5) frame.ambulanceBehind = true;
        }
      }
      // beacon
      if (v.body.beacon) v.body.beacon.emissiveIntensity = Math.sin(this.time * 14) > 0 ? 3 : 0.1;
      // cheap broad phase then SAT on rectangles
      const dx = v.x - player.x;
      const dz = v.z - player.z;
      if (dx * dx + dz * dz > 400) continue;
      if (this.obbOverlap(player, cs, sn, v)) {
        const rel = Math.abs(player.speed * Math.sign(1) - this.signedAlong(v, cs, sn));
        const len = Math.hypot(dx, dz) || 1;
        frame.collisions.push({ relSpeed: rel, kind: v.kind, nx: -dx / len, nz: -dz / len });
        v.stunned = 4;
        v.v *= 0.3;
      }
    }
    this.lastPlayerS = player.s;
    void pcount;
    return frame;
  }

  private signedAlong(v: Veh, cs: number, sn: number): number {
    // velocity of v projected on the player's heading (forward = (sin h, cos h))
    const vx = Math.sin(v.h) * v.v;
    const vz = Math.cos(v.h) * v.v;
    return vx * sn + vz * cs;
  }

  private advance(v: Veh, dt: number): void {
    v.s += v.dir * v.v * dt;
    this.place(v, this.o.path);
    const spin = (v.v * dt) / 0.36;
    for (const w of v.body.wheels) w.rotation.x += spin;
    v.body.brake.emissiveIntensity = v.braking ? 3 : 0.2;
    v.body.group.position.y += 0;
  }

  private obbOverlap(p: PlayerBody, cs: number, sn: number, v: Veh): boolean {
    // axes: player's forward (sn,cs) and right (-cs, sn); vehicle's forward and right
    const axes: [number, number][] = [
      [sn, cs],
      [-cs, sn],
      [Math.sin(v.h), Math.cos(v.h)],
      [-Math.cos(v.h), Math.sin(v.h)],
    ];
    const hp = [p.length / 2, p.width / 2];
    const hv = [v.length / 2, v.width / 2];
    const pf: [number, number][] = [axes[0], axes[1]];
    const vf: [number, number][] = [axes[2], axes[3]];
    const dx = v.x - p.x;
    const dz = v.z - p.z;
    for (const [ax, az] of axes) {
      let rp = 0;
      let rv = 0;
      for (let i = 0; i < 2; i++) {
        rp += hp[i] * Math.abs(ax * pf[i][0] + az * pf[i][1]);
        rv += hv[i] * Math.abs(ax * vf[i][0] + az * vf[i][1]);
      }
      if (Math.abs(dx * ax + dz * az) > rp + rv) return false;
    }
    return true;
  }

  dispose(): void {
    for (const v of [...this.vehicles]) this.remove(v);
    this.group.clear();
  }
}
