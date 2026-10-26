/**
 * Original fictional region. City names are invented (loosely inspired by Turkish geography);
 * no real map, road or terminal data is used. Names are localized under city.<id>.
 */

export interface CityDef {
  id: string;
  /** position on the 0..100 strategy map */
  x: number;
  y: number;
  unlockLevel: number;
  unlockCost: number;
  /** relative size, drives demand */
  size: number;
}

export const CITIES: CityDef[] = [
  { id: 'kuzeyliman', x: 22, y: 16, unlockLevel: 1, unlockCost: 0, size: 1.0 },
  { id: 'yesilvadi', x: 30, y: 36, unlockLevel: 1, unlockCost: 0, size: 0.8 },
  { id: 'dagbasi', x: 50, y: 20, unlockLevel: 2, unlockCost: 15_000, size: 0.55 },
  { id: 'ortasehir', x: 64, y: 42, unlockLevel: 3, unlockCost: 40_000, size: 0.95 },
  { id: 'egekent', x: 10, y: 62, unlockLevel: 4, unlockCost: 80_000, size: 0.85 },
  { id: 'turkuazkent', x: 44, y: 86, unlockLevel: 5, unlockCost: 150_000, size: 0.75 },
];

export const CITY_BY_ID: Record<string, CityDef> = Object.fromEntries(CITIES.map((c) => [c.id, c]));

export interface ConnectionDef {
  id: string;
  a: string;
  b: string;
  /** has a faster tolled motorway variant */
  motorway: boolean;
  difficulty: number;
  hilly: number;
  seed: number;
}

export const CONNECTIONS: ConnectionDef[] = [
  { id: 'kuzeyliman-yesilvadi', a: 'kuzeyliman', b: 'yesilvadi', motorway: true, difficulty: 2, hilly: 0.5, seed: 101 },
  { id: 'kuzeyliman-dagbasi', a: 'kuzeyliman', b: 'dagbasi', motorway: true, difficulty: 3, hilly: 0.8, seed: 202 },
  { id: 'yesilvadi-ortasehir', a: 'yesilvadi', b: 'ortasehir', motorway: true, difficulty: 3, hilly: 0.7, seed: 303 },
  { id: 'dagbasi-ortasehir', a: 'dagbasi', b: 'ortasehir', motorway: false, difficulty: 4, hilly: 1.0, seed: 404 },
  { id: 'yesilvadi-egekent', a: 'yesilvadi', b: 'egekent', motorway: true, difficulty: 3, hilly: 0.6, seed: 505 },
  { id: 'kuzeyliman-ortasehir', a: 'kuzeyliman', b: 'ortasehir', motorway: true, difficulty: 4, hilly: 0.9, seed: 606 },
  { id: 'ortasehir-turkuazkent', a: 'ortasehir', b: 'turkuazkent', motorway: true, difficulty: 5, hilly: 1.0, seed: 707 },
  { id: 'egekent-turkuazkent', a: 'egekent', b: 'turkuazkent', motorway: true, difficulty: 4, hilly: 0.8, seed: 808 },
];

export const CONNECTION_BY_ID: Record<string, ConnectionDef> = Object.fromEntries(CONNECTIONS.map((c) => [c.id, c]));

/** Departure slots (hour of day) with their demand multipliers. */
export const DEPARTURE_SLOTS = [
  { hour: 7, demand: 1.0 },
  { hour: 12.5, demand: 0.85 },
  { hour: 17.5, demand: 1.15 },
  { hour: 21.5, demand: 0.65 },
  { hour: 5.5, demand: 0.6 },
];

export const WEATHER_DEMAND: Record<string, number> = { clear: 1, cloudy: 0.97, rain: 0.88, fog: 0.85 };
export const WEATHER_GRIP: Record<string, number> = { clear: 1, cloudy: 1, rain: 0.68, fog: 0.95 };
