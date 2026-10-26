import { clamp } from '../core/utils';

export type DriveAction =
  | 'engine'
  | 'gearP'
  | 'gearR'
  | 'gearN'
  | 'gearD'
  | 'lights'
  | 'signalLeft'
  | 'signalRight'
  | 'hazard'
  | 'wipers'
  | 'doors'
  | 'camera'
  | 'rearCam'
  | 'cruise'
  | 'cruiseUp'
  | 'cruiseDown'
  | 'pause'
  | 'info'
  | 'handbrakeToggle'
  | 'interiorLight';

const KEY_ACTIONS: Record<string, DriveAction> = {
  KeyE: 'engine',
  Digit1: 'gearP',
  Digit2: 'gearR',
  Digit3: 'gearN',
  Digit4: 'gearD',
  KeyL: 'lights',
  KeyZ: 'signalLeft',
  KeyC: 'signalRight',
  KeyX: 'hazard',
  KeyK: 'wipers',
  KeyO: 'doors',
  Tab: 'camera',
  KeyB: 'rearCam',
  KeyM: 'cruise',
  Equal: 'cruiseUp',
  NumpadAdd: 'cruiseUp',
  Minus: 'cruiseDown',
  NumpadSubtract: 'cruiseDown',
  Escape: 'pause',
  KeyP: 'pause',
  KeyI: 'info',
  KeyJ: 'interiorLight',
  KeyF: 'handbrakeToggle',
};

/**
 * Keyboard, mouse and touch input collected into one analogue state.
 * Touch UI writes through `touch*` setters; keyboard uses smoothed steering.
 */
export class InputManager {
  throttle = 0;
  brake = 0;
  steer = 0;
  handbrake = false;
  horn = false;
  /** mouse / touch look offset (radians) for the cockpit camera */
  lookYaw = 0;
  lookPitch = 0;

  private keys = new Set<string>();
  /** keys pressed since the last update(): a tap shorter than one frame still counts */
  private tapped = new Set<string>();
  private touchThrottle = 0;
  private touchBrake = 0;
  private touchSteer: number | null = null;
  private steerSmooth = 0;
  private handlers: ((a: DriveAction) => void)[] = [];
  private enabled = true;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private bound = false;
  /** steering sensitivity multiplier 0.4 .. 1.6 */
  sensitivity = 1;

  constructor(private readonly target: HTMLElement | Window = window) {}

  onAction(cb: (a: DriveAction) => void): () => void {
    this.handlers.push(cb);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== cb);
    };
  }

  emit(a: DriveAction): void {
    if (!this.enabled) return;
    for (const h of this.handlers) h(a);
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.reset();
  }

  reset(): void {
    this.keys.clear();
    this.tapped.clear();
    this.touchThrottle = 0;
    this.touchBrake = 0;
    this.touchSteer = null;
    this.steerSmooth = 0;
    this.throttle = this.brake = this.steer = 0;
    this.handbrake = false;
    this.horn = false;
  }

  attach(): void {
    if (this.bound) return;
    this.bound = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
  }

  detach(): void {
    if (!this.bound) return;
    this.bound = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.isTyping(e)) return;
    if (!this.enabled) {
      if (e.code === 'Escape' || e.code === 'KeyP') for (const hd of this.handlers) hd('pause');
      return;
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    this.tapped.add(e.code);
    const a = KEY_ACTIONS[e.code];
    if (a) this.emit(a);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.dragging = false;
  };

  private onMouseDown = (e: MouseEvent): void => {
    if ((e.target as HTMLElement)?.tagName === 'CANVAS' && e.button === 0) {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  };
  private onMouseUp = (): void => {
    this.dragging = false;
  };
  private onMouseMove = (e: MouseEvent): void => {
    if (!this.dragging) return;
    this.lookYaw = clamp(this.lookYaw - (e.clientX - this.lastX) * 0.005, -2.4, 2.4);
    this.lookPitch = clamp(this.lookPitch - (e.clientY - this.lastY) * 0.004, -0.5, 0.6);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  // -------- touch UI hooks --------
  setTouchThrottle(v: number): void {
    this.touchThrottle = clamp(v, 0, 1);
  }
  setTouchBrake(v: number): void {
    this.touchBrake = clamp(v, 0, 1);
  }
  /** null = released (auto-centre) */
  setTouchSteer(v: number | null): void {
    this.touchSteer = v === null ? null : clamp(v, -1, 1);
  }
  setHandbrake(v: boolean): void {
    this.touchHandbrake = v;
  }
  touchHandbrake = false;
  touchHorn = false;
  setHorn(v: boolean): void {
    this.touchHorn = v;
  }

  resetLook(): void {
    this.lookYaw *= 0.9;
    this.lookPitch *= 0.9;
  }

  /** Call once per frame. */
  update(dt: number, speedMs: number): void {
    if (!this.enabled) {
      this.throttle = 0;
      this.brake = 0;
      this.steer = 0;
      this.horn = false;
      return;
    }
    const k = new Set([...this.keys, ...this.tapped]);
    this.tapped.clear();
    const up = k.has('KeyW') || k.has('ArrowUp');
    const down = k.has('KeyS') || k.has('ArrowDown');
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    this.throttle = Math.max(up ? 1 : 0, this.touchThrottle);
    this.brake = Math.max(down ? 1 : 0, this.touchBrake);
    this.handbrake = k.has('Space') || this.touchHandbrake;
    this.horn = k.has('KeyH') || this.touchHorn;

    // steering: analogue from touch, smoothed ramp from keys (speed-sensitive)
    let target = 0;
    if (this.touchSteer !== null) {
      this.steerSmooth += (this.touchSteer - this.steerSmooth) * clamp(dt * 14, 0, 1);
    } else {
      target = (right ? 1 : 0) - (left ? 1 : 0);
      const speedFactor = 1 / (1 + Math.abs(speedMs) / 14);
      const rate = target !== 0 && Math.sign(target) !== Math.sign(this.steerSmooth) && this.steerSmooth !== 0 ? 6 : target !== 0 ? 2.4 + speedFactor * 1.2 : 4.5;
      const diff = target - this.steerSmooth;
      this.steerSmooth += clamp(diff, -rate * dt, rate * dt);
    }
    this.steer = clamp(this.steerSmooth * this.sensitivity, -1, 1);
    if (!this.dragging) this.resetLook();
  }
}
