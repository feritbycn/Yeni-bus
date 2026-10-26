import './ui/style.css';
import { createGameContext } from './core/GameContext';
import { AudioManager } from './core/AudioManager';
import { PerformanceManager } from './core/PerformanceManager';
import { MemoryStorage, type KeyValueStorage } from './systems/SaveManager';
import { TestAdAdapter, type TestAdPresenter } from './services/adapters/TestAdAdapter';
import { GameEngine } from './engine/GameEngine';
import { UIManager, type App } from './ui/UIManager';
import { DrivingHud } from './ui/hud';
import { h, tt, money, row, fmtDuration } from './ui/dom';
import { i18n } from './i18n/LocalizationManager';
import { BUS_BY_ID } from './data/buses';
import { loadShell, shellPending } from './vehicle/BusAssets';
import type { TripConfig } from './systems/TripManager';
import { menuScreen } from './ui/screens/menu';
import { playScreen, routesScreen } from './ui/screens/play';
import { garageScreen, galleryScreen } from './ui/screens/garage';
import { careerScreen, companyScreen, mapScreen, driversScreen } from './ui/screens/company';
import { missionsScreen, achievementsScreen, dailyScreen, rewardedScreen } from './ui/screens/rewards';
import { shopScreen, premiumScreen } from './ui/screens/shop';
import { settingsScreen, helpScreen } from './ui/screens/settings';

function makeStorage(): KeyValueStorage {
  try {
    const k = '__rm_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    return new MemoryStorage();
  }
}

function boot(): void {
  const host = document.getElementById('app')!;
  const storage = makeStorage();
  const usingMemory = storage instanceof MemoryStorage;

  const ui = new UIManager(host);
  const audio = new AudioManager();

  // ---- TEST rewarded-ad presenter (clearly labelled; no real ads on the web build) ----
  const presenter: TestAdPresenter = {
    present: () =>
      new Promise((resolve) => {
        let left = 5;
        const status = h('b', null, String(left));
        let done = false;
        const closeBtnRef: { el?: HTMLButtonElement } = {};
        const close = ui.modal(
          tt('ad.testTitle'),
          h('div', { class: 'ad-overlay' },
            h('div', { class: 'ad-label' }, 'TEST AD'),
            h('p', null, tt('ad.testBody')),
            h('p', null, tt('ad.testCountdown'), ' ', status)),
          [{ label: tt('ad.close'), cls: 'btn-secondary', onClick: () => { if (!done) resolve('dismissed'); return true; } }],
          { dismiss: false },
        );
        const iv = setInterval(() => {
          left -= 1;
          status.textContent = String(Math.max(0, left));
          if (left <= 0) {
            clearInterval(iv);
            done = true;
            close();
            resolve('completed');
          }
        }, 1000);
        void closeBtnRef;
      }),
  };

  let ctxRef: ReturnType<typeof createGameContext>['ctx'] | null = null;
  const adapter = new TestAdAdapter(presenter, () => ctxRef?.state.settings.testAdFailure ?? false);
  const { ctx, boot: bootInfo } = createGameContext({ storage, adAdapter: adapter });
  ctxRef = ctx;

  i18n.setLanguage(ctx.state.settings.language);
  document.documentElement.lang = ctx.state.settings.language;
  document.documentElement.style.setProperty('--ui-scale', String(ctx.state.settings.uiScale));
  audio.applySettings(ctx.state.settings);

  const perf = new PerformanceManager(() => ctx.state.settings);
  const engine = new GameEngine({
    host: document.getElementById('stage')!,
    ctx,
    audio,
    perf,
    labels: () => ({
      city: (id) => tt(`city.${id}`),
      rest: (k) => tt(k),
      tollText: tt('world.toll'),
      restSub: tt('world.restSub'),
      terminalSub: tt('world.terminalSub'),
    }),
  });

  let hud: DrivingHud | null = null;

  const app: App = {
    ctx,
    engine,
    audio,
    perf,
    ui,
    tripDraft: {},
    startTrip(config: TripConfig): boolean {
      if (!engine.webglOk) {
        ui.toast('error', tt('common.noWebgl'));
        return false;
      }
      const res = ctx.trips.prepare(config);
      if (!res.ok) {
        ui.toast('error', tt(`play.err.${res.error}`));
        return false;
      }
      const begin = () => {
        void audio.unlock();
        ui.setMenuVisible(false);
        const session = engine.startTrip(res.plan);
        hud?.dispose();
        hud = new DrivingHud(app, session);
        engine.onHud = (d) => hud?.update(d);
        if (!ctx.state.tutorialDone) {
          engine.setTripPaused(true);
          ui.modal(tt('tutorial.title'), h('ol', null, ['t1', 't2', 't3', 't4', 't5'].map((k) => h('li', null, tt(`tutorial.${k}`)))), [
            { label: tt('tutorial.go'), onClick: () => { ctx.state.tutorialDone = true; ctx.bus.emit('stateChanged', undefined); engine.setTripPaused(false); } },
          ], { dismiss: false });
        }
      };
      const modelFile = BUS_BY_ID[ctx.garage.getBus(res.plan.busUid)?.modelId ?? '']?.glb;
      if (shellPending(modelFile)) {
        ui.toast('info', tt('common.loadingModel'));
        void loadShell(modelFile!).then(begin);
      } else begin();
      return true;
    },
    endTripUi(): void {
      hud?.dispose();
      hud = null;
      engine.onHud = null;
      engine.endTrip();
      ui.setMenuVisible(true);
      ui.home();
      ctx.save.flushIfDirty(ctx.state);
    },
  };
  ui.bind(app);
  for (const s of [menuScreen, playScreen, routesScreen, garageScreen, galleryScreen, careerScreen, companyScreen, mapScreen, driversScreen, missionsScreen, achievementsScreen, dailyScreen, rewardedScreen, shopScreen, premiumScreen, settingsScreen, helpScreen]) ui.register(s);

  // settings -> side effects
  ctx.settings.onChange((s, changed) => {
    audio.applySettings(s);
    if (changed.includes('language')) {
      i18n.setLanguage(s.language);
      document.documentElement.lang = s.language;
    }
    if (changed.includes('uiScale')) document.documentElement.style.setProperty('--ui-scale', String(s.uiScale));
    if (changed.some((k) => ['quality', 'shadows', 'viewDistance', 'fpsCap', 'trafficDensity', 'passengerDetail'].includes(k as string))) perf.notify();
    if (changed.includes('sensitivity')) engine.input.sensitivity = s.sensitivity;
    if (changed.includes('cameraDistance')) engine.camera.orbitDist = 16 * s.cameraDistance;
  });

  // browsers only start audio after a user gesture
  const unlock = () => {
    void audio.unlock();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  // warm the 3D models of the owned buses (small files); others load on demand
  for (const b of ctx.state.buses) { const f = BUS_BY_ID[b.modelId]?.glb; if (f) void loadShell(f); }

  ui.show('menu');
  engine.startLoop();
  if (!engine.webglOk) ui.toast('error', tt('common.noWebgl'), 8000);

  // launch notices
  const notices: Node[] = [];
  if (bootInfo.load.corrupted) notices.push(h('p', { class: 'error' }, bootInfo.load.recoveredFromBackup ? tt('boot.recovered') : tt('boot.corrupt')));
  if (usingMemory) notices.push(h('p', { class: 'error' }, tt('boot.noStorage')));
  if (ctx.clock.isClockBehind()) notices.push(h('p', { class: 'error' }, tt('boot.clockBehind')));
  const off = bootInfo.offline;
  if (off && (off.trips > 0 || off.salary > 0)) {
    notices.push(h('div', null, h('h3', null, tt('drivers.report')),
      row(tt('drivers.trips'), String(off.trips)), row(tt('drivers.revenue'), money(off.revenue)), row(tt('drivers.expenses'), money(off.expenses)),
      row(tt('career.profit'), h('b', { class: off.profit >= 0 ? 'good' : 'bad' }, money(off.profit))), h('small', { class: 'muted' }, tt('drivers.offlineCap')),
      h('small', { class: 'muted' }, ` (${fmtDuration(off.elapsedMs / 1000)})`)));
  }
  if (notices.length) ui.modal(tt('boot.title'), h('div', null, notices), [{ label: tt('common.ok') }]);

  // Safe save on exit is handled by the engine; also save right now if anything changed during boot.
  ctx.save.flushIfDirty(ctx.state);

  // Hook for the automated browser smoke test (opt-in only: ?smoke)
  if (new URLSearchParams(location.search).has('smoke')) (window as unknown as { __rm: unknown }).__rm = { app };
}

try {
  boot();
} catch (err) {
  const el = document.getElementById('app');
  if (el) {
    el.textContent = 'RoadMaster failed to start: ' + (err instanceof Error ? err.message : String(err));
    el.className = 'fatal';
  }
  console.error(err);
}
