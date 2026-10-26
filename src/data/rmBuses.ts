import type { BusModelDef, BusStyle } from './buses';

/**
 * 50 imported 3D coaches (public/models/RM_Bus_NN.glb, procedural prototype assets supplied with the project).
 * Catalogue columns come straight from docs/RM_BUS_CATALOG.json: id, class, length, width, height, body colour, seats, max speed.
 * Everything else (price, power, consumption ...) is game balance derived below from the class and the "series" (tier 0-9).
 */
export type RmClass = 'luxury' | 'intercity' | 'touring' | 'city' | 'electric';
export const RM_CLASSES: RmClass[] = ['luxury', 'intercity', 'touring', 'city', 'electric'];

// [id, classIndex, length, width, height, bodyColour, seats, maxSpeedKmh]
export const RM_CATALOG: [number, number, number, number, number, string, number, number][] = [
  [1, 0, 10.8, 2.45, 3.25, '#0f386b', 42, 105],
  [2, 1, 11.22, 2.53, 3.37, '#b71414', 46, 115],
  [3, 2, 11.64, 2.61, 3.49, '#e0d1ad', 50, 125],
  [4, 3, 12.06, 2.45, 3.61, '#11161e', 54, 130],
  [5, 4, 12.48, 2.53, 3.25, '#0c6b56', 58, 110],
  [6, 0, 10.8, 2.61, 3.37, '#0556a5', 42, 105],
  [7, 1, 11.22, 2.45, 3.49, '#b77a14', 46, 115],
  [8, 2, 11.64, 2.53, 3.61, '#602d8c', 50, 125],
  [9, 3, 12.06, 2.61, 3.25, '#bcbcb7', 54, 130],
  [10, 4, 12.48, 2.45, 3.37, '#0c7a84', 58, 110],
  [11, 0, 10.8, 2.53, 3.49, '#a51e47', 42, 105],
  [12, 1, 11.22, 2.61, 3.61, '#383f47', 46, 115],
  [13, 2, 11.64, 2.45, 3.25, '#d1d1c6', 50, 125],
  [14, 3, 12.06, 2.53, 3.37, '#266038', 54, 130],
  [15, 4, 12.48, 2.61, 3.49, '#0a1e3f', 58, 110],
  [16, 0, 10.8, 2.45, 3.61, '#ea7a0f', 42, 105],
  [17, 1, 11.22, 2.53, 3.25, '#5b707a', 46, 115],
  [18, 2, 11.64, 2.61, 3.37, '#adb7bf', 50, 125],
  [19, 3, 12.06, 2.45, 3.49, '#1e1e23', 54, 130],
  [20, 4, 12.48, 2.53, 3.61, '#0f5138', 58, 110],
  [21, 0, 10.8, 2.61, 3.25, '#0f386b', 42, 105],
  [22, 1, 11.22, 2.45, 3.37, '#b71414', 46, 115],
  [23, 2, 11.64, 2.53, 3.49, '#e0d1ad', 50, 125],
  [24, 3, 12.06, 2.61, 3.61, '#11161e', 54, 130],
  [25, 4, 12.48, 2.45, 3.25, '#0c6b56', 58, 110],
  [26, 0, 10.8, 2.53, 3.37, '#0556a5', 42, 105],
  [27, 1, 11.22, 2.61, 3.49, '#b77a14', 46, 115],
  [28, 2, 11.64, 2.45, 3.61, '#602d8c', 50, 125],
  [29, 3, 12.06, 2.53, 3.25, '#bcbcb7', 54, 130],
  [30, 4, 12.48, 2.61, 3.37, '#0c7a84', 58, 110],
  [31, 0, 10.8, 2.45, 3.49, '#a51e47', 42, 105],
  [32, 1, 11.22, 2.53, 3.61, '#383f47', 46, 115],
  [33, 2, 11.64, 2.61, 3.25, '#d1d1c6', 50, 125],
  [34, 3, 12.06, 2.45, 3.37, '#266038', 54, 130],
  [35, 4, 12.48, 2.53, 3.49, '#0a1e3f', 58, 110],
  [36, 0, 10.8, 2.61, 3.61, '#ea7a0f', 42, 105],
  [37, 1, 11.22, 2.45, 3.25, '#5b707a', 46, 115],
  [38, 2, 11.64, 2.53, 3.37, '#adb7bf', 50, 125],
  [39, 3, 12.06, 2.61, 3.49, '#1e1e23', 54, 130],
  [40, 4, 12.48, 2.45, 3.61, '#0f5138', 58, 110],
  [41, 0, 10.8, 2.53, 3.25, '#0f386b', 42, 105],
  [42, 1, 11.22, 2.61, 3.37, '#b71414', 46, 115],
  [43, 2, 11.64, 2.45, 3.49, '#e0d1ad', 50, 125],
  [44, 3, 12.06, 2.53, 3.61, '#11161e', 54, 130],
  [45, 4, 12.48, 2.61, 3.25, '#0c6b56', 58, 110],
  [46, 0, 10.8, 2.45, 3.37, '#0556a5', 42, 105],
  [47, 1, 11.22, 2.53, 3.49, '#b77a14', 46, 115],
  [48, 2, 11.64, 2.61, 3.61, '#602d8c', 50, 125],
  [49, 3, 12.06, 2.45, 3.25, '#bcbcb7', 54, 130],
  [50, 4, 12.48, 2.53, 3.37, '#0c7a84', 58, 110],
];

interface ClassBase {
  style: BusStyle;
  electric: boolean;
  powerKw: number;
  massKg: number;
  consumption: number;
  tank: number;
  luggage: number;
  price: number;
  maintenance: number;
  comfort: number;
  handling: number;
  resale: number;
}

const BASE: Record<RmClass, ClassBase> = {
  luxury: { style: 'luxury', electric: false, powerKw: 300, massKg: 15000, consumption: 32, tank: 420, luggage: 50, price: 210_000, maintenance: 0.7, comfort: 88, handling: 68, resale: 0.66 },
  intercity: { style: 'coach', electric: false, powerKw: 270, massKg: 14500, consumption: 30, tank: 380, luggage: 45, price: 140_000, maintenance: 0.55, comfort: 70, handling: 64, resale: 0.64 },
  touring: { style: 'coach', electric: false, powerKw: 290, massKg: 15500, consumption: 31, tank: 420, luggage: 60, price: 175_000, maintenance: 0.6, comfort: 80, handling: 62, resale: 0.64 },
  city: { style: 'standard', electric: false, powerKw: 230, massKg: 13500, consumption: 28, tank: 300, luggage: 25, price: 95_000, maintenance: 0.48, comfort: 55, handling: 66, resale: 0.62 },
  electric: { style: 'electric', electric: true, powerKw: 280, massKg: 16000, consumption: 92, tank: 380, luggage: 35, price: 330_000, maintenance: 0.3, comfort: 78, handling: 64, resale: 0.6 },
};

export const rmId = (n: number): string => 'rm' + String(n).padStart(2, '0');
export const rmFile = (n: number): string => `RM_Bus_${String(n).padStart(2, '0')}.glb`;

export function buildRmModels(): BusModelDef[] {
  return RM_CATALOG.map(([n, ci, length, width, height, color, seats, speed]) => {
    const cls = RM_CLASSES[ci];
    const b = BASE[cls];
    const tier = Math.floor((n - 1) / 5); // 0..9 : higher series = better + pricier
    const round = (v: number, step: number) => Math.round(v / step) * step;
    return {
      id: rmId(n),
      style: b.style,
      powertrain: b.electric ? 'electric' : 'diesel',
      maxSpeedKmh: speed,
      powerKw: Math.round(b.powerKw * (1 + 0.02 * tier)),
      massKg: round(b.massKg * (length / 11.5), 50),
      consumptionPer100: Math.round(b.consumption * (1 - 0.01 * tier) * 10) / 10,
      tankCapacity: b.tank,
      seats,
      luggageCapacity: b.luggage,
      price: round(b.price * (1 + 0.1 * tier), 1000),
      maintenancePerKm: Math.round(b.maintenance * (1 + 0.02 * tier) * 100) / 100,
      comfort: Math.min(100, b.comfort + tier),
      handling: Math.min(100, Math.round(b.handling + tier * 0.8)),
      resaleRate: b.resale,
      unlockLevel: 2 + tier,
      dims: { length, width, height },
      glb: rmFile(n),
      factoryColor: color,
    };
  });
}
