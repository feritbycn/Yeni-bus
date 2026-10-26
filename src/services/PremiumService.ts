import type { GameEvents, GameState } from '../core/types';
import type { EventBus } from '../core/EventBus';
import type { ClockService } from '../systems/ClockService';
import { PREMIUM_DISCOUNT } from '../data/constants';
import type { CosmeticDef } from '../data/cosmetics';

export type PremiumStatus = 'none' | 'active' | 'cancelled' | 'expired' | 'refunded';

/**
 * The ONLY place that decides whether the player is Premium and which entitlements apply.
 * Screens and systems must ask this service instead of reading state.purchases themselves.
 *
 * Premium design (see docs/PREMIUM_SYSTEM.md):
 *  - badge, daily premium reward, premium-only cosmetics, extra premium missions, extra statistics,
 *    20% discount on garage customization, more saved designs
 *  - no ads are ever required: ad-reward offers can be claimed ad-free from a daily quota
 *  - does NOT raise physical seat capacity and does NOT skip the gameplay loop
 */
export class PremiumService {
  constructor(
    private readonly state: GameState,
    private readonly bus: EventBus<GameEvents>,
    private readonly clock: ClockService,
  ) {}

  private get sub() {
    return this.state.purchases.subscription;
  }

  /** Current subscription status, evaluated against the trusted clock. */
  status(): PremiumStatus {
    const s = this.sub;
    if (s.status === 'refunded') return 'refunded';
    if (s.status === 'none') return 'none';
    if (this.clock.now() >= s.expiresAt) return 'expired';
    return s.status === 'cancelled' ? 'cancelled' : 'active';
  }

  /** Premium rights apply while active, or cancelled-but-not-yet-expired (store semantics). */
  isPremium(): boolean {
    const st = this.status();
    return st === 'active' || st === 'cancelled';
  }

  expiresAt(): number {
    return this.sub.expiresAt;
  }

  isTestSubscription(): boolean {
    return this.sub.source === 'test';
  }

  /** Refreshes persisted status when a period ends. Call on launch and periodically. */
  refresh(): void {
    const s = this.sub;
    if ((s.status === 'active' || s.status === 'cancelled') && this.clock.now() >= s.expiresAt) {
      s.status = 'expired';
      this.bus.emit('toast', { kind: 'warn', text: 'premium.expiredToast' });
      this.bus.emit('stateChanged', undefined);
    }
  }

  /** Called only after a purchase was verified (store adapter) or explicitly simulated (test). */
  activateSubscription(productId: string, transactionId: string, expiresAt: number, source: 'store' | 'test'): void {
    const s = this.sub;
    s.productId = productId;
    s.transactionId = transactionId;
    s.expiresAt = Math.max(expiresAt, s.status === 'active' ? s.expiresAt : 0);
    s.status = 'active';
    s.source = source;
    this.bus.emit('stateChanged', undefined);
  }

  /** The store reported auto-renew switched off: rights stay until the end of the paid period. */
  markCancelled(): void {
    if (this.sub.status === 'active') {
      this.sub.status = 'cancelled';
      this.bus.emit('stateChanged', undefined);
    }
  }

  /** Refund / chargeback: rights end immediately. */
  revokeSubscription(transactionId?: string): void {
    const s = this.sub;
    if (transactionId && s.transactionId && s.transactionId !== transactionId) return;
    s.status = 'refunded';
    s.expiresAt = 0;
    this.bus.emit('stateChanged', undefined);
  }

  adsFree(): boolean {
    return this.isPremium() || this.state.purchases.entitlements.removeAds;
  }

  /** Whether forced full-screen ads may be shown. (This build never shows any.) */
  canShowInterstitial(): boolean {
    return !this.adsFree();
  }

  canShowBanner(): boolean {
    return !this.adsFree();
  }

  /** Optional ad promos (e.g. "watch a video" suggestions on the main menu). */
  canShowAdPromos(): boolean {
    return !this.adsFree();
  }

  garageDiscount(): number {
    return this.isPremium() ? PREMIUM_DISCOUNT : 0;
  }

  hasGarageExpansion(): boolean {
    return this.state.purchases.entitlements.garageExpansion;
  }

  hasBusUnlock(modelId: string): boolean {
    return this.state.purchases.entitlements.unlockedBusIds.includes(modelId);
  }

  /** May this cosmetic be APPLIED right now? (Owning it is tracked separately.) */
  canApplyCosmetic(def: CosmeticDef): boolean {
    if (def.premiumOnly && !this.isPremium()) return false;
    return true;
  }

  maxSavedDesigns(): number {
    return this.isPremium() ? 10 : 3;
  }
}
