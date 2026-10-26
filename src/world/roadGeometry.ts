import type { RoadProfile, StopDef } from '../systems/RouteManager';
import { smoothstep } from '../core/utils';

export const BAY_WIDTH = 4.4;
export const BAY_HALF_LENGTH = 52;
export const BAY_TAPER = 24;

/** Extra paved width on the right-hand side near a stop (the bus bay). */
export function bayWidthAt(stops: StopDef[], s: number): number {
  let w = 0;
  for (const st of stops) {
    const a = st.s - BAY_HALF_LENGTH;
    const b = st.s + BAY_HALF_LENGTH;
    if (s < a || s > b) continue;
    const v = smoothstep(a, a + BAY_TAPER, s) * (1 - smoothstep(b - BAY_TAPER, b, s));
    w = Math.max(w, BAY_WIDTH * v);
  }
  return w;
}

/** Lateral limits of drivable surface (negative = left, positive = right) including shoulders. */
export function drivableLimits(profile: RoadProfile, stops: StopDef[], s: number): { left: number; right: number; paved: number } {
  const bay = bayWidthAt(stops, s);
  const paved = profile.halfWidth + bay;
  return {
    left: -(profile.halfWidth + profile.shoulder),
    right: bay > 0.5 ? paved + 0.2 : profile.halfWidth + profile.shoulder,
    paved,
  };
}

/** Lateral centre of the parking position in a bay. */
export function bayParkOffset(profile: RoadProfile): number {
  return profile.halfWidth + BAY_WIDTH / 2 + 0.05;
}

export function isOnPavement(profile: RoadProfile, stops: StopDef[], s: number, d: number, margin = 0): boolean {
  const lim = drivableLimits(profile, stops, s);
  return d >= lim.left - margin && d <= lim.right + margin;
}
