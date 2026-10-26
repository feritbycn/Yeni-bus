import type { GameEvents, GameState } from './types';
import { EventBus } from './EventBus';
import { ClockService } from '../systems/ClockService';
import { EconomyManager } from '../systems/EconomyManager';
import { GarageManager } from '../systems/GarageManager';
import { RouteManager } from '../systems/RouteManager';
import { CompanyManager, type OfflineReport } from '../systems/CompanyManager';
import { TripManager } from '../systems/TripManager';
import { MissionManager } from '../systems/MissionManager';
import { DailyRewardManager } from '../systems/DailyRewardManager';
import { SaveManager, type KeyValueStorage, type LoadResult } from '../systems/SaveManager';
import { SettingsManager } from '../systems/SettingsManager';
import { PremiumService } from '../services/PremiumService';
import { RewardedAdService, type RewardedAdAdapter } from '../services/RewardedAdService';
import { PurchaseService, type PurchaseAdapter } from '../services/PurchaseService';
import { WebStoreAdapter, TestPurchaseAdapter } from '../services/adapters/PurchaseAdapters';
import { createInitialState } from './state';

export interface GameContext {
  state: GameState;
  bus: EventBus<GameEvents>;
  clock: ClockService;
  economy: EconomyManager;
  settings: SettingsManager;
  garage: GarageManager;
  routes: RouteManager;
  company: CompanyManager;
  trips: TripManager;
  missions: MissionManager;
  daily: DailyRewardManager;
  premium: PremiumService;
  purchases: PurchaseService;
  ads: RewardedAdService;
  save: SaveManager;
}

export interface ContextOptions {
  storage: KeyValueStorage;
  now?: () => number;
  adAdapter: RewardedAdAdapter;
  purchaseAdapter?: PurchaseAdapter;
  testPurchaseAdapter?: PurchaseAdapter | null;
  /** skip loading (tests): use this state directly */
  initialState?: GameState;
}

export interface ContextBootInfo {
  load: LoadResult;
  offline: OfflineReport | null;
}

/** Wires every manager together around a single GameState. */
export function createGameContext(opts: ContextOptions): { ctx: GameContext; boot: ContextBootInfo } {
  const now = opts.now ?? (() => Date.now());
  const save = new SaveManager(opts.storage, now);
  const load: LoadResult = opts.initialState
    ? { state: opts.initialState, source: 'new', corrupted: false, recoveredFromBackup: false }
    : save.load();
  const state = load.state ?? createInitialState(now());

  const bus = new EventBus<GameEvents>();
  const clock = new ClockService(state.clock, now);
  const economy = new EconomyManager(state, bus, clock);
  const settings = new SettingsManager(state, bus);
  const premium = new PremiumService(state, bus, clock);
  const garage = new GarageManager(state, bus, economy, premium);
  const routes = new RouteManager(state, bus, economy);
  const company = new CompanyManager(state, bus, economy, garage, routes, clock);
  const trips = new TripManager(state, bus, economy, garage, routes, company, clock);
  const missions = new MissionManager(state, bus, economy, company, clock, premium);
  const daily = new DailyRewardManager(state, bus, economy, clock, premium);
  const ads = new RewardedAdService(state, bus, economy, company, clock, premium, daily, opts.adAdapter);
  const purchases = new PurchaseService(
    state,
    bus,
    economy,
    garage,
    premium,
    clock,
    opts.purchaseAdapter ?? new WebStoreAdapter(),
    opts.testPurchaseAdapter === undefined ? new TestPurchaseAdapter(now) : opts.testPurchaseAdapter,
  );

  bus.on('stateChanged', () => save.markDirty());

  const ctx: GameContext = { state, bus, clock, economy, settings, garage, routes, company, trips, missions, daily, premium, purchases, ads, save };

  // launch housekeeping
  clock.registerLaunch();
  premium.refresh();
  missions.ensurePeriods();
  missions.syncSetMetrics();
  missions.evaluateAchievements();
  const offline = state.drivers.length > 0 ? company.tickDrivers() : null;

  return { ctx, boot: { load, offline } };
}
