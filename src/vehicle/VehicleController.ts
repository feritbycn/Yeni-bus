import type { Gear } from '../core/types';
import { ROUTE_SCALE } from '../data/constants';
import { clamp, lerp } from '../core/utils';

export const G = 9.81;
/** Physics runs on a fixed step so behaviour does not depend on the frame rate. */
export const FIXED_DT = 1 / 60;

export interface VehicleSpec {
  massKg: number;
  powerKw: number;
  maxSpeedKmh: number;
  length: number;
  width: number;
  height: number;
  /** relative tyre grip (about 0.85 .. 1.2) */
  grip: number;
  /** L/100km or kWh/100km (logical distance) */
  consumptionPer100: number;
  tankCapacity: number;
  electric: boolean;
}

export interface Surface {
  /** rise/run along the heading */
  grade: number;
  /** 1 = dry asphalt, 0.68 = wet, lower off-road */
  gripMul: number;
  offRoad: boolean;
}

export interface DriveInput {
  throttle: number;
  brake: number;
  /** -1 (left) .. +1 (right) */
  steer: number;
  doorsOpen: boolean;
  sensitivity?: number;
}

export interface LightState {
  head: 0 | 1 | 2;
  hazard: boolean;
  left: boolean;
  right: boolean;
  wipers: 0 | 1 | 2;
  interior: boolean;
}

export interface CruiseState {
  on: boolean;
  /** m/s */
  target: number;
  integral: number;
}

const GEAR_TOPS = [0.1, 0.22, 0.36, 0.52, 0.72, 1.0];

export class VehicleController {
  x = 0;
  y = 0;
  z = 0;
  heading = 0;
  /** signed speed along the heading, m/s */
  speed = 0;
  yawRate = 0;
  /** steering angle, + = left */
  steerAngle = 0;
  roll = 0;
  pitch = 0;
  wheelAngle = 0;
  rpm = 0;
  throttleSmooth = 0;
  brakeApplied = 0;
  slip = 0;
  gear: Gear = 'P';
  engineOn = false;
  handbrake = true;
  fuel: number;
  damage: number;
  odometerM = 0;
  extraMassKg = 0;
  doorsOpen = false;
  /** 0 closed .. 1 open (animation) */
  doorProgress = 0;
  lights: LightState = { head: 0, hazard: false, left: false, right: false, wipers: 0, interior: false };
  cruise: CruiseState = { on: false, target: 0, integral: 0 };
  stalled: 'fuel' | null = null;
  longAccel = 0;
  latAccel = 0;
  impactCooldown = 0;
  impacts = 0;
  hornOn = false;
  currentGearIndex = 0;

  constructor(
    public spec: VehicleSpec,
    fuel: number,
    damage: number,
  ) {
    this.fuel = fuel;
    this.damage = damage;
  }

  get speedKmh(): number {
    return this.speed * 3.6;
  }

  get maxSpeedMs(): number {
    return (this.spec.maxSpeedKmh / 3.6) * (1 - this.damage / 400);
  }

  get wheelbase(): number {
    return this.spec.length * 0.58;
  }

  get fuelFraction(): number {
    return this.spec.tankCapacity > 0 ? this.fuel / this.spec.tankCapacity : 0;
  }

  placeAt(x: number, y: number, z: number, heading: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.yawRate = 0;
  }

  // ---------------- controls ----------------

  toggleEngine(): boolean {
    if (this.engineOn) {
      this.engineOn = false;
      this.cruise.on = false;
      return true;
    }
    if (this.fuel <= 0) return false;
    this.engineOn = true;
    this.stalled = null;
    return true;
  }

  /** Auto-gearbox selector rules (P/R/N/D). Returns false if refused. */
  setGear(g: Gear): boolean {
    const v = Math.abs(this.speed);
    if (g === this.gear) return true;
    if (g === 'P' && v > 0.6) return false;
    if ((g === 'R' || g === 'D') && v > 1.6) return false;
    this.gear = g;
    if (g === 'P') this.cruise.on = false;
    return true;
  }

  setHandbrake(on: boolean): void {
    this.handbrake = on;
    if (on) this.cruise.on = false;
  }

  toggleCruise(): boolean {
    if (this.cruise.on) {
      this.cruise.on = false;
      return false;
    }
    if (this.gear !== 'D' || !this.engineOn || this.speed < 8 / 3.6) return false;
    this.cruise = { on: true, target: this.speed, integral: this.throttleSmooth };
    return true;
  }

  adjustCruise(deltaKmh: number): void {
    if (this.cruise.on) this.cruise.target = clamp(this.cruise.target + deltaKmh / 3.6, 8 / 3.6, this.maxSpeedMs);
  }

  setDoors(open: boolean): boolean {
    if (open && Math.abs(this.speed) > 1.5) return false;
    this.doorsOpen = open;
    return true;
  }

  // ---------------- collision ----------------

  /** Returns damage points applied (0 if still in cooldown). */
  applyImpact(relativeSpeed: number, strength = 1): number {
    if (this.impactCooldown > 0) return 0;
    this.impactCooldown = 0.8;
    this.impacts += 1;
    const dmg = clamp(relativeSpeed * relativeSpeed * 0.06 * strength, 0.2, 35);
    this.damage = clamp(this.damage + dmg, 0, 100);
    this.speed *= 0.3;
    return dmg;
  }

  // ---------------- simulation ----------------

  step(dt: number, input: DriveInput, surf: Surface): void {
    const spec = this.spec;
    const mass = spec.massKg + this.extraMassKg;
    const v = this.speed;
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);

    // doors animation
    const doorTarget = this.doorsOpen ? 1 : 0;
    this.doorProgress += clamp(doorTarget - this.doorProgress, -dt * 1.4, dt * 1.4);

    let throttle = clamp(input.throttle, 0, 1);
    let brake = clamp(input.brake, 0, 1);

    // cruise control (PI)
    if (this.cruise.on) {
      if (brake > 0.15 || this.gear !== 'D' || !this.engineOn || this.handbrake) {
        this.cruise.on = false;
      } else {
        const err = this.cruise.target - v;
        this.cruise.integral = clamp(this.cruise.integral + err * dt * 0.08, 0, 0.8);
        throttle = clamp(err * 0.3 + this.cruise.integral, 0, 1);
        if (err < -2.5) brake = clamp((-err - 2.5) * 0.08, 0, 0.35);
      }
    }

    const drivable = this.engineOn && this.fuel > 0 && !input.doorsOpen && !this.doorsOpen && (this.gear === 'D' || this.gear === 'R');
    if (!drivable) throttle = 0;
    this.throttleSmooth += clamp(throttle - this.throttleSmooth, -dt * 4, dt * 2.6);
    this.brakeApplied += clamp(brake - this.brakeApplied, -dt * 6, dt * 5);

    // ---- longitudinal forces ----
    const power = spec.powerKw * 1000 * 0.82;
    const fCap = (spec.electric ? 0.24 : 0.2) * mass * G;
    let fDrive = 0;
    const vmax = this.maxSpeedMs;
    if (drivable) {
      const sgn = this.gear === 'R' ? -1 : 1;
      const along = v * sgn;
      const fp = Math.min(power / Math.max(Math.abs(along), spec.electric ? 3 : 2.2), fCap);
      const limiter = this.gear === 'R' ? clamp((4 - along) / 1.5, 0, 1) : clamp((vmax - along) / (vmax * 0.05), 0, 1);
      fDrive = sgn * fp * this.throttleSmooth * limiter;
    }
    const gripNow = 0.42 * mass * G * surf.gripMul * (0.85 + spec.grip * 0.15);
    let fBrake = this.brakeApplied * gripNow;
    if (this.handbrake) fBrake += 0.35 * mass * G * (Math.abs(v) > 0.2 ? 0.7 : 1);
    if (drivable && this.throttleSmooth < 0.03) fBrake += (spec.electric ? 0.035 : 0.02) * mass * G;
    if (!this.engineOn) fBrake += 0.01 * mass * G;
    const area = spec.width * spec.height * 0.9;
    const fDrag = 0.5 * 1.2 * 0.65 * area * v * v;
    const fRoll = 0.009 * mass * G * (surf.offRoad ? 5 : 1);
    const fGrade = mass * G * Math.sin(Math.atan(surf.grade));

    let nv = v + ((fDrive - fGrade) / mass) * dt;
    const dec = ((fDrag + fRoll + fBrake) / mass) * dt;
    if (Math.abs(nv) <= dec) nv = 0;
    else nv -= Math.sign(nv) * dec;
    // parked / held on a slope
    if ((this.gear === 'P' || this.handbrake) && Math.abs(nv) < 0.35 && throttle < 0.05) nv = 0;
    if (this.gear === 'P' && Math.abs(nv) < 1.2) nv *= 0.5;

    // ---- lateral ----
    const maxSteer = lerp(0.6, 0.07, Math.pow(clamp(Math.abs(v) / 26, 0, 1), 0.65));
    const sens = input.sensitivity ?? 1;
    const target = -clamp(input.steer, -1, 1) * maxSteer * clamp(sens, 0.5, 1.5);
    const rate = Math.abs(target) > Math.abs(this.steerAngle) ? 1.6 : 2.4;
    this.steerAngle += clamp(target - this.steerAngle, -rate * dt, rate * dt);
    let yaw = (nv * Math.tan(this.steerAngle)) / this.wheelbase;
    const aMax = 0.72 * G * spec.grip * surf.gripMul;
    let slip = 0;
    const aLatDesired = Math.abs(nv * yaw);
    if (aLatDesired > aMax) {
      slip = aLatDesired / aMax - 1;
      yaw = Math.sign(yaw) * (aMax / Math.max(Math.abs(nv), 0.1));
      nv *= 1 - Math.min(0.5, slip * 0.35) * dt;
    }
    if (this.handbrake && Math.abs(nv) > 6) {
      slip += 0.5;
      yaw *= 1.2;
    }
    this.slip = lerp(this.slip, clamp(slip, 0, 1.5), 1 - Math.exp(-10 * dt));
    this.yawRate = lerp(this.yawRate, yaw, 1 - Math.exp(-9 * dt));

    // ---- integrate pose ----
    this.heading += this.yawRate * dt;
    this.x += Math.sin(this.heading) * nv * dt;
    this.z += Math.cos(this.heading) * nv * dt;
    this.longAccel = (nv - v) / dt;
    this.latAccel = nv * this.yawRate;
    this.speed = nv;
    const dist = Math.abs(nv) * dt;
    this.odometerM += dist;
    this.wheelAngle += (nv * dt) / 0.5;

    // ---- body motion (visual) ----
    const rollTarget = clamp(this.latAccel * 0.0095 * (spec.height / 3.3), -0.09, 0.09);
    this.roll += (rollTarget - this.roll) * (1 - Math.exp(-6 * dt));
    const pitchTarget = clamp(-this.longAccel * 0.005 + Math.atan(surf.grade) * -0.9, -0.08, 0.08);
    this.pitch += (pitchTarget - this.pitch) * (1 - Math.exp(-5 * dt));

    // ---- rpm / gearbox ----
    const ratio = clamp(Math.abs(nv) / Math.max(1, spec.maxSpeedKmh / 3.6), 0, 1);
    let gi = 0;
    while (gi < GEAR_TOPS.length - 1 && ratio > GEAR_TOPS[gi]) gi++;
    this.currentGearIndex = gi;
    let rpmTarget = 0;
    if (this.engineOn) {
      if (spec.electric) {
        rpmTarget = 300 + ratio * 11000 + this.throttleSmooth * 400;
      } else {
        const lo = gi === 0 ? 0 : GEAR_TOPS[gi - 1];
        const t = (ratio - lo) / (GEAR_TOPS[gi] - lo);
        rpmTarget = 650 + t * 1350 + this.throttleSmooth * 250;
      }
    }
    this.rpm = lerp(this.rpm, rpmTarget, 1 - Math.exp(-6 * dt));

    // ---- fuel / energy ----
    if (this.engineOn) {
      const slope = clamp(surf.grade * 10, 0, 0.8);
      const load = clamp(0.55 + 0.9 * this.throttleSmooth + slope - 0.25 * this.brakeApplied, 0.15, 2.2);
      const perM = (spec.consumptionPer100 / 100000) * ROUTE_SCALE * load * (1 + (this.extraMassKg / spec.massKg) * 0.3);
      const idle = (spec.electric ? 0.0004 : 0.0006) * dt;
      this.fuel -= dist * perM + idle;
      if (this.fuel <= 0) {
        this.fuel = 0;
        this.engineOn = false;
        this.stalled = 'fuel';
        this.cruise.on = false;
      }
    }
  }
}
