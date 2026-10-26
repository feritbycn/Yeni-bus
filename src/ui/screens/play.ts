import type { App, ScreenDef } from '../UIManager';
import type { TripConfig, TripError } from '../../systems/TripManager';
import type { RouteVariant } from '../../core/types';
import { h, btn, money, num, row, tt, hhmm, fmtDuration, bar, clear } from '../dom';
import { CONNECTIONS, CONNECTION_BY_ID, DEPARTURE_SLOTS } from '../../data/world';
import { BUS_BY_ID } from '../../data/buses';
import { demandMultiplierWeather } from '../../systems/RouteManager';

function errorText(e: TripError): string {
  return tt(`play.err.${e}`);
}

function defaultDraft(app: App): TripConfig {
  const d = app.tripDraft;
  const conns = app.ctx.routes.unlockedConnections();
  const conn = d.connectionId && app.ctx.routes.isConnectionUnlocked(d.connectionId) ? d.connectionId : conns[0]?.id ?? CONNECTIONS[0].id;
  const bus = app.ctx.garage.getBus(d.busUid) ?? app.ctx.garage.selectedBus();
  return {
    connectionId: conn,
    reverse: d.reverse ?? false,
    variant: d.variant ?? 'highway',
    busUid: bus?.uid ?? '',
    departureHour: d.departureHour ?? DEPARTURE_SLOTS[0].hour,
    ticketPrice: d.ticketPrice ?? 0,
  };
}

export const playScreen: ScreenDef = {
  id: 'play',
  titleKey: 'menu.play',
  render(app, root) {
    const { ctx } = app;
    const cfg = defaultDraft(app);
    const conn = CONNECTION_BY_ID[cfg.connectionId];
    if (!conn.motorway) cfg.variant = 'old';
    const t = ctx.trips;
    const spec = ctx.routes.resolve(cfg.connectionId, cfg.reverse, cfg.variant, { timestamp: ctx.clock.now(), hour: cfg.departureHour });
    const range = t.priceRange(spec);
    if (!cfg.ticketPrice || cfg.ticketPrice < range.min || cfg.ticketPrice > range.max) cfg.ticketPrice = spec.ticketRefPrice;
    app.tripDraft = { ...cfg };

    const upd = (patch: Partial<TripConfig>) => {
      app.tripDraft = { ...cfg, ...patch };
      if (patch.connectionId || patch.variant || patch.reverse !== undefined || patch.departureHour !== undefined) app.tripDraft.ticketPrice = 0;
      clear(root);
      playScreen.render(app, root);
    };

    const sel = <T extends string | number>(opts: { v: T; label: string }[], cur: T, on: (v: T) => void) => {
      const el = h('select', { class: 'input', on: { change: (e) => on(opts[(e.target as HTMLSelectElement).selectedIndex].v) } },
        opts.map((o) => h('option', { value: String(o.v) }, o.label)));
      el.selectedIndex = Math.max(0, opts.findIndex((o) => o.v === cur));
      return el;
    };

    const unlocked = ctx.routes.unlockedConnections();
    const buses = ctx.state.buses;
    const bus = ctx.garage.getBus(cfg.busUid);
    const prep = t.prepare(cfg);
    const eff = bus ? ctx.garage.effectiveStats(bus) : null;
    const est = bus && eff ? ctx.routes.estimate(spec, eff.consumptionPer100, ctx.garage.unitPrice(bus), ctx.garage.model(bus).maintenancePerKm) : null;
    const weather = prep.ok ? prep.plan.weather : 'clear';

    const left = h('section', { class: 'panel' },
      h('h2', null, tt('play.setup')),
      h('label', { class: 'field' }, h('span', null, tt('play.route')),
        sel(unlocked.flatMap((c) => [false, true].map((r) => ({ v: `${c.id}|${r ? 'r' : 'f'}`, label: `${tt('city.' + (r ? c.b : c.a))} → ${tt('city.' + (r ? c.a : c.b))}` }))),
          `${cfg.connectionId}|${cfg.reverse ? 'r' : 'f'}`,
          (v) => {
            const [id, dir] = String(v).split('|');
            upd({ connectionId: id, reverse: dir === 'r', variant: CONNECTION_BY_ID[id].motorway ? cfg.variant : 'old' });
          })),
      h('div', { class: 'field' }, h('span', null, tt('play.variant')),
        h('div', { class: 'seg' },
          (['highway', 'old'] as RouteVariant[]).map((v) =>
            h('button', { type: 'button', class: `seg-btn${cfg.variant === v ? ' on' : ''}`, disabled: v === 'highway' && !conn.motorway, on: { click: () => upd({ variant: v }) } }, tt(`play.variant.${v}`)))),
        h('small', null, tt(`play.variant.${cfg.variant}.desc`))),
      h('label', { class: 'field' }, h('span', null, tt('play.bus')),
        buses.length
          ? sel(buses.map((b) => ({ v: b.uid, label: `${tt('bus.' + b.modelId + '.name')} · ${b.plate}${b.assignedDriverId ? ' · ' + tt('play.assigned') : ''}` })), cfg.busUid, (v) => { ctx.garage.select(String(v)); upd({ busUid: String(v) }); })
          : h('em', null, tt('play.noBus'))),
      h('label', { class: 'field' }, h('span', null, tt('play.departure')),
        sel(DEPARTURE_SLOTS.map((s) => ({ v: s.hour, label: `${hhmm(s.hour)}  (${tt('play.demand')} ×${s.demand.toFixed(2)})` })), cfg.departureHour, (v) => upd({ departureHour: Number(v) }))),
      h('label', { class: 'field' }, h('span', null, `${tt('play.price')}: ${money(cfg.ticketPrice)}`),
        h('input', { class: 'input', type: 'range', min: range.min, max: range.max, step: 1, value: cfg.ticketPrice, on: {
          input: (e) => { cfg.ticketPrice = Number((e.target as HTMLInputElement).value); app.tripDraft.ticketPrice = cfg.ticketPrice; (e.target as HTMLElement).parentElement!.querySelector('span')!.textContent = `${tt('play.price')}: ${money(cfg.ticketPrice)}`; },
          change: () => upd({ ticketPrice: cfg.ticketPrice }),
        } }),
        h('small', null, tt('play.priceHint', { ref: money(spec.ticketRefPrice) }))),
    );

    const right = h('section', { class: 'panel' },
      h('h2', null, `${tt('city.' + spec.fromId)} → ${tt('city.' + spec.toId)}`),
      row(tt('play.distance'), `${num(spec.distanceKm)} km`),
      row(tt('play.driveLen'), `${num(spec.playLengthM)} m · ${tt('play.compressed', { n: 20 })}`),
      row(tt('play.eta'), fmtDuration(spec.expectedDriveSeconds)),
      row(tt('play.weather'), tt(`weather.${weather}`) + ` ×${demandMultiplierWeather(weather).toFixed(2)}`),
      row(tt('play.traffic'), tt(`traffic.${spec.trafficLevel}`)),
      row(tt('play.toll'), spec.toll > 0 ? money(spec.toll) : tt('play.free')),
      row(tt('play.stops'), String(spec.stops.length)),
      est ? row(tt('play.estFuel'), money(est.fuelCost)) : null,
      est ? row(tt('play.estMaint'), money(est.maintenance)) : null,
      prep.ok ? h('div', { class: 'demand' },
        row(tt('play.sold'), `${prep.plan.demand.sold} / ${prep.plan.manifest.seats}`),
        bar(prep.plan.manifest.seats ? prep.plan.demand.sold / prep.plan.manifest.seats : 0),
        row(tt('play.reserved'), String(prep.plan.demand.reservations)),
      ) : null,
      bus ? h('div', { class: 'meters' },
        row(tt('garage.fuel'), `${Math.round(bus.fuel)} / ${eff!.tankCapacity}`), bar(bus.fuel / eff!.tankCapacity, bus.fuel / eff!.tankCapacity < 0.2 ? 'warn' : ''),
        row(tt('garage.damage'), `${Math.round(bus.damage)}%`), bar(bus.damage / 100, bus.damage > 60 ? 'warn' : '')) : null,
      !prep.ok ? h('p', { class: 'error' }, errorText(prep.error)) : null,
      h('div', { class: 'actions' },
        bus && !prep.ok && prep.error === 'fuel' ? btn(tt('garage.refuel'), () => { const r = ctx.garage.refuel(bus.uid); if (!r.ok) app.ui.toast('error', tt('garage.err.' + r.error)); }, 'btn-secondary') : null,
        bus && !prep.ok && prep.error === 'damaged' ? btn(tt('garage.repair'), () => app.ui.show('garage'), 'btn-secondary') : null,
        btn('▶ ' + tt('play.start'), () => { app.startTrip(cfg); }, 'btn-primary btn-big', !prep.ok),
      ),
      h('p', { class: 'hint' }, tt('play.controlsHint')),
    );

    root.append(h('div', { class: 'two-col' }, left, right));
  },
};

export const routesScreen: ScreenDef = {
  id: 'routes',
  titleKey: 'menu.routes',
  render(app, root) {
    const { ctx } = app;
    const list = h('div', { class: 'cards' });
    for (const c of CONNECTIONS) {
      const open = ctx.routes.isConnectionUnlocked(c.id);
      const sp = ctx.routes.resolve(c.id, false, c.motorway ? 'highway' : 'old', { timestamp: ctx.clock.now(), hour: 7 });
      const old = c.motorway ? ctx.routes.resolve(c.id, false, 'old', { timestamp: ctx.clock.now(), hour: 7 }) : null;
      list.appendChild(
        h('article', { class: `card${open ? '' : ' locked'}` },
          h('h3', null, `${tt('city.' + c.a)} ⇄ ${tt('city.' + c.b)}`),
          row(tt('play.distance'), `${num(sp.distanceKm)} km${old ? ` / ${num(old.distanceKm)} km` : ''}`),
          row(tt('routes.difficulty'), '●'.repeat(c.difficulty) + '○'.repeat(5 - c.difficulty)),
          row(tt('routes.motorway'), c.motorway ? tt('common.yes') : tt('common.no')),
          row(tt('routes.refFare'), money(sp.ticketRefPrice)),
          row(tt('play.toll'), c.motorway ? money(sp.toll) : tt('play.free')),
          open
            ? h('div', { class: 'actions' },
                btn(tt('routes.drive') + ' →', () => { app.tripDraft = { ...app.tripDraft, connectionId: c.id, reverse: false, variant: c.motorway ? 'highway' : 'old', ticketPrice: 0 }; app.ui.show('play'); }, 'btn-primary'),
                btn(tt('routes.driveBack') + ' ←', () => { app.tripDraft = { ...app.tripDraft, connectionId: c.id, reverse: true, variant: c.motorway ? 'highway' : 'old', ticketPrice: 0 }; app.ui.show('play'); }, 'btn-secondary'))
            : h('p', { class: 'locked-note' }, '🔒 ' + tt('routes.locked'), ' ', btn(tt('menu.map'), () => app.ui.show('map'), 'btn-ghost')),
        ),
      );
    }
    root.append(
      h('section', { class: 'panel' }, h('h2', null, tt('routes.timetable')),
        h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, tt('play.departure')), h('th', null, tt('play.demand')))),
          h('tbody', null, DEPARTURE_SLOTS.slice().sort((a, b) => a.hour - b.hour).map((s) => h('tr', null, h('td', null, hhmm(s.hour)), h('td', null, `×${s.demand.toFixed(2)}`)))))),
      list,
    );
  },
};

