import type { GameEvents, GameState } from '../core/types';
import type { EventBus } from '../core/EventBus';
import type { EconomyManager } from './EconomyManager';
import type { ClockService } from './ClockService';
import type { PremiumService } from '../services/PremiumService';
import { DAILY_REWARDS, PREMIUM_DAILY_REWARD, type DailyRewardDef } from '../data/shop';
import { daysBetweenKeys, dayKey } from '../core/utils';

export interface DailyStatus {
  today: string;
  claimedToday: boolean;
  /** 0..6: index of the reward that the next claim gives (or was given today) */
  nextIndex: number;
  streak: number;
  clockBehind: boolean;
  premiumAvailable: boolean;
  canDouble: boolean;
  doubledToday: boolean;
}

export type DailyClaimResult =
  | { ok: true; reward: DailyRewardDef; streak: number }
  | { ok: false; reason: 'already' | 'clock' | 'premium' | 'notClaimed' };

export class DailyRewardManager {
  constructor(
    private readonly state: GameState,
    private readonly bus: EventBus<GameEvents>,
    private readonly economy: EconomyManager,
    private readonly clock: ClockService,
    private readonly premium: PremiumService,
  ) {}

  status(): DailyStatus {
    const today = dayKey(this.clock.now());
    const d = this.state.daily;
    const claimedToday = d.lastClaimDay === today;
    let streak = d.streak;
    if (!claimedToday && d.lastClaimDay && daysBetweenKeys(d.lastClaimDay, today) > 1) streak = 0;
    const nextIndex = claimedToday ? (d.streak - 1) % 7 : streak % 7;
    return {
      today,
      claimedToday,
      nextIndex,
      streak,
      clockBehind: this.clock.isClockBehind(),
      premiumAvailable: this.premium.isPremium() && d.premiumClaimedDay !== today,
      canDouble: claimedToday && d.doubledDay !== today,
      doubledToday: d.doubledDay === today,
    };
  }

  claim(): DailyClaimResult {
    const st = this.status();
    if (st.clockBehind) return { ok: false, reason: 'clock' };
    if (st.claimedToday) return { ok: false, reason: 'already' };
    const d = this.state.daily;
    const newStreak = st.streak + 1;
    const reward = DAILY_REWARDS[(newStreak - 1) % 7];
    const ok = this.economy.grantOnce(`daily:${st.today}`, () => {
      if (reward.cash) this.economy.add('cash', reward.cash, 'dailyReward', { ref: st.today });
      if (reward.gold) this.economy.add('gold', reward.gold, 'dailyReward', { ref: st.today });
      d.lastClaimDay = st.today;
      d.streak = newStreak;
    });
    if (!ok) return { ok: false, reason: 'already' };
    return { ok: true, reward, streak: newStreak };
  }

  claimPremium(): DailyClaimResult {
    const st = this.status();
    if (!this.premium.isPremium()) return { ok: false, reason: 'premium' };
    if (st.clockBehind) return { ok: false, reason: 'clock' };
    if (this.state.daily.premiumClaimedDay === st.today) return { ok: false, reason: 'already' };
    const ok = this.economy.grantOnce(`dailyPremium:${st.today}`, () => {
      this.economy.add('cash', PREMIUM_DAILY_REWARD.cash, 'dailyReward', { ref: `premium:${st.today}` });
      this.economy.add('gold', PREMIUM_DAILY_REWARD.gold, 'dailyReward', { ref: `premium:${st.today}` });
      this.state.daily.premiumClaimedDay = st.today;
    });
    return ok ? { ok: true, reward: PREMIUM_DAILY_REWARD, streak: this.state.daily.streak } : { ok: false, reason: 'already' };
  }

  /** Grants today's reward a second time. Callers must have earned it (rewarded ad / premium quota). */
  applyDouble(): DailyClaimResult {
    const st = this.status();
    if (!st.claimedToday) return { ok: false, reason: 'notClaimed' };
    if (st.doubledToday) return { ok: false, reason: 'already' };
    const reward = DAILY_REWARDS[(this.state.daily.streak - 1) % 7];
    const ok = this.economy.grantOnce(`dailyDouble:${st.today}`, () => {
      if (reward.cash) this.economy.add('cash', reward.cash, 'dailyReward', { ref: `double:${st.today}` });
      if (reward.gold) this.economy.add('gold', reward.gold, 'dailyReward', { ref: `double:${st.today}` });
      this.state.daily.doubledDay = st.today;
    });
    return ok ? { ok: true, reward, streak: this.state.daily.streak } : { ok: false, reason: 'already' };
  }
}
