import * as THREE from 'three';
import type { RouteSpec, StopDef } from '../systems/RouteManager';
import type { RenderQuality } from '../core/PerformanceManager';
import { RoadPath } from './RoadPath';
import { SceneryField, type SceneryItem } from './SceneryField';
import { BAY_WIDTH, bayWidthAt } from './roadGeometry';
import { asphaltTexture, concreteTexture, facadeTexture, grassTexture, labelTexture, speedSignTexture, warningSignTexture } from './Textures';
import { clamp, lerp } from '../core/utils';

export interface WorldLabels {
  city: (id: string) => string;
  rest: (nameKey: string) => string;
  tollText: string;
  restSub: string;
  terminalSub: string;
}

export type LightPhase = 'green' | 'yellow' | 'red';

interface LightHead {
  discs: Record<LightPhase, THREE.Mesh>;
}

const STEP = 8;

function pushStrip(
  pos: number[],
  uv: number[],
  idx: number[],
  path: RoadPath,
  s0: number,
  s1: number,
  dA: (s: number) => number,
  dB: (s: number) => number,
  yA: (s: number) => number,
  yB: (s: number) => number,
  uTile: number,
  vTile: number,
  step = STEP,
): void {
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  const base = pos.length / 3;
  for (let i = 0; i <= n; i++) {
    const s = Math.min(s1, s0 + (i * (s1 - s0)) / n);
    const p = path.at(s);
    const rx = -Math.cos(p.h);
    const rz = Math.sin(p.h);
    const a = dA(s);
    const b = dB(s);
    pos.push(p.x + rx * a, p.y + yA(s), p.z + rz * a, p.x + rx * b, p.y + yB(s), p.z + rz * b);
    uv.push(a * uTile, s * vTile, b * uTile, s * vTile);
  }
  for (let i = 0; i < n; i++) {
    const a = base + i * 2;
    // winding so that the normal points up (A = smaller lateral offset, B = larger)
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

function makeGeometry(pos: number[], uv: number[], idx: number[], normals = true): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (normals) g.computeVertexNormals();
  return g;
}

/**
 * Builds and updates the whole road environment for one route: asphalt, markings, terrain,
 * barriers, terminals, signs, traffic lights, roadworks and instanced roadside scenery.
 */
export class RoadWorld {
  readonly group = new THREE.Group();
  readonly path: RoadPath;
  readonly scenery: SceneryField;
  readonly lightHeads: { s: number; heads: LightHead[] }[] = [];
  private roadMat!: THREE.MeshStandardMaterial;
  private farPlane!: THREE.Mesh;
  private lampHeadMat!: THREE.MeshStandardMaterial;
  private windowMats: THREE.MeshStandardMaterial[] = [];
  private instances: Record<string, THREE.InstancedMesh> = {};
  private lastScenerySlot = -1e9;
  private radarFlash: { mesh: THREE.Mesh; until: number }[] = [];
  private disposables: { dispose(): void }[] = [];
  private quality: RenderQuality;
  private nightAmount = 0;

  constructor(
    readonly spec: RouteSpec,
    quality: RenderQuality,
    private readonly labels: WorldLabels,
  ) {
    this.quality = quality;
    this.path = new RoadPath({
      seed: spec.seed,
      length: spec.playLengthM,
      difficulty: spec.difficulty,
      hilly: spec.hilly,
      highway: spec.highway,
      flatZones: [...spec.stops.map((s) => ({ from: s.s - 90, to: s.s + 90 })), ...spec.towns.map((t) => ({ from: t.from, to: t.to }))],
    });
    const p = spec.profile;
    this.scenery = new SceneryField({
      seed: spec.seed,
      playLength: spec.playLengthM,
      edge: p.halfWidth + p.shoulder,
      towns: spec.towns,
      stopS: spec.stops.map((s) => s.s),
      density: quality.sceneryDensity,
    });
    this.buildRoad();
    this.buildTerrain();
    this.buildMarkings();
    this.buildMedian();
    this.buildTerminals();
    this.buildSigns();
    this.buildTrafficLights();
    this.buildRoadworks();
    this.buildInstanced();
    this.update(0, new THREE.Vector3(0, 0, 0), 0);
  }

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  // ---------------------------------------------------------------- road surface

  private buildRoad(): void {
    const { path, spec } = this;
    const hw = spec.profile.halfWidth;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    pushStrip(pos, uv, idx, path, 0, path.length, () => -hw, (s) => hw + bayWidthAt(spec.stops, s), () => 0, () => 0, 1 / 4, 1 / 4);
    const geo = this.track(makeGeometry(pos, uv, idx));
    const tex = asphaltTexture();
    this.roadMat = this.track(new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.92, metalness: 0.0, envMapIntensity: 0.4 }));
    const mesh = new THREE.Mesh(geo, this.roadMat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildTerrain(): void {
    const { path, spec } = this;
    const hw = spec.profile.halfWidth;
    const sh = spec.profile.shoulder;
    const grass = grassTexture();
    const conc = concreteTexture();
    const grassMat = this.track(new THREE.MeshStandardMaterial({ map: grass, roughness: 1, metalness: 0 }));
    const shoulderMat = this.track(new THREE.MeshStandardMaterial({ map: conc, color: 0xbdb7a5, roughness: 0.95 }));
    const far = 100;
    for (const side of [-1, 1] as const) {
      const road = (s: number) => (side < 0 ? -hw : hw + bayWidthAt(spec.stops, s));
      // shoulder
      {
        const pos: number[] = [];
        const uv: number[] = [];
        const idx: number[] = [];
        const a = (s: number) => road(s) * 1;
        const b = (s: number) => road(s) + side * sh;
        if (side < 0) pushStrip(pos, uv, idx, path, 0, path.length, b, a, () => -0.03, () => -0.01, 1 / 4, 1 / 4);
        else pushStrip(pos, uv, idx, path, 0, path.length, a, b, () => -0.01, () => -0.03, 1 / 4, 1 / 4);
        const m = new THREE.Mesh(this.track(makeGeometry(pos, uv, idx)), shoulderMat);
        m.receiveShadow = true;
        this.group.add(m);
      }
      // grass
      {
        const pos: number[] = [];
        const uv: number[] = [];
        const idx: number[] = [];
        const a = (s: number) => road(s) + side * sh;
        const b = (s: number) => road(s) + side * far;
        if (side < 0) pushStrip(pos, uv, idx, path, 0, path.length, b, a, () => -4, () => -0.04, 1 / 8, 1 / 8, 16);
        else pushStrip(pos, uv, idx, path, 0, path.length, a, b, () => -0.04, () => -4, 1 / 8, 1 / 8, 16);
        const m = new THREE.Mesh(this.track(makeGeometry(pos, uv, idx)), grassMat);
        m.receiveShadow = true;
        this.group.add(m);
      }
    }
    // far ground (follows the player, always below the terrain ribbon)
    const fg = this.track(new THREE.PlaneGeometry(6000, 6000));
    fg.rotateX(-Math.PI / 2);
    const fm = this.track(new THREE.MeshStandardMaterial({ color: 0x4c6b3a, roughness: 1 }));
    this.farPlane = new THREE.Mesh(fg, fm);
    this.farPlane.position.y = -6;
    this.group.add(this.farPlane);
  }

  private buildMarkings(): void {
    const { path, spec } = this;
    const p = spec.profile;
    const white = { pos: [] as number[], uv: [] as number[], idx: [] as number[] };
    const yellow = { pos: [] as number[], uv: [] as number[], idx: [] as number[] };
    const line = (target: typeof white, s0: number, s1: number, d: number, w: number) =>
      pushStrip(target.pos, target.uv, target.idx, path, s0, s1, () => d - w / 2, () => d + w / 2, () => 0.025, () => 0.025, 1, 1, 4);
    const inTown = (s: number) => spec.towns.some((t) => s >= t.from && s <= t.to);

    // centre line
    if (p.median === 0) {
      let s = 0;
      while (s < path.length) {
        const k = Math.abs(path.at(s).k);
        const solid = inTown(s) || k > 0.0016;
        if (solid) {
          // double solid
          line(yellow, s, Math.min(path.length, s + 8), -0.12, 0.12);
          line(yellow, s, Math.min(path.length, s + 8), 0.12, 0.12);
          s += 8;
        } else {
          line(white, s, Math.min(path.length, s + 3), 0, 0.14);
          s += 9;
        }
      }
    } else {
      // lane dividers (dashed) between the two lanes in each direction
      const mid = (p.lanesSame[0] + p.lanesSame[1]) / 2;
      for (let s = 0; s < path.length; s += 12) {
        line(white, s, Math.min(path.length, s + 4), mid, 0.13);
        line(white, s, Math.min(path.length, s + 4), -mid, 0.13);
      }
    }
    // edge lines (broken at bays)
    const edge = p.halfWidth - 0.25;
    line(white, 0, path.length, -edge, 0.15);
    let runStart = -1;
    for (let s = 0; s <= path.length; s += 4) {
      const bay = bayWidthAt(spec.stops, s) > 0.3;
      if (!bay && runStart < 0) runStart = s;
      if ((bay || s >= path.length) && runStart >= 0) {
        line(white, runStart, s, edge, 0.15);
        runStart = -1;
      }
    }
    // bus bays: yellow outline + stop box
    for (const st of spec.stops) {
      line(yellow, st.s - 14, st.s + 14, p.halfWidth + 0.3, 0.12);
      line(yellow, st.s - 14, st.s + 14, p.halfWidth + BAY_WIDTH - 0.3, 0.12);
      pushStrip(yellow.pos, yellow.uv, yellow.idx, path, st.s - 14, st.s - 13.85, () => p.halfWidth + 0.3, () => p.halfWidth + BAY_WIDTH - 0.3, () => 0.025, () => 0.025, 1, 1, 1);
      pushStrip(yellow.pos, yellow.uv, yellow.idx, path, st.s + 13.85, st.s + 14, () => p.halfWidth + 0.3, () => p.halfWidth + BAY_WIDTH - 0.3, () => 0.025, () => 0.025, 1, 1, 1);
    }
    for (const [data, color] of [[white, 0xf2f2f2], [yellow, 0xf2c230]] as const) {
      if (data.pos.length === 0) continue;
      const mat = this.track(new THREE.MeshStandardMaterial({ color, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      const m = new THREE.Mesh(this.track(makeGeometry(data.pos, data.uv, data.idx)), mat);
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  private buildMedian(): void {
    const { path, spec } = this;
    if (spec.profile.median <= 0) return;
    const w = spec.profile.median;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const H = 0.85;
    // top
    pushStrip(pos, uv, idx, path, 0, path.length, () => -w * 0.6, () => w * 0.6, () => H, () => H, 1, 1 / 4);
    const top = makeGeometry(pos, uv, idx);
    // sides: build as two strips lifted with different y
    const posL: number[] = [];
    const uvL: number[] = [];
    const idxL: number[] = [];
    pushStrip(posL, uvL, idxL, path, 0, path.length, () => -w * 0.8, () => -w * 0.6, () => 0, () => H, 1, 1 / 4);
    pushStrip(posL, uvL, idxL, path, 0, path.length, () => w * 0.6, () => w * 0.8, () => H, () => 0, 1, 1 / 4);
    const sides = makeGeometry(posL, uvL, idxL);
    const mat = this.track(new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.9, side: THREE.DoubleSide }));
    const a = new THREE.Mesh(this.track(top), mat);
    const b = new THREE.Mesh(this.track(sides), mat);
    a.castShadow = true;
    this.group.add(a, b);
  }

  // ---------------------------------------------------------------- terminals

  private buildTerminals(): void {
    const { path, spec } = this;
    const hw = spec.profile.halfWidth;
    const concrete = this.track(new THREE.MeshStandardMaterial({ map: concreteTexture(), color: 0xcfcfc8, roughness: 0.9 }));
    const glass = this.track(new THREE.MeshStandardMaterial({ color: 0x1d3a52, roughness: 0.08, metalness: 0.9, transparent: true, opacity: 0.7 }));
    const roofMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2e3640, roughness: 0.6, metalness: 0.3 }));
    const wall = this.track(new THREE.MeshStandardMaterial({ color: 0xdcd6c8, roughness: 0.85 }));
    const accent = this.track(new THREE.MeshStandardMaterial({ color: 0xf5a524, roughness: 0.5 }));
    const box = (w: number, h: number, d: number, m: THREE.Material) => {
      const g = this.track(new THREE.BoxGeometry(w, h, d));
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };
    for (const st of spec.stops) {
      const rest = st.kind === 'rest';
      const c = path.at(st.s);
      const g = new THREE.Group();
      g.position.set(c.x, c.y, c.z);
      g.rotation.y = c.h;
      // local frame: +z forward, +x = LEFT, so the right-hand side (our side) is local -x
      const platformDepth = 3.4;
      const d0 = hw + BAY_WIDTH;
      const platform = box(rest ? 26 : 42, 0.2, platformDepth, concrete);
      platform.position.set(-(d0 + 0.2 + platformDepth / 2), 0.1, 0);
      g.add(platform);
      // building
      const bw = rest ? 16 : 30;
      const bd = rest ? 9 : 10;
      const bh = rest ? 4 : 6;
      const bx = -(d0 + 0.2 + platformDepth + bd / 2 + 1.5);
      const body = box(bd, bh, bw, wall);
      body.position.set(bx, bh / 2, 0);
      g.add(body);
      const frontGlass = box(0.15, bh * 0.55, bw * 0.85, glass);
      frontGlass.position.set(bx + bd / 2 + 0.05, bh * 0.4, 0);
      g.add(frontGlass);
      const roof = box(bd + 1, 0.4, bw + 1, roofMat);
      roof.position.set(bx, bh + 0.2, 0);
      g.add(roof);
      const stripe = box(0.2, 0.5, bw + 0.4, accent);
      stripe.position.set(bx + bd / 2 + 0.1, bh - 0.4, 0);
      g.add(stripe);
      // canopy over the platform
      const canopyL = rest ? 20 : 36;
      const canopy = box(platformDepth + 0.8, 0.18, canopyL, roofMat);
      canopy.position.set(platform.position.x, 3.6, 0);
      g.add(canopy);
      for (const z of [-canopyL / 2 + 1, 0, canopyL / 2 - 1]) {
        const post = box(0.16, 3.4, 0.16, roofMat);
        post.position.set(platform.position.x + platformDepth / 2 - 0.2, 1.8, z);
        g.add(post);
      }
      // benches
      for (const z of [-6, 6]) {
        const bench = box(0.6, 0.45, 2.2, accent);
        bench.position.set(platform.position.x - platformDepth / 2 + 0.6, 0.45, z);
        g.add(bench);
      }
      // name sign on the roof
      const name = st.kind === 'terminal' ? this.labels.city(st.cityId!) : this.labels.rest(st.nameKey);
      const signTex = labelTexture(name.toUpperCase(), rest ? '#6b3a12' : '#12315f', '#ffffff', 512, 128, rest ? this.labels.restSub : this.labels.terminalSub);
      const signMat = this.track(new THREE.MeshBasicMaterial({ map: signTex }));
      const sign = new THREE.Mesh(this.track(new THREE.PlaneGeometry(10, 2.5)), signMat);
      sign.position.set(bx + bd / 2 + 0.3, bh + 1.9, 0);
      sign.rotation.y = Math.PI / 2;
      g.add(sign);
      const back = sign.clone();
      back.position.x = bx - bd / 2 - 0.3;
      back.rotation.y = -Math.PI / 2;
      g.add(back);
      // bus stop pole
      const pole = box(0.12, 3.2, 0.12, roofMat);
      pole.position.set(platform.position.x + platformDepth / 2, 1.6, 8);
      g.add(pole);
      const plate = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.9, 0.9)), this.track(new THREE.MeshBasicMaterial({ map: labelTexture('BUS', '#f5a524', '#111', 128, 128) })));
      plate.position.set(platform.position.x + platformDepth / 2 + 0.07, 3.0, 8);
      plate.rotation.y = Math.PI / 2;
      g.add(plate);
      if (rest) {
        // fuel pumps (decor)
        for (const z of [-7, 7]) {
          const pump = box(0.6, 1.5, 0.6, accent);
          pump.position.set(bx + bd / 2 + 2.5, 0.75, z);
          g.add(pump);
        }
      }
      this.group.add(g);
    }
  }

  // ---------------------------------------------------------------- signs, lights, works

  private signAt(s: number, side: 1 | -1, tex: THREE.Texture, size = 0.9): void {
    const { path, spec } = this;
    const c = path.at(s);
    const p = spec.profile;
    const d = side * (p.halfWidth + p.shoulder + 0.7);
    const w = path.lanePos(s, d);
    const poleMat = this.track(new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.6, roughness: 0.5 }));
    const pole = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6)), poleMat);
    pole.position.set(w.x, w.y + 1.3, w.z);
    pole.castShadow = true;
    const face = new THREE.Mesh(this.track(new THREE.PlaneGeometry(size, size)), this.track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })));
    face.position.set(w.x, w.y + 2.4, w.z);
    face.rotation.y = c.h + (side > 0 ? Math.PI : 0);
    this.group.add(pole, face);
  }

  private buildSigns(): void {
    for (const z of this.spec.speedZones) {
      if (z.kind === 'roadworks') {
        this.signAt(z.from - 60, 1, warningSignTexture('roadworks'), 1.1);
        this.signAt(z.from - 5, 1, speedSignTexture(z.limit));
      } else {
        this.signAt(z.from + 12, 1, speedSignTexture(z.limit));
      }
    }
    for (const j of this.spec.jams) this.signAt(j.from - 120, 1, warningSignTexture('jam'), 1.2);
    for (const r of this.spec.radars) {
      const w = this.path.lanePos(r.s, this.spec.profile.halfWidth + this.spec.profile.shoulder + 1.4);
      const mat = this.track(new THREE.MeshStandardMaterial({ color: 0x59606a, metalness: 0.7, roughness: 0.4 }));
      const pole = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.1, 0.12, 3.2, 8)), mat);
      pole.position.set(w.x, w.y + 1.6, w.z);
      const flashMat = this.track(new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 0 }));
      const head = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.5, 0.35, 0.4)), flashMat);
      head.position.set(w.x, w.y + 3.3, w.z);
      this.group.add(pole, head);
      this.radarFlash.push({ mesh: head, until: 0 });
    }
    if (this.spec.highway) {
      // toll gantry
      const s = 1300;
      const p = this.spec.profile;
      const c = this.path.at(s);
      const g = new THREE.Group();
      g.position.set(c.x, c.y, c.z);
      g.rotation.y = c.h;
      const mat = this.track(new THREE.MeshStandardMaterial({ color: 0x3b4450, metalness: 0.5, roughness: 0.5 }));
      const span = (p.halfWidth + p.shoulder) * 2 + 1;
      const beam = new THREE.Mesh(this.track(new THREE.BoxGeometry(span, 0.9, 0.8)), mat);
      beam.position.y = 6;
      g.add(beam);
      for (const x of [-span / 2, span / 2]) {
        const col = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.6, 6, 0.6)), mat);
        col.position.set(x, 3, 0);
        g.add(col);
      }
      const sign = new THREE.Mesh(this.track(new THREE.PlaneGeometry(6, 1.2)), this.track(new THREE.MeshBasicMaterial({ map: labelTexture(this.labels.tollText, '#0b6b3a', '#fff', 512, 100) })));
      sign.position.set(0, 6, -0.45);
      sign.rotation.y = Math.PI;
      g.add(sign);
      this.group.add(g);
    }
  }

  private buildTrafficLights(): void {
    const { spec, path } = this;
    const p = spec.profile;
    const poleMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.5, roughness: 0.5 }));
    const boxMat = this.track(new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.6 }));
    for (const s of spec.trafficLights) {
      const heads: LightHead[] = [];
      for (const side of [1, -1] as const) {
        const w = path.lanePos(s, side * (p.halfWidth + p.shoulder + 0.6));
        const c = path.at(s);
        const g = new THREE.Group();
        g.position.set(w.x, w.y, w.z);
        // side +1 (right of our direction) faces back toward our traffic; side -1 faces opposing traffic
        g.rotation.y = c.h + (side > 0 ? Math.PI : 0);
        const pole = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.08, 0.1, 4.6, 8)), poleMat);
        pole.position.y = 2.3;
        pole.castShadow = true;
        g.add(pole);
        const head = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.42, 1.2, 0.3)), boxMat);
        head.position.set(0, 4.5, 0.1);
        g.add(head);
        const discs = {} as Record<LightPhase, THREE.Mesh>;
        const defs: [LightPhase, number, number][] = [
          ['red', 0xff2222, 0.38],
          ['yellow', 0xffb020, 0],
          ['green', 0x22dd55, -0.38],
        ];
        for (const [phase, color, y] of defs) {
          const m = this.track(new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 0.05 }));
          const disc = new THREE.Mesh(this.track(new THREE.CircleGeometry(0.13, 12)), m);
          disc.position.set(0, 4.5 + y, 0.26);
          g.add(disc);
          discs[phase] = disc;
        }
        this.group.add(g);
        heads.push({ discs });
      }
      this.lightHeads.push({ s, heads });
    }
  }

  setLightState(index: number, phase: LightPhase): void {
    const l = this.lightHeads[index];
    if (!l) return;
    for (const h of l.heads) {
      for (const k of ['red', 'yellow', 'green'] as LightPhase[]) {
        const m = h.discs[k].material as THREE.MeshStandardMaterial;
        m.emissiveIntensity = k === phase ? 2.2 : 0.04;
      }
    }
  }

  flashRadar(index: number, nowMs: number): void {
    const r = this.radarFlash[index];
    if (r) r.until = nowMs + 250;
  }

  private buildRoadworks(): void {
    const { spec, path } = this;
    const p = spec.profile;
    const zones = spec.speedZones.filter((z) => z.kind === 'roadworks');
    if (zones.length === 0) return;
    const pts: { x: number; y: number; z: number }[] = [];
    for (const z of zones) {
      for (let s = z.from; s <= z.to; s += 8) {
        const w = path.lanePos(s, p.halfWidth - 0.6);
        pts.push(w);
        if (p.median === 0) {
          // taper into the lane at the beginning of the zone
        }
      }
    }
    const cone = this.track(new THREE.ConeGeometry(0.22, 0.7, 8));
    const mat = this.track(new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.6, emissive: 0x331100 }));
    const im = new THREE.InstancedMesh(cone, mat, pts.length);
    const m = new THREE.Matrix4();
    pts.forEach((pt, i) => {
      m.makeTranslation(pt.x, pt.y + 0.35, pt.z);
      im.setMatrixAt(i, m);
    });
    im.castShadow = true;
    this.group.add(im);
  }

  // ---------------------------------------------------------------- instanced scenery

  private buildInstanced(): void {
    const cap = 600;
    const trunk = this.track(new THREE.CylinderGeometry(0.22, 0.32, 2.6, 6));
    trunk.translate(0, 1.3, 0);
    const crown1 = this.track(new THREE.ConeGeometry(2.0, 4.2, 7));
    crown1.translate(0, 4.2, 0);
    const crown2 = this.track(new THREE.ConeGeometry(1.5, 3.4, 7));
    crown2.translate(0, 6.2, 0);
    const trunkMat = this.track(new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 1 }));
    const crownMat = this.track(new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.95 }));
    const mk = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) => {
      const im = new THREE.InstancedMesh(geo, mat, cap);
      im.count = 0;
      im.castShadow = shadow;
      im.receiveShadow = true;
      im.frustumCulled = false;
      this.instances[name] = im;
      this.group.add(im);
      return im;
    };
    mk('trunk', trunk, trunkMat);
    const c1 = mk('crown1', crown1, crownMat);
    mk('crown2', crown2, crownMat);
    c1.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);

    const rock = this.track(new THREE.DodecahedronGeometry(1, 0));
    rock.translate(0, 0.4, 0);
    mk('rock', rock, this.track(new THREE.MeshStandardMaterial({ color: 0x777b80, roughness: 1, flatShading: true })));

    const pole = this.track(new THREE.CylinderGeometry(0.07, 0.1, 7, 6));
    pole.translate(0, 3.5, 0);
    const arm = this.track(new THREE.BoxGeometry(1.8, 0.1, 0.12));
    arm.translate(0.9, 7, 0);
    const poleMat = this.track(new THREE.MeshStandardMaterial({ color: 0x4a5058, metalness: 0.6, roughness: 0.5 }));
    mk('lamp', pole, poleMat);
    mk('lampArm', arm, poleMat);
    const head = this.track(new THREE.BoxGeometry(0.5, 0.14, 0.26));
    head.translate(1.7, 6.93, 0);
    this.lampHeadMat = this.track(new THREE.MeshStandardMaterial({ color: 0x555555, emissive: 0xffd9a0, emissiveIntensity: 0 }));
    mk('lampHead', head, this.lampHeadMat, false);

    // buildings in 3 height classes with matching window texture repeat
    const classes: { name: string; h: number }[] = [
      { name: 'bLow', h: 9 },
      { name: 'bMid', h: 16 },
      { name: 'bHigh', h: 26 },
    ];
    classes.forEach((c, i) => {
      const geo = this.track(new THREE.BoxGeometry(1, 1, 1));
      geo.translate(0, 0.5, 0);
      const map = facadeTexture(false, i).clone();
      map.repeat.set(2, c.h / 9);
      map.needsUpdate = true;
      const em = facadeTexture(true, i).clone();
      em.repeat.set(2, c.h / 9);
      em.needsUpdate = true;
      const mat = this.track(new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.9 }));
      this.windowMats.push(mat);
      mk(c.name, geo, mat);
    });
  }

  private refreshInstances(s: number): void {
    const slot = Math.floor(s / 14);
    if (slot === this.lastScenerySlot) return;
    this.lastScenerySlot = slot;
    const view = this.quality.viewDistance;
    const items = this.scenery.itemsInRange(s - 180, s + Math.min(900, view * 1.05));
    const counts: Record<string, number> = {};
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const col = new THREE.Color();
    const put = (name: string, matrix: THREE.Matrix4) => {
      const im = this.instances[name];
      const n = counts[name] ?? 0;
      if (n >= im.instanceMatrix.count) return n;
      im.setMatrixAt(n, matrix);
      counts[name] = n + 1;
      return n;
    };
    for (const it of items) {
      const w = this.path.lanePos(it.s, it.d);
      pos.set(w.x, w.y, w.z);
      if (it.kind === 'tree') {
        e.set(0, it.rot, 0);
        q.setFromEuler(e);
        sc.set(it.scale, it.scale * (0.9 + (it.variant % 3) * 0.12), it.scale);
        m.compose(pos, q, sc);
        const n = put('trunk', m);
        put('crown1', m);
        put('crown2', m);
        const green = 0.32 + (it.variant % 3) * 0.06 + (it.rot % 1) * 0.08;
        col.setRGB(0.18 + (it.rot % 0.7) * 0.1, green + 0.2, 0.18);
        (this.instances.crown1.instanceColor as THREE.InstancedBufferAttribute).setXYZ(n, col.r, col.g, col.b);
      } else if (it.kind === 'rock') {
        e.set(0, it.rot, 0);
        q.setFromEuler(e);
        sc.set(it.scale, it.scale * 0.7, it.scale);
        m.compose(pos, q, sc);
        put('rock', m);
      } else if (it.kind === 'lamp') {
        // arm points toward the road: local +x must point to the centre line
        const toward = it.d > 0 ? 1 : -1;
        const c = this.path.at(it.s);
        e.set(0, c.h + (toward > 0 ? 0 : Math.PI), 0);
        q.setFromEuler(e);
        sc.set(1, 1, 1);
        m.compose(pos, q, sc);
        put('lamp', m);
        put('lampArm', m);
        put('lampHead', m);
      } else if (it.kind === 'building') {
        const c = this.path.at(it.s);
        e.set(0, c.h, 0);
        q.setFromEuler(e);
        const cls = it.height < 12 ? 'bLow' : it.height < 20 ? 'bMid' : 'bHigh';
        const h = cls === 'bLow' ? 9 : cls === 'bMid' ? 16 : 26;
        sc.set(it.depth, h, it.w);
        m.compose(pos, q, sc);
        put(cls, m);
      }
    }
    for (const [name, im] of Object.entries(this.instances)) {
      im.count = counts[name] ?? 0;
      im.instanceMatrix.needsUpdate = true;
    }
    if (this.instances.crown1.instanceColor) this.instances.crown1.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- per frame

  /** night: 0 (day) .. 1 (night). */
  update(playerS: number, playerPos: THREE.Vector3, night: number, nowMs = 0): void {
    this.refreshInstances(playerS);
    this.farPlane.position.x = Math.round(playerPos.x / 50) * 50;
    this.farPlane.position.z = Math.round(playerPos.z / 50) * 50;
    this.farPlane.position.y = this.path.at(clamp(playerS, 0, this.path.length)).y - 5;
    if (Math.abs(night - this.nightAmount) > 0.01) {
      this.nightAmount = night;
      this.lampHeadMat.emissiveIntensity = night * 3;
      for (const m of this.windowMats) m.emissiveIntensity = night * 1.2;
    }
    for (const r of this.radarFlash) {
      (r.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = nowMs < r.until ? 6 : 0;
    }
  }

  setWet(wet: number): void {
    this.roadMat.roughness = lerp(0.92, 0.3, wet);
    this.roadMat.color.setScalar(lerp(1, 0.62, wet));
    this.roadMat.envMapIntensity = lerp(0.4, 1.6, wet);
    this.roadMat.metalness = lerp(0, 0.08, wet);
  }

  dispose(): void {
    this.group.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) im.dispose();
    });
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.group.clear();
  }

  /** helper for passengers etc.: where is the platform edge for a stop (world position) */
  platformPoint(stop: StopDef, along = 0): { x: number; y: number; z: number } {
    const p = this.spec.profile;
    return this.path.lanePos(stop.s + along, p.halfWidth + BAY_WIDTH + 1.4);
  }

  /** world position beside the bus door. */
  doorPoint(stop: StopDef): { x: number; y: number; z: number } {
    const p = this.spec.profile;
    return this.path.lanePos(stop.s + 3.2, p.halfWidth + BAY_WIDTH / 2 + 1.35);
  }
}
