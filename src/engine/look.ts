import type { GameContext } from '../core/GameContext';
import type { OwnedBus } from '../core/types';
import { DEFAULT_COSMETICS } from '../data/cosmetics';
import type { BusLook } from '../vehicle/BusModel';

/** Cosmetics the player may not currently use (expired Premium / trial) fall back to defaults. */
export function lookFor(ctx: GameContext, bus: OwnedBus): BusLook {
  const now = ctx.clock.now();
  const pick = (id: string, kind: keyof typeof DEFAULT_COSMETICS): string => (ctx.garage.isUsable(id, now) ? id : DEFAULT_COSMETICS[kind]);
  return {
    paint: pick(bus.paint, 'paint'),
    livery: pick(bus.livery, 'livery'),
    rims: pick(bus.rims, 'rims'),
    interior: pick(bus.interior, 'interior'),
    plate: bus.plate,
    companyName: ctx.state.company.name,
    companyColor: ctx.state.company.color,
  };
}
