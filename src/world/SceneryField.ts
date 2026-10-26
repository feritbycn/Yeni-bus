import { hashString, mulberry32 } from '../core/utils';

export type SceneryKind = 'tree' | 'lamp' | 'building' | 'rock';

export interface SceneryItem {
  kind: SceneryKind;
  /** distance along the road */
  s: number;
  /** signed lateral offset (+ right) */
  d: number;
  scale: number;
  rot: number;
  variant: number;
  /** collision radius (m) */
  radius: number;
  /** building dimensions */
  w: number;
  depth: number;
  height: number;
}

export interface SceneryOptions {
  seed: number;
  playLength: number;
  /** road half width + shoulder on each side (drivable edge) */
  edge: number;
  towns: { from: number; to: number }[];
  /** stops where the right-hand side is reserved for terminal buildings */
  stopS: number[];
  density: number;
}

export const SCENERY_SPACING = 22;

/**
 * Deterministic roadside scenery. The SAME generator feeds rendering (instanced meshes) and
 * collision queries, so what you see is what you can hit.
 */
export class SceneryField {
  constructor(private readonly o: SceneryOptions) {}

  private inTown(s: number): boolean {
    for (const t of this.o.towns) if (s >= t.from - 10 && s <= t.to + 10) return true;
    return false;
  }

  private nearStop(s: number): boolean {
    for (const st of this.o.stopS) if (Math.abs(s - st) < 190) return true;
    return false;
  }

  itemsInRange(sFrom: number, sTo: number): SceneryItem[] {
    const out: SceneryItem[] = [];
    const k0 = Math.max(0, Math.floor(sFrom / SCENERY_SPACING));
    const k1 = Math.min(Math.floor(this.o.playLength / SCENERY_SPACING), Math.ceil(sTo / SCENERY_SPACING));
    for (let k = k0; k <= k1; k++) {
      const s = k * SCENERY_SPACING;
      const town = this.inTown(s);
      for (const side of [-1, 1] as const) {
        const rnd = mulberry32(hashString(`${this.o.seed}:${k}:${side}`));
        const edge = this.o.edge;
        const reserved = side === 1 && this.nearStop(s);
        if (town) {
          // street lamp on every slot
          if (!reserved) {
            out.push({ kind: 'lamp', s, d: side * (edge + 1.0), scale: 1, rot: side > 0 ? Math.PI : 0, variant: 0, radius: 0.28, w: 0, depth: 0, height: 7 });
          }
          if (!reserved && rnd() < 0.9 * Math.min(1, this.o.density + 0.2)) {
            const h = 6 + rnd() * 20;
            const w = 9 + rnd() * 8;
            const depth = 9 + rnd() * 6;
            out.push({ kind: 'building', s: s + (rnd() - 0.5) * 6, d: side * (edge + 7 + depth / 2 + rnd() * 3), scale: 1, rot: side > 0 ? Math.PI / 2 : -Math.PI / 2, variant: Math.floor(rnd() * 3), radius: Math.max(w, depth) / 2, w, depth, height: h });
          }
        } else {
          if (rnd() < 0.78 * this.o.density) {
            const dist = edge + 5 + rnd() * 38;
            const sc = 0.8 + rnd() * 0.9;
            out.push({ kind: 'tree', s: s + (rnd() - 0.5) * 10, d: side * dist, scale: sc, rot: rnd() * 6.28, variant: Math.floor(rnd() * 3), radius: 0.55 * sc, w: 0, depth: 0, height: 6 * sc });
          }
          if (rnd() < 0.1 * this.o.density) {
            const sc = 0.6 + rnd() * 1.4;
            out.push({ kind: 'rock', s: s + (rnd() - 0.5) * 10, d: side * (edge + 2.5 + rnd() * 20), scale: sc, rot: rnd() * 6.28, variant: 0, radius: 0.9 * sc, w: 0, depth: 0, height: sc });
          }
        }
      }
    }
    return out;
  }

  /** Solid obstacles close to the road (what the bus can crash into). */
  obstaclesNear(s: number, range = 60): SceneryItem[] {
    return this.itemsInRange(s - range, s + range).filter((i) => i.kind !== 'rock' || i.radius > 0.7);
  }
}
