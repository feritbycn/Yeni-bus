import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tr } from '../src/i18n/tr';
import { en } from '../src/i18n/en';
import { BUS_MODELS } from '../src/data/buses';
import { CITIES } from '../src/data/world';
import { COSMETICS } from '../src/data/cosmetics';
import { PRODUCTS, AD_REWARDS } from '../src/data/shop';
import { ALL_MISSIONS, ACHIEVEMENTS } from '../src/data/missions';
import { MENU_ENTRY_IDS } from '../src/ui/screens/menu';

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.includes('/i18n/')) out.push(p);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('i18n', () => {
  it('Turkish and English have exactly the same keys', () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
  });

  it('no empty strings and placeholders match between languages', () => {
    for (const k of Object.keys(tr)) {
      expect(tr[k].trim().length, k).toBeGreaterThan(0);
      expect(en[k].trim().length, k).toBeGreaterThan(0);
      expect(placeholders(en[k]), `placeholders of ${k}`).toBe(placeholders(tr[k]));
    }
  });

  it('every literal key used in the source exists', () => {
    const missing: string[] = [];
    const re = /\b(?:tt|t|notify)\(\s*'([a-zA-Z0-9_.]+)'/g;
    const re2 = /prompt = '([a-zA-Z0-9_.]+)'/g;
    for (const f of walk('src')) {
      const src = readFileSync(f, 'utf8');
      for (const m of [...src.matchAll(re), ...src.matchAll(re2)]) {
        if (m[1].endsWith('.')) continue; // prefix of a concatenated key (family tested below)
        if (!(m[1] in tr)) missing.push(`${f}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('data-driven key families exist', () => {
    const need: string[] = [];
    for (const b of BUS_MODELS) need.push(`bus.${b.id}.name`, `bus.${b.id}.class`, `bus.${b.id}.desc`);
    for (const c of CITIES) need.push(`city.${c.id}`);
    for (const c of COSMETICS) need.push(`cos.${c.id}`);
    for (const p of PRODUCTS) need.push(`product.${p.id}.name`, `product.${p.id}.desc`);
    for (const m of ALL_MISSIONS) need.push(`mission.${m.id}`, `mission.${m.id}.desc`);
    for (const a of ACHIEVEMENTS) need.push(`ach.${a.id}`, `ach.${a.id}.desc`);
    for (const a of AD_REWARDS) need.push(`ad.${a.id}.name`, `ad.${a.id}.desc`);
    for (const id of MENU_ENTRY_IDS) need.push(`menu.${id}`);
    for (const n of [1, 2, 3]) need.push(`rest.${n}`);
    need.push('hud.msg.welcome', 'hud.prompt.openDoors');
    expect(need.filter((k) => !(k in tr))).toEqual([]);
  });

  it('the menu has exactly the 16 required entries', () => {
    expect(MENU_ENTRY_IDS).toHaveLength(16);
    expect(new Set(MENU_ENTRY_IDS).size).toBe(16);
  });
});
