import type { GameState, OwnedBus, Settings } from './types';
import { CURRENT_SCHEMA_VERSION, START_CASH, START_GOLD } from '../data/constants';
import { BUS_BY_ID, STARTER_BUS_ID } from '../data/buses';
import { DEFAULT_COSMETICS, STARTER_COSMETICS } from '../data/cosmetics';
import { dayKey, uid, weekKey } from './utils';

export function defaultSettings(): Settings {
  return {
    quality: 'auto',
    shadows: 'medium',
    viewDistance: 700,
    fpsCap: 0,
    volumes: { master: 0.8, vehicle: 0.8, ambient: 0.7, ui: 0.7 },
    muted: false,
    controlType: 'auto',
    sensitivity: 1,
    cameraDistance: 1,
    language: 'tr',
    vibration: true,
    autoSave: true,
    uiScale: 1,
    autoDoors: true,
    trafficDensity: 'auto',
    passengerDetail: 'auto',
    testMode: false,
    testAdFailure: false,
  };
}

export function createOwnedBus(modelId: string, purchasePrice: number): OwnedBus {
  const model = BUS_BY_ID[modelId];
  if (!model) throw new Error(`Unknown bus model: ${modelId}`);
  return {
    uid: uid('bus'),
    modelId,
    paint: DEFAULT_COSMETICS.paint,
    livery: DEFAULT_COSMETICS.livery,
    rims: DEFAULT_COSMETICS.rims,
    interior: DEFAULT_COSMETICS.interior,
    plate: `34 RM ${100 + Math.floor(Math.random() * 899)}`,
    upgrades: { engine: 0, comfort: 0, handling: 0 },
    upgradeSpent: 0,
    damage: 0,
    fuel: model.tankCapacity,
    odometerKm: 0,
    purchasePrice,
    assignedDriverId: null,
  };
}

export function createInitialState(now: number): GameState {
  const starter = createOwnedBus(STARTER_BUS_ID, 0);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: now,
    cash: START_CASH,
    gold: START_GOLD,
    ledger: [],
    processedIds: [],
    company: {
      name: 'RoadMaster Tur',
      logo: 'logo_bus',
      color: '#f5a524',
      level: 1,
      xp: 0,
      reputation: 30,
      officeLevel: 0,
      unlockedCities: ['kuzeyliman', 'yesilvadi'],
      reports: {},
    },
    buses: [starter],
    selectedBusUid: starter.uid,
    unlockedCosmetics: [...STARTER_COSMETICS],
    drivers: [],
    missions: {
      progress: {},
      claimed: {},
      dailyKey: dayKey(now),
      weeklyKey: weekKey(now),
      dailyIds: [],
      weeklyIds: [],
    },
    achievements: { unlocked: {}, claimed: {} },
    daily: { lastClaimDay: null, streak: 0, premiumClaimedDay: null, doubledDay: null },
    boosts: { revenue: 0, demand: 0, fuelDiscount: 0, maintenanceDiscount: 0, upgradeDiscount: 0, missionBonus: 0 },
    tempCosmetic: null,
    ads: { dayKey: dayKey(now), countByType: {}, premiumFreeClaims: 0, lastAdAt: 0, totalWatched: 0 },
    purchases: {
      entitlements: { removeAds: false, garageExpansion: false, unlockedBusIds: [], cosmeticPacks: [] },
      subscription: { productId: null, status: 'none', expiresAt: 0, source: 'none', transactionId: null },
      history: [],
      pending: [],
      processed: [],
    },
    trips: [],
    stats: {
      totalKm: 0,
      totalPassengers: 0,
      tripsCompleted: 0,
      cleanStreak: 0,
      bestCleanStreak: 0,
      totalRevenue: 0,
      totalExpenses: 0,
      upgradesDone: 0,
      driversHired: 0,
      busesPurchased: 0,
      adsWatched: 0,
      purchasesCount: 0,
      maxReputation: 30,
      fiveStarTrips: 0,
    },
    settings: defaultSettings(),
    clock: { highWater: now, lastLaunch: now, suspiciousJumps: 0 },
    tutorialDone: false,
  };
}
