export type MissionKind = 'main' | 'daily' | 'weekly';

export type MissionMetric =
  | 'trips'
  | 'passengers'
  | 'cleanTrips'
  | 'efficientTrips'
  | 'reachCity'
  | 'busBought'
  | 'driverHired'
  | 'reputation'
  | 'revenue'
  | 'km'
  | 'fiveStar'
  | 'upgrade'
  | 'adWatched'
  | 'citiesUnlocked';

export interface MissionReward {
  cash?: number;
  gold?: number;
  xp?: number;
}

export interface MissionDef {
  id: string;
  kind: MissionKind;
  goal: number;
  metric: MissionMetric;
  /** e.g. city id for reachCity */
  param?: string;
  reward: MissionReward;
  /** main missions: previous mission that must be claimed first */
  after?: string;
  /** only offered / claimable for active Premium members */
  premiumOnly?: boolean;
}

export const MAIN_MISSIONS: MissionDef[] = [
  { id: 'm_first_trip', kind: 'main', goal: 1, metric: 'trips', reward: { cash: 3000, xp: 40 } },
  { id: 'm_clean_trip', kind: 'main', goal: 1, metric: 'cleanTrips', reward: { cash: 3000, xp: 40 }, after: 'm_first_trip' },
  { id: 'm_pax_100', kind: 'main', goal: 100, metric: 'passengers', reward: { cash: 5000, xp: 60 }, after: 'm_clean_trip' },
  { id: 'm_eco_trip', kind: 'main', goal: 1, metric: 'efficientTrips', reward: { cash: 4000, gold: 3, xp: 60 }, after: 'm_pax_100' },
  { id: 'm_trips_5', kind: 'main', goal: 5, metric: 'trips', reward: { cash: 8000, xp: 80 }, after: 'm_eco_trip' },
  { id: 'm_hire_driver', kind: 'main', goal: 1, metric: 'driverHired', reward: { cash: 5000, xp: 80 }, after: 'm_trips_5' },
  { id: 'm_buy_bus', kind: 'main', goal: 1, metric: 'busBought', reward: { cash: 10000, gold: 5, xp: 120 }, after: 'm_hire_driver' },
  { id: 'm_upgrade', kind: 'main', goal: 1, metric: 'upgrade', reward: { cash: 6000, xp: 80 }, after: 'm_buy_bus' },
  { id: 'm_revenue_50k', kind: 'main', goal: 50_000, metric: 'revenue', reward: { cash: 12000, xp: 150 }, after: 'm_upgrade' },
  { id: 'm_reach_dagbasi', kind: 'main', goal: 1, metric: 'reachCity', param: 'dagbasi', reward: { cash: 10000, xp: 150 }, after: 'm_revenue_50k' },
  { id: 'm_rep_60', kind: 'main', goal: 60, metric: 'reputation', reward: { cash: 15000, gold: 8, xp: 200 }, after: 'm_reach_dagbasi' },
  { id: 'm_reach_ortasehir', kind: 'main', goal: 1, metric: 'reachCity', param: 'ortasehir', reward: { cash: 25000, gold: 10, xp: 300 }, after: 'm_rep_60' },
];

export const DAILY_POOL: MissionDef[] = [
  { id: 'd_trips_2', kind: 'daily', goal: 2, metric: 'trips', reward: { cash: 2500, xp: 30 } },
  { id: 'd_pax_80', kind: 'daily', goal: 80, metric: 'passengers', reward: { cash: 3000, xp: 30 } },
  { id: 'd_clean_1', kind: 'daily', goal: 1, metric: 'cleanTrips', reward: { cash: 2500, gold: 1, xp: 30 } },
  { id: 'd_revenue_8k', kind: 'daily', goal: 8000, metric: 'revenue', reward: { cash: 3500, xp: 40 } },
  { id: 'd_km_60', kind: 'daily', goal: 60, metric: 'km', reward: { cash: 2500, xp: 30 } },
  { id: 'd_ad_1', kind: 'daily', goal: 1, metric: 'adWatched', reward: { cash: 1500, xp: 10 } },
];

export const WEEKLY_POOL: MissionDef[] = [
  { id: 'w_trips_15', kind: 'weekly', goal: 15, metric: 'trips', reward: { cash: 15000, gold: 5, xp: 150 } },
  { id: 'w_pax_600', kind: 'weekly', goal: 600, metric: 'passengers', reward: { cash: 18000, xp: 150 } },
  { id: 'w_revenue_60k', kind: 'weekly', goal: 60_000, metric: 'revenue', reward: { cash: 20000, gold: 8, xp: 180 } },
  { id: 'w_clean_5', kind: 'weekly', goal: 5, metric: 'cleanTrips', reward: { cash: 16000, xp: 150 } },
  { id: 'w_five_star_3', kind: 'weekly', goal: 3, metric: 'fiveStar', reward: { cash: 17000, gold: 5, xp: 160 } },
];

/** Premium members get these extra daily missions. */
export const PREMIUM_DAILY: MissionDef[] = [
  { id: 'p_trips_3', kind: 'daily', goal: 3, metric: 'trips', reward: { cash: 6000, gold: 6, xp: 60 }, premiumOnly: true },
  { id: 'p_pax_150', kind: 'daily', goal: 150, metric: 'passengers', reward: { cash: 6000, gold: 6, xp: 60 }, premiumOnly: true },
];

export const ALL_MISSIONS: MissionDef[] = [...MAIN_MISSIONS, ...DAILY_POOL, ...WEEKLY_POOL, ...PREMIUM_DAILY];
export const MISSION_BY_ID: Record<string, MissionDef> = Object.fromEntries(ALL_MISSIONS.map((m) => [m.id, m]));

export type AchievementStat =
  | 'trips'
  | 'passengers'
  | 'km'
  | 'upgrades'
  | 'drivers'
  | 'cities'
  | 'reputation'
  | 'cleanStreak'
  | 'revenue'
  | 'buses';

export interface AchievementDef {
  id: string;
  stat: AchievementStat;
  goal: number;
  reward: MissionReward;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'a_first_trip', stat: 'trips', goal: 1, reward: { cash: 2000 } },
  { id: 'a_trips_25', stat: 'trips', goal: 25, reward: { cash: 10000, gold: 3 } },
  { id: 'a_trips_100', stat: 'trips', goal: 100, reward: { cash: 40000, gold: 10 } },
  { id: 'a_pax_100', stat: 'passengers', goal: 100, reward: { cash: 4000 } },
  { id: 'a_pax_1000', stat: 'passengers', goal: 1000, reward: { cash: 25000, gold: 5 } },
  { id: 'a_km_1000', stat: 'km', goal: 1000, reward: { cash: 8000, gold: 2 } },
  { id: 'a_first_upgrade', stat: 'upgrades', goal: 1, reward: { cash: 3000 } },
  { id: 'a_first_driver', stat: 'drivers', goal: 1, reward: { cash: 4000 } },
  { id: 'a_five_cities', stat: 'cities', goal: 5, reward: { cash: 30000, gold: 10 } },
  { id: 'a_rep_80', stat: 'reputation', goal: 80, reward: { cash: 20000, gold: 8 } },
  { id: 'a_clean_streak_5', stat: 'cleanStreak', goal: 5, reward: { cash: 12000, gold: 4 } },
  { id: 'a_fleet_3', stat: 'buses', goal: 3, reward: { cash: 15000, gold: 4 } },
  { id: 'a_revenue_500k', stat: 'revenue', goal: 500_000, reward: { cash: 50000, gold: 15 } },
];

export const ACHIEVEMENT_BY_ID: Record<string, AchievementDef> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
