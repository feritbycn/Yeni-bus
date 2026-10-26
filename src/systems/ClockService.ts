import type { ClockState } from '../core/types';

/**
 * Monotonic game clock. Date.now() can be moved by the player; this service makes sure game time
 * never goes backwards (so "set the clock back to re-claim a reward" does not work).
 *
 * LIMITATION: without a trusted server a player can still move the device clock FORWARD.
 * Daily rewards are therefore limited to one per calendar day and offline earnings are capped,
 * but this is not tamper-proof. See docs/KNOWN_LIMITATIONS.md.
 */
export class ClockService {
  constructor(
    private readonly state: ClockState,
    private readonly source: () => number = () => Date.now(),
  ) {}

  /** Trusted "now": never earlier than the highest time ever observed. */
  now(): number {
    const raw = this.source();
    if (raw > this.state.highWater) this.state.highWater = raw;
    return this.state.highWater;
  }

  /** True when the device clock is currently behind the high-water mark (clock set back). */
  isClockBehind(toleranceMs = 120_000): boolean {
    return this.source() < this.state.highWater - toleranceMs;
  }

  /** Registers a new app launch; flags absurd forward jumps. Returns elapsed ms since last launch. */
  registerLaunch(maxPlausibleGapMs = 45 * 86_400_000): number {
    const now = this.now();
    const gap = Math.max(0, now - this.state.lastLaunch);
    if (gap > maxPlausibleGapMs) this.state.suspiciousJumps += 1;
    this.state.lastLaunch = now;
    return gap;
  }
}
