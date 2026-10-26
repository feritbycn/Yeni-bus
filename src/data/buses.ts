import type { PowerTrain } from '../core/types';
import { buildRmModels } from './rmBuses';

export type BusStyle = 'compact' | 'standard' | 'coach' | 'luxury' | 'doubleDecker' | 'electric';

export interface BusModelDef {
  id: string;
  style: BusStyle;
  powertrain: PowerTrain;
  maxSpeedKmh: number;
  powerKw: number;
  massKg: number;
  /** L/100 km (diesel) or kWh/100 km (electric) */
  consumptionPer100: number;
  tankCapacity: number;
  seats: number;
  luggageCapacity: number;
  price: number;
  maintenancePerKm: number;
  comfort: number;
  /** 0..100, scales tyre grip */
  handling: number;
  resaleRate: number;
  unlockLevel: number;
  dims: { length: number; width: number; height: number };
  /** imported 3D asset file under public/models (the procedural rig is used when absent or when loading fails) */
  glb?: string;
  /** factory body colour of an imported model; used while the player keeps the default paint */
  factoryColor?: string;
}

/** Six original prototype models; names are localized under bus.<id>.name / .desc / .class */
export const BUS_MODELS: BusModelDef[] = [
  {
    id: 'eco',
    style: 'compact',
    powertrain: 'diesel',
    maxSpeedKmh: 105,
    powerKw: 180,
    massKg: 11500,
    consumptionPer100: 27,
    tankCapacity: 250,
    seats: 41,
    luggageCapacity: 25,
    price: 48_000,
    maintenancePerKm: 0.45,
    comfort: 45,
    handling: 55,
    resaleRate: 0.6,
    unlockLevel: 1,
    dims: { length: 10.5, width: 2.5, height: 3.1 },
  },
  {
    id: 'standard',
    style: 'standard',
    powertrain: 'diesel',
    maxSpeedKmh: 120,
    powerKw: 240,
    massKg: 13500,
    consumptionPer100: 29,
    tankCapacity: 300,
    seats: 50,
    luggageCapacity: 35,
    price: 85_000,
    maintenancePerKm: 0.5,
    comfort: 60,
    handling: 60,
    resaleRate: 0.62,
    unlockLevel: 2,
    dims: { length: 12, width: 2.55, height: 3.3 },
  },
  {
    id: 'coach',
    style: 'coach',
    powertrain: 'diesel',
    maxSpeedKmh: 130,
    powerKw: 290,
    massKg: 15000,
    consumptionPer100: 31,
    tankCapacity: 400,
    seats: 46,
    luggageCapacity: 45,
    price: 150_000,
    maintenancePerKm: 0.6,
    comfort: 78,
    handling: 66,
    resaleRate: 0.64,
    unlockLevel: 3,
    dims: { length: 13, width: 2.55, height: 3.6 },
  },
  {
    id: 'luxury',
    style: 'luxury',
    powertrain: 'diesel',
    maxSpeedKmh: 140,
    powerKw: 330,
    massKg: 16500,
    consumptionPer100: 34,
    tankCapacity: 450,
    seats: 38,
    luggageCapacity: 55,
    price: 260_000,
    maintenancePerKm: 0.75,
    comfort: 95,
    handling: 72,
    resaleRate: 0.66,
    unlockLevel: 4,
    dims: { length: 13.5, width: 2.55, height: 3.75 },
  },
  {
    id: 'double',
    style: 'doubleDecker',
    powertrain: 'diesel',
    maxSpeedKmh: 100,
    powerKw: 300,
    massKg: 19000,
    consumptionPer100: 38,
    tankCapacity: 450,
    seats: 80,
    luggageCapacity: 60,
    price: 320_000,
    maintenancePerKm: 0.9,
    comfort: 55,
    handling: 42,
    resaleRate: 0.58,
    unlockLevel: 5,
    dims: { length: 13, width: 2.55, height: 4.2 },
  },
  {
    id: 'electric',
    style: 'electric',
    powertrain: 'electric',
    maxSpeedKmh: 110,
    powerKw: 250,
    massKg: 15500,
    consumptionPer100: 95,
    tankCapacity: 400,
    seats: 44,
    luggageCapacity: 30,
    price: 380_000,
    maintenancePerKm: 0.3,
    comfort: 82,
    handling: 64,
    resaleRate: 0.6,
    unlockLevel: 4,
    dims: { length: 12, width: 2.55, height: 3.4 },
  },
];

/** The six built-in procedural buses followed by the 50 imported 3D coaches. */
export const ALL_BUS_MODELS: BusModelDef[] = [...BUS_MODELS, ...buildRmModels()];

export const BUS_BY_ID: Record<string, BusModelDef> = Object.fromEntries(ALL_BUS_MODELS.map((b) => [b.id, b]));
export const STARTER_BUS_ID = 'eco';

export function getBusModel(id: string): BusModelDef {
  const m = BUS_BY_ID[id];
  if (!m) throw new Error(`Unknown bus model: ${id}`);
  return m;
}
