import type { GameEvents, GameState, RouteVariant, Weather } from '../core/types';
import type { EventBus } from '../core/EventBus';
import type { EconomyManager } from './EconomyManager';
import { CITY_BY_ID, CITIES, CONNECTIONS, CONNECTION_BY_ID, DEPARTURE_SLOTS, WEATHER_DEMAND, type ConnectionDef } from '../data/world';
import { ROUTE_SCALE, TICKET_PRICE_PER_KM, TOLL_PER_KM } from '../data/constants';
import { clamp, hashString, mulberry32 } from '../core/utils';

export interface StopDef {
  id: string;
  /** meters along the (compressed) play road */
  s: number;
  kind: 'terminal' | 'rest';
  cityId?: string;
  /** i18n key for rest stops, city.<id> for terminals */
  nameKey: string;
}

export interface SpeedZone {
  from: number;
  to: number;
  /** km/h */
  limit: number;
  kind: 'town' | 'open' | 'roadworks';
}

export interface RoadProfile {
  halfWidth: number;
  shoulder: number;
  median: number;
  /** lateral lane centres (m, + = right of the centreline = our direction) */
  lanesSame: number[];
  lanesOpposite: number[];
}

export type TrafficLevel = 'light' | 'normal' | 'heavy';

export interface RouteSpec {
  id: string;
  connectionId: string;
  variant: RouteVariant;
  reverse: boolean;
  fromId: string;
  toId: string;
  /** logical distance (km) used for money, fuel and stats */
  distanceKm: number;
  /** compressed driven length (m) */
  playLengthM: number;
  seed: number;
  difficulty: number;
  hilly: number;
  profile: RoadProfile;
  stops: StopDef[];
  speedZones: SpeedZone[];
  towns: { from: number; to: number }[];
  trafficLights: number[];
  radars: { s: number; limit: number }[];
  jams: { from: number; to: number }[];
  trafficLevel: TrafficLevel;
  toll: number;
  ticketRefPrice: number;
  baseDemand: number;
  expectedDriveSeconds: number;
  highway: boolean;
}

export const TOWN_LENGTH_M = 520;
export const STOP_DWELL_SECONDS = 25;

export function roadProfile(highway: boolean): RoadProfile {
  if (highway) {
    return { halfWidth: 8.6, shoulder: 1.6, median: 1.0, lanesSame: [6.4, 2.8], lanesOpposite: [-2.8, -6.4] };
  }
  return { halfWidth: 3.8, shoulder: 1.4, median: 0, lanesSame: [1.9], lanesOpposite: [-1.9] };
}

export function weatherFor(connectionId: string, ts: number, slotHour: number): Weather {
  const day = Math.floor(ts / 86_400_000);
  const r = mulberry32(hashString(`${connectionId}:${day}:${Math.floor(slotHour)}`))();
  if (r < 0.6) return 'clear';
  if (r < 0.78) return 'cloudy';
  if (r < 0.95) return 'rain';
  return 'fog';
}

export function trafficLevelFor(connectionId: string, ts: number, slotHour: number): TrafficLevel {
  const day = Math.floor(ts / 86_400_000);
  const r = mulberry32(hashString(`traffic:${connectionId}:${day}:${Math.floor(slotHour)}`))();
  const rush = slotHour >= 7 && slotHour <= 9 ? 0.2 : slotHour >= 17 && slotHour <= 19 ? 0.25 : 0;
  const v = r + rush;
  if (v > 0.85) return 'heavy';
  if (v > 0.35) return 'normal';
  return 'light';
}

export function slotDemand(hour: number): number {
  let best = DEPARTURE_SLOTS[0];
  let bd = 99;
  for (const s of DEPARTURE_SLOTS) {
    const d = Math.abs(s.hour - hour);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best.demand;
}

export class RouteManager {
  constructor(
    private readonly state: GameState,
    private readonly bus: EventBus<GameEvents>,
    private readonly economy: EconomyManager,
  ) {}

  isCityUnlocked(cityId: string): boolean {
    return this.state.company.unlockedCities.includes(cityId);
  }

  isConnectionUnlocked(connectionId: string): boolean {
    const c = CONNECTION_BY_ID[connectionId];
    return !!c && this.isCityUnlocked(c.a) && this.isCityUnlocked(c.b);
  }

  unlockedConnections(): ConnectionDef[] {
    return CONNECTIONS.filter((c) => this.isConnectionUnlocked(c.id));
  }

  canUnlockCity(cityId: string): { ok: boolean; reason?: 'unknown' | 'already' | 'level' | 'funds' } {
    const c = CITY_BY_ID[cityId];
    if (!c) return { ok: false, reason: 'unknown' };
    if (this.isCityUnlocked(cityId)) return { ok: false, reason: 'already' };
    if (this.state.company.level < c.unlockLevel) return { ok: false, reason: 'level' };
    if (!this.economy.canAfford('cash', c.unlockCost)) return { ok: false, reason: 'funds' };
    return { ok: true };
  }

  unlockCity(cityId: string): { ok: boolean; reason?: string } {
    const chk = this.canUnlockCity(cityId);
    if (!chk.ok) return chk;
    const c = CITY_BY_ID[cityId];
    if (!this.economy.spend('cash', c.unlockCost, 'cityUnlock', { ref: cityId, description: `unlock ${cityId}` })) return { ok: false, reason: 'funds' };
    this.state.company.unlockedCities.push(cityId);
    this.bus.emit('cityUnlocked', { cityId });
    this.bus.emit('stateChanged', undefined);
    return { ok: true };
  }

  static baseDistanceKm(conn: ConnectionDef): number {
    const a = CITY_BY_ID[conn.a];
    const b = CITY_BY_ID[conn.b];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    return Math.max(40, Math.round(d * 5.5));
  }

  /** Builds the full, deterministic description of a route (used by both game logic and 3D world). */
  resolve(connectionId: string, reverse: boolean, variant: RouteVariant, opts: { timestamp?: number; hour?: number } = {}): RouteSpec {
    const conn = CONNECTION_BY_ID[connectionId];
    if (!conn) throw new Error(`Unknown connection ${connectionId}`);
    const v: RouteVariant = variant === 'highway' && !conn.motorway ? 'old' : variant;
    const highway = v === 'highway';
    const fromId = reverse ? conn.b : conn.a;
    const toId = reverse ? conn.a : conn.b;
    const baseKm = RouteManager.baseDistanceKm(conn);
    const distanceKm = Math.round(highway ? baseKm : baseKm * 1.18);
    const playLengthM = Math.round((distanceKm * 1000) / ROUTE_SCALE);
    const seed = conn.seed * 31 + (reverse ? 7 : 0) + (highway ? 0 : 1000);
    const rnd = mulberry32(seed);

    const stops: StopDef[] = [{ id: 'start', s: 90, kind: 'terminal', cityId: fromId, nameKey: `city.${fromId}` }];
    const restCount = distanceKm >= 330 ? 2 : distanceKm >= 160 ? 1 : 0;
    for (let i = 1; i <= restCount; i++) {
      const frac = i / (restCount + 1);
      stops.push({ id: `rest${i}`, s: Math.round(playLengthM * frac), kind: 'rest', nameKey: `rest.${((seed + i) % 3) + 1}` });
    }
    stops.push({ id: 'end', s: playLengthM - 90, kind: 'terminal', cityId: toId, nameKey: `city.${toId}` });

    const open = highway ? 110 : 80;
    const town = 50;
    const towns = [
      { from: 0, to: TOWN_LENGTH_M },
      { from: playLengthM - TOWN_LENGTH_M, to: playLengthM },
    ];
    if (!highway) {
      // villages along the old road
      const villages = Math.floor(playLengthM / 3500);
      for (let i = 1; i <= villages; i++) {
        const c = Math.round((playLengthM * i) / (villages + 1)) + Math.round((rnd() - 0.5) * 300);
        if (stops.every((st) => Math.abs(st.s - c) > 500) && c > TOWN_LENGTH_M + 400 && c < playLengthM - TOWN_LENGTH_M - 400) {
          towns.push({ from: c - 200, to: c + 200 });
        }
      }
    }
    towns.sort((a, b) => a.from - b.from);

    const speedZones: SpeedZone[] = [];
    let cursor = 0;
    for (const t of towns) {
      if (t.from > cursor) speedZones.push({ from: cursor, to: t.from, limit: open, kind: 'open' });
      speedZones.push({ from: t.from, to: t.to, limit: town, kind: 'town' });
      cursor = t.to;
    }
    if (cursor < playLengthM) speedZones.push({ from: cursor, to: playLengthM, limit: open, kind: 'open' });

    // road works: up to 2 short zones in open road
    const roadworkCount = playLengthM > 6000 ? 2 : playLengthM > 3000 ? 1 : 0;
    for (let i = 0; i < roadworkCount; i++) {
      const from = Math.round(playLengthM * (0.25 + 0.4 * i + rnd() * 0.12));
      const to = from + 260;
      const clear = towns.every((t) => to < t.from - 50 || from > t.to + 50) && stops.every((st) => to < st.s - 100 || from > st.s + 100);
      if (clear) speedZones.push({ from, to, limit: 40, kind: 'roadworks' });
    }

    const trafficLights: number[] = [];
    for (const t of towns) {
      const n = t === towns[0] || t === towns[towns.length - 1] ? 2 : 1;
      for (let i = 1; i <= n; i++) trafficLights.push(Math.round(t.from + ((t.to - t.from) * i) / (n + 1)));
    }

    const radars: { s: number; limit: number }[] = [];
    for (const t of towns) radars.push({ s: t.from + 40, limit: town });
    for (const z of speedZones) if (z.kind === 'roadworks') radars.push({ s: z.from + 60, limit: z.limit });

    const hour = opts.hour ?? 12;
    const ts = opts.timestamp ?? 0;
    const trafficLevel = ts ? trafficLevelFor(connectionId, ts, hour) : 'normal';
    // the motorway is the one that jams; the old road is the alternative
    const jams: { from: number; to: number }[] = [];
    if (trafficLevel === 'heavy' && highway && playLengthM > 2500) {
      const from = Math.round(playLengthM * (0.35 + rnd() * 0.3));
      jams.push({ from, to: from + 420 });
    }

    const aCity = CITY_BY_ID[conn.a];
    const bCity = CITY_BY_ID[conn.b];
    const baseDemand = Math.round(24 + 38 * Math.sqrt(aCity.size * bCity.size) + Math.min(10, distanceKm / 40));
    const toll = highway ? Math.round(distanceKm * TOLL_PER_KM) : 0;
    const ticketRefPrice = Math.round(distanceKm * TICKET_PRICE_PER_KM * (highway ? 1 : 0.94));

    let seconds = stops.length * STOP_DWELL_SECONDS;
    for (const z of speedZones) seconds += (z.to - z.from) / ((z.limit * 0.82) / 3.6);

    return {
      id: `${connectionId}|${reverse ? 'r' : 'f'}|${v}`,
      connectionId,
      variant: v,
      reverse,
      fromId,
      toId,
      distanceKm,
      playLengthM,
      seed,
      difficulty: conn.difficulty + (highway ? 0 : 1),
      hilly: conn.hilly * (highway ? 1 : 1.2),
      profile: roadProfile(highway),
      stops,
      speedZones: speedZones.sort((a, b) => a.from - b.from),
      towns,
      trafficLights,
      radars,
      jams,
      trafficLevel,
      toll,
      ticketRefPrice,
      baseDemand,
      expectedDriveSeconds: Math.round(seconds),
      highway,
    };
  }

  speedLimitAt(spec: RouteSpec, s: number): number {
    let limit = spec.speedZones[0]?.limit ?? 80;
    // roadworks override town/open; pick the lowest overlapping limit
    let found = false;
    for (const z of spec.speedZones) {
      if (s >= z.from && s < z.to) {
        limit = found ? Math.min(limit, z.limit) : z.limit;
        found = true;
      }
    }
    return limit;
  }

  /** Cost estimate shown before a trip. */
  estimate(spec: RouteSpec, consumptionPer100: number, unitPrice: number, maintenancePerKm: number) {
    const fuelUnits = (spec.distanceKm * consumptionPer100) / 100;
    return {
      fuelUnits,
      fuelCost: fuelUnits * unitPrice,
      toll: spec.toll,
      maintenance: spec.distanceKm * maintenancePerKm,
    };
  }
}

export function demandMultiplierWeather(w: Weather): number {
  return WEATHER_DEMAND[w] ?? 1;
}

export function allCities() {
  return CITIES;
}

export { clamp };
