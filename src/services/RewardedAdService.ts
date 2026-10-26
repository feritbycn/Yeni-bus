import type { GameEvents, GameState } from '../core/types';
import type { EventBus } from '../core/EventBus';
import type { EconomyManager } from '../systems/EconomyManager';
import type { CompanyManager } from '../systems/CompanyManager';
import type { ClockService } from '../systems/ClockService';
import type { DailyRewardManager } from '../systems/DailyRewardManager';
import type { PremiumService } from './PremiumService';
import { AD_REWARDS } from '../data/shop';
import { AD_COOLDOWN_MS, PREMIUM_FREE_CLAIMS_PER_DAY } from '../data/constants';
import { TRIAL_COSMETIC_ID } from '../data/cosmetics';
import { dayKey, uid } from '../core/utils';

/** What a platform ad integration must implement. Real SDK code lives ONLY in adapters. */
export interface RewardedAdAdapter {
  readonly id: string;
  /** true for adapters that do not show real ads (web demo). The UI labels them clearly. */
  readonly isTest: boolean;
  isSupported(): boolean;
  /** Resolves true when an ad is ready to be shown. */
  load(): Promise<boolean>;
  show(): Promise<AdShowResult>;
}

export interface AdShowResult {
  status: 'completed' | 'dismissed' | 'failed';
  /** Unique id of this view (provider transaction id / server-side-verification id). */
  transactionId?: string;
  /** true only when the provider (or your server) confirmed the completion. */
  verified?: boolean;
  error?: string;
}

export type AdFailure =
  | 'unknownType'
  | 'limit'
  | 'cooldown'
  | 'alreadyActive'
  | 'unavailable'
  | 'unsupported'
  | 'loadFailed'
  | 'dismissed'
  | 'failed'
  | 'unverified'
  | 'busy'
  | 'duplicate'
  | 'clock';

export interface AdClaimResult {
  ok: boolean;
  reason?: AdFailure;
  mode?: 'ad' | 'premiumFree';
  type?: string;
  summary?: { cash?: number; gold?: number; boost?: boolean };
  testAd?: boolean;
}

export interface AdStatus {
  type: string;
  usedToday: number;
  dailyLimit: number;
  cooldownMs: number;
  eligible: boolean;
  reason?: AdFailure;
  premiumFree: boolean;
}

export class RewardedAdService {
  private busy = false;

  constructor(
    private readonly state: GameState,
    private readonly bus: EventBus<GameEvents>,
    private readonly economy: EconomyManager,
    private readonly company: CompanyManager,
    private readonly clock: ClockService,
    private readonly premium: PremiumService,
    private readonly daily: DailyRewardManager,
    private adapter: RewardedAdAdapter,
  ) {}

  setAdapter(adapter: RewardedAdAdapter): void {
    this.adapter = adapter;
  }

  get adapterInfo(): { id: string; isTest: boolean } {
    return { id: this.adapter.id, isTest: this.adapter.isTest };
  }

  private rollDay(): void {
    const today = dayKey(this.clock.now());
    const a = this.state.ads;
    if (a.dayKey !== today) {
      a.dayKey = today;
      a.countByType = {};
      a.premiumFreeClaims = 0;
    }
  }

  premiumFreeLeft(): number {
    this.rollDay();
    return this.premium.isPremium() ? Math.max(0, PREMIUM_FREE_CLAIMS_PER_DAY - this.state.ads.premiumFreeClaims) : 0;
  }

  /** Is this boost / reward currently useful? Prevents wasting a video on an already active effect. */
  private alreadyActive(type: string): boolean {
    const b = this.state.boosts;
    const now = this.clock.now();
    switch (type) {
      case 'tripRevenue':
        return b.revenue > 0;
      case 'fuelDiscount':
        return b.fuelDiscount > 0;
      case 'maintenanceDiscount':
        return b.maintenanceDiscount > 0;
      case 'demandBoost':
        return b.demand > 0;
      case 'upgradeDiscount':
        return b.upgradeDiscount > 0;
      case 'missionBonus':
        return b.missionBonus > 0;
      case 'cosmeticTrial':
        return !!this.state.tempCosmetic && this.state.tempCosmetic.expiresAt > now;
      default:
        return false;
    }
  }

  status(type: string): AdStatus {
    this.rollDay();
    const def = AD_REWARDS.find((d) => d.id === type);
    const used = this.state.ads.countByType[type] ?? 0;
    const limit = def?.dailyLimit ?? 0;
    const cooldown = Math.max(0, this.state.ads.lastAdAt + AD_COOLDOWN_MS - this.clock.now());
    const premiumFree = this.premiumFreeLeft() > 0;
    const out: AdStatus = { type, usedToday: used, dailyLimit: limit, cooldownMs: premiumFree ? 0 : cooldown, eligible: true, premiumFree };
    if (!def) return { ...out, eligible: false, reason: 'unknownType' };
    if (type === 'doubleDaily') {
      const d = this.daily.status();
      if (!d.canDouble) return { ...out, eligible: false, reason: 'unavailable' };
    }
    if (this.alreadyActive(type)) return { ...out, eligible: false, reason: 'alreadyActive' };
    if (!premiumFree) {
      if (used >= limit) return { ...out, eligible: false, reason: 'limit' };
      if (cooldown > 0) return { ...out, eligible: false, reason: 'cooldown' };
    }
    return out;
  }

  /** Reward amounts scale with company level so they stay relevant. */
  cashRewardAmount(): number {
    return 1500 + this.state.company.level * 500;
  }
  goldRewardAmount(): number {
    return 5;
  }

  /**
   * Full flow: eligibility -> (premium free claim | load + show ad) -> verification -> one-time grant.
   * Nothing is granted unless the completion is confirmed and the transaction id is new.
   */
  async claim(type: string): Promise<AdClaimResult> {
    if (this.busy) return { ok: false, reason: 'busy' };
    if (this.clock.isClockBehind()) return { ok: false, reason: 'clock' };
    const st = this.status(type);
    if (!st.eligible) return { ok: false, reason: st.reason, type };
    this.busy = true;
    try {
      if (st.premiumFree) {
        const txId = uid('premfree');
        const summary = this.grant(type, `premfree:${txId}`);
        if (!summary) return { ok: false, reason: 'duplicate', type };
        this.state.ads.premiumFreeClaims += 1;
        this.bus.emit('adRewardGranted', { type });
        return { ok: true, mode: 'premiumFree', type, summary };
      }

      if (!this.adapter.isSupported()) return { ok: false, reason: 'unsupported', type };
      const ready = await this.adapter.load().catch(() => false);
      if (!ready) return { ok: false, reason: 'loadFailed', type };
      const res = await this.adapter.show().catch((e: unknown): AdShowResult => ({ status: 'failed', error: String(e) }));
      if (res.status === 'dismissed') return { ok: false, reason: 'dismissed', type };
      if (res.status !== 'completed') return { ok: false, reason: 'failed', type };
      if (!res.verified || !res.transactionId) return { ok: false, reason: 'unverified', type };

      const summary = this.grant(type, `ad:${res.transactionId}`);
      if (!summary) return { ok: false, reason: 'duplicate', type };
      this.state.ads.countByType[type] = (this.state.ads.countByType[type] ?? 0) + 1;
      this.state.ads.lastAdAt = this.clock.now();
      this.state.ads.totalWatched += 1;
      this.state.stats.adsWatched += 1;
      this.bus.emit('adRewardGranted', { type });
      return { ok: true, mode: 'ad', type, summary, testAd: this.adapter.isTest };
    } finally {
      this.busy = false;
      this.bus.emit('stateChanged', undefined);
    }
  }

  /** Applies the reward exactly once per idempotency key. Returns what was granted or null. */
  private grant(type: string, key: string): { cash?: number; gold?: number; boost?: boolean } | null {
    let summary: { cash?: number; gold?: number; boost?: boolean } = {};
    const b = this.state.boosts;
    const done = this.economy.grantOnce(key, () => {
      switch (type) {
        case 'cash': {
          const amt = this.cashRewardAmount();
          this.economy.add('cash', amt, 'adReward', { ref: key, description: 'rewarded video: cash' });
          summary = { cash: amt };
          break;
        }
        case 'gold': {
          const amt = this.goldRewardAmount();
          this.economy.add('gold', amt, 'adReward', { ref: key, description: 'rewarded video: gold' });
          summary = { gold: amt };
          break;
        }
        case 'tripRevenue':
          b.revenue = 1;
          summary = { boost: true };
          break;
        case 'fuelDiscount':
          b.fuelDiscount = 1;
          summary = { boost: true };
          break;
        case 'maintenanceDiscount':
          b.maintenanceDiscount = 1;
          summary = { boost: true };
          break;
        case 'demandBoost':
          b.demand = 1;
          summary = { boost: true };
          break;
        case 'upgradeDiscount':
          b.upgradeDiscount = 1;
          summary = { boost: true };
          break;
        case 'missionBonus':
          b.missionBonus = 1;
          summary = { boost: true };
          break;
        case 'cosmeticTrial':
          this.state.tempCosmetic = { cosmeticId: TRIAL_COSMETIC_ID, expiresAt: this.clock.now() + 24 * 3_600_000 };
          summary = { boost: true };
          break;
        case 'doubleDaily': {
          const r = this.daily.applyDouble();
          if (r.ok) summary = { cash: r.reward.cash, gold: r.reward.gold };
          break;
        }
        default:
          break;
      }
    });
    return done ? summary : null;
  }
}
