import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import type { RenderQuality } from '../core/PerformanceManager';
import type { AudioManager } from '../core/AudioManager';
import type { TripPlan, TripOutcome, TripSummary } from '../systems/TripManager';
import type { StopDef } from '../systems/RouteManager';
import { STOP_DWELL_SECONDS } from '../systems/RouteManager';
import { VehicleController, FIXED_DT, type VehicleSpec, type Surface } from '../vehicle/VehicleController';
import { BusRig } from '../vehicle/BusModel';
import { BUS_BY_ID } from '../data/buses';
import { shellIfLoaded } from '../vehicle/BusAssets';
import { WEATHER_GRIP } from '../data/world';
import { RoadWorld, type WorldLabels } from '../world/RoadWorld';
import { Environment } from '../world/Environment';
import { bayParkOffset, drivableLimits, BAY_WIDTH } from '../world/roadGeometry';
import { TrafficManager, lightPhaseAt } from '../traffic/TrafficManager';
import { CameraController, RearViewCamera, type CameraTarget } from './CameraController';
import { InputManager, type DriveAction } from './InputManager';
import { lookFor } from './look';
import { clamp } from '../core/utils';

/** Game minutes pass this much faster than real minutes (for clock + day/night). */
export const GAME_TIME_SCALE = 30;
export const RADAR_FINE_BASE = 150;
export const RADAR_FINE_PER_KMH = 8;
export const RED_LIGHT_FINE = 250;
const STOP_ZONE_HALF = 16;

export type Phase = 'driving' | 'finished';

export interface HudData {
  speedKmh: number;
  rpm: number;
  gear: string;
  fuelFrac: number;
  fuelLow: boolean;
  limitKmh: number;
  speeding: boolean;
  engineOn: boolean;
  handbrake: boolean;
  doorsOpen: boolean;
  cruiseOn: boolean;
  cruiseKmh: number;
  lights: number;
  left: boolean;
  right: boolean;
  hazard: boolean;
  wipers: number;
  damage: number;
  progress: number;
  nextStopKey: string | null;
  nextStopId: string | null;
  nextStopDist: number;
  nextStopKind: 'terminal' | 'rest' | null;
  onboard: number;
  seats: number;
  waiting: number;
  satisfaction: number;
  fines: number;
  clock: string;
  elapsed: number;
  expected: number;
  late: boolean;
  weather: string;
  prompt: string | null;
  inStopZone: boolean;
  stopped: boolean;
  trafficLight: 'green' | 'yellow' | 'red' | null;
  ambulance: boolean;
  tailgating: boolean;
  camera: string;
  offRoad: boolean;
  blinkOn: boolean;
  lastMessage: { key: string; params?: Record<string, string | number>; kind: 'info' | 'success' | 'warn' | 'error'; t: number } | null;
  paused: boolean;
}

export interface SessionOptions {
  ctx: GameContext;
  plan: TripPlan;
  scene: THREE.Scene;
  quality: RenderQuality;
  labels: WorldLabels;
  audio: AudioManager;
  input: InputManager;
  camera: CameraController;
  renderer: THREE.WebGLRenderer | undefined;
}

function toSpec(ctx: GameContext, plan: TripPlan): { spec: VehicleSpec; seats: number } {
  const bus = ctx.garage.getBus(plan.busUid)!;
  const model = BUS_BY_ID[bus.modelId];
  const eff = ctx.garage.effectiveStats(bus);
  return {
    seats: eff.seats,
    spec: {
      massKg: eff.massKg,
      powerKw: eff.powerKw,
      maxSpeedKmh: eff.maxSpeedKmh,
      length: model.dims.length,
      width: model.dims.width,
      height: model.dims.height,
      grip: eff.grip,
      consumptionPer100: eff.consumptionPer100,
      tankCapacity: eff.tankCapacity,
      electric: model.powertrain === 'electric',
    },
  };
}

/**
 * One driven trip. Owns the 3D world, bus, traffic and the trip state machine (stops, boarding,
 * fines, collisions, fuel). Rendering is driven by `update(dt)` from the GameEngine.
 */
export class DriveSession {
  readonly world: RoadWorld;
  readonly env: Environment;
  readonly vehicle: VehicleController;
  readonly rig: BusRig;
  readonly traffic: TrafficManager;
  readonly rear = new RearViewCamera();
  phase: Phase = 'driving';
  paused = false;
  summary: TripSummary | null = null;
  rearCamOn = false;

  private acc = 0;
  private elapsed = 0;
  private fines = 0;
  private damageStart: number;
  private hint = 0;
  private s = 0;
  private d = 0;
  private surface: Surface = { grade: 0, gripMul: 1, offRoad: false };
  private msgs: HudData['lastMessage'] = null;
  private blinkClock = 0;
  private lastLightIdx = -1;
  private servingStop: StopDef | null = null;
  private serviceDone = false;
  private lateFlagged = false;
  private lateSeconds = 0;
  private speedingAcc = 0;
  private radarDone = new Set<number>();
  private redLightDone = new Set<number>();
  private prevLightSide = new Map<number, number>();
  private fuelOutTimer = 0;
  private clusterTimer = 0;
  private hardBrakeCd = 0;
  private cornerCd = 0;
  private tailAcc = 0;
  private offRoadCd = 0;
  private smoothAcc = 0;
  private resultOutcome: TripOutcome | null = null;
  private lightState: ('green' | 'yellow' | 'red')[] = [];
  private seatCap: number;
  private lastOccupancy = -1;
  private stoppedTimer = 0;
  private prompt: string | null = null;
  private currentLimit = 50;
  private weatherGrip: number;
  private disposed = false;
  private unsubInput: () => void;
  private tmpEye = new THREE.Vector3();
  private cameraTarget!: CameraTarget;
  private nextStopCache: StopDef | null = null;
  private lastHud!: HudData;
  private ambulanceAlerted = false;

  constructor(private readonly o: SessionOptions) {
    const { ctx, plan, scene, quality, labels } = o;
    const route = plan.route;
    this.damageStart = plan.startDamage;
    this.weatherGrip = WEATHER_GRIP[plan.weather] ?? 1;

    this.world = new RoadWorld(route, quality, labels);
    scene.add(this.world.group);
    this.env = new Environment(scene, quality, o.renderer);
    this.env.setWeather(plan.weather);
    this.env.setTime(plan.hour);
    this.world.setWet(this.env.wetness);

    const bus = ctx.garage.getBus(plan.busUid)!;
    const { spec, seats } = toSpec(ctx, plan);
    this.seatCap = seats;
    this.vehicle = new VehicleController(spec, plan.startFuel, plan.startDamage);
    this.rig = new BusRig(BUS_BY_ID[bus.modelId], lookFor(ctx, bus), { headlightBeams: quality.headlightBeams, interior: true, shell: shellIfLoaded(BUS_BY_ID[bus.modelId].glb) });
    this.rig.setDestination(labels.city(route.toId));
    scene.add(this.rig.group);

    this.traffic = new TrafficManager({ route, path: this.world.path, maxVehicles: this.trafficCap(), spawnRadius: Math.min(520, quality.viewDistance * 0.7) });
    scene.add(this.traffic.group);

    // park in the first bay
    const start = route.stops[0];
    const p = this.world.path.lanePos(start.s - 3, bayParkOffset(route.profile));
    this.vehicle.placeAt(p.x, p.y, p.z, p.h);
    this.s = start.s - 3;
    this.hint = this.s;
    this.d = bayParkOffset(route.profile);
    this.vehicle.gear = 'P';
    this.vehicle.handbrake = true;
    this.vehicle.lights = { head: plan.hour < 6 || plan.hour >= 19 ? 1 : 0, hazard: false, left: false, right: false, wipers: plan.weather === 'rain' ? 1 : 0, interior: false };
    this.traffic.prime(this.s);
    this.lightState = route.trafficLights.map(() => 'green');

    ctx.trips.commit(plan);
    o.camera.setMode('chase');
    o.camera.snap();
    o.input.reset();
    o.input.sensitivity = clamp(ctx.state.settings.sensitivity, 0.4, 1.6);
    this.unsubInput = o.input.onAction((a) => this.onAction(a));
    this.syncExtraMass();
    this.notify('hud.msg.welcome', 'info');
    this.cameraTarget = this.makeTarget();
    this.updateVisuals(0, true);
  }

  private trafficCap(): number {
    const d = this.o.ctx.state.settings.trafficDensity;
    const q = this.o.quality.maxTraffic;
    if (d === 'off') return 0;
    if (d === 'low') return Math.max(2, Math.round(q * 0.4));
    if (d === 'medium') return Math.max(3, Math.round(q * 0.7));
    if (d === 'high') return q;
    return Math.round(q * 0.8);
  }

  get plan(): TripPlan {
    return this.o.plan;
  }

  private notify(key: string, kind: 'info' | 'success' | 'warn' | 'error', params?: Record<string, string | number>): void {
    this.msgs = { key, params, kind, t: this.elapsed };
  }

  private syncExtraMass(): void {
    const m = this.o.plan.manifest;
    this.vehicle.extraMassKg = m.onboard * 75 + m.luggageCarried * 18;
  }

  // ------------------------------------------------------------ actions

  private onAction(a: DriveAction): void {
    if (this.phase !== 'driving' || this.paused) {
      return;
    }
    const v = this.vehicle;
    const audio = this.o.audio;
    switch (a) {
      case 'engine':
        if (v.toggleEngine()) {
          if (v.engineOn) audio.engineStart();
        } else this.notify('hud.msg.noFuel', 'error');
        break;
      case 'gearP':
        if (!v.setGear('P')) this.notify('hud.msg.stopFirst', 'warn');
        break;
      case 'gearR':
        if (!v.setGear('R')) this.notify('hud.msg.stopFirst', 'warn');
        break;
      case 'gearN':
        v.setGear('N');
        break;
      case 'gearD':
        if (!v.setGear('D')) this.notify('hud.msg.stopFirst', 'warn');
        else if (v.handbrake && v.engineOn) this.notify('hud.msg.handbrakeOn', 'warn');
        break;
      case 'lights':
        v.lights.head = ((v.lights.head + 1) % 3) as 0 | 1 | 2;
        audio.tick(true);
        break;
      case 'signalLeft':
        v.lights.left = !v.lights.left;
        v.lights.right = false;
        v.lights.hazard = false;
        break;
      case 'signalRight':
        v.lights.right = !v.lights.right;
        v.lights.left = false;
        v.lights.hazard = false;
        break;
      case 'hazard':
        v.lights.hazard = !v.lights.hazard;
        v.lights.left = v.lights.right = false;
        break;
      case 'wipers':
        v.lights.wipers = ((v.lights.wipers + 1) % 3) as 0 | 1 | 2;
        break;
      case 'interiorLight':
        v.lights.interior = !v.lights.interior;
        break;
      case 'doors':
        this.toggleDoors();
        break;
      case 'camera': {
        this.o.camera.cycle();
        this.rig.setCockpitVisible(this.o.camera.mode === 'cockpit' || this.o.camera.mode === 'chase' || this.o.camera.mode === 'far' || this.o.camera.mode === 'orbit');
        break;
      }
      case 'rearCam':
        this.rearCamOn = !this.rearCamOn;
        break;
      case 'cruise':
        if (!v.toggleCruise() && !v.cruise.on) this.notify('hud.msg.cruiseNA', 'warn');
        break;
      case 'cruiseUp':
        v.adjustCruise(5);
        break;
      case 'cruiseDown':
        v.adjustCruise(-5);
        break;
      case 'handbrakeToggle':
        v.setHandbrake(!v.handbrake);
        break;
      case 'pause':
      case 'info':
        break;
    }
  }

  toggleDoors(): void {
    const v = this.vehicle;
    const next = !v.doorsOpen;
    if (!v.setDoors(next)) {
      this.notify('hud.msg.stopFirst', 'warn');
      return;
    }
    this.o.audio.doorSound(next);
    if (next && Math.abs(v.speed) > 0.3) this.o.plan.manifest.satisfactionEvent('doorsMoving');
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.o.input.setEnabled(!p);
  }

  /** Player gives up: passengers are refunded partially by settle(). */
  abandon(): TripSummary {
    return this.finish('abandoned');
  }

  // ------------------------------------------------------------ main loop

  update(rawDt: number, nowMs: number): void {
    if (this.disposed) return;
    const dt = Math.min(rawDt, 0.1);
    if (this.phase !== 'driving' || this.paused) {
      this.updateVisuals(0, false, nowMs);
      return;
    }
    const input = this.o.input;
    input.update(dt, this.vehicle.speed);
    this.vehicle.hornOn = input.horn;
    this.o.audio.hornOn(input.horn);
    this.o.camera.lookYaw = input.lookYaw;
    this.o.camera.lookPitch = input.lookPitch;
    if (input.handbrake) this.vehicle.handbrake = true;
    else if (this.handbrakeHeld) this.vehicle.handbrake = false; // Space released
    this.handbrakeHeld = input.handbrake;

    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < 6) {
      this.physicsStep(FIXED_DT);
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps === 6) this.acc = 0;
    this.elapsed += dt;
    this.blinkClock += dt;
    this.gameplay(dt);
    this.updateVisuals(dt, false, nowMs);
  }

  private handbrakeHeld = false;
  private lastSpeed = 0;

  private physicsStep(dt: number): void {
    const v = this.vehicle;
    const input = this.o.input;
    this.surface.grade = this.world.path.grade(this.s);
    this.surface.gripMul = (this.surface.offRoad ? 0.45 : 1) * this.weatherGrip;
    v.step(dt, { throttle: input.throttle, brake: input.brake, steer: input.steer, doorsOpen: v.doorsOpen, sensitivity: 1 }, this.surface);
    // locate on the road
    const pr = this.world.path.project(v.x, v.z, this.hint);
    this.s = pr.s;
    this.d = pr.d;
    this.hint = pr.s;
    v.y = pr.y;
    this.collideStatics();
  }

  private lim(): { left: number; right: number; paved: number } {
    return drivableLimits(this.o.plan.route.profile, this.o.plan.route.stops, this.s);
  }

  /** Road edges, median barrier, scenery and the road ends. */
  private collideStatics(): void {
    const v = this.vehicle;
    const route = this.o.plan.route;
    const half = v.spec.width / 2;
    const lim = this.lim();
    // off-road = body edge beyond the drivable surface
    this.surface.offRoad = this.d + half * 0.8 > lim.right + 0.3 || this.d - half * 0.8 < lim.left - 0.3;
    // median barrier
    if (route.profile.median > 0) {
      const mh = route.profile.median / 2;
      if (Math.abs(this.d) < mh + half * 0.6 && Math.abs(this.d) > 0) {
        const side = this.d >= 0 ? 1 : -1;
        const need = mh + half * 0.6 - Math.abs(this.d);
        this.pushLateral(side * need);
        this.hit(Math.abs(v.speed) * 0.8, 'barrier');
      }
    }
    // road ends
    if (this.s <= 6 && v.speed < 0) {
      v.speed = 0;
    }
    if (this.s >= route.playLengthM - 6 && v.speed > 0) {
      v.speed = 0;
    }
    // roadside scenery
    const items = this.world.scenery.obstaclesNear(this.s, 40);
    if (items.length) {
      const fx = Math.sin(v.heading);
      const fz = Math.cos(v.heading);
      const pts = [-0.34, 0, 0.34].map((k) => ({ x: v.x + fx * v.spec.length * k, z: v.z + fz * v.spec.length * k }));
      for (const it of items) {
        const lp = this.world.path.lanePos(it.s, it.d);
        const r = (it.kind === 'building' ? Math.min(it.w, it.depth) / 2 : it.radius) + half * 0.85;
        for (const p of pts) {
          const dx = p.x - lp.x;
          const dz = p.z - lp.z;
          if (dx * dx + dz * dz < r * r) {
            const dist = Math.hypot(dx, dz) || 1;
            // push the bus out and bleed speed
            v.x += (dx / dist) * (r - dist);
            v.z += (dz / dist) * (r - dist);
            this.hit(Math.abs(v.speed), it.kind);
            // a solid obstacle stops the bus (it can still reverse away)
            if (Math.abs(v.speed) > 0.8) v.speed = Math.sign(v.speed) * 0.8;
            break;
          }
        }
      }
    }
  }

  private pushLateral(dd: number): void {
    // lateral + = right = (-cos h, sin h) of the *path* heading
    const h = this.world.path.at(this.s).h;
    this.vehicle.x += -Math.cos(h) * dd;
    this.vehicle.z += Math.sin(h) * dd;
    this.d += dd;
  }

  /** last impact (for tests/diagnostics) */
  lastHit: { what: string; rel: number; s: number } | null = null;

  private hit(rel: number, what: string): void {
    const v = this.vehicle;
    if (rel < 1.5) return;
    this.lastHit = { what, rel: +rel.toFixed(1), s: Math.round(this.s) };
    const dmg = v.applyImpact(rel, what === 'barrier' ? 0.6 : 1);
    if (dmg > 0) {
      this.o.plan.manifest.satisfactionEvent('collision', clamp(rel / 12, 0.3, 1.5));
      this.o.audio.crash(clamp(rel / 15, 0.2, 1));
      this.o.audio.vibrate(120);
      this.o.camera.addShake(clamp(rel / 14, 0.2, 1));
      this.notify('hud.msg.collision', 'error');
    }
  }

  // ------------------------------------------------------------ gameplay rules

  private gameplay(dt: number): void {
    const { plan } = this.o;
    const route = plan.route;
    const v = this.vehicle;
    const man = plan.manifest;
    const speedKmh = Math.abs(v.speedKmh);

    // speed limit
    this.currentLimit = this.limitAt(this.s);
    if (speedKmh > this.currentLimit + 6) {
      this.speedingAcc += dt;
      if (this.speedingAcc > 3) {
        this.speedingAcc = 0;
        man.satisfactionEvent('speeding');
      }
    } else this.speedingAcc = 0;

    // radars (fine once per radar when passing in direction of travel)
    route.radars.forEach((r, i) => {
      if (this.radarDone.has(i)) return;
      if (this.s >= r.s) {
        this.radarDone.add(i);
        if (v.speed > 1 && Math.abs(this.s - r.s) < 40) {
          const over = speedKmh - r.limit;
          this.world.flashRadar(i, performance.now());
          if (over > 4) {
            const fine = Math.round(RADAR_FINE_BASE + over * RADAR_FINE_PER_KMH);
            this.fines += fine;
            man.satisfactionEvent('speeding', 2);
            this.notify('hud.msg.radarFine', 'error', { amount: fine, speed: Math.round(speedKmh) });
            this.o.audio.ui('error');
          } else this.notify('hud.msg.radarOk', 'success');
        }
      }
    });

    // traffic lights
    route.trafficLights.forEach((ls, i) => {
      const ph = lightPhaseAt(i, this.trafficTime);
      if (this.lightState[i] !== ph) {
        this.lightState[i] = ph;
        this.world.setLightState(i, ph);
      }
      const side = this.s - ls;
      const prev = this.prevLightSide.get(i);
      this.prevLightSide.set(i, side);
      if (prev !== undefined && prev < 0 && side >= 0 && !this.redLightDone.has(i) && v.speed > 1) {
        this.redLightDone.add(i);
        if (ph === 'red') {
          this.fines += RED_LIGHT_FINE;
          man.satisfactionEvent('redLight');
          this.notify('hud.msg.redLight', 'error', { amount: RED_LIGHT_FINE });
          this.o.audio.ui('error');
        }
      }
      if (prev !== undefined && side < -2) this.redLightDone.delete(i);
    });

    // comfort / harsh driving
    this.hardBrakeCd = Math.max(0, this.hardBrakeCd - dt);
    this.cornerCd = Math.max(0, this.cornerCd - dt);
    if (v.longAccel < -5.5 && speedKmh > 20 && this.hardBrakeCd === 0) {
      man.satisfactionEvent('hardBrake');
      this.hardBrakeCd = 2.5;
    }
    if (Math.abs(v.latAccel) > 3.8 && speedKmh > 20 && this.cornerCd === 0) {
      man.satisfactionEvent('hardCorner');
      this.cornerCd = 3;
    }
    if (speedKmh > 15 && Math.abs(v.longAccel) < 1.2 && Math.abs(v.latAccel) < 1.5 && !this.surface.offRoad) {
      this.smoothAcc += dt;
      if (this.smoothAcc > 12) {
        this.smoothAcc = 0;
        man.satisfactionEvent('smooth');
      }
    }
    this.offRoadCd = Math.max(0, this.offRoadCd - dt);
    if (this.surface.offRoad && speedKmh > 10 && this.offRoadCd === 0) {
      man.satisfactionEvent('offRoad');
      this.offRoadCd = 3;
      this.notify('hud.msg.offRoad', 'warn');
    }

    // stops
    this.stopLogic(dt);

    // lateness
    const expected = route.expectedDriveSeconds + route.stops.length * STOP_DWELL_SECONDS;
    if (this.elapsed > expected * 1.25) {
      this.lateSeconds = this.elapsed - expected * 1.25;
      if (!this.lateFlagged) {
        this.lateFlagged = true;
        man.satisfactionEvent('late');
        this.notify('hud.msg.late', 'warn');
      }
    }

    // out of fuel / wrecked
    if (v.stalled === 'fuel' && Math.abs(v.speed) < 0.4) {
      this.fuelOutTimer += dt;
      if (this.fuelOutTimer > 3) {
        this.finish('outOfFuel');
        return;
      }
    }
    if (v.damage >= 100) {
      this.finish('wrecked');
      return;
    }
    if (v.fuelFraction < 0.1 && !this.lowFuelWarned) {
      this.lowFuelWarned = true;
      this.notify('hud.msg.lowFuel', 'warn');
    }
    this.syncExtraMass();
  }

  private lowFuelWarned = false;
  private trafficTime = 0;

  private limitAt(s: number): number {
    let lim = this.o.plan.route.highway ? 100 : 70;
    for (const z of this.o.plan.route.speedZones) if (s >= z.from && s <= z.to) lim = Math.min(lim, z.limit);
    return lim;
  }

  private stopLogic(dt: number): void {
    const { plan, ctx } = this.o;
    const route = plan.route;
    const man = plan.manifest;
    const v = this.vehicle;
    const settings = ctx.state.settings;
    this.prompt = null;
    this.nextStopCache = this.nextStop();

    if (this.servingStop) {
      const stop = this.servingStop;
      const isLast = stop.id === route.stops[route.stops.length - 1].id;
      // wander off => cancel serving
      if (Math.abs(this.s - stop.s) > STOP_ZONE_HALF + 6 || Math.abs(v.speed) > 1.2) {
        if (!v.doorsOpen) {
          // left without finishing
          man.finishStop();
          this.servingStop = null;
          return;
        }
      }
      if (!v.doorsOpen) {
        if (this.serviceDone) {
          // finished: all done, doors closed
          man.finishStop();
          this.servingStop = null;
          this.serviceDone = false;
          if (isLast) {
            this.finish('completed');
          } else {
            this.notify('hud.msg.stopDone', 'success');
          }
        } else {
          this.prompt = 'hud.prompt.openDoors';
          if (settings.autoDoors) this.toggleDoors();
        }
        return;
      }
      // doors open: board/alight
      if (!this.serviceDone) {
        const r = man.step(dt);
        if (r.boarded || r.alighted) this.o.audio.tick(false);
        if (r.done) {
          this.serviceDone = true;
          this.serviceDoneAt = this.elapsed;
        }
        this.prompt = 'hud.prompt.boarding';
      } else {
        this.prompt = 'hud.prompt.closeDoors';
        if (settings.autoDoors && this.elapsed - this.serviceDoneAt > 1.2) this.toggleDoors();
      }
      return;
    }

    // look for a stop to serve
    for (const stop of route.stops) {
      if (man.hasServedStop(stop.id)) continue;
      const lat = bayParkOffset(route.profile);
      const inZone = Math.abs(this.s - stop.s) < STOP_ZONE_HALF && Math.abs(this.d - lat) < 2.6;
      if (!inZone) continue;
      if (Math.abs(v.speed) < 0.5) {
        const isLast = stop.id === route.stops[route.stops.length - 1].id;
        this.servingStop = stop;
        this.serviceDone = false;
        man.arriveAtStop(stop, isLast);
        this.notify(stop.kind === 'terminal' ? 'hud.msg.arrivedTerminal' : 'hud.msg.arrivedStop', 'success');
        return;
      }
      this.prompt = 'hud.prompt.stopHere';
    }

    // passed a rest stop without serving it
    for (const stop of route.stops) {
      if (stop.kind !== 'rest' || man.hasServedStop(stop.id)) continue;
      if (this.s > stop.s + 70) {
        man.skipStop(stop.id);
        man.satisfactionEvent('missedStop');
        this.notify('hud.msg.missedStop', 'error');
      }
    }
  }

  private serviceDoneAt = 0;

  private nextStop(): StopDef | null {
    const man = this.o.plan.manifest;
    const stops = this.o.plan.route.stops;
    for (const st of stops) if (!man.hasServedStop(st.id) && this.s < st.s + 70) return st;
    return null;
  }

  // ------------------------------------------------------------ visuals

  private makeTarget(): CameraTarget {
    const v = this.vehicle;
    this.rig.eyeWorld(this.tmpEye);
    return { x: v.x, y: v.y, z: v.z, heading: v.heading, speed: v.speed, length: v.spec.length, height: v.spec.height, eye: this.tmpEye, yawRate: v.yawRate };
  }

  private updateVisuals(dt: number, first: boolean, nowMs = 0): void {
    const v = this.vehicle;
    const { plan, audio, camera, quality } = this.o;
    const rainy = plan.weather === 'rain';
    // game time
    const gameSec = plan.hour * 3600 + this.elapsed * GAME_TIME_SCALE;
    const hour = (gameSec / 3600) % 24;
    this.trafficTime += dt;
    this.env.setTime(hour);

    // bus pose
    const brake = this.o.input.brake > 0.05 || v.brakeApplied > 0.1;
    this.rig.pose({ x: v.x, y: v.y, z: v.z, heading: v.heading, roll: v.roll, pitch: v.pitch, wheelAngle: v.wheelAngle, steerAngle: v.steerAngle, doorProgress: v.doorProgress });
    const blinkOn = Math.floor(this.blinkClock * 3) % 2 === 0;
    this.rig.setLights(v.lights, brake, v.gear === 'R' && v.engineOn, blinkOn, this.env.night, v.engineOn);
    this.rig.setWipers(v.lights.wipers, this.blinkClock);
    if ((v.lights.left || v.lights.right || v.lights.hazard) && blinkOn !== this.lastBlink && v.engineOn) audio.tick(blinkOn);
    this.lastBlink = blinkOn;
    const occ = Math.min(quality.maxVisiblePassengers, plan.manifest.onboard);
    const occShown = Math.min(this.seatCap, plan.manifest.onboard);
    if (occShown !== this.lastOccupancy) {
      this.rig.setOccupancy(occShown);
      this.lastOccupancy = occShown;
    }
    void occ;
    this.clusterTimer -= dt;
    if (this.clusterTimer <= 0) {
      this.clusterTimer = 0.1;
      this.rig.updateCluster(v.speedKmh, v.rpm, v.fuelFraction, v.gear, v.spec.electric, v.fuelFraction < 0.1 || v.damage > 70);
    }

    // traffic
    if (!first && dt > 0) {
      const frame = this.traffic.update(dt, { x: v.x, z: v.z, heading: v.heading, length: v.spec.length, width: v.spec.width, speed: v.speed, s: this.s, d: this.d }, 1);
      for (const c of frame.collisions) {
        this.hit(c.relSpeed, 'traffic');
        v.x += c.nx * 0.35;
        v.z += c.nz * 0.35;
      }
      this.tailAcc = frame.tailgating ? this.tailAcc + dt : 0;
      if (this.tailAcc > 4) {
        this.tailAcc = 0;
        plan.manifest.satisfactionEvent('tailgating');
        this.notify('hud.msg.tailgating', 'warn');
      }
      this.tailgating = frame.tailgating;
      this.ambulance = frame.ambulanceBehind;
      if (frame.ambulanceBehind && !this.ambulanceAlerted) {
        this.ambulanceAlerted = true;
        this.notify('hud.msg.ambulance', 'warn');
      }
      if (!frame.ambulanceBehind) this.ambulanceAlerted = false;
    }

    // environment + world
    this.world.update(this.s, new THREE.Vector3(v.x, v.y, v.z), this.env.night, nowMs);
    this.cameraTarget = this.makeTarget();
    camera.update(dt || 0.016, this.cameraTarget, quality.viewDistance);
    this.env.setSkyRadius(camera.camera.far * 0.9);
    this.env.update(dt || 0.016, new THREE.Vector3(v.x, v.y, v.z), camera.camera.position, rainy ? 0.2 : 0);
    if (this.rearCamOn) this.rear.update(this.cameraTarget);

    // audio
    audio.update({
      engineOn: v.engineOn,
      rpm: v.rpm,
      throttle: v.throttleSmooth,
      speed: Math.abs(v.speed),
      brake: v.brakeApplied,
      slip: v.slip,
      rain: plan.weather === 'rain' ? 1 : 0,
      offRoad: this.surface.offRoad,
      electric: v.spec.electric,
      atTerminal: !!this.servingStop,
      engineVolumeScale: camera.mode === 'cockpit' ? 0.7 : 1,
    });
    this.lastSpeed = v.speed;
  }

  private lastBlink = false;
  private tailgating = false;
  private ambulance = false;

  // ------------------------------------------------------------ results

  /** Settles the trip economically. Idempotent. */
  finish(status: TripOutcome['status']): TripSummary {
    if (this.summary) return this.summary;
    const v = this.vehicle;
    const outcome: TripOutcome = {
      status,
      durationSec: this.elapsed,
      endFuel: v.fuel,
      damageDelta: Math.max(0, v.damage - this.damageStart),
      fines: this.fines,
      lateSeconds: Math.round(this.lateSeconds),
    };
    this.resultOutcome = outcome;
    this.summary = this.o.ctx.trips.settle(this.o.plan, outcome);
    this.phase = 'finished';
    v.setGear('P');
    v.handbrake = true;
    this.o.input.reset();
    this.o.audio.hornOn(false);
    return this.summary;
  }

  hud(): HudData {
    const { plan } = this.o;
    const route = plan.route;
    const v = this.vehicle;
    const man = plan.manifest;
    const ns = this.nextStopCache;
    const gameSec = plan.hour * 3600 + this.elapsed * GAME_TIME_SCALE;
    const hh = Math.floor(gameSec / 3600) % 24;
    const mm = Math.floor((gameSec % 3600) / 60);
    const expected = route.expectedDriveSeconds + route.stops.length * STOP_DWELL_SECONDS;
    // nearest upcoming light within 80 m
    let tl: HudData['trafficLight'] = null;
    for (let i = 0; i < route.trafficLights.length; i++) {
      const dd = route.trafficLights[i] - this.s;
      if (dd > -2 && dd < 90) tl = this.lightState[i] ?? 'green';
    }
    const inZone = !!ns && Math.abs(this.s - ns.s) < STOP_ZONE_HALF;
    const hud: HudData = {
      speedKmh: Math.abs(v.speedKmh),
      rpm: v.rpm,
      gear: v.gear,
      fuelFrac: v.fuelFraction,
      fuelLow: v.fuelFraction < 0.12,
      limitKmh: this.currentLimit,
      speeding: Math.abs(v.speedKmh) > this.currentLimit + 3,
      engineOn: v.engineOn,
      handbrake: v.handbrake,
      doorsOpen: v.doorsOpen,
      cruiseOn: v.cruise.on,
      cruiseKmh: v.cruise.target * 3.6,
      lights: v.lights.head,
      left: v.lights.left,
      right: v.lights.right,
      hazard: v.lights.hazard,
      wipers: v.lights.wipers,
      damage: v.damage,
      progress: clamp(this.s / route.playLengthM, 0, 1),
      nextStopKey: ns ? ns.nameKey : null,
      nextStopId: ns ? ns.id : null,
      nextStopDist: ns ? Math.max(0, ns.s - this.s) : 0,
      nextStopKind: ns ? ns.kind : null,
      onboard: man.onboard,
      seats: man.seats,
      waiting: man.waitingCount,
      satisfaction: man.satisfaction,
      fines: this.fines,
      clock: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
      elapsed: this.elapsed,
      expected,
      late: this.lateFlagged,
      weather: plan.weather,
      prompt: this.prompt,
      inStopZone: inZone,
      stopped: Math.abs(v.speed) < 0.5,
      trafficLight: tl,
      ambulance: this.ambulance,
      tailgating: this.tailgating,
      camera: this.o.camera.mode,
      offRoad: this.surface.offRoad,
      blinkOn: Math.floor(this.blinkClock * 3) % 2 === 0,
      lastMessage: this.msgs,
      paused: this.paused,
    };
    this.lastHud = hud;
    return hud;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubInput();
    this.o.audio.hornOn(false);
    this.o.scene.remove(this.world.group, this.rig.group, this.traffic.group);
    this.traffic.dispose();
    this.rig.dispose();
    this.world.dispose();
    this.env.dispose();
    void this.resultOutcome;
    void this.lastHud;
    void BAY_WIDTH;
  }
}
