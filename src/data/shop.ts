/**
 * Store product catalogue. IMPORTANT: no prices live here. The visible price string must come
 * from the platform store (Google Play Billing on Android) via PurchaseAdapter.getProducts().
 */

export type ProductKind = 'consumable' | 'permanent' | 'subscription';

export interface ProductDef {
  id: string;
  kind: ProductKind;
  /** consumable grants */
  grant?: { cash?: number; gold?: number; fuelFill?: boolean };
  /** permanent grants */
  unlock?: { removeAds?: boolean; garageExpansion?: boolean; busId?: string; cosmeticPack?: string };
  /** subscription length in days (store is the source of truth for the real expiry) */
  periodDays?: number;
}

export const PRODUCTS: ProductDef[] = [
  { id: 'cash_small', kind: 'consumable', grant: { cash: 25_000 } },
  { id: 'cash_medium', kind: 'consumable', grant: { cash: 120_000 } },
  { id: 'cash_large', kind: 'consumable', grant: { cash: 600_000 } },
  { id: 'gold_pack', kind: 'consumable', grant: { gold: 200 } },
  { id: 'fuel_pack', kind: 'consumable', grant: { fuelFill: true } },
  { id: 'event_pack', kind: 'consumable', grant: { cash: 60_000, gold: 80 } },

  { id: 'remove_ads', kind: 'permanent', unlock: { removeAds: true } },
  { id: 'cosmetic_pack_1', kind: 'permanent', unlock: { cosmeticPack: 'cosmetic_pack_1' } },
  { id: 'garage_expansion', kind: 'permanent', unlock: { garageExpansion: true } },
  { id: 'unlock_luxury', kind: 'permanent', unlock: { busId: 'luxury' } },

  { id: 'premium_monthly', kind: 'subscription', periodDays: 30 },
  { id: 'premium_yearly', kind: 'subscription', periodDays: 365 },
];

export const PRODUCT_BY_ID: Record<string, ProductDef> = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

/** The 7-day daily reward calendar. */
export interface DailyRewardDef {
  cash: number;
  gold: number;
  /** day 7 gives a bigger reward */
  special?: boolean;
}

export const DAILY_REWARDS: DailyRewardDef[] = [
  { cash: 2_000, gold: 0 },
  { cash: 3_000, gold: 2 },
  { cash: 4_000, gold: 0 },
  { cash: 5_000, gold: 5 },
  { cash: 6_500, gold: 0 },
  { cash: 8_000, gold: 8 },
  { cash: 15_000, gold: 25, special: true },
];

/** Extra reward for active Premium members (claimable once per day, separate from the normal one). */
export const PREMIUM_DAILY_REWARD = { cash: 5_000, gold: 10 };

/** Rewarded video catalogue (10 types). Amounts are balanced in AdRewardManager. */
export interface AdRewardDef {
  id: string;
  dailyLimit: number;
}

export const AD_REWARDS: AdRewardDef[] = [
  { id: 'cash', dailyLimit: 5 },
  { id: 'gold', dailyLimit: 3 },
  { id: 'tripRevenue', dailyLimit: 3 },
  { id: 'fuelDiscount', dailyLimit: 3 },
  { id: 'maintenanceDiscount', dailyLimit: 3 },
  { id: 'demandBoost', dailyLimit: 3 },
  { id: 'doubleDaily', dailyLimit: 1 },
  { id: 'cosmeticTrial', dailyLimit: 1 },
  { id: 'upgradeDiscount', dailyLimit: 2 },
  { id: 'missionBonus', dailyLimit: 2 },
];
