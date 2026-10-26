import type { QualityLevel, Settings } from './types';

export interface RenderQuality {
  level: Exclude<QualityLevel, 'auto'>;
  pixelRatioCap: number;
  shadowMapSize: number;
  shadows: boolean;
  viewDistance: number;
  /** multiplier for scenery instance pools */
  sceneryDensity: number;
  maxTraffic: number;
  maxVisiblePassengers: number;
  rainParticles: number;
  headlightBeams: boolean;
  antialias: boolean;
  fpsCap: number;
  /** animated details (wheel steering, indicators, passenger walking) */
  detailedAnimation: boolean;
}

const PRESETS: Record<Exclude<QualityLevel, 'auto'>, Omit<RenderQuality, 'fpsCap' | 'level'>> = {
  low: { pixelRatioCap: 1, shadowMapSize: 512, shadows: false, viewDistance: 380, sceneryDensity: 0.45, maxTraffic: 6, maxVisiblePassengers: 6, rainParticles: 500, headlightBeams: false, antialias: false, detailedAnimation: false },
  medium: { pixelRatioCap: 1.5, shadowMapSize: 1024, shadows: true, viewDistance: 600, sceneryDensity: 0.75, maxTraffic: 12, maxVisiblePassengers: 14, rainParticles: 1200, headlightBeams: true, antialias: true, detailedAnimation: true },
  high: { pixelRatioCap: 2, shadowMapSize: 2048, shadows: true, viewDistance: 850, sceneryDensity: 1, maxTraffic: 20, maxVisiblePassengers: 28, rainParticles: 2500, headlightBeams: true, antialias: true, detailedAnimation: true },
  ultra: { pixelRatioCap: 2.5, shadowMapSize: 4096, shadows: true, viewDistance: 1200, sceneryDensity: 1.3, maxTraffic: 28, maxVisiblePassengers: 50, rainParticles: 4000, headlightBeams: true, antialias: true, detailedAnimation: true },
};

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
}

/** Picks a starting quality for "auto" from hardware hints. */
export function guessAutoQuality(): Exclude<QualityLevel, 'auto'> {
  if (typeof navigator === 'undefined') return 'medium';
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  const touch = isTouchDevice();
  if (touch && (cores <= 4 || mem <= 3)) return 'low';
  if (touch) return 'medium';
  if (cores >= 8 && mem >= 8) return 'high';
  return 'medium';
}

/**
 * Resolves the user's settings into concrete render quality and adapts it at runtime
 * (when quality is "auto" a sustained low FPS lowers the level, a sustained high FPS may raise it).
 */
export class PerformanceManager {
  private autoLevel: Exclude<QualityLevel, 'auto'> = guessAutoQuality();
  private frameTimes: number[] = [];
  private lastAdapt = 0;
  fps = 60;
  private listeners = new Set<(q: RenderQuality) => void>();

  constructor(private getSettings: () => Settings) {}

  onChange(cb: (q: RenderQuality) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  current(): RenderQuality {
    const s = this.getSettings();
    const level = s.quality === 'auto' ? this.autoLevel : s.quality;
    const p = PRESETS[level];
    const shadowsOff = s.shadows === 'off';
    const shadowSize = s.shadows === 'low' ? 512 : s.shadows === 'high' ? Math.max(p.shadowMapSize, 2048) : p.shadowMapSize;
    const traffic = s.trafficDensity === 'auto' ? p.maxTraffic : { off: 0, low: 6, medium: 12, high: 22 }[s.trafficDensity];
    const pax = s.passengerDetail === 'auto' ? p.maxVisiblePassengers : { low: 6, medium: 16, high: 40 }[s.passengerDetail];
    return {
      ...p,
      level,
      shadows: p.shadows && !shadowsOff,
      shadowMapSize: shadowSize,
      viewDistance: Math.min(s.viewDistance, p.viewDistance * 1.5),
      maxTraffic: traffic,
      maxVisiblePassengers: pax,
      fpsCap: s.fpsCap,
    };
  }

  /** Call once per rendered frame with the frame time in seconds. */
  sample(dt: number, now: number): void {
    if (dt <= 0 || dt > 1) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (this.frameTimes.length < 30) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.fps = 1 / avg;
    if (this.getSettings().quality !== 'auto') return;
    if (now - this.lastAdapt < 4000) return;
    const order: Exclude<QualityLevel, 'auto'>[] = ['low', 'medium', 'high', 'ultra'];
    const i = order.indexOf(this.autoLevel);
    if (this.fps < 32 && i > 0) {
      this.autoLevel = order[i - 1];
      this.lastAdapt = now;
      this.frameTimes.length = 0;
      this.notify();
    } else if (this.fps > 58 && i < 2 && now - this.lastAdapt > 15000) {
      // allow growing back up to "high" only, and slowly
      this.autoLevel = order[i + 1];
      this.lastAdapt = now;
      this.frameTimes.length = 0;
      this.notify();
    }
  }

  notify(): void {
    const q = this.current();
    for (const l of [...this.listeners]) l(q);
  }
}
