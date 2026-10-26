import * as THREE from 'three';
import { clamp, lerp } from '../core/utils';

export type CameraMode = 'chase' | 'far' | 'cockpit' | 'bumper' | 'orbit';
export const CAMERA_ORDER: CameraMode[] = ['chase', 'far', 'cockpit', 'bumper', 'orbit'];

export interface CameraTarget {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  length: number;
  height: number;
  /** eye position in world space (for cockpit) */
  eye: THREE.Vector3;
  yawRate: number;
}

/**
 * Chase / far / cockpit / bumper / orbit cameras with smoothing, speed-based FOV and a
 * controlled shake. Behaviour is frame-rate independent (exponential smoothing).
 */
export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private initialised = false;
  private shake = 0;
  private time = 0;
  orbitYaw = 0.6;
  orbitPitch = 0.25;
  orbitDist = 16;
  shakeEnabled = true;
  /** extra look offsets from the input manager */
  lookYaw = 0;
  lookPitch = 0;
  private lagHeading = 0;
  private tmp = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.15, 1500);
  }

  setMode(m: CameraMode): void {
    this.mode = m;
    this.initialised = false;
  }

  cycle(): CameraMode {
    const i = CAMERA_ORDER.indexOf(this.mode);
    this.setMode(CAMERA_ORDER[(i + 1) % CAMERA_ORDER.length]);
    return this.mode;
  }

  setAspect(a: number): void {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  addShake(amount: number): void {
    if (this.shakeEnabled) this.shake = Math.min(1.2, this.shake + amount);
  }

  snap(): void {
    this.initialised = false;
  }

  update(dt: number, t: CameraTarget, viewDistance: number): void {
    this.time += dt;
    const fwdX = Math.sin(t.heading);
    const fwdZ = Math.cos(t.heading);
    const speedAbs = Math.abs(t.speed);
    const k = (rate: number) => 1 - Math.exp(-rate * dt);
    if (!this.initialised) this.lagHeading = t.heading;
    // heading lag gives a sense of rotation in curves
    let dh = t.heading - this.lagHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.lagHeading += dh * k(this.mode === 'far' ? 3.2 : 4.2);
    const lh = this.lagHeading;

    let desiredPos: THREE.Vector3;
    let desiredLook: THREE.Vector3;
    let fov = 60;
    let posRate = 8;
    switch (this.mode) {
      case 'chase': {
        const back = t.length * 0.5 + 7.5;
        desiredPos = this.tmp.set(t.x - Math.sin(lh) * back, t.y + t.height + 2.6, t.z - Math.cos(lh) * back);
        desiredLook = new THREE.Vector3(t.x + fwdX * 14, t.y + t.height * 0.55, t.z + fwdZ * 14);
        fov = 60 + clamp(speedAbs * 0.18, 0, 12);
        posRate = 9;
        break;
      }
      case 'far': {
        const back = t.length * 0.5 + 15;
        desiredPos = this.tmp.set(t.x - Math.sin(lh) * back, t.y + t.height + 7, t.z - Math.cos(lh) * back);
        desiredLook = new THREE.Vector3(t.x + fwdX * 10, t.y + t.height * 0.4, t.z + fwdZ * 10);
        fov = 58 + clamp(speedAbs * 0.12, 0, 8);
        posRate = 6;
        break;
      }
      case 'cockpit': {
        desiredPos = this.tmp.copy(t.eye);
        const yaw = t.heading + this.lookYaw;
        const pitch = -0.04 + this.lookPitch;
        desiredLook = new THREE.Vector3(t.eye.x + Math.sin(yaw) * Math.cos(pitch) * 10, t.eye.y + Math.sin(pitch) * 10, t.eye.z + Math.cos(yaw) * Math.cos(pitch) * 10);
        fov = 72 + clamp(speedAbs * 0.12, 0, 8);
        posRate = 60;
        break;
      }
      case 'bumper': {
        desiredPos = this.tmp.set(t.x + fwdX * (t.length / 2 + 0.6), t.y + 1.0, t.z + fwdZ * (t.length / 2 + 0.6));
        desiredLook = new THREE.Vector3(t.x + fwdX * 30, t.y + 1.2, t.z + fwdZ * 30);
        fov = 70 + clamp(speedAbs * 0.2, 0, 10);
        posRate = 40;
        break;
      }
      case 'orbit':
      default: {
        const yaw = t.heading + this.orbitYaw + this.lookYaw;
        const pitch = clamp(this.orbitPitch + this.lookPitch, 0.02, 1.2);
        const r = this.orbitDist + t.length * 0.4;
        desiredPos = this.tmp.set(t.x - Math.sin(yaw) * Math.cos(pitch) * r, t.y + Math.sin(pitch) * r + 1, t.z - Math.cos(yaw) * Math.cos(pitch) * r);
        desiredLook = new THREE.Vector3(t.x, t.y + t.height * 0.5, t.z);
        fov = 55;
        posRate = 12;
      }
    }
    if (!this.initialised) {
      this.pos.copy(desiredPos);
      this.look.copy(desiredLook);
      this.initialised = true;
    } else {
      this.pos.lerp(desiredPos, k(posRate));
      this.look.lerp(desiredLook, k(posRate * 1.3));
    }
    this.camera.position.copy(this.pos);
    // shake: speed-dependent micro vibration + impact decay
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const micro = this.shakeEnabled ? clamp(speedAbs / 60, 0, 1) * 0.008 : 0;
    const amp = this.shake * 0.12 + micro;
    if (amp > 0) {
      this.camera.position.x += Math.sin(this.time * 61) * amp;
      this.camera.position.y += Math.sin(this.time * 73 + 1.3) * amp;
      this.camera.position.z += Math.cos(this.time * 57) * amp;
    }
    this.camera.lookAt(this.look);
    if (this.mode === 'cockpit') this.camera.rotateZ(-t.yawRate * 0.01);
    this.camera.fov = lerp(this.camera.fov, fov, k(3));
    this.camera.far = Math.max(600, viewDistance + 300);
    this.camera.updateProjectionMatrix();
  }
}

/** Small rear-view camera rendered picture-in-picture. */
export class RearViewCamera {
  readonly camera = new THREE.PerspectiveCamera(65, 3, 0.3, 500);
  update(t: CameraTarget): void {
    const back = -t.length / 2 - 0.5;
    this.camera.position.set(t.x + Math.sin(t.heading) * back, t.y + t.height * 0.7, t.z + Math.cos(t.heading) * back);
    this.camera.lookAt(t.x - Math.sin(t.heading) * 40, t.y + 1.5, t.z - Math.cos(t.heading) * 40);
  }
}
