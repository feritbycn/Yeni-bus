import type { App, ScreenDef } from '../UIManager';
import type { Settings } from '../../core/types';
import { h, btn, tt, row } from '../dom';
import { GAME_NAME } from '../../data/constants';

const sel = <T extends string | number>(app: App, key: keyof Settings, opts: T[], labelOf: (v: T) => string): HTMLSelectElement => {
  const cur = app.ctx.state.settings[key] as unknown as T;
  const el = h('select', { class: 'input', id: `set-${String(key)}`, on: { change: (e) => {
    const raw = (e.target as HTMLSelectElement).value;
    const v = (typeof opts[0] === 'number' ? Number(raw) : raw) as T;
    app.ctx.settings.update({ [key]: v } as Partial<Settings>);
  } } }, opts.map((o) => h('option', { value: String(o) }, labelOf(o))));
  el.value = String(cur);
  return el;
};

const toggle = (app: App, key: keyof Settings): HTMLElement => {
  const on = !!app.ctx.state.settings[key];
  return h('input', { type: 'checkbox', class: 'switch', id: `set-${String(key)}`, checked: on, on: { change: (e) => app.ctx.settings.update({ [key]: (e.target as HTMLInputElement).checked } as Partial<Settings>) } });
};

const slider = (app: App, get: () => number, set: (v: number) => void, min: number, max: number, step: number, id: string): HTMLElement =>
  h('input', { type: 'range', class: 'input', id, min, max, step, value: get(), on: { input: (e) => set(Number((e.target as HTMLInputElement).value)) } });

const field = (label: string, ctrl: Node, hint?: string) =>
  h('label', { class: 'field inline-field' }, h('span', null, label), ctrl, hint ? h('small', { class: 'muted' }, hint) : null);

export const settingsScreen: ScreenDef = {
  id: 'settings',
  titleKey: 'menu.settings',
  render(app, root) {
    const { ctx } = app;
    const s = ctx.state.settings;
    const upd = (p: Partial<Settings>) => ctx.settings.update(p);
    const vol = (k: keyof Settings['volumes']) => slider(app, () => s.volumes[k], (v) => upd({ volumes: { ...s.volumes, [k]: v } }), 0, 1, 0.05, `vol-${k}`);

    root.append(
      h('div', { class: 'two-col' },
        h('section', { class: 'panel' },
          h('h2', null, tt('settings.general')),
          field(tt('settings.language'), sel(app, 'language', ['tr', 'en'] as const, (v) => (v === 'tr' ? 'Türkçe' : 'English'))),
          field(tt('settings.autoSave'), toggle(app, 'autoSave')),
          field(tt('settings.vibration'), toggle(app, 'vibration')),
          field(tt('settings.uiScale'), slider(app, () => s.uiScale, (v) => { upd({ uiScale: v }); document.documentElement.style.setProperty('--ui-scale', String(v)); }, 0.8, 1.3, 0.05, 'ui-scale')),
          h('h2', null, tt('settings.audio')),
          field(tt('settings.muted'), toggle(app, 'muted')),
          field(tt('settings.volMaster'), vol('master')),
          field(tt('settings.volVehicle'), vol('vehicle')),
          field(tt('settings.volAmbient'), vol('ambient')),
          field(tt('settings.volUi'), vol('ui')),
          h('h2', null, tt('settings.controls')),
          field(tt('settings.controlType'), sel(app, 'controlType', ['auto', 'keyboard', 'touchButtons', 'touchWheel'] as const, (v) => tt(`settings.control.${v}`))),
          field(tt('settings.sensitivity'), slider(app, () => s.sensitivity, (v) => upd({ sensitivity: v }), 0.5, 1.5, 0.05, 'sens')),
          field(tt('settings.cameraDistance'), slider(app, () => s.cameraDistance, (v) => upd({ cameraDistance: v }), 0.7, 1.5, 0.05, 'camdist')),
          field(tt('settings.autoDoors'), toggle(app, 'autoDoors'), tt('settings.autoDoors.hint')),
        ),
        h('section', { class: 'panel' },
          h('h2', null, tt('settings.graphics')),
          field(tt('settings.quality'), sel(app, 'quality', ['auto', 'low', 'medium', 'high', 'ultra'] as const, (v) => tt(`settings.q.${v}`))),
          field(tt('settings.shadows'), sel(app, 'shadows', ['off', 'low', 'medium', 'high'] as const, (v) => tt(`settings.q.${v}`))),
          field(tt('settings.viewDistance'), slider(app, () => s.viewDistance, (v) => upd({ viewDistance: v }), 250, 1600, 50, 'viewdist')),
          field(tt('settings.fpsCap'), sel(app, 'fpsCap', [0, 30, 45, 60] as const, (v) => (v === 0 ? tt('settings.fps.unlimited') : `${v} FPS`))),
          field(tt('settings.traffic'), sel(app, 'trafficDensity', ['auto', 'off', 'low', 'medium', 'high'] as const, (v) => tt(`settings.q.${v}`))),
          field(tt('settings.passengers'), sel(app, 'passengerDetail', ['auto', 'low', 'medium', 'high'] as const, (v) => tt(`settings.q.${v}`))),
          h('p', { class: 'muted' }, tt('settings.perfNote', { fps: Math.round(app.perf.fps), q: app.perf.current().level })),
          h('h2', null, tt('settings.data')),
          h('div', { class: 'actions wrap' },
            btn(tt('settings.export'), () => {
              const text = ctx.save.exportText(ctx.state);
              const ta = h('textarea', { class: 'input mono', rows: 8, readOnly: true }, text);
              app.ui.modal(tt('settings.export'), h('div', null, h('p', null, tt('settings.exportHint')), ta), [
                { label: tt('settings.copy'), onClick: () => { void navigator.clipboard?.writeText(text).catch(() => undefined); ta.select(); app.ui.toast('info', tt('settings.copied')); return false; } },
                { label: tt('settings.download'), cls: 'btn-secondary', onClick: () => {
                  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: 'roadmaster-save.json' });
                  document.body.appendChild(a); a.click(); a.remove(); return false;
                } },
                { label: tt('common.close'), cls: 'btn-ghost' },
              ], { wide: true });
            }, 'btn-secondary'),
            btn(tt('settings.import'), () => {
              const ta = h('textarea', { class: 'input mono', rows: 8, placeholder: tt('settings.importPlaceholder') });
              app.ui.modal(tt('settings.import'), h('div', null, h('p', null, tt('settings.importWarn')), ta), [
                { label: tt('common.cancel'), cls: 'btn-ghost' },
                { label: tt('settings.import'), cls: 'btn-danger', onClick: () => {
                  const r = ctx.save.importText((ta as HTMLTextAreaElement).value);
                  if (!r.ok || !r.state) { app.ui.toast('error', tt('settings.importFail')); return false; }
                  ctx.save.save(r.state);
                  app.ui.toast('success', tt('settings.importOk'));
                  setTimeout(() => location.reload(), 600);
                } },
              ], { wide: true });
            }, 'btn-secondary'),
            btn(tt('settings.reset'), () => app.ui.confirm(tt('settings.reset'), tt('settings.resetConfirm'), () => { ctx.save.wipe(); location.reload(); }, tt('settings.reset'), true), 'btn-danger')),
          h('h2', null, tt('settings.dev')),
          field(tt('settings.testMode'), toggle(app, 'testMode'), tt('settings.testMode.hint')),
          field(tt('settings.testAdFailure'), toggle(app, 'testAdFailure')),
        ),
      ),
    );
  },
};

export const helpScreen: ScreenDef = {
  id: 'help',
  titleKey: 'menu.help',
  render(app, root) {
    const keys: [string, string][] = [
      ['W / ↑', 'help.k.gas'], ['S / ↓', 'help.k.brake'], ['A D / ← →', 'help.k.steer'], ['Space', 'help.k.handbrake'],
      ['E', 'help.k.engine'], ['1 2 3 4', 'help.k.gears'], ['L', 'help.k.lights'], ['Z / C', 'help.k.signals'], ['X', 'help.k.hazard'],
      ['H', 'help.k.horn'], ['K', 'help.k.wipers'], ['O', 'help.k.doors'], ['Tab', 'help.k.camera'], ['B', 'help.k.rear'],
      ['M  + / −', 'help.k.cruise'], ['Esc / P', 'help.k.pause'], ['F', 'help.k.handbrakeToggle'],
    ];
    const steps = ['help.s1', 'help.s2', 'help.s3', 'help.s4', 'help.s5', 'help.s6'];
    const faq = ['help.q1', 'help.q2', 'help.q3', 'help.q4', 'help.q5'];
    root.append(
      h('div', { class: 'two-col' },
        h('section', { class: 'panel' },
          h('h2', null, tt('help.howto')),
          h('ol', null, steps.map((k) => h('li', null, tt(k)))),
          h('h2', null, tt('help.controls')),
          h('table', { class: 'table keys' }, h('tbody', null, keys.map(([k, d]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', null, tt(d)))))),
          h('p', { class: 'muted' }, tt('help.touch')),
        ),
        h('section', { class: 'panel' },
          h('h2', null, tt('help.faq')),
          faq.map((k) => h('details', null, h('summary', null, tt(`${k}.q`)), h('p', null, tt(`${k}.a`)))),
          h('h2', null, tt('help.support')),
          h('p', null, tt('help.supportText')),
          h('h2', null, tt('help.about')),
          row(tt('help.game'), GAME_NAME),
          row(tt('help.version'), __APP_VERSION__),
          h('p', { class: 'muted' }, tt('help.legal')),
          h('p', { class: 'muted' }, tt('help.privacy')),
          btn(tt('help.replayTutorial'), () => { ctx2(app); }, 'btn-secondary'),
        ),
      ),
    );
  },
};

function ctx2(app: App): void {
  app.ctx.state.tutorialDone = false;
  app.ctx.bus.emit('stateChanged', undefined);
  app.ui.toast('info', tt('help.tutorialReset'));
  app.ui.home();
}
