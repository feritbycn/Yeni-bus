import type { GameContext } from '../core/GameContext';
import type { GameEngine } from '../engine/GameEngine';
import type { AudioManager } from '../core/AudioManager';
import type { PerformanceManager } from '../core/PerformanceManager';
import type { TripConfig } from '../systems/TripManager';
import { clear, h, btn, num, tt } from './dom';
import { i18n } from '../i18n/LocalizationManager';
import { xpForLevel } from '../data/constants';

export interface App {
  ctx: GameContext;
  engine: GameEngine;
  audio: AudioManager;
  perf: PerformanceManager;
  ui: UIManager;
  /** Prepares + starts a driven trip; shows an error toast on failure. */
  startTrip(config: TripConfig): boolean;
  /** Tear down the HUD + 3D trip and return to the main menu. */
  endTripUi(): void;
  /** Prefill for the trip-setup screen (set by the routes / map screens). */
  tripDraft: Partial<TripConfig>;
}

export interface ScreenDef {
  id: string;
  titleKey: string;
  /** build the screen. Return an optional cleanup. */
  render(app: App, root: HTMLElement, params?: Record<string, unknown>): void | (() => void);
  /** screen leaves the 3D canvas visible behind it (garage, gallery, menu) */
  showroom?: boolean;
}

export interface ModalButton {
  label: string;
  cls?: string;
  onClick?: () => void | boolean;
}

/** Top bar, router, toasts and modals. Everything is plain DOM (see dom.ts). */
export class UIManager {
  readonly root: HTMLElement;
  private topbar: HTMLElement;
  private screenEl: HTMLElement;
  private toasts: HTMLElement;
  private modalLayer: HTMLElement;
  private hudLayer: HTMLElement;
  private screens = new Map<string, ScreenDef>();
  private current: { def: ScreenDef; params?: Record<string, unknown>; cleanup?: void | (() => void) } | null = null;
  private history: string[] = [];
  private pendingRefresh = 0;
  private app!: App;
  private hidden = false;

  constructor(host: HTMLElement) {
    this.root = h('div', { id: 'ui' });
    this.topbar = h('header', { class: 'topbar' });
    this.screenEl = h('main', { class: 'screen' });
    this.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    this.modalLayer = h('div', { class: 'modal-layer' });
    this.hudLayer = h('div', { class: 'hud-layer' });
    this.root.append(this.topbar, this.screenEl, this.hudLayer, this.toasts, this.modalLayer);
    host.appendChild(this.root);
  }

  bind(app: App): void {
    this.app = app;
    const ctx = app.ctx;
    ctx.bus.on('stateChanged', () => this.scheduleRefresh());
    ctx.bus.on('toast', (e) => this.toast(e.kind, e.text));
    i18n.onChange(() => {
      this.renderTopbar();
      this.refresh(true);
    });
    this.renderTopbar();
  }

  register(def: ScreenDef): void {
    this.screens.set(def.id, def);
  }

  get hud(): HTMLElement {
    return this.hudLayer;
  }

  get currentId(): string | null {
    return this.current?.def.id ?? null;
  }

  /** Hide every menu element while the driving HUD is shown. */
  setMenuVisible(v: boolean): void {
    this.hidden = !v;
    this.topbar.style.display = v ? '' : 'none';
    this.screenEl.style.display = v ? '' : 'none';
  }

  show(id: string, params?: Record<string, unknown>, push = true): void {
    const def = this.screens.get(id);
    if (!def) return;
    if (this.current) {
      if (typeof this.current.cleanup === 'function') this.current.cleanup();
      if (push && this.current.def.id !== id) this.history.push(this.current.def.id);
    }
    if (this.history.length > 20) this.history.shift();
    clear(this.screenEl);
    this.screenEl.className = `screen screen-${id}${def.showroom ? ' showroom' : ''}`;
    this.current = { def, params };
    this.current.cleanup = def.render(this.app, this.screenEl, params);
    this.screenEl.scrollTop = 0;
    this.renderTopbar();
    if (!def.showroom) this.app.engine.leaveShowroom();
  }

  back(): void {
    const prev = this.history.pop() ?? 'menu';
    this.show(prev, undefined, false);
  }

  home(): void {
    this.history = [];
    this.show('menu', undefined, false);
  }

  private scheduleRefresh(): void {
    if (this.pendingRefresh || this.hidden) return;
    this.pendingRefresh = requestAnimationFrame(() => {
      this.pendingRefresh = 0;
      this.renderTopbar();
      this.refresh(false);
    });
  }

  /** Re-renders the active screen. Skipped while the user is typing in it (keeps focus). */
  refresh(force: boolean): void {
    if (!this.current || this.hidden) return;
    const a = document.activeElement as HTMLElement | null;
    if (!force && a && this.screenEl.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA')) return;
    const scroll = this.screenEl.scrollTop;
    const { def, params } = this.current;
    if (typeof this.current.cleanup === 'function') this.current.cleanup();
    clear(this.screenEl);
    this.current.cleanup = def.render(this.app, this.screenEl, params);
    this.screenEl.scrollTop = scroll;
  }

  renderTopbar(): void {
    if (!this.app) return;
    const { state, premium } = this.app.ctx;
    const c = state.company;
    const need = xpForLevel(c.level);
    const notMenu = this.current && this.current.def.id !== 'menu';
    clear(this.topbar);
    this.topbar.append(
      h('div', { class: 'tb-left' },
        notMenu ? btn('◀ ' + tt('common.back'), () => this.back(), 'btn-ghost') : null,
        notMenu ? btn('⌂', () => this.home(), 'btn-ghost') : null,
        h('div', { class: 'tb-company' },
          h('div', { class: 'tb-name', style: { color: c.color } }, c.name),
          h('div', { class: 'tb-level' }, `${tt('common.level')} ${c.level}`, h('span', { class: 'xpbar' }, h('i', { style: { width: `${Math.min(100, (c.xp / need) * 100)}%` } }))),
        ),
      ),
      h('div', { class: 'tb-right' },
        premium.isPremium() ? h('span', { class: 'chip premium' }, '★ ' + tt('premium.badge')) : null,
        state.settings.testMode ? h('span', { class: 'chip test' }, tt('common.testMode')) : null,
        h('span', { class: 'chip cash', title: tt('common.cash') }, '$ ' + num(state.cash)),
        h('span', { class: 'chip gold', title: tt('common.gold') }, '◆ ' + num(state.gold)),
      ),
    );
  }

  toast(kind: 'info' | 'success' | 'warn' | 'error', text: string, ms = 3600): void {
    const el = h('div', { class: `toast ${kind}`, role: 'status' }, text);
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
    setTimeout(() => el.classList.add('out'), ms - 300);
    setTimeout(() => el.remove(), ms);
  }

  /** Generic modal. Buttons close the modal unless onClick returns false. Returns a close function. */
  modal(title: string, body: Node | string, buttons: ModalButton[] = [{ label: tt('common.ok') }], opts: { wide?: boolean; dismiss?: boolean } = {}): () => void {
    const layer = this.modalLayer;
    const close = () => {
      box.remove();
      if (!layer.children.length) layer.classList.remove('open');
    };
    const box = h('div', { class: 'modal-backdrop', on: { click: (e) => { if (e.target === box && opts.dismiss !== false) close(); } } },
      h('div', { class: `modal${opts.wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('h2', null, title),
        h('div', { class: 'modal-body' }, body),
        h('div', { class: 'modal-actions' },
          buttons.map((b) => btn(b.label, () => { const r = b.onClick?.(); if (r !== false) close(); }, b.cls ?? 'btn-primary')),
        ),
      ),
    );
    layer.appendChild(box);
    layer.classList.add('open');
    return close;
  }

  confirm(title: string, message: string, onYes: () => void, yesLabel = tt('common.yes'), danger = false): void {
    this.modal(title, h('p', null, message), [
      { label: tt('common.cancel'), cls: 'btn-ghost' },
      { label: yesLabel, cls: danger ? 'btn-danger' : 'btn-primary', onClick: () => { onYes(); } },
    ]);
  }
}
