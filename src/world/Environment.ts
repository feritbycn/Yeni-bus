import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Weather } from '../core/types';
import type { RenderQuality } from '../core/PerformanceManager';
import { clamp, lerp, mulberry32 } from '../core/utils';

interface Key {
  h: number;
  sun: number;
  sunColor: number;
  hemi: number;
  hemiSky: number;
  hemiGround: number;
  skyTop: number;
  skyHorizon: number;
  fog: number;
  exposure: number;
}

const KEYS: Key[] = [
  { h: 0, sun: 0, sunColor: 0x8899ff, hemi: 0.42, hemiSky: 0x24365e, hemiGround: 0x0c1018, skyTop: 0x040816, skyHorizon: 0x101b33, fog: 0x0a1020, exposure: 0.95 },
  { h: 5, sun: 0, sunColor: 0x8899ff, hemi: 0.5, hemiSky: 0x3a4a7a, hemiGround: 0x1a1a22, skyTop: 0x1a2b50, skyHorizon: 0x6b4a5c, fog: 0x3b3f58, exposure: 0.95 },
  { h: 6.5, sun: 1.4, sunColor: 0xffb070, hemi: 0.75, hemiSky: 0x9ab4d8, hemiGround: 0x5b4a3a, skyTop: 0x4b79b8, skyHorizon: 0xffc08a, fog: 0xd9b79b, exposure: 1.0 },
  { h: 9, sun: 2.8, sunColor: 0xfff1d8, hemi: 1.0, hemiSky: 0xa8c6ee, hemiGround: 0x5f6a4a, skyTop: 0x3f86d6, skyHorizon: 0xbfdcff, fog: 0xbcd4ee, exposure: 1.0 },
  { h: 13, sun: 3.3, sunColor: 0xffffff, hemi: 1.1, hemiSky: 0xb5d3f5, hemiGround: 0x66704f, skyTop: 0x2f7fe0, skyHorizon: 0xcfe6ff, fog: 0xc4dbf3, exposure: 1.0 },
  { h: 17, sun: 2.9, sunColor: 0xfff0d0, hemi: 1.0, hemiSky: 0xa9c4e8, hemiGround: 0x625a44, skyTop: 0x3a7fd0, skyHorizon: 0xf0e0c0, fog: 0xd6d0c0, exposure: 1.0 },
  { h: 19, sun: 1.5, sunColor: 0xff8a45, hemi: 0.7, hemiSky: 0x8a8fb8, hemiGround: 0x4a3a30, skyTop: 0x34508a, skyHorizon: 0xff9a5c, fog: 0xc98c6d, exposure: 1.0 },
  { h: 20.4, sun: 0.1, sunColor: 0xff6a40, hemi: 0.5, hemiSky: 0x4a5080, hemiGround: 0x1c1a24, skyTop: 0x1a2850, skyHorizon: 0x7a5a78, fog: 0x3a3a58, exposure: 0.95 },
  { h: 22, sun: 0, sunColor: 0x8899ff, hemi: 0.42, hemiSky: 0x24365e, hemiGround: 0x0c1018, skyTop: 0x040816, skyHorizon: 0x101b33, fog: 0x0a1020, exposure: 0.95 },
  { h: 24, sun: 0, sunColor: 0x8899ff, hemi: 0.42, hemiSky: 0x24365e, hemiGround: 0x0c1018, skyTop: 0x040816, skyHorizon: 0x101b33, fog: 0x0a1020, exposure: 0.95 },
];

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

function mixColor(out: THREE.Color, a: number, b: number, t: number): THREE.Color {
  tmpA.setHex(a);
  tmpB.setHex(b);
  return out.copy(tmpA).lerp(tmpB, t);
}

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
}`;

const SKY_FRAG = `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float sunPower;
varying vec3 vDir;
void main() {
  float h = clamp(vDir.y, -0.2, 1.0);
  float t = pow(max(h, 0.0), 0.55);
  vec3 col = mix(horizonColor, topColor, t);
  if (vDir.y < 0.0) col = mix(horizonColor, horizonColor * 0.6, clamp(-vDir.y * 4.0, 0.0, 1.0));
  float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
  col += sunColor * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.18) * sunPower;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** Sky, sun/moon, fog, shadows, stars, rain and reflections. Everything is procedural. */
export class Environment {
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xaaccff, 0x444444, 1);
  private sky!: THREE.Mesh;
  private skyMat!: THREE.ShaderMaterial;
  private stars!: THREE.Points;
  private rain: THREE.LineSegments | null = null;
  private rainBase: Float32Array | null = null;
  private rainAmount = 0;
  private rainTarget = 0;
  private fogColor = new THREE.Color();
  private weather: Weather = 'clear';
  private hour = 12;
  private quality: RenderQuality;
  private envMap: THREE.Texture | null = null;
  private time = 0;
  /** 0 = full day, 1 = night */
  night = 0;
  exposure = 1;

  constructor(
    readonly scene: THREE.Scene,
    quality: RenderQuality,
    renderer?: THREE.WebGLRenderer,
  ) {
    this.quality = quality;
    scene.fog = new THREE.Fog(0xbcd4ee, 80, quality.viewDistance);
    scene.add(this.hemi);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    this.configureShadow();
    scene.add(this.sun, this.sun.target);
    this.buildSky();
    this.buildStars();
    if (renderer) this.buildEnvMap(renderer);
    this.rebuildRain();
    this.setTime(12);
  }

  private buildEnvMap(renderer: THREE.WebGLRenderer): void {
    const pm = new THREE.PMREMGenerator(renderer);
    this.envMap = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.55;
    pm.dispose();
  }

  private configureShadow(): void {
    const sh = this.sun.shadow;
    sh.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
    const cam = sh.camera;
    cam.left = -45;
    cam.right = 45;
    cam.top = 45;
    cam.bottom = -45;
    cam.near = 1;
    cam.far = 260;
    cam.updateProjectionMatrix();
    if (sh.map) {
      sh.map.dispose();
      (sh as unknown as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
  }

  setQuality(q: RenderQuality): void {
    const sizeChanged = q.shadowMapSize !== this.quality.shadowMapSize;
    this.quality = q;
    this.sun.castShadow = q.shadows;
    if (sizeChanged) this.configureShadow();
    const fog = this.scene.fog as THREE.Fog;
    fog.far = this.fogFar();
    this.rebuildRain();
  }

  private buildSky(): void {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x3f86d6) },
        horizonColor: { value: new THREE.Color(0xbfdcff) },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color(0xffffff) },
        sunPower: { value: 1 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.skyMat);
    this.sky.scale.setScalar(3000);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  /** Keeps the sky dome and stars inside the camera far plane. */
  setSkyRadius(r: number): void {
    this.sky.scale.setScalar(r);
    this.stars.scale.setScalar(r / 2800);
  }

  private buildStars(): void {
    const n = 700;
    const pos = new Float32Array(n * 3);
    const rnd = mulberry32(99);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const y = Math.abs(u) * 0.95 + 0.05;
      pos[i * 3] = Math.cos(th) * r * 2800;
      pos[i * 3 + 1] = y * 2800;
      pos[i * 3 + 2] = Math.sin(th) * r * 2800;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  private rebuildRain(): void {
    if (this.rain) {
      this.scene.remove(this.rain);
      this.rain.geometry.dispose();
      (this.rain.material as THREE.Material).dispose();
      this.rain = null;
    }
    const n = this.quality.rainParticles;
    this.rainBase = new Float32Array(n * 3);
    const rnd = mulberry32(5);
    for (let i = 0; i < n; i++) {
      this.rainBase[i * 3] = (rnd() - 0.5) * 60;
      this.rainBase[i * 3 + 1] = rnd() * 28;
      this.rainBase[i * 3 + 2] = (rnd() - 0.5) * 60;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xcfe0f2, transparent: true, opacity: 0.32, fog: false, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = this.rainTarget > 0;
    this.scene.add(this.rain);
  }

  private fogFar(): number {
    const base = this.quality.viewDistance;
    if (this.weather === 'fog') return Math.min(base, 170);
    if (this.weather === 'rain') return base * 0.7;
    if (this.weather === 'cloudy') return base * 0.9;
    return base;
  }

  setWeather(w: Weather): void {
    this.weather = w;
    this.rainTarget = w === 'rain' ? 1 : 0;
    (this.scene.fog as THREE.Fog).far = this.fogFar();
    if (this.rain) this.rain.visible = this.rainTarget > 0 || this.rainAmount > 0.01;
    this.setTime(this.hour);
  }

  get currentWeather(): Weather {
    return this.weather;
  }

  /** 0..1 how wet roads are */
  get wetness(): number {
    return clamp(this.rainAmount, 0, 1);
  }

  setTime(hour: number): void {
    this.hour = ((hour % 24) + 24) % 24;
    const h = this.hour;
    let i = 0;
    while (i < KEYS.length - 2 && h >= KEYS[i + 1].h) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = clamp((h - a.h) / (b.h - a.h), 0, 1);
    const grey = this.weather === 'rain' ? 0.65 : this.weather === 'fog' ? 0.75 : this.weather === 'cloudy' ? 0.35 : 0;
    const dim = this.weather === 'rain' ? 0.45 : this.weather === 'fog' ? 0.55 : this.weather === 'cloudy' ? 0.75 : 1;
    const sunI = lerp(a.sun, b.sun, t) * dim;
    const hemiI = lerp(a.hemi, b.hemi, t) * (0.75 + 0.25 * dim);
    const gray = new THREE.Color(0x808a96);

    const sunCol = mixColor(new THREE.Color(), a.sunColor, b.sunColor, t);
    this.sun.color.copy(sunCol);
    // moon light when the sun is down
    const moon = clamp(1 - sunI / 0.5, 0, 1) * 0.35 * (this.weather === 'clear' ? 1 : 0.5);
    this.sun.intensity = sunI + moon;
    if (sunI < 0.3) this.sun.color.lerp(new THREE.Color(0x9bb0ff), 1 - sunI / 0.3);

    this.hemi.intensity = hemiI;
    this.hemi.color.copy(mixColor(new THREE.Color(), a.hemiSky, b.hemiSky, t)).lerp(gray, grey * 0.6);
    this.hemi.groundColor.copy(mixColor(new THREE.Color(), a.hemiGround, b.hemiGround, t));

    const top = mixColor(new THREE.Color(), a.skyTop, b.skyTop, t).lerp(gray, grey);
    const hor = mixColor(new THREE.Color(), a.skyHorizon, b.skyHorizon, t).lerp(gray, grey);
    this.skyMat.uniforms.topColor.value.copy(top);
    this.skyMat.uniforms.horizonColor.value.copy(hor);
    this.fogColor = mixColor(new THREE.Color(), a.fog, b.fog, t).lerp(gray, grey * 0.9);
    (this.scene.fog as THREE.Fog).color.copy(this.fogColor);
    this.exposure = lerp(a.exposure, b.exposure, t);

    // sun / moon position
    const elev = Math.sin(clamp((h - 6) / 12, 0, 1) * Math.PI);
    const dayPhase = h >= 6 && h <= 18;
    const ang = ((h - 6) / 24) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(ang) * 0.6, dayPhase ? Math.max(0.08, elev) : 0.55, Math.sin(ang) * 0.8).normalize();
    this.sun.position.copy(dir).multiplyScalar(120);
    this.skyMat.uniforms.sunDir.value.copy(dayPhase ? dir : new THREE.Vector3(-dir.x, 0.5, -dir.z).normalize());
    this.skyMat.uniforms.sunColor.value.copy(dayPhase ? sunCol : new THREE.Color(0xbfd0ff));
    this.skyMat.uniforms.sunPower.value = dayPhase ? clamp(sunI / 2, 0.1, 1) * (1 - grey * 0.8) : 0.25 * (1 - grey);

    this.night = clamp(1 - (sunI + 0.1) / 0.9, 0, 1);
    (this.stars.material as THREE.PointsMaterial).opacity = this.night * (this.weather === 'clear' ? 0.9 : 0.15);
    this.scene.environmentIntensity = lerp(0.18, 0.62, 1 - this.night) * (this.weather === 'rain' ? 0.8 : 1);
  }

  get hourNow(): number {
    return this.hour;
  }

  /** Keeps the shadow frustum, sky and rain around the focus point. */
  update(dt: number, focus: THREE.Vector3, cameraPos: THREE.Vector3, windSlant = 0): void {
    this.time += dt;
    this.sky.position.copy(cameraPos);
    this.stars.position.copy(cameraPos);
    // shadow follows the bus (snapped to reduce shimmering)
    const snap = 2;
    const fx = Math.round(focus.x / snap) * snap;
    const fz = Math.round(focus.z / snap) * snap;
    const dir = this.sun.position.clone().normalize();
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + dir.x * 120, focus.y + dir.y * 120, fz + dir.z * 120);

    this.rainAmount += clamp(this.rainTarget - this.rainAmount, -dt * 0.05, dt * 0.25);
    if (this.rain) {
      this.rain.visible = this.rainAmount > 0.01;
      if (this.rain.visible && this.rainBase) {
        const pos = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
        const arr = pos.array as Float32Array;
        const n = this.rainBase.length / 3;
        const active = Math.floor(n * this.rainAmount);
        const fall = 24;
        const H = 28;
        for (let i = 0; i < n; i++) {
          const j = i * 6;
          if (i >= active) {
            arr[j] = arr[j + 1] = arr[j + 2] = arr[j + 3] = arr[j + 4] = arr[j + 5] = 0;
            continue;
          }
          const bx = this.rainBase[i * 3];
          const by = this.rainBase[i * 3 + 1];
          const bz = this.rainBase[i * 3 + 2];
          const y = (((by - this.time * fall) % H) + H) % H;
          const x = cameraPos.x + bx;
          const z = cameraPos.z + bz;
          const yy = cameraPos.y - 6 + y;
          arr[j] = x;
          arr[j + 1] = yy;
          arr[j + 2] = z;
          arr[j + 3] = x + windSlant * 0.05;
          arr[j + 4] = yy - 0.9;
          arr[j + 5] = z + windSlant * 0.3;
        }
        pos.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    this.envMap?.dispose();
    this.skyMat.dispose();
    this.sky.geometry.dispose();
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
    if (this.rain) {
      this.rain.geometry.dispose();
      (this.rain.material as THREE.Material).dispose();
    }
  }
}
