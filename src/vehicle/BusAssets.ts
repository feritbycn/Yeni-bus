import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Imported coach assets (public/models/RM_Bus_NN.glb).
 *
 * The files are procedural prototypes: Z-up, nose towards +X, one flat vertex-coloured mesh per part and a fixed
 * colour palette (glass / tyre / rim / hub / head-light / red lamp). parseShell() converts one of them into the
 * game's coordinate system (nose +z, passenger door on the right = -x, y up), sorts the parts by role and merges
 * them, so a BusRig can paint, light and animate them. Geometry is shared between rigs and never disposed per rig.
 */

export interface ShellWheel {
  /** tyre centre in bus space (the pivot of the spin / steering group) */
  center: THREE.Vector3;
  front: boolean;
  /** geometries already centred on `center` */
  tire: THREE.BufferGeometry;
  rim: THREE.BufferGeometry | null;
  hub: THREE.BufferGeometry | null;
}

export interface ShellTemplate {
  body: THREE.BufferGeometry | null;
  glass: THREE.BufferGeometry | null;
  /** polished metal (roof units, bumpers, rims-like trim) with vertex colours */
  chrome: THREE.BufferGeometry | null;
  /** everything else with vertex colours (accent stripes, mirrors, lamps housings ...) */
  trim: THREE.BufferGeometry | null;
  headLamps: THREE.BufferGeometry | null;
  /** small front lamps: left (+x) and right (-x) */
  signalLeft: THREE.BufferGeometry | null;
  signalRight: THREE.BufferGeometry | null;
  wheels: ShellWheel[];
  /** passenger door opening on the right side (x < 0), if the model has one */
  door: { x: number; zMin: number; zMax: number; yMin: number; yMax: number } | null;
  /** front face of the upper (roof) section and its top, for the destination board */
  roofFront: { z: number; yTop: number } | null;
  bounds: THREE.Box3;
}

const ROLE: Record<string, string> = {
  '32586e': 'glass',
  b8bec4: 'chrome',
  '2a2e32': 'tire',
  ffeaad: 'head',
  ed4f38: 'signal',
  '606568': 'hub',
};

// glb (X forward, Y left, Z up) -> game (z forward, x right-negative, y up). Determinant -1: winding is flipped below.
const M = new THREE.Matrix4().set(
  0, -1, 0, 0,
  0, 0, 1, 0,
  1, 0, 0, 0,
  0, 0, 0, 1,
);

const srgbToLinear = (v: number): number => (v < 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

interface Part {
  geo: THREE.BufferGeometry;
  role: string;
  box: THREE.Box3;
  center: THREE.Vector3;
}

function flipWinding(geo: THREE.BufferGeometry): void {
  const idx = geo.getIndex();
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
    idx.needsUpdate = true;
  } else {
    for (const name of Object.keys(geo.attributes)) {
      const at = geo.getAttribute(name);
      const n = at.itemSize;
      for (let i = 0; i < at.count; i += 3) {
        for (let k = 0; k < n; k++) {
          const a = at.getComponent(i + 1, k);
          at.setComponent(i + 1, k, at.getComponent(i + 2, k));
          at.setComponent(i + 2, k, a);
        }
      }
    }
  }
}

function merge(parts: Part[]): THREE.BufferGeometry | null {
  if (!parts.length) return null;
  const geos = parts.map((p) => p.geo);
  return geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
}

/** Pure conversion (no network): used by the loader and by tests. */
export function parseShell(scene: THREE.Object3D): ShellTemplate {
  scene.updateMatrixWorld(true);
  const parts: Part[] = [];
  let bodyKey: string | null = null;
  const tmp = new THREE.Color();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone();
    const col = g.getAttribute('color');
    if (!col) return;
    tmp.setRGB(col.getX(0), col.getY(0), col.getZ(0));
    const key = tmp.getHexString();
    if (bodyKey === null) bodyKey = key; // the first part is always the main body block
    // the files store sRGB bytes in a linear attribute: convert so the colours look like the catalogue
    const rgb = new Float32Array(col.count * 3);
    for (let i = 0; i < col.count; i++) {
      rgb[i * 3] = srgbToLinear(col.getX(i));
      rgb[i * 3 + 1] = srgbToLinear(col.getY(i));
      rgb[i * 3 + 2] = srgbToLinear(col.getZ(i));
    }
    g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'color') g.deleteAttribute(name);
    g.applyMatrix4(mesh.matrixWorld);
    g.applyMatrix4(M);
    flipWinding(g);
    g.computeBoundingBox();
    const box = g.boundingBox!.clone();
    parts.push({ geo: g, role: key === bodyKey ? 'body' : (ROLE[key] ?? 'trim'), box, center: box.getCenter(new THREE.Vector3()) });
  });

  const bounds = new THREE.Box3();
  for (const p of parts) bounds.union(p.box);

  // ---- wheels: tyre / rim / hub triplets low on the sides
  const isWheelPart = (p: Part) => (p.role === 'tire' || p.role === 'hub' || (p.role === 'chrome' && p.geo.getAttribute('position').count === 34)) && Math.abs(p.center.x) > 1.1 && p.box.max.y < 1.3;
  const wheelParts = parts.filter(isWheelPart);
  const tires = wheelParts.filter((p) => p.role === 'tire');
  const wheels: ShellWheel[] = [];
  const used = new Set<Part>();
  for (const t of tires) {
    const near = (p: Part) => p !== t && Math.sign(p.center.x) === Math.sign(t.center.x) && Math.abs(p.center.z - t.center.z) < 0.25 && Math.abs(p.center.y - t.center.y) < 0.25;
    const rim = wheelParts.find((p) => p.role === 'chrome' && near(p)) ?? null;
    const hub = wheelParts.find((p) => p.role === 'hub' && near(p)) ?? null;
    const c = t.center.clone();
    const shift = (g: THREE.BufferGeometry) => g.clone().translate(-c.x, -c.y, -c.z);
    wheels.push({ center: c, front: c.z > 0, tire: shift(t.geo), rim: rim ? shift(rim.geo) : null, hub: hub ? shift(hub.geo) : null });
    used.add(t);
    if (rim) used.add(rim);
    if (hub) used.add(hub);
  }

  // ---- door: the narrow glass pane on the right flank
  let door: ShellTemplate['door'] = null;
  const doorPart = parts.find((p) => p.role === 'glass' && p.center.x < -1.1 && p.box.max.z - p.box.min.z < 1.3);
  if (doorPart) {
    door = { x: doorPart.box.min.x, zMin: doorPart.box.min.z, zMax: doorPart.box.max.z, yMin: doorPart.box.min.y, yMax: doorPart.box.max.y };
    used.add(doorPart);
  }

  // ---- roof section
  const bodies = parts.filter((p) => p.role === 'body');
  const roof = bodies.reduce<Part | null>((best, p) => (!best || p.box.max.y > best.box.max.y ? p : best), null);
  const roofFront = roof ? { z: roof.box.max.z, yTop: roof.box.max.y } : null;

  const rest = parts.filter((p) => !used.has(p));
  const by = (role: string, pred: (p: Part) => boolean = () => true) => rest.filter((p) => p.role === role && pred(p));
  const sig = by('signal');
  return {
    body: merge(by('body')),
    glass: merge(by('glass')),
    chrome: merge(by('chrome')),
    trim: merge([...by('trim'), ...by('tire'), ...by('hub')]),
    headLamps: merge(by('head')),
    signalLeft: merge(sig.filter((p) => p.center.x > 0)),
    signalRight: merge(sig.filter((p) => p.center.x <= 0)),
    wheels,
    door,
    roofFront,
    bounds,
  };
}

const cache = new Map<string, ShellTemplate>();
const pending = new Map<string, Promise<ShellTemplate | null>>();
const failed = new Set<string>();

export const modelUrl = (file: string): string => `${import.meta.env.BASE_URL}models/${file}`;

export function shellIfLoaded(file: string | undefined): ShellTemplate | undefined {
  return file ? cache.get(file) : undefined;
}

/** true while a load for this file may still succeed (not cached, not failed) */
export function shellPending(file: string | undefined): boolean {
  return !!file && !cache.has(file) && !failed.has(file);
}

/** Loads (once) and converts a model. Resolves to null on failure; callers then fall back to the procedural bus. */
export function loadShell(file: string): Promise<ShellTemplate | null> {
  const hit = cache.get(file);
  if (hit) return Promise.resolve(hit);
  if (failed.has(file)) return Promise.resolve(null);
  let p = pending.get(file);
  if (!p) {
    p = new GLTFLoader()
      .loadAsync(modelUrl(file))
      .then((gltf) => {
        const t = parseShell(gltf.scene);
        cache.set(file, t);
        return t;
      })
      .catch((err) => {
        console.warn('Bus model failed to load, using the procedural bus:', file, err);
        failed.add(file);
        return null;
      })
      .finally(() => pending.delete(file));
    pending.set(file, p);
  }
  return p;
}
