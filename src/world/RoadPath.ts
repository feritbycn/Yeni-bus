import { clamp, lerp, mulberry32, smoothstep } from '../core/utils';

/**
 * Deterministic road centre-line used by BOTH the 3D world and the game logic (progress, lateral
 * offset, grade, lane positions). Pure maths, no Three.js, so it is unit-testable.
 *
 * Conventions: heading h => forward = (sin h, cos h); right-hand side = (-cos h, sin h).
 * Lateral offset d > 0 means "to the right of the centre line" (our driving direction).
 */

export interface PathPoint {
  x: number;
  y: number;
  z: number;
  h: number;
  /** curvature (1/m), + = turning left (heading increases) */
  k: number;
  s: number;
}

export interface PathOptions {
  seed: number;
  length: number;
  difficulty: number;
  hilly: number;
  highway: boolean;
  /** zones forced flat and straight (towns, stops) */
  flatZones: { from: number; to: number }[];
}

export const PATH_STEP = 8;

export class RoadPath {
  readonly step = PATH_STEP;
  readonly points: PathPoint[] = [];
  readonly length: number;

  constructor(opts: PathOptions) {
    this.length = opts.length;
    const n = Math.ceil(opts.length / this.step) + 1;
    const rnd = mulberry32(opts.seed);

    // ---- bends ----
    interface Bend {
      start: number;
      len: number;
      peak: number;
    }
    const bends: Bend[] = [];
    let cursor = 700;
    let headingEstimate = 0;
    const minRadius = (opts.highway ? 320 : 130) + (6 - opts.difficulty) * (opts.highway ? 40 : 18);
    while (cursor < opts.length - 700) {
      const straight = (opts.highway ? 400 : 140) + rnd() * (opts.highway ? 900 : 480);
      const len = (opts.highway ? 260 : 110) + rnd() * (opts.highway ? 420 : 260);
      const radius = lerp(opts.highway ? 1400 : 900, minRadius, Math.pow(rnd(), 1.4));
      let sign = rnd() < 0.5 ? -1 : 1;
      if (Math.abs(headingEstimate) > 1.1 && rnd() < 0.9) sign = headingEstimate > 0 ? -1 : 1;
      const start = cursor + straight;
      const peak = sign / radius;
      bends.push({ start, len, peak });
      headingEstimate += (peak * len) / 2;
      cursor = start + len;
    }

    // ---- masks (flat + straight) ----
    const flatMask = (s: number): number => {
      let m = 1;
      for (const z of opts.flatZones) {
        const fade = 90;
        const inside = smoothstep(z.from - fade, z.from, s) * (1 - smoothstep(z.to, z.to + fade, s));
        m = Math.min(m, 1 - inside);
      }
      return m;
    };

    const amp1 = 22 * opts.hilly * (opts.highway ? 0.65 : 1);
    const amp2 = 6 * opts.hilly * (opts.highway ? 0.5 : 1);
    const ph1 = rnd() * 6.28;
    const ph2 = rnd() * 6.28;
    const lam1 = opts.highway ? 1200 : 800;
    const lam2 = opts.highway ? 340 : 220;

    let x = 0;
    let z = 0;
    let h = 0;
    let y = 0;
    for (let i = 0; i < n; i++) {
      const s = i * this.step;
      let k = 0;
      for (const b of bends) {
        if (s >= b.start && s <= b.start + b.len) {
          const t = (s - b.start) / b.len;
          const w = Math.sin(Math.PI * t);
          k += b.peak * w * w; // smooth entry/exit, max curvature = peak, total turn = peak * len / 2
        }
      }
      k *= flatMask(s);
      const mask = flatMask(s);
      // integrate the (masked) grade so that flat zones are really flat and the surface is continuous
      const grade = ((amp1 / lam1) * Math.cos(s / lam1 + ph1) + (amp2 / lam2) * Math.cos(s / lam2 + ph2)) * mask;
      this.points.push({ x, y, z, h, k, s });
      y += grade * this.step;
      h += k * this.step;
      x += Math.sin(h) * this.step;
      z += Math.cos(h) * this.step;
    }
  }

  private index(s: number): { i: number; t: number } {
    const f = clamp(s, 0, this.length) / this.step;
    const i = Math.min(this.points.length - 2, Math.floor(f));
    return { i, t: f - i };
  }

  at(s: number): PathPoint {
    const { i, t } = this.index(s);
    const a = this.points[i];
    const b = this.points[i + 1];
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      z: lerp(a.z, b.z, t),
      h: lerp(a.h, b.h, t),
      k: lerp(a.k, b.k, t),
      s: clamp(s, 0, this.length),
    };
  }

  /** Rise over run along the road (0.05 = 5% uphill) at distance s. */
  grade(s: number): number {
    const a = this.at(s - 4);
    const b = this.at(s + 4);
    const run = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return (b.y - a.y) / run;
  }

  /** World position of lateral offset d (m, + = right) at distance s. */
  lanePos(s: number, d: number): { x: number; y: number; z: number; h: number } {
    const p = this.at(s);
    return { x: p.x - Math.cos(p.h) * d, y: p.y, z: p.z + Math.sin(p.h) * d, h: p.h };
  }

  /**
   * Projects a world position onto the road. `hint` (previous s) keeps the search local and cheap.
   * Returns progress s, signed lateral offset d (+ right) and heading error helper data.
   */
  project(x: number, z: number, hint = 0): { s: number; d: number; h: number; y: number } {
    const centre = Math.round(clamp(hint, 0, this.length) / this.step);
    const lo = Math.max(0, centre - 50);
    const hi = Math.min(this.points.length - 2, centre + 50);
    let bestI = lo;
    let bestD2 = Infinity;
    for (let i = lo; i <= hi; i++) {
      const p = this.points[i];
      const dx = x - p.x;
      const dz = z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestI = i;
      }
    }
    // refine on the neighbouring segments
    let bestS = bestI * this.step;
    let bestSeg = Infinity;
    for (let i = Math.max(0, bestI - 1); i <= Math.min(this.points.length - 2, bestI); i++) {
      const a = this.points[i];
      const b = this.points[i + 1];
      const vx = b.x - a.x;
      const vz = b.z - a.z;
      const len2 = vx * vx + vz * vz || 1;
      const t = clamp(((x - a.x) * vx + (z - a.z) * vz) / len2, 0, 1);
      const px = a.x + vx * t;
      const pz = a.z + vz * t;
      const d2 = (x - px) ** 2 + (z - pz) ** 2;
      if (d2 < bestSeg) {
        bestSeg = d2;
        bestS = (i + t) * this.step;
      }
    }
    const p = this.at(bestS);
    const dx = x - p.x;
    const dz = z - p.z;
    // right vector = (-cos h, sin h)
    const d = dx * -Math.cos(p.h) + dz * Math.sin(p.h);
    return { s: bestS, d, h: p.h, y: p.y };
  }
}
