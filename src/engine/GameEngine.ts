import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameContext } from '../core/GameContext';
import type { AudioManager } from '../core/AudioManager';
import type { PerformanceManager, RenderQuality } from '../core/PerformanceManager';
import type { TripPlan } from '../systems/TripManager';
import type { WorldLabels } from '../world/RoadWorld';
import { BusRig, type BusLook, DEFAULT_LOOK } from '../vehicle/BusModel';
import { BUS_BY_ID } from '../data/buses';
import { loadShell, shellIfLoaded, shellPending } from '../vehicle/BusAssets';
import { CameraController } from './CameraController';
import { InputManager } from './InputManager';
import { DriveSession, type HudData } from './DriveSession';

export type EngineMode = 'idle' | 'showroom' | 'drive';

export interface EngineOptions {
  host: HTMLElement;
  ctx: GameContext;
  audio: AudioManager;
  perf: PerformanceManager;
  labels: () => WorldLabels;
}

/**
 * Owns the WebGL renderer, the render loop (fixed-step physics lives in DriveSession),
 * autosave, visibility handling and the garage/gallery showroom scene.
 */
export class GameEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly input: InputManager;
  readonly camera: CameraController;
  readonly canvas: HTMLCanvasElement;
  mode: EngineMode = 'idle';
  session: DriveSession | null = null;
  onHud: ((h: HudData) => void) | null = null;
  onSessionFinished: (() => void) | null = null;
  onContextLost: (() => void) | null = null;
  webglOk = true;

  private scene = new THREE.Scene();
  private showScene = new THREE.Scene();
  private showCam: THREE.PerspectiveCamera;
  private showRig: BusRig | null = null;
  private showKey = '';
  private showYaw = 0.6;
  private showYawTarget = 0.6;
  private showDragging = false;
  private showAuto = true;
  private last = 0;
  private raf = 0;
  private running = false;
  private saveTimer = 0;
  private hudTimer = 0;
  private lastFrameAt = 0;
  private hidden = false;
  private quality: RenderQuality;
  private showFloor!: THREE.Mesh;

  constructor(private readonly o: EngineOptions) {
    this.quality = o.perf.current();
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    this.canvas.tabIndex = 0;
    o.host.appendChild(this.canvas);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.quality.antialias, powerPreference: 'high-performance', alpha: false });
    } catch (e) {
      this.webglOk = false;
      renderer = null as unknown as THREE.WebGLRenderer;
    }
    this.renderer = renderer;
    this.input = new InputManager();
    this.camera = new CameraController(1.6);
    this.showCam = new THREE.PerspectiveCamera(42, 1.6, 0.1, 200);
    if (!this.webglOk) return;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.applyQuality(this.quality);
    this.buildShowroom();
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('beforeunload', this.flushSave);
    window.addEventListener('pagehide', this.flushSave);
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.onContextLost?.();
    });
    this.canvas.addEventListener('pointerdown', this.onShowDown);
    window.addEventListener('pointerup', this.onShowUp);
    window.addEventListener('pointermove', this.onShowMove);
    o.perf.onChange((q) => this.applyQuality(q));
    this.input.attach();
  }

  // ------------------------------------------------------------ setup

  private applyQuality(q: RenderQuality): void {
    this.quality = q;
    const ratio = Math.min(window.devicePixelRatio || 1, q.pixelRatioCap);
    this.renderer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.session?.env.setQuality(q);
    this.resize();
  }

  private resize = (): void => {
    if (!this.webglOk) return;
    const w = this.o.host.clientWidth || window.innerWidth;
    const h = this.o.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.setAspect(w / h);
    this.showCam.aspect = w / h;
    this.showCam.updateProjectionMatrix();
  };

  private buildShowroom(): void {
    const sc = this.showScene;
    sc.background = new THREE.Color(0x10151c);
    sc.fog = new THREE.Fog(0x10151c, 18, 60);
    const pm = new THREE.PMREMGenerator(this.renderer);
    sc.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    sc.environmentIntensity = 0.8;
    pm.dispose();
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(8, 14, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -12;
    key.shadow.camera.right = 12;
    key.shadow.camera.top = 12;
    key.shadow.camera.bottom = -12;
    sc.add(key);
    sc.add(new THREE.HemisphereLight(0x9ab6ff, 0x20242b, 0.6));
    const rim = new THREE.DirectionalLight(0x6aa6ff, 1.2);
    rim.position.set(-8, 5, -9);
    sc.add(rim);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1b222c, roughness: 0.55, metalness: 0.3 });
    this.showFloor = new THREE.Mesh(new THREE.CircleGeometry(16, 64), floorMat);
    this.showFloor.rotation.x = -Math.PI / 2;
    this.showFloor.receiveShadow = true;
    sc.add(this.showFloor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(9.2, 9.35, 96), new THREE.MeshBasicMaterial({ color: 0xf5a524 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    sc.add(ring);
  }

  private onShowDown = (e: PointerEvent): void => {
    if (this.mode === 'showroom') {
      this.showDragging = true;
      this.showAuto = false;
      this.lastPX = e.clientX;
    }
  };
  private lastPX = 0;
  private onShowUp = (): void => {
    this.showDragging = false;
  };
  private onShowMove = (e: PointerEvent): void => {
    if (!this.showDragging) return;
    this.showYawTarget += (e.clientX - this.lastPX) * 0.01;
    this.lastPX = e.clientX;
  };

  // ------------------------------------------------------------ modes

  /** Displays a bus in the showroom (garage / gallery / main menu backdrop). */
  showBus(modelId: string, look: BusLook = DEFAULT_LOOK, auto = true): void {
    if (!this.webglOk) return;
    const model = BUS_BY_ID[modelId];
    this.mode = 'showroom';
    this.showAuto = auto;
    // imported models load on demand; keep showing the previous bus until the new one is ready
    if (shellPending(model.glb)) {
      void loadShell(model.glb!).then(() => {
        if (this.mode === 'showroom' && this.showWanted === modelId) this.showBus(modelId, look, auto);
      });
      this.showWanted = modelId;
      return;
    }
    this.showWanted = modelId;
    const shell = shellIfLoaded(model.glb);
    const key = `${modelId}|${shell ? 'g' : 'p'}|${JSON.stringify(look)}`;
    if (key !== this.showKey) {
      this.showKey = key;
      if (this.showRig) {
        this.showScene.remove(this.showRig.group);
        this.showRig.dispose();
      }
      const rig = new BusRig(model, look, { headlightBeams: false, interior: true, shell });
      rig.pose({ x: 0, y: 0, z: 0, heading: 0, roll: 0, pitch: 0, wheelAngle: 0, steerAngle: 0, doorProgress: 0 });
      rig.setLights({ head: 0, hazard: false, left: false, right: false, wipers: 0, interior: false }, false, false, false, 0, false);
      rig.setOccupancy(Math.round(BUS_BY_ID[modelId].seats * 0.35));
      rig.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
      });
      this.showScene.add(rig.group);
      this.showRig = rig;
      const L = BUS_BY_ID[modelId].dims.length;
      this.showDist = L * 1.35 + 4;
    }
    this.startLoop();
  }
  private showDist = 18;
  private showWanted = '';

  showDoors(open: boolean): void {
    this.showDoorTarget = open ? 1 : 0;
  }
  private showDoorTarget = 0;
  private showDoorPos = 0;

  leaveShowroom(): void {
    if (this.mode === 'showroom') this.mode = 'idle';
  }

  startTrip(plan: TripPlan): DriveSession {
    this.endTrip();
    this.mode = 'drive';
    this.session = new DriveSession({
      ctx: this.o.ctx,
      plan,
      scene: this.scene,
      quality: this.quality,
      labels: this.o.labels(),
      audio: this.o.audio,
      input: this.input,
      camera: this.camera,
      renderer: this.renderer,
    });
    this.startLoop();
    return this.session;
  }

  endTrip(): void {
    if (this.session) {
      this.session.dispose();
      this.session = null;
    }
    this.scene.clear();
    this.scene.fog = null;
    this.scene.background = null;
    this.o.audio.update({ engineOn: false, rpm: 0, throttle: 0, speed: 0, brake: 0, slip: 0, rain: 0, offRoad: false, electric: false, atTerminal: false });
    this.mode = 'idle';
  }

  setTripPaused(p: boolean): void {
    this.session?.setPaused(p);
    if (p) this.o.audio.suspend();
    else this.o.audio.resume();
  }

  // ------------------------------------------------------------ loop

  startLoop(): void {
    if (this.running || !this.webglOk) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stopLoop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private onVisibility = (): void => {
    this.hidden = document.hidden;
    if (this.hidden) {
      this.flushSave();
      if (this.session && this.session.phase === 'driving') this.setTripPaused(true);
      this.o.audio.suspend();
    } else {
      this.last = performance.now();
      if (!this.session?.paused) this.o.audio.resume();
    }
  };

  readonly flushSave = (): void => {
    try {
      this.o.ctx.save.flushIfDirty(this.o.ctx.state);
    } catch {
      /* storage may be unavailable */
    }
  };

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.hidden) return;
    const cap = this.quality.fpsCap;
    if (cap > 0 && now - this.lastFrameAt < 1000 / cap - 1.5) return;
    this.lastFrameAt = now;
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    this.o.perf.sample(dt, now);

    // autosave
    this.saveTimer += dt;
    if (this.saveTimer > 15) {
      this.saveTimer = 0;
      if (this.o.ctx.state.settings.autoSave) this.flushSave();
    }

    if (this.mode === 'drive' && this.session) {
      const s = this.session;
      s.update(dt, now);
      this.render(s);
      this.hudTimer += dt;
      if (this.hudTimer > 0.05) {
        this.hudTimer = 0;
        this.onHud?.(s.hud());
      }
      if (s.phase === 'finished' && !this.finishedNotified) {
        this.finishedNotified = true;
        this.onSessionFinished?.();
      }
      if (s.phase === 'driving') this.finishedNotified = false;
    } else if (this.mode === 'showroom') {
      this.renderShowroom(dt);
    } else {
      this.renderer.setClearColor(0x0b0f14);
      this.renderer.clear();
    }
  };
  private finishedNotified = false;

  private render(s: DriveSession): void {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    r.setScissorTest(false);
    r.setViewport(0, 0, size.x, size.y);
    r.render(this.scene, this.camera.camera);
    if (s.rearCamOn) {
      const w = Math.min(380, size.x * 0.45);
      const h = w / 3.2;
      const x = (size.x - w) / 2;
      const y = size.y - h - 70;
      r.setScissorTest(true);
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);
      s.rear.camera.aspect = w / h;
      s.rear.camera.updateProjectionMatrix();
      r.clearDepth();
      s.rig.setCockpitVisible(false);
      r.render(this.scene, s.rear.camera);
      s.rig.setCockpitVisible(true);
      r.setScissorTest(false);
      r.setViewport(0, 0, size.x, size.y);
    }
  }

  private renderShowroom(dt: number): void {
    if (this.showAuto) this.showYawTarget += dt * 0.25;
    this.showYaw += (this.showYawTarget - this.showYaw) * Math.min(1, dt * 6);
    const d = this.showDist;
    this.showCam.position.set(Math.sin(this.showYaw) * d, d * 0.28 + 1.5, Math.cos(this.showYaw) * d);
    this.showCam.lookAt(0, 1.4, 0);
    const w = this.renderer.domElement.clientWidth;
    const hh = this.renderer.domElement.clientHeight;
    if (w > 760) this.showCam.setViewOffset(w, hh, -w * 0.2, 0, w, hh);
    else this.showCam.clearViewOffset();
    if (this.showRig) {
      this.showDoorPos += (this.showDoorTarget - this.showDoorPos) * Math.min(1, dt * 4);
      this.showRig.pose({ x: 0, y: 0, z: 0, heading: 0, roll: 0, pitch: 0, wheelAngle: 0, steerAngle: 0, doorProgress: this.showDoorPos });
    }
    this.renderer.setScissorTest(false);
    this.renderer.render(this.showScene, this.showCam);
  }

  dispose(): void {
    this.stopLoop();
    this.endTrip();
    this.input.detach();
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('beforeunload', this.flushSave);
    window.removeEventListener('pagehide', this.flushSave);
    this.renderer?.dispose();
    this.canvas.remove();
  }
}
