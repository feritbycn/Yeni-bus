import type { App } from './UIManager';
import type { HudData, DriveSession } from '../engine/DriveSession';
import type { TripSummary } from '../systems/TripManager';
import type { DriveAction } from '../engine/InputManager';
import { h, btn, money, num, row, tt, stars, bar, fmtDuration } from './dom';
import { isTouchDevice } from '../core/PerformanceManager';

const q = <T extends HTMLElement>(root: HTMLElement, sel: string): T => root.querySelector(sel) as T;

/** In-trip overlay: instruments, stop info, prompts, touch controls, pause menu and summary. */
export class DrivingHud {
  private el: HTMLElement;
  private touchEl: HTMLElement | null = null;
  private lastMsgT = -1;
  private msgTimer = 0;
  private wheelPointer: number | null = null;
  private summaryShown = false;
  private pauseOpen: (() => void) | null = null;
  private unsubInput: () => void;

  constructor(
    private readonly app: App,
    private readonly session: DriveSession,
  ) {
    this.el = this.build();
    app.ui.hud.appendChild(this.el);
    const ct = app.ctx.state.settings.controlType;
    const touch = ct === 'touchButtons' || ct === 'touchWheel' || (ct === 'auto' && isTouchDevice());
    if (touch) {
      this.touchEl = this.buildTouch(ct === 'touchButtons' ? 'buttons' : 'wheel');
      this.el.appendChild(this.touchEl);
    }
    this.unsubInput = app.engine.input.onAction((a) => {
      if (a === 'pause') this.togglePause();
    });
  }

  private act(a: DriveAction): void {
    this.app.engine.input.emit(a);
  }

  private build(): HTMLElement {
    const gauge = (cls: string, label: string) => h('div', { class: `g ${cls}` }, h('small', null, label), h('b', { class: 'val' }, '0'));
    return h('div', { class: 'hud', role: 'region', 'aria-label': tt('hud.aria') },
      h('div', { class: 'hud-tl' },
        h('div', { class: 'speedo' }, h('b', { class: 'speed' }, '0'), h('small', null, 'km/h')),
        h('div', { class: 'limit', title: tt('hud.limit') }, h('span', { class: 'limit-val' }, '50')),
        h('div', { class: 'gearbox' }, ['P', 'R', 'N', 'D'].map((g) => h('span', { 'data-gear': g, class: 'gear' }, g))),
        h('div', { class: 'ind' },
          h('span', { class: 'i i-engine', title: tt('hud.engine') }, '⏻'), h('span', { class: 'i i-hb', title: tt('hud.handbrake') }, '(P)'),
          h('span', { class: 'i i-light' }, '💡'), h('span', { class: 'i i-left' }, '◀'), h('span', { class: 'i i-right' }, '▶'),
          h('span', { class: 'i i-hazard' }, '⚠'), h('span', { class: 'i i-door' }, '🚪'), h('span', { class: 'i i-wiper' }, '☂'), h('span', { class: 'i i-cruise' }, 'CC')),
      ),
      h('div', { class: 'hud-tc' },
        h('div', { class: 'next' }, h('small', null, tt('hud.next')), h('b', { class: 'next-name' }, '—'), h('span', { class: 'next-dist' }, '')),
        h('div', { class: 'progress' }, h('i', { style: { width: '0%' } })),
        h('div', { class: 'prompt', role: 'status' }),
        h('div', { class: 'msg', role: 'alert' }),
      ),
      h('div', { class: 'hud-tr' },
        h('div', { class: 'pax' }, '👥 ', h('b', { class: 'pax-val' }, '0/0')),
        h('div', { class: 'sat' }, tt('hud.satisfaction'), ' ', h('b', { class: 'sat-val' }, '')),
        h('div', { class: 'fines' }, tt('hud.fines'), ' ', h('b', { class: 'fines-val' }, '$0')),
        h('div', { class: 'clock' }, '🕒 ', h('b', { class: 'clock-val' }, '--:--'), ' ', h('span', { class: 'weather' }, '')),
        h('button', { class: 'btn btn-ghost pause-btn', type: 'button', 'aria-label': tt('hud.pause'), on: { click: () => this.togglePause() } }, '⏸'),
      ),
      h('div', { class: 'hud-bl' },
        gauge('fuel', tt('hud.fuel')), gauge('dmg', tt('hud.damage')),
        h('div', { class: 'tl', title: tt('hud.trafficLight') }, h('i', { class: 'r' }), h('i', { class: 'y' }), h('i', { class: 'g' })),
        h('div', { class: 'cam' }, '🎥 ', h('span', { class: 'cam-val' }, '')),
      ),
      h('div', { class: 'hud-keys' }, tt('hud.keysHint')),
      h('div', { class: 'warn-flash' }),
    );
  }

  private buildTouch(kind: 'wheel' | 'buttons'): HTMLElement {
    const input = this.app.engine.input;
    const press = (el: HTMLElement, on: () => void, off?: () => void) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('down'); on(); });
      const up = (e: Event) => { e.preventDefault(); el.classList.remove('down'); off?.(); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    };
    const tapBtn = (label: string, a: DriveAction, cls = '') => {
      const b = h('button', { class: `tbtn ${cls}`, type: 'button', 'aria-label': label }, label);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.act(a); });
      return b;
    };
    const holdBtn = (label: string, on: () => void, off: () => void, cls = '') => {
      const b = h('button', { class: `tbtn ${cls}`, type: 'button', 'aria-label': label }, label);
      press(b, on, off);
      return b;
    };
    const gas = holdBtn('GAS', () => input.setTouchThrottle(1), () => input.setTouchThrottle(0), 'pedal gas');
    const brake = holdBtn('BRAKE', () => input.setTouchBrake(1), () => input.setTouchBrake(0), 'pedal brake');

    let steerZone: HTMLElement;
    if (kind === 'wheel') {
      const wheel = h('div', { class: 'wheel-knob' }, h('div', { class: 'wheel-mark' }));
      steerZone = h('div', { class: 'wheel', 'aria-label': tt('hud.steer') }, wheel);
      let cx = 0;
      const set = (clientX: number) => {
        const rect = steerZone.getBoundingClientRect();
        cx = rect.left + rect.width / 2;
        const v = Math.max(-1, Math.min(1, (clientX - cx) / (rect.width * 0.4)));
        input.setTouchSteer(v);
        wheel.style.transform = `rotate(${v * 110}deg)`;
      };
      steerZone.addEventListener('pointerdown', (e) => { e.preventDefault(); steerZone.setPointerCapture(e.pointerId); this.wheelPointer = e.pointerId; set(e.clientX); });
      steerZone.addEventListener('pointermove', (e) => { if (this.wheelPointer === e.pointerId) set(e.clientX); });
      const rel = (e: PointerEvent) => { if (this.wheelPointer === e.pointerId) { this.wheelPointer = null; input.setTouchSteer(null); wheel.style.transform = 'rotate(0deg)'; } };
      steerZone.addEventListener('pointerup', rel);
      steerZone.addEventListener('pointercancel', rel);
    } else {
      steerZone = h('div', { class: 'steer-btns' },
        holdBtn('◀', () => input.setTouchSteer(-1), () => input.setTouchSteer(null), 'steer'),
        holdBtn('▶', () => input.setTouchSteer(1), () => input.setTouchSteer(null), 'steer'));
    }

    return h('div', { class: 'touch' },
      h('div', { class: 'touch-left' }, steerZone),
      h('div', { class: 'touch-mid' },
        h('div', { class: 'row' }, tapBtn('P', 'gearP'), tapBtn('R', 'gearR'), tapBtn('N', 'gearN'), tapBtn('D', 'gearD')),
        h('div', { class: 'row' }, tapBtn('⏻', 'engine'), tapBtn('💡', 'lights'), tapBtn('◀', 'signalLeft', 'sig'), tapBtn('▶', 'signalRight', 'sig'), tapBtn('⚠', 'hazard')),
        h('div', { class: 'row' }, tapBtn('🚪', 'doors'), tapBtn('🎥', 'camera'), tapBtn('🔙', 'rearCam'), tapBtn('CC', 'cruise'), tapBtn('☂', 'wipers'),
          holdBtn('📯', () => input.setHorn(true), () => input.setHorn(false)),
          holdBtn('(P)', () => input.setHandbrake(true), () => input.setHandbrake(false), 'hb'))),
      h('div', { class: 'touch-right' }, brake, gas),
    );
  }

  togglePause(): void {
    const s = this.session;
    if (s.phase !== 'driving') return;
    if (s.paused) {
      this.pauseOpen?.();
      this.pauseOpen = null;
      this.app.engine.setTripPaused(false);
      return;
    }
    this.app.engine.setTripPaused(true);
    this.app.audio.vibrate(0);
    const body = h('div', null, h('p', null, tt('hud.pausedText')),
      row(tt('hud.paxOnboard'), `${s.plan.manifest.onboard}/${s.plan.manifest.seats}`));
    this.pauseOpen = this.app.ui.modal(tt('hud.paused'), body, [
      { label: tt('hud.resume'), onClick: () => { this.pauseOpen = null; this.app.engine.setTripPaused(false); } },
      { label: tt('hud.settings'), cls: 'btn-secondary', onClick: () => { this.quickSettings(); return false; } },
      { label: tt('hud.abandon'), cls: 'btn-danger', onClick: () => {
        this.app.ui.confirm(tt('hud.abandon'), tt('hud.abandonConfirm'), () => {
          this.app.engine.setTripPaused(false);
          s.abandon();
        }, tt('hud.abandon'), true);
        this.pauseOpen = null;
      } },
    ], { dismiss: false });
  }

  private quickSettings(): void {
    const { ctx } = this.app;
    const s = ctx.state.settings;
    const mute = h('input', { type: 'checkbox', checked: s.muted, on: { change: (e) => ctx.settings.update({ muted: (e.target as HTMLInputElement).checked }) } });
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.volumes.master, on: { input: (e) => ctx.settings.update({ volumes: { ...s.volumes, master: Number((e.target as HTMLInputElement).value) } }) } });
    const cam = h('select', { class: 'input', on: { change: (e) => ctx.settings.update({ cameraDistance: Number((e.target as HTMLSelectElement).value) }) } },
      [0.8, 1, 1.25].map((v) => h('option', { value: v, selected: v === 1 }, String(v))));
    this.app.ui.modal(tt('hud.settings'), h('div', null,
      h('label', { class: 'field inline-field' }, h('span', null, tt('settings.muted')), mute),
      h('label', { class: 'field inline-field' }, h('span', null, tt('settings.volMaster')), vol),
      h('label', { class: 'field inline-field' }, h('span', null, tt('settings.cameraDistance')), cam)),
    [{ label: tt('common.close') }]);
  }

  update(d: HudData): void {
    const e = this.el;
    q(e, '.speed').textContent = String(Math.round(d.speedKmh));
    e.classList.toggle('over', d.speeding);
    q(e, '.limit-val').textContent = String(d.limitKmh);
    e.querySelectorAll('.gear').forEach((g) => g.classList.toggle('on', (g as HTMLElement).dataset.gear === d.gear));
    const flag = (cls: string, on: boolean) => q(e, cls).classList.toggle('on', on);
    flag('.i-engine', d.engineOn); flag('.i-hb', d.handbrake); flag('.i-light', d.lights > 0);
    flag('.i-left', (d.left || d.hazard) && d.blinkOn); flag('.i-right', (d.right || d.hazard) && d.blinkOn);
    flag('.i-hazard', d.hazard); flag('.i-door', d.doorsOpen); flag('.i-wiper', d.wipers > 0); flag('.i-cruise', d.cruiseOn);
    q(e, '.i-cruise').textContent = d.cruiseOn ? `CC ${Math.round(d.cruiseKmh)}` : 'CC';
    q(e, '.next-name').textContent = d.nextStopKey ? tt(d.nextStopKey.startsWith('city.') ? d.nextStopKey : d.nextStopKey) : tt('hud.noStop');
    q(e, '.next-dist').textContent = d.nextStopKey ? (d.nextStopDist >= 1000 ? `${(d.nextStopDist / 1000).toFixed(1)} km` : `${Math.round(d.nextStopDist)} m`) : '';
    (q(e, '.progress i') as HTMLElement).style.width = `${(d.progress * 100).toFixed(1)}%`;
    q(e, '.prompt').textContent = d.prompt ? tt(d.prompt) : '';
    q(e, '.pax-val').textContent = `${d.onboard}/${d.seats}${d.waiting > 0 ? `  (+${d.waiting})` : ''}`;
    const sat = q(e, '.sat-val');
    sat.textContent = stars(d.satisfaction / 20);
    q(e, '.fines-val').textContent = money(d.fines);
    q(e, '.clock-val').textContent = d.clock;
    q(e, '.weather').textContent = tt(`weather.${d.weather}`);
    this.setGauge('.g.fuel', d.fuelFrac, d.fuelLow);
    this.setGauge('.g.dmg', d.damage / 100, d.damage > 60);
    const tl = q(e, '.tl');
    tl.className = `tl ${d.trafficLight ?? 'none'}`;
    q(e, '.cam-val').textContent = tt(`hud.cam.${d.camera}`);
    e.classList.toggle('night', false);
    q(e, '.warn-flash').classList.toggle('on', d.ambulance || d.tailgating || d.fuelLow);
    if (d.lastMessage && d.lastMessage.t !== this.lastMsgT) {
      this.lastMsgT = d.lastMessage.t;
      const m = q(e, '.msg');
      m.textContent = tt(d.lastMessage.key, d.lastMessage.params);
      m.className = `msg show ${d.lastMessage.kind}`;
      clearTimeout(this.msgTimer);
      this.msgTimer = window.setTimeout(() => { m.className = 'msg'; }, 3600);
    }
    if (this.session.phase === 'finished' && !this.summaryShown && this.session.summary) {
      this.summaryShown = true;
      this.showSummary(this.session.summary);
    }
  }

  private setGauge(sel: string, frac: number, warn: boolean): void {
    const g = q(this.el, sel);
    q(g, '.val').textContent = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
    g.classList.toggle('warn', warn);
  }

  showSummary(s: TripSummary): void {
    const { ctx } = this.app;
    this.pauseOpen?.();
    const body = h('div', { class: 'summary' },
      h('p', { class: `status ${s.status}` }, tt(`summary.status.${s.status}`)),
      h('div', { class: 'stars' }, stars(s.rating)),
      row(tt('summary.passengers'), `${s.passengers} / ${s.seats}`),
      row(tt('summary.tickets'), money(s.ticketRevenue)),
      s.baggageRevenue ? row(tt('summary.baggage'), money(s.baggageRevenue)) : null,
      s.boostRevenue ? row(tt('summary.boost'), money(s.boostRevenue)) : null,
      row(tt('summary.revenue'), h('b', null, money(s.revenue))),
      row(tt('summary.fuel'), `−${money(s.fuelValue)}`),
      row(tt('summary.toll'), `−${money(s.toll)}`),
      row(tt('summary.maintenance'), `−${money(s.maintenance)}`),
      row(tt('summary.terminal'), `−${money(s.terminalFee)}`),
      s.fines ? row(tt('summary.fines'), `−${money(s.fines)}`, 'bad') : null,
      s.towing ? row(tt('summary.towing'), `−${money(s.towing)}`, 'bad') : null,
      row(tt('summary.profit'), h('b', { class: s.profit >= 0 ? 'good' : 'bad' }, money(s.profit))),
      row(tt('summary.xp'), `+${num(s.xp)}`),
      row(tt('summary.reputation'), `${s.reputationDelta >= 0 ? '+' : ''}${s.reputationDelta.toFixed(1)}`),
      row(tt('summary.time'), fmtDuration(this.session.hud().elapsed)),
      bar(s.satisfaction / 100),
    );
    this.app.ui.modal(tt('summary.title'), body, [
      { label: tt('summary.again'), cls: 'btn-secondary', onClick: () => { this.leave(); this.app.ui.show('play'); } },
      { label: tt('summary.continue'), onClick: () => { this.leave(); this.app.ui.home(); } },
    ], { dismiss: false, wide: true });
    void ctx;
  }

  private leave(): void {
    this.app.endTripUi();
  }

  dispose(): void {
    this.unsubInput();
    clearTimeout(this.msgTimer);
    this.el.remove();
  }
}

void btn;
