/** Small, dependency-free helpers shared by pure game logic (no DOM / Three.js here). */

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a || 1), 0, 1);
  return t * t * (3 - 2 * t);
};
export const round2 = (v: number): number => Math.round(v * 100) / 100;
export const KMH = 3.6;

/** Deterministic PRNG so routes, candidates and weather are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

let uidCounter = 0;
export function uid(prefix: string): string {
  uidCounter = (uidCounter + 1) % 1_000_000;
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  const rnd = g.crypto?.randomUUID ? g.crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${uidCounter.toString(36)}_${rnd}`;
}

const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/** Local calendar day key, e.g. 2026-10-26. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Key of the Monday that starts the week containing ts. */
export function weekKey(ts: number): string {
  const d = new Date(ts);
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return dayKey(d.getTime());
}

export function daysBetweenKeys(a: string, b: string): number {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  const ta = Date.UTC(pa[0], pa[1] - 1, pa[2]);
  const tb = Date.UTC(pb[0], pb[1] - 1, pb[2]);
  return Math.round((tb - ta) / 86_400_000);
}

export function pick<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length) % arr.length];
}

export function shuffled<T>(rnd: () => number, arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function formatNumber(n: number, locale = 'tr-TR'): string {
  return Math.round(n).toLocaleString(locale);
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function formatClock(hourFloat: number): string {
  const h = ((hourFloat % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${pad(hh)}:${pad(mm)}`;
}

export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Keeps arrays bounded (ledger, processed ids, history). */
export function capArray<T>(arr: T[], max: number): void {
  if (arr.length > max) arr.splice(0, arr.length - max);
}
