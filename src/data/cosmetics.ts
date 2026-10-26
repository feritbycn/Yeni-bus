/** Garage customization catalogue. Ownership is stored in state.unlockedCosmetics. */

export type CosmeticKind = 'paint' | 'livery' | 'rims' | 'interior';

export interface CosmeticDef {
  id: string;
  kind: CosmeticKind;
  /** hex colour for paint / interior / rims; accent for liveries */
  color: string;
  cost: { cash?: number; gold?: number };
  /** Needs an active Premium membership to be applied. */
  premiumOnly?: boolean;
  /** Obtained through a real-money cosmetic pack (see data/shop.ts). */
  pack?: string;
}

export const DEFAULT_COSMETICS: Record<CosmeticKind, string> = {
  paint: 'paint_white',
  livery: 'livery_plain',
  rims: 'rims_steel',
  interior: 'interior_gray',
};

export const COSMETICS: CosmeticDef[] = [
  { id: 'paint_white', kind: 'paint', color: '#f1f3f6', cost: {} },
  { id: 'paint_silver', kind: 'paint', color: '#b8bec8', cost: { cash: 800 } },
  { id: 'paint_graphite', kind: 'paint', color: '#3a3f48', cost: { cash: 900 } },
  { id: 'paint_red', kind: 'paint', color: '#c7283a', cost: { cash: 900 } },
  { id: 'paint_blue', kind: 'paint', color: '#1f5fbf', cost: { cash: 900 } },
  { id: 'paint_green', kind: 'paint', color: '#238a52', cost: { cash: 900 } },
  { id: 'paint_orange', kind: 'paint', color: '#e8801e', cost: { cash: 1200 } },
  { id: 'paint_teal', kind: 'paint', color: '#16919b', cost: { cash: 1200 } },
  { id: 'paint_gold', kind: 'paint', color: '#d6a42b', cost: { gold: 30 } },
  { id: 'paint_midnight', kind: 'paint', color: '#10163a', cost: {}, premiumOnly: true },
  { id: 'paint_aurora', kind: 'paint', color: '#37d6a5', cost: {}, premiumOnly: true },
  { id: 'paint_royal', kind: 'paint', color: '#6a2c9e', cost: {}, premiumOnly: true },

  { id: 'livery_plain', kind: 'livery', color: '#ffffff', cost: {} },
  { id: 'livery_stripe', kind: 'livery', color: '#1f5fbf', cost: { cash: 1500 } },
  { id: 'livery_chevron', kind: 'livery', color: '#e8801e', cost: { cash: 2200 } },
  { id: 'livery_wave', kind: 'livery', color: '#16919b', cost: { cash: 2600 } },
  { id: 'livery_checker', kind: 'livery', color: '#222222', cost: { gold: 15 } },
  { id: 'livery_carbon', kind: 'livery', color: '#15181d', cost: {}, premiumOnly: true },
  { id: 'livery_aurora', kind: 'livery', color: '#37d6a5', cost: {}, premiumOnly: true },
  { id: 'livery_sunset', kind: 'livery', color: '#ff6a3d', cost: {}, pack: 'cosmetic_pack_1' },

  { id: 'rims_steel', kind: 'rims', color: '#9aa1ab', cost: {} },
  { id: 'rims_chrome', kind: 'rims', color: '#dfe5ee', cost: { cash: 1200 } },
  { id: 'rims_black', kind: 'rims', color: '#1a1c20', cost: { cash: 1200 } },
  { id: 'rims_gold', kind: 'rims', color: '#d6a42b', cost: {}, premiumOnly: true },

  { id: 'interior_gray', kind: 'interior', color: '#6b7380', cost: {} },
  { id: 'interior_blue', kind: 'interior', color: '#2a4f8f', cost: { cash: 700 } },
  { id: 'interior_beige', kind: 'interior', color: '#b79e78', cost: { cash: 700 } },
  { id: 'interior_burgundy', kind: 'interior', color: '#7a2535', cost: { cash: 900 } },
  { id: 'interior_emerald', kind: 'interior', color: '#1f6b4f', cost: {}, premiumOnly: true },
];

export const COSMETIC_BY_ID: Record<string, CosmeticDef> = Object.fromEntries(COSMETICS.map((c) => [c.id, c]));

export const STARTER_COSMETICS = Object.values(DEFAULT_COSMETICS);

/** Cosmetic used for the "rewarded video" 24h trial. */
export const TRIAL_COSMETIC_ID = 'livery_aurora';
