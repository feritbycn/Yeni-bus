/** Shared game data types. Everything persisted lives in GameState. */

export type Currency = 'cash' | 'gold';
export type Gear = 'P' | 'R' | 'N' | 'D';
export type Weather = 'clear' | 'cloudy' | 'rain' | 'fog';
export type QualityLevel = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
export type Language = 'tr' | 'en';
export type PowerTrain = 'diesel' | 'electric';

export type TransactionType =
  | 'tripRevenue'
  | 'fuel'
  | 'maintenance'
  | 'repair'
  | 'salary'
  | 'toll'
  | 'fine'
  | 'terminalFee'
  | 'towing'
  | 'busPurchase'
  | 'busSale'
  | 'upgrade'
  | 'cosmetic'
  | 'office'
  | 'cityUnlock'
  | 'hiring'
  | 'missionReward'
  | 'achievementReward'
  | 'dailyReward'
  | 'adReward'
  | 'purchase'
  | 'testPurchase'
  | 'refund'
  | 'devGrant';

export interface Transaction {
  id: string;
  type: TransactionType;
  currency: Currency;
  /** Signed: positive = income, negative = spending. */
  amount: number;
  before: number;
  after: number;
  time: number;
  ref?: string;
  description: string;
}

export interface BusUpgrades {
  engine: number;
  comfort: number;
  handling: number;
}

export interface OwnedBus {
  uid: string;
  modelId: string;
  paint: string;
  livery: string;
  rims: string;
  interior: string;
  plate: string;
  upgrades: BusUpgrades;
  upgradeSpent: number;
  /** 0 (new) .. 100 (wrecked) */
  damage: number;
  /** liters (diesel) or kWh (electric) */
  fuel: number;
  odometerKm: number;
  purchasePrice: number;
  assignedDriverId: string | null;
}

export interface Driver {
  id: string;
  name: string;
  /** 1..10 */
  experience: number;
  skill: number;
  fuelEfficiency: number;
  customerSatisfaction: number;
  /** Salary per in-game day (24 real hours). Player adjustable. */
  salaryPerDay: number;
  assignedBusUid: string | null;
  assignedConnectionId: string | null;
  assignedVariant: RouteVariant;
  hiredAt: number;
  lastTickAt: number;
  tripsDone: number;
  revenueGenerated: number;
  profitGenerated: number;
  status: 'idle' | 'working' | 'brokenDown' | 'noFunds';
  lastReport: string;
}

export interface DriverCandidate {
  id: string;
  name: string;
  experience: number;
  skill: number;
  fuelEfficiency: number;
  customerSatisfaction: number;
  fairSalary: number;
  hiringFee: number;
}

export type RouteVariant = 'highway' | 'old';

export interface TripRecord {
  id: string;
  time: number;
  connectionId: string;
  variant: RouteVariant;
  fromId: string;
  toId: string;
  busModelId: string;
  seats: number;
  passengers: number;
  revenue: number;
  expenses: number;
  profit: number;
  rating: number;
  distanceKm: number;
  fuelUsed: number;
  damageDelta: number;
  byDriverId: string | null;
  durationMin: number;
}

export interface Stats {
  totalKm: number;
  totalPassengers: number;
  tripsCompleted: number;
  cleanStreak: number;
  bestCleanStreak: number;
  totalRevenue: number;
  totalExpenses: number;
  upgradesDone: number;
  driversHired: number;
  busesPurchased: number;
  adsWatched: number;
  purchasesCount: number;
  maxReputation: number;
  fiveStarTrips: number;
}

export interface DailyReport {
  revenue: number;
  expenses: number;
}

export interface CompanyState {
  name: string;
  logo: string;
  color: string;
  level: number;
  xp: number;
  reputation: number;
  officeLevel: number;
  unlockedCities: string[];
  reports: Record<string, DailyReport>;
}

export interface MissionProgress {
  /** key = `${missionId}:${periodKey}` */
  progress: Record<string, number>;
  claimed: Record<string, boolean>;
  dailyKey: string;
  weeklyKey: string;
  dailyIds: string[];
  weeklyIds: string[];
}

export interface AchievementState {
  unlocked: Record<string, number>;
  claimed: Record<string, boolean>;
}

export interface DailyRewardState {
  lastClaimDay: string | null;
  streak: number;
  premiumClaimedDay: string | null;
  doubledDay: string | null;
}

export interface BoostState {
  revenue: number;
  demand: number;
  fuelDiscount: number;
  maintenanceDiscount: number;
  upgradeDiscount: number;
  missionBonus: number;
}

export interface TempCosmetic {
  cosmeticId: string;
  expiresAt: number;
}

export interface AdState {
  /** Per-type day counters. */
  dayKey: string;
  countByType: Record<string, number>;
  premiumFreeClaims: number;
  lastAdAt: number;
  totalWatched: number;
}

export interface Entitlements {
  removeAds: boolean;
  garageExpansion: boolean;
  unlockedBusIds: string[];
  /** cosmetics bought with real money */
  cosmeticPacks: string[];
}

export interface SubscriptionState {
  productId: string | null;
  status: 'none' | 'active' | 'cancelled' | 'expired' | 'refunded';
  expiresAt: number;
  /** 'store' = verified by an actual billing adapter, 'test' = simulated. */
  source: 'store' | 'test' | 'none';
  transactionId: string | null;
}

export interface PurchaseRecord {
  transactionId: string;
  productId: string;
  time: number;
  source: 'store' | 'test';
  status: 'completed' | 'refunded';
  granted: { cash?: number; gold?: number; fuelUnits?: number };
}

export interface PendingPurchase {
  productId: string;
  startedAt: number;
  transactionId?: string;
}

export interface PurchaseState {
  entitlements: Entitlements;
  subscription: SubscriptionState;
  history: PurchaseRecord[];
  pending: PendingPurchase[];
  /** Transaction ids that were already applied (idempotency). */
  processed: string[];
}

export interface ClockState {
  /** Highest timestamp ever seen; time can never move backwards past this. */
  highWater: number;
  lastLaunch: number;
  suspiciousJumps: number;
}

export interface Settings {
  quality: QualityLevel;
  shadows: 'off' | 'low' | 'medium' | 'high';
  viewDistance: number;
  fpsCap: 0 | 30 | 45 | 60;
  volumes: { master: number; vehicle: number; ambient: number; ui: number };
  muted: boolean;
  controlType: 'auto' | 'keyboard' | 'touchButtons' | 'touchWheel';
  sensitivity: number;
  cameraDistance: number;
  language: Language;
  vibration: boolean;
  autoSave: boolean;
  uiScale: number;
  autoDoors: boolean;
  trafficDensity: 'auto' | 'off' | 'low' | 'medium' | 'high';
  passengerDetail: 'auto' | 'low' | 'medium' | 'high';
  /** Enables clearly-labelled TEST purchases and debug helpers. */
  testMode: boolean;
  /** Simulate ad load failure in the test ad adapter. */
  testAdFailure: boolean;
}

export interface GameState {
  schemaVersion: number;
  createdAt: number;
  cash: number;
  gold: number;
  ledger: Transaction[];
  processedIds: string[];
  company: CompanyState;
  buses: OwnedBus[];
  selectedBusUid: string | null;
  unlockedCosmetics: string[];
  drivers: Driver[];
  missions: MissionProgress;
  achievements: AchievementState;
  daily: DailyRewardState;
  boosts: BoostState;
  tempCosmetic: TempCosmetic | null;
  ads: AdState;
  purchases: PurchaseState;
  trips: TripRecord[];
  stats: Stats;
  settings: Settings;
  clock: ClockState;
  tutorialDone: boolean;
}

export interface TripCompletedEvent {
  connectionId: string;
  variant: RouteVariant;
  fromId: string;
  toId: string;
  passengers: number;
  seats: number;
  rating: number;
  damageDelta: number;
  fuelUsed: number;
  fuelPer100: number;
  modelConsumption: number;
  revenue: number;
  profit: number;
  distanceKm: number;
  byDriver: boolean;
  clean: boolean;
}

export interface GameEvents {
  stateChanged: void;
  tripCompleted: TripCompletedEvent;
  busPurchased: { modelId: string; uid: string };
  busSold: { modelId: string; uid: string };
  busUpgraded: { uid: string; kind: string; level: number };
  driverHired: { driverId: string };
  cityUnlocked: { cityId: string };
  reputationChanged: { value: number };
  levelUp: { level: number };
  moneyEarned: { amount: number };
  adRewardGranted: { type: string };
  purchaseCompleted: { productId: string };
  toast: { kind: 'info' | 'success' | 'warn' | 'error'; text: string };
}
