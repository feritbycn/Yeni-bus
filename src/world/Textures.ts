import * as THREE from 'three';
import { mulberry32 } from '../core/utils';

/** Procedural canvas textures: no image assets are shipped, so there are no texture licences to track. */

const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 4;
  return t;
}

function noiseFill(ctx: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amount: number, seed: number, grain = 1): void {
  const rnd = mulberry32(seed);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const n = (rnd() - 0.5) * amount;
      const i = (y * w + x) * 4;
      img.data[i] = base[0] + n;
      img.data[i + 1] = base[1] + n;
      img.data[i + 2] = base[2] + n;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  void grain;
}

export function asphaltTexture(): THREE.Texture {
  const key = 'asphalt';
  if (cache.has(key)) return cache.get(key)!;
  const [c, ctx] = canvas(256, 256);
  noiseFill(ctx, 256, 256, [92, 94, 98], 46, 7);
  // tyre polish streaks and cracks
  const rnd = mulberry32(3);
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#000';
  for (let i = 0; i < 6; i++) ctx.fillRect(rnd() * 256, 0, 10 + rnd() * 18, 256);
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = '#2a2b2e';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    let x = rnd() * 256;
    let y = rnd() * 256;
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (rnd() - 0.5) * 40;
      y += (rnd() - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const t = finish(c);
  cache.set(key, t);
  return t;
}

export function grassTexture(): THREE.Texture {
  const key = 'grass';
  if (cache.has(key)) return cache.get(key)!;
  const [c, ctx] = canvas(256, 256);
  noiseFill(ctx, 256, 256, [74, 112, 58], 40, 11);
  const rnd = mulberry32(5);
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(${40 + rnd() * 40},${90 + rnd() * 60},${30 + rnd() * 30},0.35)`;
    ctx.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 6, 2 + rnd() * 6);
  }
  const t = finish(c);
  cache.set(key, t);
  return t;
}

export function concreteTexture(): THREE.Texture {
  const key = 'concrete';
  if (cache.has(key)) return cache.get(key)!;
  const [c, ctx] = canvas(128, 128);
  noiseFill(ctx, 128, 128, [165, 165, 160], 30, 17);
  const t = finish(c);
  cache.set(key, t);
  return t;
}

/** Building facade with a window grid. `lit` draws warm lit windows (used with emissiveMap at night). */
export function facadeTexture(lit: boolean, seed = 1): THREE.Texture {
  const key = `facade-${lit}-${seed}`;
  if (cache.has(key)) return cache.get(key)!;
  const [c, ctx] = canvas(128, 256);
  if (lit) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 128, 256);
  } else {
    noiseFill(ctx, 128, 256, [150 + seed * 8, 146 + seed * 5, 140], 24, 21 + seed);
  }
  const rnd = mulberry32(100 + seed);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 4; x++) {
      const on = rnd() < 0.55;
      if (lit) ctx.fillStyle = on ? '#ffd9a0' : '#000';
      else ctx.fillStyle = on ? '#33414f' : '#202a35';
      ctx.fillRect(10 + x * 29, 12 + y * 30, 18, 20);
    }
  }
  const t = finish(c);
  cache.set(key, t);
  return t;
}

export function speedSignTexture(limit: number): THREE.Texture {
  const key = `speed-${limit}`;
  if (cache.has(key)) return cache.get(key)!;
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(64, 64, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d11a2a';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(64, 64, 54, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.font = 'bold 60px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(limit), 64, 68);
  const t = finish(c, false);
  cache.set(key, t);
  return t;
}

export function labelTexture(text: string, bg = '#12315f', fg = '#ffffff', w = 512, h = 128, sub?: string): THREE.Texture {
  const key = `label-${text}-${bg}-${fg}-${w}-${sub ?? ''}`;
  if (cache.has(key)) return cache.get(key)!;
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${sub ? h * 0.42 : h * 0.5}px Arial, sans-serif`;
  ctx.fillText(text, w / 2, sub ? h * 0.38 : h / 2);
  if (sub) {
    ctx.font = `${h * 0.22}px Arial, sans-serif`;
    ctx.fillText(sub, w / 2, h * 0.76);
  }
  const t = finish(c, false);
  cache.set(key, t);
  return t;
}

export function warningSignTexture(kind: 'roadworks' | 'jam' | 'radar'): THREE.Texture {
  const key = `warn-${kind}`;
  if (cache.has(key)) return cache.get(key)!;
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(64, 6);
  ctx.lineTo(122, 112);
  ctx.lineTo(6, 112);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#d11a2a';
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.font = 'bold 54px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // simple glyphs that exist in every font
  if (kind === 'roadworks') {
    ctx.fillText('!', 64, 78);
  } else if (kind === 'jam') {
    ctx.font = 'bold 40px Arial, sans-serif';
    ctx.fillText('SLOW', 64, 80);
  } else {
    ctx.font = 'bold 40px Arial, sans-serif';
    ctx.fillText('RADAR', 64, 80);
  }
  const t = finish(c, false);
  cache.set(key, t);
  return t;
}

/** Raindrop / star sprite helper. */
export function softDotTexture(): THREE.Texture {
  const key = 'dot';
  if (cache.has(key)) return cache.get(key)!;
  const [c, ctx] = canvas(32, 32);
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const t = finish(c, false);
  cache.set(key, t);
  return t;
}

export function disposeTextureCache(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
