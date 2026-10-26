import { t, i18n } from '../i18n/LocalizationManager';

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> & { class?: string; style?: Partial<CSSStyleDeclaration> | string; on?: Record<string, (e: Event) => void> };

/** Tiny hyperscript helper. Text is always inserted as text nodes (no innerHTML => no XSS). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k === 'on') {
        for (const [ev, fn] of Object.entries(v as Record<string, (e: Event) => void>)) el.addEventListener(ev, fn);
      } else if (k === 'disabled' || k === 'checked' || k === 'hidden' || k === 'readOnly') {
        (el as unknown as Record<string, unknown>)[k] = !!v;
      } else if (k === 'value') (el as unknown as { value: string }).value = String(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (typeof c === 'string' || typeof c === 'number') el.appendChild(document.createTextNode(String(c)));
    else el.appendChild(c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function btn(label: string, onClick: () => void, cls = '', disabled = false): HTMLButtonElement {
  return h('button', { class: `btn ${cls}`.trim(), type: 'button', disabled, on: { click: () => onClick() } }, label);
}

export function money(n: number): string {
  return i18n.money(n);
}
export function num(n: number): string {
  return i18n.number(n);
}
export function pct(f: number): string {
  return `${Math.round(f * 100)}%`;
}

export function bar(frac: number, cls = ''): HTMLElement {
  return h('div', { class: `bar ${cls}` }, h('div', { class: 'bar-fill', style: { width: `${Math.max(0, Math.min(100, frac * 100))}%` } }));
}

export function stars(r: number): string {
  const full = Math.round(r);
  return '★'.repeat(full) + '☆'.repeat(Math.max(0, 5 - full));
}

export function row(label: string, value: Child, cls = ''): HTMLElement {
  return h('div', { class: `kv ${cls}`.trim() }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, value));
}

export function tt(key: string, params?: Record<string, string | number>): string {
  return t(key, params);
}

export function hhmm(hour: number): string {
  const hh = Math.floor(hour);
  const mm = Math.round((hour - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return hh > 0 ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}
