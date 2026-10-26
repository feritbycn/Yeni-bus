import type { GameEvents, GameState, Settings } from '../core/types';
import type { EventBus } from '../core/EventBus';
import { clamp } from '../core/utils';
import { defaultSettings } from '../core/state';

type Listener = (s: Settings, changed: (keyof Settings)[]) => void;

/** Validated access to Settings; every change notifies listeners (renderer, audio, UI scale...). */
export class SettingsManager {
  private listeners = new Set<Listener>();

  constructor(
    private readonly state: GameState,
    private readonly bus: EventBus<GameEvents>,
  ) {}

  get(): Settings {
    return this.state.settings;
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  update(patch: Partial<Settings>): void {
    const s = this.state.settings;
    const changed: (keyof Settings)[] = [];
    const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
      if (JSON.stringify(s[k]) !== JSON.stringify(v)) {
        s[k] = v;
        changed.push(k);
      }
    };
    const p = patch;
    if (p.quality !== undefined && ['auto', 'low', 'medium', 'high', 'ultra'].includes(p.quality)) set('quality', p.quality);
    if (p.shadows !== undefined && ['off', 'low', 'medium', 'high'].includes(p.shadows)) set('shadows', p.shadows);
    if (p.viewDistance !== undefined) set('viewDistance', clamp(Math.round(p.viewDistance), 250, 1600));
    if (p.fpsCap !== undefined && [0, 30, 45, 60].includes(p.fpsCap)) set('fpsCap', p.fpsCap);
    if (p.volumes !== undefined) {
      const v = { ...s.volumes, ...p.volumes };
      for (const k of Object.keys(v) as (keyof Settings['volumes'])[]) v[k] = clamp(v[k], 0, 1);
      set('volumes', v);
    }
    if (p.muted !== undefined) set('muted', !!p.muted);
    if (p.controlType !== undefined && ['auto', 'keyboard', 'touchButtons', 'touchWheel'].includes(p.controlType)) set('controlType', p.controlType);
    if (p.sensitivity !== undefined) set('sensitivity', clamp(p.sensitivity, 0.5, 1.5));
    if (p.cameraDistance !== undefined) set('cameraDistance', clamp(p.cameraDistance, 0.7, 1.5));
    if (p.language !== undefined && (p.language === 'tr' || p.language === 'en')) set('language', p.language);
    if (p.vibration !== undefined) set('vibration', !!p.vibration);
    if (p.autoSave !== undefined) set('autoSave', !!p.autoSave);
    if (p.uiScale !== undefined) set('uiScale', clamp(p.uiScale, 0.8, 1.3));
    if (p.autoDoors !== undefined) set('autoDoors', !!p.autoDoors);
    if (p.trafficDensity !== undefined && ['auto', 'off', 'low', 'medium', 'high'].includes(p.trafficDensity)) set('trafficDensity', p.trafficDensity);
    if (p.passengerDetail !== undefined && ['auto', 'low', 'medium', 'high'].includes(p.passengerDetail)) set('passengerDetail', p.passengerDetail);
    if (p.testMode !== undefined) set('testMode', !!p.testMode);
    if (p.testAdFailure !== undefined) set('testAdFailure', !!p.testAdFailure);
    if (changed.length) {
      for (const l of [...this.listeners]) l(s, changed);
      this.bus.emit('stateChanged', undefined);
    }
  }

  reset(): void {
    this.update(defaultSettings());
  }
}
