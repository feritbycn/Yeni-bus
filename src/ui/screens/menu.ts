import type { App, ScreenDef } from '../UIManager';
import { h, tt } from '../dom';
import { GAME_NAME } from '../../data/constants';
import { lookFor } from '../../engine/look';

interface Entry {
  id: string;
  icon: string;
  badge?: (app: App) => number;
}

const ENTRIES: Entry[] = [
  { id: 'play', icon: '▶' },
  { id: 'career', icon: '🏆' },
  { id: 'company', icon: '🏢' },
  { id: 'garage', icon: '🔧' },
  { id: 'gallery', icon: '🚌' },
  { id: 'routes', icon: '🗓' },
  { id: 'map', icon: '🗺' },
  { id: 'drivers', icon: '👤' },
  { id: 'missions', icon: '🎯', badge: (a) => a.ctx.missions.list().filter((m) => m.claimable).length },
  { id: 'daily', icon: '🎁', badge: (a) => (a.ctx.daily.status().claimedToday ? 0 : 1) },
  { id: 'rewarded', icon: '📺' },
  { id: 'shop', icon: '🛒' },
  { id: 'premium', icon: '★' },
  { id: 'achievements', icon: '🏅', badge: (a) => a.ctx.missions.achievementList().filter((x) => x.unlocked && !x.claimed).length },
  { id: 'settings', icon: '⚙' },
  { id: 'help', icon: '❓' },
];

export const MENU_ENTRY_IDS = ENTRIES.map((e) => e.id);

export const menuScreen: ScreenDef = {
  id: 'menu',
  titleKey: 'menu.title',
  showroom: true,
  render(app, root) {
    const bus = app.ctx.garage.selectedBus();
    if (bus) app.engine.showBus(bus.modelId, lookFor(app.ctx, bus), true);
    const grid = h('nav', { class: 'menu-grid', 'aria-label': tt('menu.title') });
    for (const e of ENTRIES) {
      const n = e.badge ? e.badge(app) : 0;
      grid.appendChild(
        h('button', { class: `menu-btn${e.id === 'play' ? ' primary' : ''}`, type: 'button', 'data-menu': e.id, on: { click: () => { app.audio.ui('click'); app.ui.show(e.id); } } },
          h('span', { class: 'mi' }, e.icon),
          h('span', { class: 'ml' }, tt(`menu.${e.id}`)),
          n > 0 ? h('span', { class: 'badge' }, String(n)) : null,
        ),
      );
    }
    root.append(
      h('div', { class: 'menu-wrap' },
        h('div', { class: 'brand' }, h('h1', null, GAME_NAME), h('p', null, tt('menu.tagline'))),
        grid,
        h('p', { class: 'menu-foot' }, tt('menu.hint')),
      ),
    );
  },
};
