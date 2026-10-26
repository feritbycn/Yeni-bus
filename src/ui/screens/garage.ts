import type { App, ScreenDef } from '../UIManager';
import type { OwnedBus, BusUpgrades } from '../../core/types';
import type { BusModelDef } from '../../data/buses';
import type { CosmeticKind } from '../../data/cosmetics';
import { h, btn, money, num, row, tt, bar, clear } from '../dom';
import { BUS_MODELS, BUS_BY_ID, ALL_BUS_MODELS } from '../../data/buses';
import { COSMETICS, COSMETIC_BY_ID } from '../../data/cosmetics';
import { GarageManager } from '../../systems/GarageManager';
import { MAX_UPGRADE_LEVEL, PLATE_REGEX } from '../../data/constants';
import { lookFor } from '../../engine/look';
import type { BusLook } from '../../vehicle/BusModel';

const KINDS: CosmeticKind[] = ['paint', 'livery', 'rims', 'interior'];
const UPG: (keyof BusUpgrades)[] = ['engine', 'comfort', 'handling'];

let selectedUid: string | null = null;
let tab: CosmeticKind | 'upgrades' | 'info' = 'paint';
let preview: Partial<Pick<BusLook, 'paint' | 'livery' | 'rims' | 'interior'>> = {};
let previewUid: string | null = null;

function costText(c: { cash?: number; gold?: number }): string {
  const parts: string[] = [];
  if (c.cash) parts.push(money(c.cash));
  if (c.gold) parts.push(`◆ ${c.gold}`);
  return parts.length ? parts.join(' + ') : tt('common.free');
}

export function statRows(m: BusModelDef): HTMLElement[] {
  return [
    row(tt('stat.seats'), String(m.seats)),
    row(tt('stat.maxSpeed'), `${m.maxSpeedKmh} km/h`),
    row(tt('stat.power'), `${m.powerKw} kW`),
    row(tt('stat.consumption'), `${m.consumptionPer100} ${m.powertrain === 'electric' ? 'kWh' : 'L'}/100km`),
    row(tt('stat.luggage'), String(m.luggageCapacity)),
    row(tt('stat.comfort'), String(m.comfort)),
    row(tt('stat.handling'), String(m.handling)),
    row(tt('stat.tank'), `${m.tankCapacity} ${m.powertrain === 'electric' ? 'kWh' : 'L'}`),
  ];
}

export const garageScreen: ScreenDef = {
  id: 'garage',
  titleKey: 'menu.garage',
  showroom: true,
  render(app: App, root: HTMLElement) {
    const { ctx } = app;
    const g = ctx.garage;
    const buses = ctx.state.buses;
    if (!selectedUid || !g.getBus(selectedUid)) selectedUid = g.selectedBus()?.uid ?? buses[0]?.uid ?? null;
    const bus = g.getBus(selectedUid);
    if (!bus) {
      root.append(h('section', { class: 'panel' }, h('p', null, tt('garage.empty')), btn(tt('menu.gallery'), () => app.ui.show('gallery'))));
      return;
    }
    if (previewUid !== bus.uid) {
      preview = {};
      previewUid = bus.uid;
    }
    const now = ctx.clock.now();
    const model = g.model(bus);
    const look = { ...lookFor(ctx, bus), ...preview };
    app.engine.showBus(bus.modelId, look, Object.keys(preview).length === 0);
    app.engine.showDoors(false);

    const err = (e?: string) => app.ui.toast('error', tt(`garage.err.${e ?? 'nothingToDo'}`));

    // fleet list
    const fleet = h('div', { class: 'fleet' },
      buses.map((b) =>
        h('button', { type: 'button', class: `fleet-item${b.uid === bus.uid ? ' on' : ''}`, on: { click: () => { selectedUid = b.uid; clear(root); garageScreen.render(app, root); } } },
          h('b', null, tt(`bus.${b.modelId}.name`)),
          h('small', null, `${b.plate}${ctx.state.selectedBusUid === b.uid ? ' ★' : ''}${b.assignedDriverId ? ' 👤' : ''}`))),
      h('small', { class: 'slots' }, tt('garage.slots', { n: buses.length, m: g.slots() })),
    );

    const eff = g.effectiveStats(bus);
    const info = h('div', { class: 'panel-body' },
      h('h3', null, tt(`bus.${bus.modelId}.name`)),
      h('p', { class: 'muted' }, tt(`bus.${bus.modelId}.desc`)),
      row(tt('garage.fuel'), `${bus.fuel.toFixed(0)} / ${eff.tankCapacity}`), bar(bus.fuel / eff.tankCapacity, bus.fuel / eff.tankCapacity < 0.2 ? 'warn' : ''),
      row(tt('garage.damage'), `${bus.damage.toFixed(0)}%`), bar(bus.damage / 100, bus.damage > 60 ? 'warn' : ''),
      row(tt('garage.odometer'), `${num(bus.odometerKm)} km`),
      row(tt('stat.maxSpeed'), `${Math.round(eff.maxSpeedKmh)} km/h`),
      row(tt('stat.power'), `${Math.round(eff.powerKw)} kW`),
      row(tt('stat.consumption'), eff.consumptionPer100.toFixed(1)),
      row(tt('stat.comfort'), String(Math.round(eff.comfort))),
      row(tt('stat.seats'), String(eff.seats)),
      row(tt('garage.resale'), money(g.resaleValue(bus))),
      h('div', { class: 'actions wrap' },
        btn(tt('garage.select'), () => { const r = g.select(bus.uid); if (!r.ok) err(r.error); else app.ui.toast('success', tt('garage.selected')); }, 'btn-primary', ctx.state.selectedBusUid === bus.uid || !!bus.assignedDriverId),
        btn(`${tt('garage.refuel')} (${money(g.refuelCost(bus.uid))})`, () => { const r = g.refuel(bus.uid); if (!r.ok) err(r.error); else app.audio.ui('coin'); }, 'btn-secondary', bus.fuel >= eff.tankCapacity - 0.5),
        btn(`${tt('garage.repair')} (${money(g.repairCost(bus.uid))})`, () => { const r = g.repair(bus.uid); if (!r.ok) err(r.error); else app.audio.ui('coin'); }, 'btn-secondary', bus.damage <= 0),
        btn(`${tt('garage.sell')} (${money(g.resaleValue(bus))})`, () => app.ui.confirm(tt('garage.sell'), tt('garage.sellConfirm', { v: money(g.resaleValue(bus)) }), () => { const r = g.sell(bus.uid); if (!r.ok) err(r.error); else { selectedUid = null; app.audio.ui('coin'); } }, tt('garage.sell'), true), 'btn-danger', buses.length <= 1 || !!bus.assignedDriverId),
      ),
      h('label', { class: 'field' }, h('span', null, tt('garage.plate')),
        h('div', { class: 'inline' },
          h('input', { class: 'input', id: 'plate-input', maxlength: 10, value: bus.plate, autocomplete: 'off' }),
          btn(tt('common.save'), () => {
            const v = (document.getElementById('plate-input') as HTMLInputElement).value.toUpperCase().trim();
            if (!PLATE_REGEX.test(v)) return err('invalidPlate');
            const r = g.setPlate(bus.uid, v);
            if (!r.ok) err(r.error); else app.ui.toast('success', tt('garage.plateSaved'));
          }, 'btn-secondary'))),
    );

    const cosmeticPane = (kind: CosmeticKind) => {
      const items = COSMETICS.filter((c) => c.kind === kind);
      const equipped = g.effectiveCosmetic(bus, kind, now);
      const shown = (preview[kind] ?? equipped) as string;
      const pick = items.map((c) => {
        const usable = g.isUsable(c.id, now);
        const lockedPremium = !!c.premiumOnly && !usable;
        return h('button', {
          type: 'button',
          class: `swatch${shown === c.id ? ' on' : ''}${usable ? '' : ' locked'}`,
          title: tt(`cos.${c.id}`),
          'aria-label': tt(`cos.${c.id}`),
          style: { background: kind === 'livery' ? `linear-gradient(135deg, #fff 0 45%, ${c.color} 45%)` : c.color },
          on: { click: () => { preview = { ...preview, [kind]: c.id }; clear(root); garageScreen.render(app, root); } },
        }, lockedPremium ? '★' : usable ? '' : '🔒');
      });
      const sel = COSMETIC_BY_ID[shown];
      const usable = g.isUsable(shown, now);
      const owned = g.ownsCosmetic(shown) || usable;
      const cost = g.cosmeticCost(shown);
      return h('div', { class: 'panel-body' },
        h('div', { class: 'swatches' }, pick),
        sel ? h('div', { class: 'sel-info' },
          h('b', null, tt(`cos.${sel.id}`)),
          sel.premiumOnly ? h('span', { class: 'chip premium' }, '★ ' + tt('premium.badge')) : null,
          sel.pack ? h('span', { class: 'chip' }, tt('cos.pack')) : null,
          h('div', { class: 'actions' },
            shown === equipped ? h('span', { class: 'chip ok' }, tt('garage.equipped'))
              : usable ? btn(tt('garage.apply'), () => { const r = g.applyCosmetic(bus.uid, shown, now); if (!r.ok) err(r.error); else { preview = {}; app.audio.ui('ok'); } }, 'btn-primary')
              : sel.premiumOnly ? btn('★ ' + tt('garage.needPremium'), () => app.ui.show('premium'), 'btn-secondary')
              : sel.pack ? btn(tt('garage.openShop'), () => app.ui.show('shop'), 'btn-secondary')
              : btn(`${tt('garage.buy')} · ${costText(cost)}`, () => { const r = g.buyCosmetic(shown); if (!r.ok) err(r.error); else { g.applyCosmetic(bus.uid, shown, now); preview = {}; app.audio.ui('coin'); } }, 'btn-primary'),
            owned && shown !== equipped ? null : null,
          )) : null,
        h('small', { class: 'muted' }, tt('garage.previewHint')),
      );
    };

    const upgradePane = h('div', { class: 'panel-body' },
      UPG.map((k) => {
        const lvl = bus.upgrades[k];
        const cost = g.upgradeCost(bus.uid, k);
        return h('div', { class: 'upgrade' },
          h('div', null, h('b', null, tt(`upgrade.${k}`)), h('small', null, tt(`upgrade.${k}.desc`))),
          h('div', { class: 'pips' }, Array.from({ length: MAX_UPGRADE_LEVEL }, (_, i) => h('i', { class: i < lvl ? 'on' : '' }))),
          lvl >= MAX_UPGRADE_LEVEL ? h('span', { class: 'chip ok' }, tt('garage.maxed'))
            : btn(`${tt('garage.upgrade')} · ${money(cost)}`, () => { const r = g.upgrade(bus.uid, k); if (!r.ok) err(r.error); else app.audio.ui('ok'); }, 'btn-secondary'));
      }),
      h('small', { class: 'muted' }, tt('garage.upgradeHint')),
    );

    const compareOther = ALL_BUS_MODELS.filter((m) => m.id !== bus.modelId);
    const comparePane = h('div', { class: 'panel-body' },
      h('select', { class: 'input', id: 'cmp-sel' }, compareOther.map((m) => h('option', { value: m.id }, tt(`bus.${m.id}.name`)))),
      h('div', { id: 'cmp-out' }),
    );
    const renderCmp = () => {
      const other = BUS_BY_ID[(document.getElementById('cmp-sel') as HTMLSelectElement).value];
      const out = document.getElementById('cmp-out')!;
      clear(out);
      for (const r of GarageManager.compare(model, other)) {
        const better = r.higherIsBetter ? r.b > r.a : r.b < r.a;
        out.appendChild(h('div', { class: 'kv' }, h('span', { class: 'k' }, tt(`stat.${r.key}`)), h('span', { class: 'v' }, `${r.a} → `, h('b', { class: r.a === r.b ? '' : better ? 'good' : 'bad' }, String(r.b)))));
      }
    };

    const tabs = h('div', { class: 'tabs' },
      ([...KINDS, 'upgrades', 'info'] as const).map((k) =>
        h('button', { type: 'button', class: `tab${tab === k ? ' on' : ''}`, on: { click: () => { tab = k; clear(root); garageScreen.render(app, root); } } }, tt(`garage.tab.${k}`))));

    const body = tab === 'info' ? info : tab === 'upgrades' ? upgradePane : cosmeticPane(tab);
    root.append(
      h('div', { class: 'side-layout' },
        h('section', { class: 'panel side' }, fleet, tabs, body,
          tab === 'info' ? h('details', null, h('summary', null, tt('garage.compare')), comparePane) : null,
          btn(tt('menu.gallery'), () => app.ui.show('gallery'), 'btn-ghost')),
      ),
    );
    const sel = document.getElementById('cmp-sel');
    if (sel) {
      sel.addEventListener('change', renderCmp);
      renderCmp();
    }
  },
};

let galleryIndex = 0;
type GalleryFilter = 'all' | 'builtin' | 'luxury' | 'intercity' | 'touring' | 'city' | 'electric';
const GALLERY_FILTERS: GalleryFilter[] = ['all', 'builtin', 'luxury', 'intercity', 'touring', 'city', 'electric'];
let galleryFilter: GalleryFilter = 'all';

function galleryList(): BusModelDef[] {
  if (galleryFilter === 'all') return ALL_BUS_MODELS;
  if (galleryFilter === 'builtin') return ALL_BUS_MODELS.filter((m) => !m.glb);
  const ci = ['luxury', 'intercity', 'touring', 'city', 'electric'].indexOf(galleryFilter);
  return ALL_BUS_MODELS.filter((m) => m.glb && (Number(m.id.slice(2)) - 1) % 5 === ci);
}

export const galleryScreen: ScreenDef = {
  id: 'gallery',
  titleKey: 'menu.gallery',
  showroom: true,
  render(app, root) {
    const { ctx } = app;
    const g = ctx.garage;
    const list = galleryList();
    const m = list[((galleryIndex % list.length) + list.length) % list.length];
    app.engine.showBus(m.id, { ...lookFor(ctx, g.selectedBus() ?? ctx.state.buses[0]), plate: '34 RM 100' }, true);
    app.engine.showDoors(false);
    const owned = ctx.state.buses.filter((b) => b.modelId === m.id).length;
    const can = g.canBuy(m.id);
    const cur = g.selectedBus();
    const redraw = () => { clear(root); galleryScreen.render(app, root); };
    const go = (d: number) => { galleryIndex = (galleryIndex + d + list.length) % list.length; redraw(); };
    const filterSel = h('select', { class: 'input', id: 'gal-filter', 'aria-label': tt('gallery.filter'), on: { change: (e) => { galleryFilter = (e.target as HTMLSelectElement).value as GalleryFilter; galleryIndex = 0; redraw(); } } },
      GALLERY_FILTERS.map((f) => h('option', { value: f }, tt(`gallery.f.${f}`))));
    (filterSel as HTMLSelectElement).value = galleryFilter;
    const pos = ((galleryIndex % list.length) + list.length) % list.length;
    root.append(
      h('div', { class: 'side-layout' },
        h('section', { class: 'panel side' },
          h('div', { class: 'gal-nav' }, btn('◀', () => go(-1), 'btn-ghost'), h('h2', null, tt(`bus.${m.id}.name`)), btn('▶', () => go(1), 'btn-ghost')),
          h('div', { class: 'inline' }, filterSel, h('small', { class: 'muted' }, `${pos + 1} / ${list.length} · ${tt(`bus.${m.id}.class`)}`)),
          h('p', null, tt(`bus.${m.id}.desc`)),
          ...statRows(m),
          row(tt('gallery.price'), money(g.buyPrice(m.id))),
          row(tt('gallery.unlock'), `${tt('common.level')} ${m.unlockLevel}`),
          row(tt('gallery.owned'), String(owned)),
          ctx.premium.garageDiscount() > 0 ? h('small', { class: 'good' }, '★ ' + tt('gallery.premiumDiscount')) : null,
          h('div', { class: 'actions' },
            btn(`${tt('garage.buy')} · ${money(g.buyPrice(m.id))}`, () => {
              const r = g.buy(m.id);
              if (!r.ok) app.ui.toast('error', tt(`garage.err.${r.error}`));
              else { app.ui.toast('success', tt('gallery.bought')); app.audio.ui('coin'); }
            }, 'btn-primary', !can.ok),
            !can.ok ? h('small', { class: 'error' }, tt(`garage.err.${can.error}`)) : null,
            btn(tt('gallery.interior'), () => app.engine.showDoors(true), 'btn-ghost'),
          ),
          cur ? h('details', null, h('summary', null, tt('gallery.compareWith', { name: tt(`bus.${cur.modelId}.name`) })),
            GarageManager.compare(g.model(cur), m).map((r) => h('div', { class: 'kv' }, h('span', { class: 'k' }, tt(`stat.${r.key}`)), h('span', { class: 'v' }, `${r.a} → `, h('b', { class: r.a === r.b ? '' : (r.higherIsBetter ? r.b > r.a : r.b < r.a) ? 'good' : 'bad' }, String(r.b)))))) : null,
        ),
      ),
    );
  },
};

export type { OwnedBus };
