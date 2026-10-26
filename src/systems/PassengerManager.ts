import type { RouteSpec, StopDef } from './RouteManager';
import { clamp } from '../core/utils';

export const BOARD_RATE_PER_SEC = 5;
export const ALIGHT_RATE_PER_SEC = 7;
export const BAGGAGE_FEE = 12;

export interface DemandInput {
  route: RouteSpec;
  hourDemand: number;
  weatherDemand: number;
  reputation: number;
  ticketPrice: number;
  seats: number;
  demandBoost: boolean;
  /** player level of the company (small effect) */
  companyLevel: number;
}

export interface DemandResult {
  demand: number;
  sold: number;
  reservations: number;
}

/**
 * Passengers wanting a ticket for this trip. Seats are a HARD cap: sold + reservations <= seats,
 * no matter which boosts are active.
 */
export function computeDemand(i: DemandInput): DemandResult {
  const ratio = clamp(i.ticketPrice / Math.max(1, i.route.ticketRefPrice), 0.2, 4);
  const priceFactor = clamp(Math.pow(1 / ratio, 1.3), 0.15, 1.5);
  const repFactor = 0.75 + clamp(i.reputation, 0, 100) / 200;
  const lvlFactor = 1 + Math.min(0.2, i.companyLevel * 0.02);
  let demand = i.route.baseDemand * i.hourDemand * i.weatherDemand * repFactor * priceFactor * lvlFactor;
  if (i.demandBoost) demand *= 1.3;
  const sold = clamp(Math.round(demand), 0, i.seats);
  let reservations = Math.min(i.seats - sold, Math.floor(clamp(i.reputation, 0, 100) / 30));
  if (i.demandBoost) reservations += 6;
  reservations = clamp(reservations, 0, i.seats - sold);
  return { demand, sold, reservations };
}

interface Group {
  count: number;
  /** fraction (0..1) of the route at which the group boarded */
  boardFrac: number;
  destStopId: string;
}

export interface StepResult {
  boarded: number;
  alighted: number;
  done: boolean;
}

export type SatisfactionEvent =
  | 'hardBrake'
  | 'hardCorner'
  | 'speeding'
  | 'collision'
  | 'redLight'
  | 'doorsMoving'
  | 'missedStop'
  | 'late'
  | 'smooth'
  | 'restStop'
  | 'offRoad'
  | 'tailgating';

const SAT_DELTA: Record<SatisfactionEvent, number> = {
  hardBrake: -1.2,
  hardCorner: -0.8,
  speeding: -0.6,
  collision: -10,
  redLight: -6,
  doorsMoving: -8,
  missedStop: -10,
  late: -12,
  smooth: 0.15,
  restStop: 2,
  offRoad: -2,
  tailgating: -0.3,
};

/** Tracks every passenger number of one trip: tickets, reservations, boarding, alighting, revenue. */
export class TripManifest {
  readonly seats: number;
  readonly luggageCapacity: number;
  readonly ticketPrice: number;
  readonly distanceKm: number;
  sold: number;
  reservations: number;
  boardedTotal = 0;
  alightedTotal = 0;
  onboard = 0;
  satisfaction = 88;
  ticketRevenue = 0;
  luggageCarried = 0;
  private groups: Group[] = [];
  private waiting = 0;
  private waitingFrac = 0;
  private currentStopId: string | null = null;
  private alightQueue = 0;
  private boardBudget = 0;
  private acc = 0;
  private stopsDone = new Set<string>();
  readonly eventLog: Record<string, number> = {};

  constructor(
    private readonly route: RouteSpec,
    seats: number,
    luggageCapacity: number,
    ticketPrice: number,
    sold: number,
    reservations: number,
    private readonly rnd: () => number,
  ) {
    this.seats = seats;
    this.luggageCapacity = luggageCapacity;
    this.ticketPrice = ticketPrice;
    this.distanceKm = route.distanceKm;
    this.sold = clamp(sold, 0, seats);
    this.reservations = clamp(reservations, 0, seats - this.sold);
    this.waiting = this.sold + this.reservations;
    this.waitingFrac = 0;
  }

  get booked(): number {
    return this.sold + this.reservations;
  }
  get empty(): number {
    return this.seats - this.onboard;
  }
  get occupancy(): number {
    return this.seats > 0 ? this.onboard / this.seats : 0;
  }
  /** Booked seats / seats: the load factor of the trip. */
  get loadFactor(): number {
    return this.seats > 0 ? this.booked / this.seats : 0;
  }
  get waitingCount(): number {
    return this.waiting;
  }
  get currentStop(): string | null {
    return this.currentStopId;
  }

  hasServedStop(stopId: string): boolean {
    return this.stopsDone.has(stopId);
  }

  /** Called when the bus has stopped inside a stop zone. */
  arriveAtStop(stop: StopDef, isLast: boolean): void {
    this.currentStopId = stop.id;
    this.acc = 0;
    const frac = clamp(stop.s / this.route.playLengthM, 0, 1);
    // who gets off here
    let off = 0;
    if (isLast) {
      off = this.onboard;
    } else if (stop.kind === 'rest') {
      for (const g of this.groups) if (g.destStopId === stop.id) off += g.count;
    }
    this.alightQueue = off;
    // who wants to get on here
    if (stop.id === 'start') {
      this.waiting = this.booked - this.boardedTotal;
      this.waitingFrac = 0;
    } else if (!isLast) {
      this.waiting = Math.round(this.route.baseDemand * 0.18 * (0.6 + this.rnd() * 0.8));
      this.waitingFrac = frac;
    } else {
      this.waiting = 0;
    }
    this.boardBudget = this.waiting;
  }

  /** Assigns a destination to passengers boarding at `stopIndex` (they all travel to some later stop). */
  private destFor(stopId: string): string {
    const later = this.route.stops.filter((s) => s.s > (this.route.stops.find((x) => x.id === stopId)?.s ?? 0));
    const rests = later.filter((s) => s.kind === 'rest');
    for (const r of rests) if (this.rnd() < 0.16) return r.id;
    return 'end';
  }

  /** Advance boarding/alighting while the doors are open. */
  step(dt: number): StepResult {
    if (!this.currentStopId) return { boarded: 0, alighted: 0, done: true };
    let boarded = 0;
    let alighted = 0;
    this.acc += dt;
    if (this.alightQueue > 0) {
      const n = Math.min(this.alightQueue, Math.floor(this.acc * ALIGHT_RATE_PER_SEC));
      if (n > 0) {
        this.acc -= n / ALIGHT_RATE_PER_SEC;
        alighted = this.alight(n);
        this.alightQueue -= alighted;
        if (alighted === 0) this.alightQueue = 0;
      }
    } else if (this.waiting > 0 && this.empty > 0) {
      const n = Math.min(this.waiting, this.empty, Math.floor(this.acc * BOARD_RATE_PER_SEC));
      if (n > 0) {
        this.acc -= n / BOARD_RATE_PER_SEC;
        boarded = this.board(n);
        this.waiting -= boarded;
      }
    } else if (this.waiting > 0 && this.empty <= 0) {
      this.waiting = 0; // rest are turned away: bus is full
    }
    const done = this.alightQueue <= 0 && (this.waiting <= 0 || this.empty <= 0);
    return { boarded, alighted, done };
  }

  /** Boards up to n passengers; NEVER exceeds seat count. */
  board(n: number): number {
    const k = Math.max(0, Math.min(Math.floor(n), this.empty));
    if (k === 0) return 0;
    const stopId = this.currentStopId ?? 'start';
    // split into destination groups
    for (let i = 0; i < k; i++) {
      const dest = this.destFor(stopId);
      const g = this.groups.find((x) => x.destStopId === dest && x.boardFrac === this.waitingFrac);
      if (g) g.count += 1;
      else this.groups.push({ count: 1, boardFrac: this.waitingFrac, destStopId: dest });
    }
    this.onboard += k;
    this.boardedTotal += k;
    this.luggageCarried = Math.min(this.luggageCapacity, this.luggageCarried + Math.round(k * 0.75));
    return k;
  }

  private alight(n: number): number {
    const stop = this.route.stops.find((s) => s.id === this.currentStopId);
    const here = stop ? clamp(stop.s / this.route.playLengthM, 0, 1) : 1;
    let left = n;
    let got = 0;
    for (const g of this.groups) {
      if (left <= 0) break;
      const isLast = stop && this.route.stops[this.route.stops.length - 1].id === stop.id;
      if (g.destStopId !== this.currentStopId && !isLast) continue;
      const take = Math.min(g.count, left);
      g.count -= take;
      left -= take;
      got += take;
      this.ticketRevenue += take * this.ticketPrice * clamp(here - g.boardFrac, 0, 1);
    }
    this.groups = this.groups.filter((g) => g.count > 0);
    this.onboard -= got;
    this.alightedTotal += got;
    return got;
  }

  finishStop(): void {
    if (this.currentStopId) this.stopsDone.add(this.currentStopId);
    this.currentStopId = null;
    this.alightQueue = 0;
    this.waiting = 0;
  }

  /** Passengers whose stop was skipped: they ride to the final terminal and are unhappy. */
  skipStop(stopId: string): void {
    for (const g of this.groups) if (g.destStopId === stopId) g.destStopId = 'end';
    this.stopsDone.add(stopId);
  }

  satisfactionEvent(kind: SatisfactionEvent, scale = 1): void {
    this.eventLog[kind] = (this.eventLog[kind] ?? 0) + 1;
    this.satisfaction = clamp(this.satisfaction + SAT_DELTA[kind] * scale, 0, 100);
  }

  baggageRevenue(): number {
    return this.luggageCarried * BAGGAGE_FEE;
  }

  /** 0..5 stars (0.5 steps) */
  rating(comfortBonus = 0): number {
    const s = clamp(this.satisfaction + comfortBonus, 0, 100);
    return Math.round((s / 20) * 2) / 2;
  }
}

export function createManifest(route: RouteSpec, seats: number, luggage: number, ticketPrice: number, demand: DemandResult, rnd: () => number): TripManifest {
  return new TripManifest(route, seats, luggage, ticketPrice, demand.sold, demand.reservations, rnd);
}
