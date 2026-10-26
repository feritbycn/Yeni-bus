import type { Language } from '../core/types';
import { tr } from './tr';
import { en } from './en';

export type Dict = Record<string, string>;

const DICTS: Record<Language, Dict> = { tr, en };

/** All visible text lives in src/i18n/tr.ts and en.ts. UI code only uses keys. */
export class LocalizationManager {
  private lang: Language = 'tr';
  private listeners = new Set<() => void>();

  get language(): Language {
    return this.lang;
  }

  get locale(): string {
    return this.lang === 'tr' ? 'tr-TR' : 'en-US';
  }

  setLanguage(lang: Language): void {
    if (lang !== this.lang && DICTS[lang]) {
      this.lang = lang;
      for (const l of [...this.listeners]) l();
    }
  }

  onChange(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  has(key: string): boolean {
    return key in DICTS[this.lang] || key in DICTS.tr;
  }

  /** t("trip.price", {n: 5}) -> replaces {n}. Falls back to Turkish, then to the key itself. */
  t(key: string, params?: Record<string, string | number>): string {
    let s = DICTS[this.lang][key] ?? DICTS.tr[key] ?? key;
    if (params) for (const k of Object.keys(params)) s = s.split(`{${k}}`).join(String(params[k]));
    return s;
  }

  number(n: number): string {
    return Math.round(n).toLocaleString(this.locale);
  }

  money(n: number): string {
    return `$${this.number(n)}`;
  }
}

export const i18n = new LocalizationManager();
export const t = (key: string, params?: Record<string, string | number>): string => i18n.t(key, params);
export { DICTS };
