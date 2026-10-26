import * as THREE from 'three';
import type { BusModelDef, BusStyle } from '../data/buses';
import type { LightState } from './VehicleController';
import { COSMETIC_BY_ID } from '../data/cosmetics';
import { clamp, mulberry32 } from '../core/utils';
import { labelTexture } from '../world/Textures';
import type { ShellTemplate } from './BusAssets';

/**
 * Procedural, low-poly but fully original bus models (no external assets, no trademarks).
 * Forward is +z, the driver sits on the LEFT (+x), passenger door is on the RIGHT (-x).
 */

export interface BusLook {
  paint: string;
  livery: string;
  rims: string;
  interior: string;
  plate: string;
  companyName: string;
  companyColor: string;
}

export const DEFAULT_LOOK: BusLook = {
  paint: 'paint_white',
  livery: 'livery_plain',
  rims: 'rims_steel',
  interior: 'interior_gray',
  plate: '34 RM 100',
  companyName: 'RoadMaster Tur',
  companyColor: '#f5a524',
};

interface StyleDef {
  rake: number;
  rows: 1 | 2;
  rearWindow: boolean;
  roofPod: 'none' | 'ac' | 'battery';
  skirt: number;
  tint: number;
  frontAxleFromNose: number;
  rearAxleFromTail: number;
}

const STYLES: Record<BusStyle, StyleDef> = {
  compact: { rake: 0.7, rows: 1, rearWindow: true, roofPod: 'ac', skirt: 0.55, tint: 0x0b1620, frontAxleFromNose: 2.3, rearAxleFromTail: 2.3 },
  standard: { rake: 0.95, rows: 1, rearWindow: true, roofPod: 'ac', skirt: 0.55, tint: 0x0b1620, frontAxleFromNose: 2.6, rearAxleFromTail: 2.7 },
  coach: { rake: 1.5, rows: 1, rearWindow: true, roofPod: 'ac', skirt: 0.7, tint: 0x081018, frontAxleFromNose: 2.9, rearAxleFromTail: 2.9 },
  luxury: { rake: 1.8, rows: 1, rearWindow: true, roofPod: 'ac', skirt: 0.75, tint: 0x05090d, frontAxleFromNose: 3.0, rearAxleFromTail: 3.0 },
  doubleDecker: { rake: 0.12, rows: 2, rearWindow: true, roofPod: 'none', skirt: 0.55, tint: 0x0b1620, frontAxleFromNose: 2.6, rearAxleFromTail: 2.7 },
  electric: { rake: 1.0, rows: 1, rearWindow: true, roofPod: 'battery', skirt: 0.55, tint: 0x0a1822, frontAxleFromNose: 2.5, rearAxleFromTail: 2.6 },
};

const BODY_Y0 = 0.55;
const WHEEL_R = 0.52;

function luminance(hex: string): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function drawLivery(kind: string, accent: string, text: string, frontOnRight: boolean, paintHex: string, companyColor: string): HTMLCanvasElement {
  const W = 1024;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const fx = (x: number) => (frontOnRight ? x : W - x); // x measured from the rear
  ctx.clearRect(0, 0, W, H);
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    const a = fx(x0);
    const b = fx(x1);
    ctx.fillRect(Math.min(a, b), y0, Math.abs(b - a), y1 - y0);
  };
  ctx.fillStyle = accent;
  switch (kind) {
    case 'livery_stripe':
      rect(0, 168, W, 196);
      ctx.fillStyle = '#ffffff';
      rect(0, 204, W, 214);
      break;
    case 'livery_chevron':
      for (let i = 0; i < 9; i++) {
        const x = 40 + i * 54;
        ctx.beginPath();
        ctx.moveTo(fx(x), H);
        ctx.lineTo(fx(x + 38), H);
        ctx.lineTo(fx(x + 38 + 58), 110);
        ctx.lineTo(fx(x + 58), 110);
        ctx.closePath();
        ctx.globalAlpha = 0.35 + i * 0.07;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    case 'livery_wave': {
      for (let k = 0; k < 3; k++) {
        ctx.globalAlpha = 0.9 - k * 0.28;
        ctx.beginPath();
        ctx.moveTo(fx(0), H);
        ctx.lineTo(fx(0), 150 + k * 22);
        ctx.bezierCurveTo(fx(300), 90 + k * 22, fx(520), 230 + k * 10, fx(W), 120 + k * 22);
        ctx.lineTo(fx(W), H);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'livery_checker': {
      const s = 24;
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < W / s; x++) {
          ctx.fillStyle = (x + y) % 2 === 0 ? '#111' : '#f5f5f5';
          rect(x * s, 176 + y * s, x * s + s, 176 + (y + 1) * s);
        }
      }
      break;
    }
    case 'livery_carbon': {
      ctx.fillStyle = '#161a20';
      rect(0, 120, W, H);
      for (let y = 120; y < H; y += 8) {
        for (let x = 0; x < W; x += 8) {
          ctx.fillStyle = (x / 8 + y / 8) % 2 === 0 ? '#20252d' : '#101318';
          rect(x, y, x + 8, y + 8);
        }
      }
      ctx.fillStyle = '#d6232f';
      rect(0, 112, W, 120);
      break;
    }
    case 'livery_aurora':
    case 'livery_sunset': {
      const g = ctx.createLinearGradient(0, 0, W, 0);
      if (kind === 'livery_aurora') {
        g.addColorStop(0, '#37d6a5');
        g.addColorStop(0.5, '#3a8dde');
        g.addColorStop(1, '#8a4fe0');
      } else {
        g.addColorStop(0, '#ffb347');
        g.addColorStop(0.5, '#ff6a3d');
        g.addColorStop(1, '#d6246e');
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(fx(0), H);
      ctx.lineTo(fx(0), 140);
      ctx.bezierCurveTo(fx(260), 70, fx(640), 220, fx(W), 100);
      ctx.lineTo(fx(W), H);
      ctx.closePath();
      ctx.fill();
      break;
    }
    default:
      // plain: a slim company-colour line
      ctx.fillStyle = companyColor;
      rect(0, 214, W, 222);
  }
  // company name
  const dark = luminance(paintHex) > 0.45 && !['livery_carbon'].includes(kind);
  ctx.font = 'bold 54px Arial, sans-serif';
  ctx.textBaseline = 'middle';
  const textX = frontOnRight ? 150 : W - 150;
  ctx.textAlign = frontOnRight ? 'left' : 'right';
  ctx.fillStyle = dark ? '#1b2330' : '#ffffff';
  ctx.shadowColor = dark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 6;
  ctx.fillText(text, textX, 60);
  ctx.shadowBlur = 0;
  // round logo
  ctx.fillStyle = companyColor;
  ctx.beginPath();
  ctx.arc(fx(90), 60, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#10151c';
  ctx.font = 'bold 40px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text.charAt(0).toUpperCase(), fx(90), 62);
  return c;
}

function bodyShape(L: number, H: number, rake: number): THREE.Shape {
  const s = new THREE.Shape();
  const y0 = BODY_Y0;
  const z0 = -L / 2;
  const z1 = L / 2;
  s.moveTo(z0 + 0.3, y0);
  s.lineTo(z1 - 0.35, y0);
  s.quadraticCurveTo(z1, y0, z1, y0 + 0.35);
  s.lineTo(z1, H * 0.4);
  s.lineTo(z1 - rake, H - 0.12);
  s.quadraticCurveTo(z1 - rake - 0.12, H, z1 - rake - 0.7, H);
  s.lineTo(z0 + 0.5, H);
  s.quadraticCurveTo(z0, H, z0, H - 0.5);
  s.lineTo(z0, y0 + 0.45);
  s.quadraticCurveTo(z0, y0, z0 + 0.3, y0);
  return s;
}

export interface RigOptions {
  headlightBeams: boolean;
  interior: boolean;
  /** converted imported model; the procedural exterior is used when absent */
  shell?: ShellTemplate;
}

export class BusRig {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  readonly cockpit = new THREE.Group();
  readonly eye = new THREE.Object3D();
  readonly dims: { L: number; W: number; H: number };
  private frontPivots: THREE.Group[] = [];
  private wheels: THREE.Object3D[] = [];
  private leafDh = 1;
  private leafFront!: THREE.Group;
  private leafRear!: THREE.Group;
  private lightsEmissive: { head: THREE.MeshStandardMaterial; tail: THREE.MeshStandardMaterial; brake: THREE.MeshStandardMaterial; reverse: THREE.MeshStandardMaterial; indicators: THREE.MeshStandardMaterial[] } | null = null;
  private spots: THREE.SpotLight[] = [];
  private wiperArms: THREE.Group[] = [];
  private steeringWheel!: THREE.Object3D;
  private cluster!: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture };
  private seatInst: THREE.InstancedMesh[] = [];
  private paxHeads!: THREE.InstancedMesh;
  private paxBodies!: THREE.InstancedMesh;
  private seatOrder: number[] = [];
  private seatSlots: THREE.Vector3[] = [];
  private disposables: { dispose(): void }[] = [];
  /** procedural exterior parts that are hidden when an imported shell is used */
  private ext: THREE.Object3D[] = [];
  private destBoard!: THREE.Mesh;
  readonly usesShell: boolean;
  private lastClusterKey = '';
  private destMat!: THREE.MeshBasicMaterial;
  readonly style: StyleDef;
  readonly wheelPositions: { x: number; z: number; front: boolean }[] = [];

  constructor(
    readonly model: BusModelDef,
    readonly look: BusLook,
    opts: RigOptions = { headlightBeams: true, interior: true },
  ) {
    const { length: L, width: W, height: H } = model.dims;
    this.dims = { L, W, H };
    this.style = STYLES[model.style];
    this.usesShell = !!opts.shell;
    this.group.add(this.body);
    this.build(opts);
  }

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  private addExt<T extends THREE.Object3D>(o: T): T {
    this.ext.push(o);
    this.body.add(o);
    return o;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, cast = true): THREE.Mesh {
    this.track(geo);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    return m;
  }

  private build(opts: RigOptions): void {
    const { L, W, H } = this.dims;
    const st = this.style;
    const look = this.look;
    const paintHex = COSMETIC_BY_ID[look.paint]?.color ?? '#f1f3f6';
    const rimHex = COSMETIC_BY_ID[look.rims]?.color ?? '#9aa1ab';
    const interiorHex = COSMETIC_BY_ID[look.interior]?.color ?? '#6b7380';
    const accentHex = COSMETIC_BY_ID[look.livery]?.color ?? '#ffffff';

    const paint = this.track(new THREE.MeshPhysicalMaterial({ color: paintHex, metalness: 0.3, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.0 }));
    const trim = this.track(new THREE.MeshStandardMaterial({ color: 0x1b1f25, roughness: 0.7, metalness: 0.2 }));
    const glass = this.track(new THREE.MeshStandardMaterial({ color: st.tint, roughness: 0.06, metalness: 0.85, transparent: true, opacity: 0.62, envMapIntensity: 1.3 }));
    const chrome = this.track(new THREE.MeshStandardMaterial({ color: 0xc8ced6, metalness: 1, roughness: 0.18 }));

    // ---------------- body shell ----------------
    const bevel = 0.07;
    const geo = new THREE.ExtrudeGeometry(bodyShape(L, H, st.rake), { depth: W - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 8 });
    geo.rotateY(-Math.PI / 2);
    geo.translate(W / 2 - bevel, 0, 0);
    const shell = this.mesh(geo, paint);
    this.addExt(shell);

    // lower skirt (dark plastic) hides the wheel wells a bit
    const skirt = this.mesh(new THREE.BoxGeometry(W + 0.02, 0.2, L - 0.4), trim);
    skirt.position.set(0, BODY_Y0 + 0.1, 0);
    this.addExt(skirt);

    // ---------------- windows ----------------
    const frontAxleZ = L / 2 - st.frontAxleFromNose;
    const rearAxleZ = -L / 2 + st.rearAxleFromTail;
    const doorFront = L / 2 - 0.45;
    const doorBack = doorFront - 1.15;
    const rowsY: [number, number][] = st.rows === 1 ? [[1.25, H - 0.5]] : [[1.2, 2.25], [2.95, H - 0.4]];
    const zStart = -L / 2 + 0.9;
    const zEnd = L / 2 - 0.5;
    for (const [side, sx] of [['left', 1], ['right', -1]] as const) {
      for (const [y0, y1] of rowsY) {
        const segments: [number, number][] = side === 'right' && y0 < 2 ? [[zStart, doorBack - 0.1]] : [[zStart, zEnd]];
        for (const [a, b] of segments) {
          const len = b - a;
          const strip = this.mesh(new THREE.BoxGeometry(0.04, y1 - y0, len), glass, false);
          strip.position.set(sx * (W / 2 + 0.005), (y0 + y1) / 2, (a + b) / 2);
          this.addExt(strip);
          // pillars
          const n = Math.max(2, Math.floor(len / 1.45));
          for (let i = 1; i < n; i++) {
            const pill = this.mesh(new THREE.BoxGeometry(0.06, y1 - y0 + 0.02, 0.1), paint, false);
            pill.position.set(sx * (W / 2 + 0.012), (y0 + y1) / 2, a + (len * i) / n);
            this.addExt(pill);
          }
        }
      }
    }
    // windshield
    const ws = this.buildWindshield(glass);
    this.addExt(ws.group);
    this.wiperArms = ws.wipers;
    // rear window
    if (st.rearWindow) {
      const rw = this.mesh(new THREE.PlaneGeometry(W - 0.6, st.rows === 2 ? 1.0 : 0.95), glass, false);
      rw.position.set(0, H * 0.62, -L / 2 - 0.085);
      rw.rotation.y = Math.PI;
      this.addExt(rw);
    }

    // ---------------- livery overlay (side planes) ----------------
    const shellMode = !!opts.shell;
    const bandH = shellMode ? 0.8 : 1.5;
    for (const [sx, front] of [[-1, true], [1, false]] as const) {
      const tex = new THREE.CanvasTexture(drawLivery(look.livery, accentHex, look.companyName, front, paintHex, look.companyColor));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this.track(tex);
      const mat = this.track(new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.45, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      const plane = new THREE.Mesh(this.track(new THREE.PlaneGeometry(shellMode ? L - 1.6 : L - 0.5, bandH)), mat);
      plane.position.set(sx * (W / 2 + (shellMode ? 0.035 : 0.085)), shellMode ? 1.7 : BODY_Y0 + 0.2 + bandH / 2, shellMode ? -0.2 : -0.1);
      plane.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.body.add(plane);
    }

    // ---------------- front & rear details ----------------
    const grille = this.mesh(new THREE.BoxGeometry(W - 0.5, 0.5, 0.06), trim);
    grille.position.set(0, 0.95, L / 2 + 0.03);
    this.addExt(grille);
    const bumperF = this.mesh(new THREE.BoxGeometry(W + 0.08, 0.28, 0.2), trim);
    bumperF.position.set(0, 0.62, L / 2 - 0.02);
    this.addExt(bumperF);
    const bumperR = bumperF.clone();
    bumperR.position.set(0, 0.62, -L / 2 + 0.02);
    this.addExt(bumperR);

    const headMat = this.track(new THREE.MeshStandardMaterial({ color: 0xf3f7ff, emissive: 0xfff2d0, emissiveIntensity: 0, roughness: 0.2 }));
    const tailMat = this.track(new THREE.MeshStandardMaterial({ color: 0x5a0a0a, emissive: 0xff1010, emissiveIntensity: 0.1, roughness: 0.3 }));
    const brakeMat = this.track(new THREE.MeshStandardMaterial({ color: 0x5a0a0a, emissive: 0xff1010, emissiveIntensity: 0, roughness: 0.3 }));
    const revMat = this.track(new THREE.MeshStandardMaterial({ color: 0xeeeeee, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 }));
    const indMats: THREE.MeshStandardMaterial[] = [];
    const mkInd = () => {
      const m = this.track(new THREE.MeshStandardMaterial({ color: 0x6a4a00, emissive: 0xffa800, emissiveIntensity: 0, roughness: 0.4 }));
      indMats.push(m);
      return m;
    };
    const indLeft = mkInd();
    const indRight = mkInd();
    const lights: { head: THREE.MeshStandardMaterial; tail: THREE.MeshStandardMaterial; brake: THREE.MeshStandardMaterial; reverse: THREE.MeshStandardMaterial; indicators: THREE.MeshStandardMaterial[] } = {
      head: headMat,
      tail: tailMat,
      brake: brakeMat,
      reverse: revMat,
      indicators: [indLeft, indRight],
    };
    this.lightsEmissive = lights;
    for (const sx of [-1, 1]) {
      const hl = this.mesh(new THREE.BoxGeometry(0.46, 0.2, 0.06), headMat, false);
      hl.position.set(sx * (W / 2 - 0.4), 0.98, L / 2 + 0.06);
      this.addExt(hl);
      const ind = this.mesh(new THREE.BoxGeometry(0.22, 0.12, 0.06), sx > 0 ? indLeft : indRight, false);
      ind.position.set(sx * (W / 2 - 0.2), 0.74, L / 2 + 0.06);
      this.body.add(indicatorOf(ind));
      const tl = this.mesh(new THREE.BoxGeometry(0.3, 0.3, 0.06), tailMat, false);
      tl.position.set(sx * (W / 2 - 0.25), 1.15, -L / 2 - 0.05);
      this.body.add(tl);
      const bl = this.mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), brakeMat, false);
      bl.position.set(sx * (W / 2 - 0.25), 0.9, -L / 2 - 0.05);
      this.body.add(bl);
      const rl = this.mesh(new THREE.BoxGeometry(0.22, 0.1, 0.06), revMat, false);
      rl.position.set(sx * (W / 2 - 0.62), 0.9, -L / 2 - 0.05);
      this.body.add(rl);
      const rind = this.mesh(new THREE.BoxGeometry(0.22, 0.12, 0.06), sx > 0 ? indLeft : indRight, false);
      rind.position.set(sx * (W / 2 - 0.2), 1.45, -L / 2 - 0.05);
      this.body.add(rind);
      // side marker indicators
      const side = this.mesh(new THREE.BoxGeometry(0.06, 0.1, 0.3), sx > 0 ? indLeft : indRight, false);
      side.position.set(sx * (W / 2 + 0.04), 0.9, L / 2 - 1.8);
      this.body.add(side);
    }
    // headlight beams
    if (opts.headlightBeams) {
      for (const sx of [-1, 1]) {
        const spot = new THREE.SpotLight(0xfff0d8, 0, 110, 0.5, 0.55, 1.3);
        spot.position.set(sx * (W / 2 - 0.4), 1.0, L / 2 + 0.1);
        const target = new THREE.Object3D();
        target.position.set(sx * 0.6, 0.2, L / 2 + 30);
        this.body.add(spot, target);
        spot.target = target;
        this.spots.push(spot);
      }
    }

    // plates + destination board
    const plateTex = labelTexture(look.plate, '#f5f5f5', '#111111', 256, 64);
    for (const [z, rot] of [[L / 2 + 0.075, 0], [-L / 2 - 0.085, Math.PI]] as const) {
      const plate = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.52, 0.13)), this.track(new THREE.MeshBasicMaterial({ map: plateTex })));
      plate.position.set(0, 0.62, z);
      plate.rotation.y = rot;
      this.body.add(plate);
    }
    this.destMat = this.track(new THREE.MeshBasicMaterial({ map: labelTexture('RoadMaster', '#050505', '#ffb000', 512, 96) }));
    const dest = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1.8, 0.34)), this.destMat);
    const ry = st.rake > 0.5 ? H - 0.2 - st.rake * 0.1 : H - 0.35;
    dest.position.set(0, ry, L / 2 - st.rake + 0.06);
    dest.rotation.x = st.rake > 0.5 ? -0.55 : 0;
    this.body.add(dest);
    this.destBoard = dest;
    // mirrors
    for (const sx of [-1, 1]) {
      const arm = this.mesh(new THREE.BoxGeometry(0.4, 0.04, 0.04), trim, false);
      arm.position.set(sx * (W / 2 + 0.2), H * 0.55, L / 2 - 0.5);
      this.addExt(arm);
      const mir = this.mesh(new THREE.BoxGeometry(0.08, 0.5, 0.26), trim, false);
      mir.position.set(sx * (W / 2 + 0.4), H * 0.55 - 0.1, L / 2 - 0.5);
      this.addExt(mir);
    }

    // roof pods
    if (st.roofPod === 'ac') {
      const pod = this.mesh(new THREE.BoxGeometry(W * 0.62, 0.3, L * 0.22), this.track(new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.5 })));
      pod.position.set(0, H + 0.15, -L * 0.18);
      this.addExt(pod);
    } else if (st.roofPod === 'battery') {
      const pod = this.mesh(new THREE.BoxGeometry(W * 0.85, 0.42, L * 0.55), this.track(new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.5, metalness: 0.4 })));
      pod.position.set(0, H + 0.21, -L * 0.1);
      this.addExt(pod);
      const stripe = this.mesh(new THREE.BoxGeometry(W * 0.86, 0.06, L * 0.55 + 0.02), this.track(new THREE.MeshStandardMaterial({ color: 0x3cff9a, emissive: 0x3cff9a, emissiveIntensity: 0.6 })));
      stripe.position.set(0, H + 0.3, -L * 0.1);
      this.addExt(stripe);
    }

    // ---------------- wheels ----------------
    const tire = this.track(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.32, 20));
    tire.rotateZ(Math.PI / 2);
    const tireMat = this.track(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 }));
    const rimGeo = this.track(new THREE.CylinderGeometry(0.33, 0.33, 0.34, 12));
    rimGeo.rotateZ(Math.PI / 2);
    const rimMat = this.track(new THREE.MeshStandardMaterial({ color: rimHex, metalness: 0.9, roughness: 0.25 }));
    const spokeGeo = this.track(new THREE.BoxGeometry(0.35, 0.08, 0.5));
    const addWheel = (x: number, z: number, front: boolean, dual: boolean) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, WHEEL_R, z);
      const spin = new THREE.Group();
      const t = new THREE.Mesh(tire, tireMat);
      t.castShadow = true;
      const r = new THREE.Mesh(rimGeo, rimMat);
      const sp = new THREE.Mesh(spokeGeo, rimMat);
      spin.add(t, r, sp);
      pivot.add(spin);
      if (dual) {
        const inner = spin.clone();
        inner.position.x = -Math.sign(x) * 0.33;
        pivot.add(inner);
        this.wheels.push(inner);
      }
      this.group.add(pivot);
      this.ext.push(pivot);
      this.wheels.push(spin);
      if (front) this.frontPivots.push(pivot);
      this.wheelPositions.push({ x, z, front });
    };
    const track = W / 2 - 0.2;
    for (const sx of [-1, 1]) {
      addWheel(sx * track, frontAxleZ, true, false);
      addWheel(sx * track, rearAxleZ, false, true);
    }
    // wheel arches (dark discs on the body side)
    for (const sx of [-1, 1]) {
      for (const z of [frontAxleZ, rearAxleZ]) {
        const arch = this.mesh(new THREE.CylinderGeometry(0.64, 0.64, 0.06, 18), trim, false);
        arch.rotation.z = Math.PI / 2;
        arch.position.set(sx * (W / 2 + 0.005), WHEEL_R + 0.05, z);
        this.addExt(arch);
      }
    }

    // ---------------- doors (right side) ----------------
    const leafMat = this.track(new THREE.MeshStandardMaterial({ color: st.tint, roughness: 0.08, metalness: 0.8, transparent: true, opacity: 0.8 }));
    const leafFrame = this.track(new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.5 }));
    const dh = Math.min(2.05, H - 1.3);
    const leaf = (hingeZ: number, dir: 1 | -1) => {
      const pivot = new THREE.Group();
      pivot.position.set(-W / 2 - 0.02, BODY_Y0 + 0.15 + dh / 2, hingeZ);
      const panel = this.mesh(new THREE.BoxGeometry(0.05, dh, 0.55), leafMat, false);
      panel.position.z = -dir * 0.275;
      const frame = this.mesh(new THREE.BoxGeometry(0.06, dh + 0.04, 0.06), leafFrame, false);
      frame.position.z = -dir * 0.55;
      pivot.add(panel, frame);
      this.body.add(pivot);
      return pivot;
    };
    this.leafDh = dh;
    this.leafFront = leaf(doorFront, 1);
    this.leafRear = leaf(doorBack, -1);
    // door frame
    const frameTop = this.mesh(new THREE.BoxGeometry(0.1, 0.1, 1.2), leafFrame, false);
    frameTop.position.set(-W / 2 - 0.02, BODY_Y0 + 0.2 + dh, (doorFront + doorBack) / 2);
    this.addExt(frameTop);
    // steps
    const step = this.mesh(new THREE.BoxGeometry(0.4, 0.08, 1.0), trim, false);
    step.position.set(-W / 2 + 0.1, BODY_Y0 + 0.3, (doorFront + doorBack) / 2);
    this.addExt(step);

    if (opts.shell) {
      this.attachShell(opts.shell, { paint, glass, trim, headMat, indLeft, indRight, rimHex, paintHex, leafFrame });
    }

    // ---------------- interior ----------------
    this.buildInterior(interiorHex, opts.interior, frontAxleZ);

    // keep the model visually centred: group origin = ground centre
    this.group.add(this.cockpit);
    this.body.add(this.eye);
    chrome.dispose();
  }


  /** Replaces the procedural exterior with an imported model (see BusAssets.ts). Lights, wheels and doors stay animated. */
  private attachShell(
    sh: ShellTemplate,
    c: {
      paint: THREE.MeshPhysicalMaterial;
      glass: THREE.MeshStandardMaterial;
      trim: THREE.MeshStandardMaterial;
      headMat: THREE.MeshStandardMaterial;
      indLeft: THREE.MeshStandardMaterial;
      indRight: THREE.MeshStandardMaterial;
      rimHex: string;
      paintHex: string;
      leafFrame: THREE.MeshStandardMaterial;
    },
  ): void {
    const { W } = this.dims;
    for (const o of this.ext) o.visible = false;
    this.wheels.length = 0;
    this.frontPivots.length = 0;
    this.wheelPositions.length = 0;

    // the shipped models have no normals: everything is flat shaded (low-poly look)
    for (const m of [c.paint, c.glass, c.headMat, c.indLeft, c.indRight]) {
      m.flatShading = true;
      m.needsUpdate = true;
    }
    // unpainted buses keep their catalogue colour; any bought paint overrides it
    const factory = this.model.factoryColor;
    c.paint.color.set(this.look.paint === DEFAULT_LOOK.paint && factory ? factory : c.paintHex);

    const vcTrim = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.62, metalness: 0.15 }));
    const vcChrome = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.3, metalness: 0.7 }));
    const vcTire = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 }));
    const rimMat = this.track(new THREE.MeshStandardMaterial({ color: c.rimHex, flatShading: true, metalness: 0.85, roughness: 0.3 }));

    const root = new THREE.Group();
    root.name = 'imported-shell';
    this.body.add(root);
    const put = (geo: THREE.BufferGeometry | null, mat: THREE.Material, cast = true) => {
      if (!geo) return;
      const m = new THREE.Mesh(geo, mat); // geometry is shared between rigs: not tracked / disposed here
      m.castShadow = cast;
      m.receiveShadow = true;
      root.add(m);
    };
    put(sh.body, c.paint);
    put(sh.glass, c.glass, false);
    put(sh.chrome, vcChrome);
    put(sh.trim, vcTrim);
    put(sh.headLamps, c.headMat, false);
    put(sh.signalLeft, c.indLeft, false);
    put(sh.signalRight, c.indRight, false);

    for (const w of sh.wheels) {
      const pivot = new THREE.Group();
      pivot.position.copy(w.center);
      const spin = new THREE.Group();
      const add = (g: THREE.BufferGeometry | null, mat: THREE.Material) => {
        if (!g) return;
        const m = new THREE.Mesh(g, mat);
        m.castShadow = true;
        spin.add(m);
      };
      add(w.tire, vcTire);
      add(w.rim, rimMat);
      add(w.hub, vcTrim);
      pivot.add(spin);
      this.group.add(pivot);
      this.wheels.push(spin);
      if (w.front) this.frontPivots.push(pivot);
      this.wheelPositions.push({ x: w.center.x, z: w.center.z, front: w.front });
    }

    // passenger door: animated leaves over a dark doorway
    const d = sh.door;
    if (d) {
      const half = (d.zMax - d.zMin) / 2;
      const hgt = d.yMax - d.yMin;
      const cy = (d.yMin + d.yMax) / 2;
      const way = new THREE.Mesh(
        this.track(new THREE.PlaneGeometry(half * 2, hgt)),
        this.track(new THREE.MeshBasicMaterial({ color: 0x15181d, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })),
      );
      way.position.set(d.x - 0.012, cy, (d.zMin + d.zMax) / 2);
      way.rotation.y = -Math.PI / 2;
      root.add(way);
      const xo = d.x - 0.045;
      this.leafFront.position.set(xo, cy, d.zMax);
      this.leafRear.position.set(xo, cy, d.zMin);
      for (const l of [this.leafFront, this.leafRear]) l.scale.set(1, hgt / this.leafDh, half / 0.55);
    } else {
      this.leafFront.visible = false;
      this.leafRear.visible = false;
    }

    if (sh.roofFront) {
      this.destBoard.rotation.set(0, 0, 0);
      this.destBoard.scale.set(0.8, 0.8, 1);
      this.destBoard.position.set(0, sh.roofFront.yTop - 0.3, sh.roofFront.z + 0.012);
    }
    void W;
  }

  private buildWindshield(glass: THREE.Material): { group: THREE.Group; wipers: THREE.Group[] } {
    const { L, W, H } = this.dims;
    const rake = this.style.rake;
    const group = new THREE.Group();
    const z1 = L / 2;
    const yLow = H * 0.4;
    const yHigh = H - 0.12;
    const dz = -rake;
    const dy = yHigh - yLow;
    const len = Math.hypot(dz, dy);
    const nz = dy / len;
    const ny = -dz / len;
    const plane = new THREE.Mesh(this.track(new THREE.PlaneGeometry(W - 0.3, len - 0.1)), glass);
    plane.position.set(0, (yLow + yHigh) / 2, z1 + dz / 2);
    const off = 0.075;
    plane.position.z += nz * off;
    plane.position.y += ny * off;
    plane.rotation.x = -Math.atan2(ny, nz);
    group.add(plane);
    const wipers: THREE.Group[] = [];
    for (const x of [-0.55, 0.55]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, -(len - 0.1) / 2 + 0.12, 0.02);
      const blade = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.03, 0.75, 0.015)), this.track(new THREE.MeshStandardMaterial({ color: 0x0a0a0a })));
      blade.position.y = 0.375;
      pivot.add(blade);
      pivot.rotation.z = -1.2;
      plane.add(pivot);
      wipers.push(pivot);
    }
    return { group, wipers };
  }

  private buildInterior(interiorHex: string, withSeats: boolean, frontAxleZ: number): void {
    const { L, W, H } = this.dims;
    const m = this.model;
    const st = this.style;
    const floorY = 1.0;
    // floor
    const floor = this.mesh(new THREE.BoxGeometry(W - 0.2, 0.06, L - 0.6), this.track(new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.9 })), false);
    floor.position.set(0, floorY, 0);
    this.body.add(floor);
    if (st.rows === 2) {
      const f2 = floor.clone();
      f2.position.y = 2.65;
      this.body.add(f2);
    }

    // seats
    const seatMat = this.track(new THREE.MeshStandardMaterial({ color: interiorHex, roughness: 0.9 }));
    const seatBase = this.track(new THREE.BoxGeometry(0.42, 0.12, 0.44));
    const seatBack = this.track(new THREE.BoxGeometry(0.42, 0.55, 0.1));
    const cap = Math.max(1, m.seats);
    const base = new THREE.InstancedMesh(seatBase, seatMat, cap);
    const back = new THREE.InstancedMesh(seatBack, seatMat, cap);
    base.frustumCulled = false;
    back.frustumCulled = false;
    const mtx = new THREE.Matrix4();
    const slots: THREE.Vector3[] = [];
    const perDeck = st.rows === 2 ? Math.ceil(cap / 2) : cap;
    const startZ = L / 2 - 3.6;
    const pitch = st.rows === 2 ? 0.8 : m.style === 'luxury' ? 1.0 : 0.86;
    const cols = [0.5, 0.95, -0.5, -0.95];
    for (let i = 0; i < cap; i++) {
      const deck = st.rows === 2 && i >= perDeck ? 1 : 0;
      const k = deck ? i - perDeck : i;
      const row = Math.floor(k / 4);
      const col = cols[k % 4];
      const z = startZ - row * pitch;
      const y = (deck ? 2.65 : floorY) + 0.4;
      const zz = Math.max(z, -L / 2 + 0.6);
      slots.push(new THREE.Vector3(col, y, zz));
      mtx.makeTranslation(col, y, zz);
      base.setMatrixAt(i, mtx);
      mtx.makeTranslation(col, y + 0.3, zz - 0.2);
      back.setMatrixAt(i, mtx);
    }
    if (withSeats) {
      this.body.add(base, back);
      this.seatInst.push(base, back);
    }
    this.seatSlots = slots;
    const rnd = mulberry32(17 + cap);
    this.seatOrder = slots.map((_, i) => i).sort(() => rnd() - 0.5);

    // passengers (heads + torsos), count set by setOccupancy
    const headGeo = this.track(new THREE.SphereGeometry(0.12, 8, 6));
    const torsoGeo = this.track(new THREE.BoxGeometry(0.34, 0.5, 0.2));
    const headMat = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }));
    const torsoMat = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
    this.paxHeads = new THREE.InstancedMesh(headGeo, headMat, cap);
    this.paxBodies = new THREE.InstancedMesh(torsoGeo, torsoMat, cap);
    this.paxHeads.frustumCulled = false;
    this.paxBodies.frustumCulled = false;
    const skin = [0xf1c9a5, 0xd9a577, 0xb97c52, 0x8d5a3a, 0xf6d6bd];
    const shirts = [0x2e5aa8, 0xb23a48, 0x3c8c5a, 0xe0a83a, 0x6a4fa3, 0x2f3a46, 0xd8d8d8, 0x2a9bb0];
    const c = new THREE.Color();
    for (let i = 0; i < cap; i++) {
      c.setHex(skin[Math.floor(rnd() * skin.length)]);
      this.paxHeads.setColorAt(i, c);
      c.setHex(shirts[Math.floor(rnd() * shirts.length)]);
      this.paxBodies.setColorAt(i, c);
    }
    this.paxHeads.count = 0;
    this.paxBodies.count = 0;
    this.body.add(this.paxHeads, this.paxBodies);

    // ---------------- cockpit ----------------
    const seatX = 0.65;
    const dashZ = L / 2 - 1.15;
    const dash = this.mesh(new THREE.BoxGeometry(W - 0.5, 0.42, 0.6), this.track(new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.7 })), false);
    dash.position.set(0, floorY + 0.55, dashZ + 0.05);
    this.cockpit.add(dash);
    const dashTop = this.mesh(new THREE.BoxGeometry(W - 0.5, 0.06, 0.62), seatMat, false);
    dashTop.position.set(0, floorY + 0.78, dashZ + 0.05);
    this.cockpit.add(dashTop);
    // driver seat
    const dseat = this.mesh(new THREE.BoxGeometry(0.5, 0.15, 0.5), seatMat, false);
    dseat.position.set(seatX, floorY + 0.5, dashZ - 0.7);
    const dback = this.mesh(new THREE.BoxGeometry(0.5, 0.7, 0.12), seatMat, false);
    dback.position.set(seatX, floorY + 0.9, dashZ - 0.98);
    this.cockpit.add(dseat, dback);
    // steering wheel
    const sw = new THREE.Group();
    sw.position.set(seatX, floorY + 0.68, dashZ - 0.18);
    sw.rotation.x = -0.9;
    const rimW = this.mesh(new THREE.TorusGeometry(0.2, 0.021, 8, 24), this.track(new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.6 })), false);
    const hub = this.mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), this.track(new THREE.MeshStandardMaterial({ color: 0x2c3138 })), false);
    hub.rotation.x = Math.PI / 2;
    const sp1 = this.mesh(new THREE.BoxGeometry(0.4, 0.025, 0.02), rimW.material as THREE.Material, false);
    sw.add(rimW, hub, sp1);
    this.cockpit.add(sw);
    this.steeringWheel = sw;
    // instrument cluster
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 128;
    const cctx = cv.getContext('2d')!;
    const ctex = new THREE.CanvasTexture(cv);
    ctex.colorSpace = THREE.SRGBColorSpace;
    this.track(ctex);
    this.cluster = { canvas: cv, ctx: cctx, tex: ctex };
    const clusterMesh = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.5, 0.25)), this.track(new THREE.MeshBasicMaterial({ map: ctex })));
    clusterMesh.position.set(seatX, floorY + 0.84, dashZ - 0.36);
    clusterMesh.rotation.set(-0.75, Math.PI, 0);
    this.cockpit.add(clusterMesh);
    this.eye.position.set(seatX, floorY + 1.2 + (H > 3.9 ? 0 : 0), dashZ - 0.55);
    void frontAxleZ;
  }

  // ---------------------------------------------------------------- runtime

  /** Number of seated passengers shown (never more than seats). */
  setOccupancy(n: number): void {
    const k = clamp(Math.floor(n), 0, this.seatSlots.length);
    const m = new THREE.Matrix4();
    for (let i = 0; i < k; i++) {
      const p = this.seatSlots[this.seatOrder[i]];
      m.makeTranslation(p.x, p.y + 0.35, p.z - 0.18);
      this.paxBodies.setMatrixAt(i, m);
      m.makeTranslation(p.x, p.y + 0.78, p.z - 0.16);
      this.paxHeads.setMatrixAt(i, m);
    }
    this.paxBodies.count = k;
    this.paxHeads.count = k;
    this.paxBodies.instanceMatrix.needsUpdate = true;
    this.paxHeads.instanceMatrix.needsUpdate = true;
    if (this.paxBodies.instanceColor) this.paxBodies.instanceColor.needsUpdate = true;
    if (this.paxHeads.instanceColor) this.paxHeads.instanceColor.needsUpdate = true;
  }

  setDestination(text: string): void {
    this.destMat.map = labelTexture(text.toUpperCase(), '#050505', '#ffb000', 512, 96);
    this.destMat.needsUpdate = true;
  }

  /** Position/orientation + animated parts. */
  pose(v: { x: number; y: number; z: number; heading: number; roll: number; pitch: number; wheelAngle: number; steerAngle: number; doorProgress: number }): void {
    this.group.position.set(v.x, v.y, v.z);
    this.group.rotation.y = v.heading;
    this.body.rotation.set(v.pitch, 0, v.roll);
    for (const w of this.wheels) w.rotation.x = v.wheelAngle;
    for (const p of this.frontPivots) p.rotation.y = v.steerAngle;
    const open = v.doorProgress * 1.35;
    this.leafFront.rotation.y = open;
    this.leafRear.rotation.y = -open;
    this.steeringWheel.rotation.z = -v.steerAngle * 5.5;
  }

  setLights(l: LightState, brake: boolean, reverse: boolean, blinkOn: boolean, night: number, engineOn: boolean): void {
    const e = this.lightsEmissive!;
    const headLevel = l.head === 0 ? 0 : l.head === 1 ? 1.6 : 3.2;
    e.head.emissiveIntensity = headLevel + (engineOn && night < 0.5 ? 0.15 : 0);
    e.tail.emissiveIntensity = l.head > 0 ? 1.4 : 0.15;
    e.brake.emissiveIntensity = brake ? 3 : l.head > 0 ? 0.5 : 0;
    e.reverse.emissiveIntensity = reverse ? 2.5 : 0;
    const left = (l.left || l.hazard) && blinkOn;
    const right = (l.right || l.hazard) && blinkOn;
    e.indicators[0].emissiveIntensity = left ? 3 : 0;
    e.indicators[1].emissiveIntensity = right ? 3 : 0;
    const spotI = l.head === 0 ? 0 : l.head === 1 ? 60 : 130;
    for (const s of this.spots) s.intensity = spotI * (0.35 + night * 0.65);
  }

  setWipers(mode: 0 | 1 | 2, timeSec: number): void {
    for (const w of this.wiperArms) {
      if (mode === 0) w.rotation.z = -1.2;
      else {
        const f = mode === 1 ? 1.3 : 2.4;
        w.rotation.z = -1.2 + (0.5 + 0.5 * Math.sin(timeSec * f * 3)) * 1.9;
      }
    }
  }

  /** Cockpit dashboard display (call at ~10 Hz). */
  updateCluster(speedKmh: number, rpm: number, fuelFrac: number, gear: string, electric: boolean, warn: boolean): void {
    const key = `${Math.round(speedKmh)}|${Math.round(rpm / 50)}|${Math.round(fuelFrac * 50)}|${gear}|${warn}`;
    if (key === this.lastClusterKey) return;
    this.lastClusterKey = key;
    const { ctx, tex, canvas } = this.cluster;
    ctx.fillStyle = '#05080c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // speed
    ctx.fillStyle = '#d8f3ff';
    ctx.font = 'bold 54px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(Math.round(Math.abs(speedKmh))), 90, 78);
    ctx.font = '16px Arial, sans-serif';
    ctx.fillStyle = '#6fb3d1';
    ctx.fillText('km/h', 90, 98);
    // rpm bar
    const rf = clamp(rpm / (electric ? 11500 : 2400), 0, 1);
    ctx.fillStyle = '#12202b';
    ctx.fillRect(150, 30, 90, 12);
    ctx.fillStyle = rf > 0.85 ? '#ff5a4a' : '#3cc8ff';
    ctx.fillRect(150, 30, 90 * rf, 12);
    ctx.fillStyle = '#6fb3d1';
    ctx.font = '12px Arial, sans-serif';
    ctx.fillText(electric ? 'POWER' : 'RPM', 195, 58);
    // fuel bar
    ctx.fillStyle = '#12202b';
    ctx.fillRect(150, 72, 90, 12);
    ctx.fillStyle = fuelFrac < 0.15 ? '#ff5a4a' : '#ffc23d';
    ctx.fillRect(150, 72, 90 * clamp(fuelFrac, 0, 1), 12);
    ctx.fillStyle = '#6fb3d1';
    ctx.fillText(electric ? 'kWh' : 'FUEL', 195, 100);
    // gear
    ctx.fillStyle = '#8dffb0';
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.fillText(gear, 30, 40);
    if (warn) {
      ctx.fillStyle = '#ff5a4a';
      ctx.fillRect(10, 108, 236, 14);
    }
    tex.needsUpdate = true;
  }

  setCockpitVisible(v: boolean): void {
    this.cockpit.visible = v;
  }

  /** world position of the driver's eyes */
  eyeWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.eye.getWorldPosition(out);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.group.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) im.dispose();
    });
    this.group.clear();
  }
}

function indicatorOf<T extends THREE.Object3D>(o: T): T {
  return o;
}

/** Light-weight AI traffic body (cars, vans, trucks, buses, ambulances). */
export type TrafficKind = 'car' | 'van' | 'truck' | 'bus' | 'ambulance';

const trafficGeoCache = new Map<string, THREE.BufferGeometry>();
const trafficMatCache = new Map<string, THREE.Material>();

function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = trafficGeoCache.get(key);
  if (!g) {
    g = make();
    trafficGeoCache.set(key, g);
  }
  return g;
}

function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = trafficMatCache.get(key);
  if (!m) {
    m = make();
    trafficMatCache.set(key, m);
  }
  return m;
}

export interface TrafficBody {
  group: THREE.Group;
  length: number;
  width: number;
  beacon?: THREE.MeshStandardMaterial;
  brake: THREE.MeshStandardMaterial;
  wheels: THREE.Object3D[];
}

export function buildTrafficBody(kind: TrafficKind, color: number): TrafficBody {
  const g = new THREE.Group();
  const paint = mat(`tp-${color}`, () => new THREE.MeshPhysicalMaterial({ color, metalness: 0.3, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.15 }));
  const glass = mat('tglass', () => new THREE.MeshStandardMaterial({ color: 0x0c1822, roughness: 0.1, metalness: 0.8 }));
  const dark = mat('tdark', () => new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8 }));
  const tire = mat('ttire', () => new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.95 }));
  const brake = mat(`tbrake`, () => new THREE.MeshStandardMaterial({ color: 0x5a0a0a, emissive: 0xff1010, emissiveIntensity: 0.2 })).clone() as THREE.MeshStandardMaterial;
  const headM = mat('thead', () => new THREE.MeshStandardMaterial({ color: 0xf2f2f2, emissive: 0xfff0c0, emissiveIntensity: 0.5 }));
  const add = (key: string, make: () => THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, cast = true) => {
    const mesh = new THREE.Mesh(geo(key, make), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const wheels: THREE.Object3D[] = [];
  const wheelGeo = () => {
    const w = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 12);
    w.rotateZ(Math.PI / 2);
    return w;
  };
  let length = 4.3;
  let width = 1.8;
  let beacon: THREE.MeshStandardMaterial | undefined;
  switch (kind) {
    case 'car':
      length = 4.4;
      width = 1.8;
      add('car-body', () => new THREE.BoxGeometry(1.8, 0.6, 4.3), paint, 0, 0.62, 0);
      add('car-cabin', () => new THREE.BoxGeometry(1.6, 0.5, 2.2), glass, 0, 1.12, -0.2);
      add('car-roof', () => new THREE.BoxGeometry(1.55, 0.06, 1.9), paint, 0, 1.4, -0.2);
      for (const sx of [-1, 1]) for (const z of [1.35, -1.35]) {
        const w = add('car-wheel', wheelGeo, tire, sx * 0.88, 0.36, z);
        wheels.push(w);
      }
      break;
    case 'van':
      length = 5.2;
      width = 1.95;
      add('van-body', () => new THREE.BoxGeometry(1.95, 1.5, 5.1), paint, 0, 1.2, 0);
      add('van-win', () => new THREE.BoxGeometry(1.9, 0.6, 1.3), glass, 0, 1.55, 1.6);
      for (const sx of [-1, 1]) for (const z of [1.65, -1.6]) wheels.push(add('van-wheel', wheelGeo, tire, sx * 0.95, 0.36, z));
      break;
    case 'truck':
      length = 9.5;
      width = 2.5;
      add('truck-cab', () => new THREE.BoxGeometry(2.4, 2.3, 2.1), paint, 0, 1.7, 3.5);
      add('truck-win', () => new THREE.BoxGeometry(2.3, 0.8, 0.1), glass, 0, 2.2, 4.56);
      add('truck-box', () => new THREE.BoxGeometry(2.5, 2.7, 6.4), mat('truckbox', () => new THREE.MeshStandardMaterial({ color: 0xdadde0, roughness: 0.7 })), 0, 2.05, -1.1);
      add('truck-chassis', () => new THREE.BoxGeometry(2.0, 0.3, 9), dark, 0, 0.6, 0);
      for (const sx of [-1, 1]) for (const z of [3.4, -2.2, -3.4]) wheels.push(add('truck-wheel', () => {
        const w = new THREE.CylinderGeometry(0.5, 0.5, 0.3, 12);
        w.rotateZ(Math.PI / 2);
        return w;
      }, tire, sx * 1.05, 0.5, z));
      break;
    case 'bus':
      length = 11;
      width = 2.5;
      add('abus-body', () => new THREE.BoxGeometry(2.5, 2.7, 10.8), paint, 0, 1.9, 0);
      add('abus-win', () => new THREE.BoxGeometry(2.52, 0.9, 9.4), glass, 0, 2.3, -0.2);
      add('abus-ws', () => new THREE.BoxGeometry(2.3, 1.0, 0.1), glass, 0, 2.2, 5.42);
      for (const sx of [-1, 1]) for (const z of [3.6, -3.6]) wheels.push(add('abus-wheel', () => {
        const w = new THREE.CylinderGeometry(0.5, 0.5, 0.3, 12);
        w.rotateZ(Math.PI / 2);
        return w;
      }, tire, sx * 1.1, 0.5, z));
      break;
    case 'ambulance': {
      length = 5.6;
      width = 2.0;
      const white = mat('amb-white', () => new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.4 }));
      add('amb-body', () => new THREE.BoxGeometry(2.0, 1.9, 5.5), white, 0, 1.4, 0);
      add('amb-stripe', () => new THREE.BoxGeometry(2.02, 0.25, 5.2), mat('amb-red', () => new THREE.MeshStandardMaterial({ color: 0xd8232a })), 0, 1.2, -0.1);
      add('amb-win', () => new THREE.BoxGeometry(1.9, 0.6, 0.1), glass, 0, 1.9, 2.75);
      beacon = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2020, emissiveIntensity: 0 });
      const bar = new THREE.Mesh(geo('amb-bar', () => new THREE.BoxGeometry(1.5, 0.18, 0.3)), beacon);
      bar.position.set(0, 2.45, 1.8);
      g.add(bar);
      for (const sx of [-1, 1]) for (const z of [1.7, -1.7]) wheels.push(add('amb-wheel', wheelGeo, tire, sx * 0.98, 0.36, z));
      break;
    }
  }
  // lights
  const zf = length / 2;
  for (const sx of [-1, 1]) {
    add('t-head', () => new THREE.BoxGeometry(0.32, 0.14, 0.05), headM, sx * (width / 2 - 0.35), kind === 'car' ? 0.7 : 0.95, zf + 0.02, false);
    const b = new THREE.Mesh(geo('t-tail', () => new THREE.BoxGeometry(0.34, 0.16, 0.05)), brake);
    b.position.set(sx * (width / 2 - 0.35), kind === 'car' ? 0.75 : 1.0, -zf - 0.02);
    g.add(b);
  }
  return { group: g, length, width, beacon, brake, wheels };
}

export function disposeTrafficCaches(): void {
  for (const g of trafficGeoCache.values()) g.dispose();
  for (const m of trafficMatCache.values()) m.dispose();
  trafficGeoCache.clear();
  trafficMatCache.clear();
}
