/** Tunable game-design constants. Prices of real-money products are NOT here (they come from the store). */

/** The 3D road is a compressed version of the logical route: 1 driven km = ROUTE_SCALE logical km. */
export const ROUTE_SCALE = 20;
export const START_CASH = 30_000;
export const START_GOLD = 20;
export const FUEL_PRICE_PER_L = 8;
export const ENERGY_PRICE_PER_KWH = 2.2;
export const TICKET_PRICE_PER_KM = 0.9;
export const TERMINAL_FEE_RATE = 0.1;
export const TOLL_PER_KM = 0.45;
export const REPAIR_COST_FACTOR = 0.0015;
export const TOW_COST = 2500;
export const MAX_LEDGER = 300;
export const MAX_PROCESSED_IDS = 800;
export const MAX_TRIPS = 100;
export const OFFLINE_CAP_HOURS = 8;
export const OFFLINE_CAP_TRIPS = 12;
export const PREMIUM_DISCOUNT = 0.2;
export const PREMIUM_FREE_CLAIMS_PER_DAY = 8;
export const AD_COOLDOWN_MS = 30_000;
export const MAX_UPGRADE_LEVEL = 3;
export const UPGRADE_COST_FRACTIONS = [0.05, 0.09, 0.14];
export const OFFICE_COSTS = [20_000, 60_000, 150_000, 400_000, 900_000];
export const MAX_OFFICE_LEVEL = OFFICE_COSTS.length;
export const BASE_GARAGE_SLOTS = 2;
export const GARAGE_EXPANSION_SLOTS = 3;
export const BASE_DRIVER_SLOTS = 1;
export const DRIVER_BASE_SALARY = 600;
export const SAVE_KEY = 'roadmaster.save';
export const SAVE_BACKUP_KEY = 'roadmaster.save.backup';
export const SAVE_CORRUPT_KEY = 'roadmaster.save.corrupt';
export const CURRENT_SCHEMA_VERSION = 1;
export const GAME_NAME = 'RoadMaster: Bus Empire';
export const PLATE_REGEX = /^[A-Z0-9 ]{2,10}$/;
export const COMPANY_NAME_MAX = 24;

export function xpForLevel(level: number): number {
  return Math.round(120 * Math.pow(level, 1.55));
}
