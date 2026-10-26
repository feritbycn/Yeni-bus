import type { GameEvents, GameState } from '../core/types';
import type { EventBus } from '../core/EventBus';
import type { EconomyManager } from './EconomyManager';
import type { CompanyManager } from './CompanyManager';
import type { ClockService } from './ClockService';
import type { PremiumService } from '../services/PremiumService';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BY_ID,
  DAILY_POOL,
  MAIN_MISSIONS,
  MISSION_BY_ID,
  PREMIUM_DAILY,
  WEEKLY_POOL,
  type AchievementDef,
  type AchievementStat,
  type MissionDef,
  type MissionMetric,
  type MissionReward,
} from '../data/missions';
import { dayKey, hashString, mulberry32, shuffled, weekKey } from '../core/utils';

export interface MissionView {
  def: MissionDef;
  key: string;
  period: string;
  progress: number;
  claimed: boolean;
  complete: boolean;
  locked: boolean;
  premiumLocked: boolean;
  claimable: boolean;
}

export interface AchievementView {
  def: AchievementDef;
  progress: number;
  unlocked: boolean;
  claimed: boolean;
}

export type ClaimResult = { ok: true; reward: MissionReward } | { ok: false; reason: 'unknown' | 'incomplete' | 'claimed' | 'locked' | 'premium' };

export class MissionManager {
  constructor(
    private readonly state: GameState,
    private readonly bus: EventBus<GameEvents>,
    private readonly economy: EconomyManager,
    private readonly company: CompanyManager,
    private readonly clock: ClockService,
    private readonly premium: PremiumService,
  ) {
    bus.on('tripCompleted', (e) => {
      this.ensurePeriods();
      this.add('trips', 1);
      this.add('passengers', e.passengers);
      if (e.clean) this.add('cleanTrips', 1);
      if (e.fuelPer100 > 0 && e.fuelPer100 <= e.modelConsumption * 1.1) this.add('efficientTrips', 1);
      this.add('reachCity', 1, e.toId);
      this.add('revenue', Math.max(0, e.revenue));
      this.add('km', e.distanceKm);
      if (e.rating >= 4.5) this.add('fiveStar', 1);
      this.syncSetMetrics();
      this.evaluateAchievements();
    });
    bus.on('busPurchased', () => {
      this.add('busBought', 1);
      this.evaluateAchievements();
    });
    bus.on('driverHired', () => {
      this.add('driverHired', 1);
      this.evaluateAchievements();
    });
    bus.on('busUpgraded', () => {
      this.add('upgrade', 1);
      this.evaluateAchievements();
    });
    bus.on('cityUnlocked', () => {
      this.syncSetMetrics();
      this.evaluateAchievements();
    });
    bus.on('reputationChanged', () => {
      this.syncSetMetrics();
      this.evaluateAchievements();
    });
    bus.on('adRewardGranted', () => {
      this.ensurePeriods();
      this.add('adWatched', 1);
    });
  }

  // ---------- periods ----------

  periodOf(def: MissionDef): string {
    const m = this.state.missions;
    return def.kind === 'main' ? 'main' : def.kind === 'daily' ? m.dailyKey : m.weeklyKey;
  }

  ensurePeriods(): void {
    const now = this.clock.now();
    const m = this.state.missions;
    const today = dayKey(now);
    const week = weekKey(now);
    let changed = false;
    if (m.dailyKey !== today || m.dailyIds.length === 0) {
      m.dailyKey = today;
      m.dailyIds = shuffled(mulberry32(hashString(`daily:${today}`)), DAILY_POOL).slice(0, 3).map((x) => x.id);
      this.purge('daily');
      changed = true;
    }
    if (m.weeklyKey !== week || m.weeklyIds.length === 0) {
      m.weeklyKey = week;
      m.weeklyIds = shuffled(mulberry32(hashString(`weekly:${week}`)), WEEKLY_POOL).slice(0, 2).map((x) => x.id);
      this.purge('weekly');
      changed = true;
    }
    if (changed) this.bus.emit('stateChanged', undefined);
  }

  /** Drops progress/claims of expired daily/weekly periods. */
  private purge(kind: 'daily' | 'weekly'): void {
    const m = this.state.missions;
    const current = kind === 'daily' ? m.dailyKey : m.weeklyKey;
    const keep = (k: string) => {
      const [id, period] = k.split(':');
      const def = MISSION_BY_ID[id];
      if (!def || def.kind !== kind) return true;
      return period === current;
    };
    for (const k of Object.keys(m.progress)) if (!keep(k)) delete m.progress[k];
    for (const k of Object.keys(m.claimed)) if (!keep(k)) delete m.claimed[k];
  }

  private activeDefs(): MissionDef[] {
    const m = this.state.missions;
    const defs: MissionDef[] = [...MAIN_MISSIONS];
    for (const id of m.dailyIds) if (MISSION_BY_ID[id]) defs.push(MISSION_BY_ID[id]);
    if (this.premium.isPremium()) defs.push(...PREMIUM_DAILY);
    for (const id of m.weeklyIds) if (MISSION_BY_ID[id]) defs.push(MISSION_BY_ID[id]);
    return defs;
  }

  // ---------- progress ----------

  private keyOf(def: MissionDef): string {
    return `${def.id}:${this.periodOf(def)}`;
  }

  private add(metric: MissionMetric, value: number, param?: string): void {
    if (!(value > 0)) return;
    for (const def of this.activeDefs()) {
      if (def.metric !== metric) continue;
      if (metric === 'reachCity' && def.param !== param) continue;
      const k = this.keyOf(def);
      if (this.state.missions.claimed[k]) continue;
      this.state.missions.progress[k] = Math.min(def.goal, (this.state.missions.progress[k] ?? 0) + value);
    }
    this.bus.emit('stateChanged', undefined);
  }

  private setAtLeast(metric: MissionMetric, value: number): void {
    for (const def of this.activeDefs()) {
      if (def.metric !== metric) continue;
      const k = this.keyOf(def);
      if (this.state.missions.claimed[k]) continue;
      this.state.missions.progress[k] = Math.min(def.goal, Math.max(this.state.missions.progress[k] ?? 0, value));
    }
  }

  /** Metrics that mirror current state rather than accumulate events. */
  syncSetMetrics(): void {
    this.setAtLeast('reputation', this.state.company.reputation);
    this.setAtLeast('citiesUnlocked', this.state.company.unlockedCities.length);
  }

  // ---------- views ----------

  list(): MissionView[] {
    this.ensurePeriods();
    const prem = this.premium.isPremium();
    return this.activeDefs().map((def) => {
      const key = this.keyOf(def);
      const progress = this.state.missions.progress[key] ?? 0;
      const claimed = !!this.state.missions.claimed[key];
      const complete = progress >= def.goal;
      const locked = !!def.after && !this.state.missions.claimed[`${def.after}:main`];
      const premiumLocked = !!def.premiumOnly && !prem;
      return {
        def,
        key,
        period: this.periodOf(def),
        progress,
        claimed,
        complete,
        locked,
        premiumLocked,
        claimable: complete && !claimed && !locked && !premiumLocked,
      };
    });
  }

  claim(id: string): ClaimResult {
    this.ensurePeriods();
    const def = MISSION_BY_ID[id];
    if (!def) return { ok: false, reason: 'unknown' };
    const view = this.list().find((v) => v.def.id === id);
    if (!view) return { ok: false, reason: 'unknown' };
    if (view.claimed) return { ok: false, reason: 'claimed' };
    if (view.premiumLocked) return { ok: false, reason: 'premium' };
    if (view.locked) return { ok: false, reason: 'locked' };
    if (!view.complete) return { ok: false, reason: 'incomplete' };
    const bonus = this.state.boosts.missionBonus > 0 ? 1.5 : 1;
    const reward: MissionReward = {
      cash: def.reward.cash ? Math.round(def.reward.cash * bonus) : undefined,
      gold: def.reward.gold ? Math.round(def.reward.gold * bonus) : undefined,
      xp: def.reward.xp,
    };
    // idempotent: the claimed flag AND processed id both guard the payout
    const done = this.economy.grantOnce(`mission:${view.key}`, () => {
      if (reward.cash) this.economy.add('cash', reward.cash, 'missionReward', { ref: id, description: `mission ${id}` });
      if (reward.gold) this.economy.add('gold', reward.gold, 'missionReward', { ref: id, description: `mission ${id}` });
      if (reward.xp) this.company.addXp(reward.xp);
      this.state.missions.claimed[view.key] = true;
      if (this.state.boosts.missionBonus > 0) this.state.boosts.missionBonus -= 1;
    });
    if (!done) return { ok: false, reason: 'claimed' };
    return { ok: true, reward };
  }

  // ---------- achievements ----------

  statValue(stat: AchievementStat): number {
    const s = this.state.stats;
    switch (stat) {
      case 'trips':
        return s.tripsCompleted;
      case 'passengers':
        return s.totalPassengers;
      case 'km':
        return s.totalKm;
      case 'upgrades':
        return s.upgradesDone;
      case 'drivers':
        return s.driversHired;
      case 'cities':
        return this.state.company.unlockedCities.length;
      case 'reputation':
        return this.state.company.reputation;
      case 'cleanStreak':
        return s.bestCleanStreak;
      case 'revenue':
        return s.totalRevenue;
      case 'buses':
        return this.state.buses.length;
    }
  }

  evaluateAchievements(): string[] {
    const newly: string[] = [];
    for (const def of ACHIEVEMENTS) {
      if (this.state.achievements.unlocked[def.id]) continue;
      if (this.statValue(def.stat) >= def.goal) {
        this.state.achievements.unlocked[def.id] = this.clock.now();
        newly.push(def.id);
        this.bus.emit('toast', { kind: 'success', text: `toast.achievement:${def.id}` });
      }
    }
    if (newly.length) this.bus.emit('stateChanged', undefined);
    return newly;
  }

  achievementList(): AchievementView[] {
    return ACHIEVEMENTS.map((def) => ({
      def,
      progress: Math.min(def.goal, this.statValue(def.stat)),
      unlocked: !!this.state.achievements.unlocked[def.id],
      claimed: !!this.state.achievements.claimed[def.id],
    }));
  }

  claimAchievement(id: string): boolean {
    const def = ACHIEVEMENT_BY_ID[id];
    if (!def || !this.state.achievements.unlocked[id] || this.state.achievements.claimed[id]) return false;
    return this.economy.grantOnce(`achievement:${id}`, () => {
      if (def.reward.cash) this.economy.add('cash', def.reward.cash, 'achievementReward', { ref: id });
      if (def.reward.gold) this.economy.add('gold', def.reward.gold, 'achievementReward', { ref: id });
      this.state.achievements.claimed[id] = true;
    });
  }
}
