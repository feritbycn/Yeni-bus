import type { App, ScreenDef } from '../UIManager';
import type { RouteVariant } from '../../core/types';
import { h, btn, money, num, row, tt, bar, stars } from '../dom';
import { CITIES, CITY_BY_ID, CONNECTIONS } from '../../data/world';
import { xpForLevel, OFFICE_COSTS, COMPANY_NAME_MAX } from '../../data/constants';
import { COMPANY_COLORS, COMPANY_LOGOS } from '../../systems/CompanyManager';
import { i18n } from '../../i18n/LocalizationManager';

const LOGO_GLYPH: Record<string, string> = { logo_bus: '🚌', logo_star: '★', logo_bolt: '⚡', logo_shield: '🛡', logo_leaf: '🍃', logo_road: '🛣' };

export const careerScreen: ScreenDef = {
  id: 'career',
  titleKey: 'menu.career',
  render(app, root) {
    const { ctx } = app;
    const c = ctx.state.company;
    const s = ctx.state.stats;
    const need = xpForLevel(c.level);
    const trips = ctx.state.trips.slice().reverse().slice(0, 12);
    root.append(
      h('div', { class: 'two-col' },
        h('section', { class: 'panel' },
          h('h2', null, tt('career.progress')),
          row(tt('common.level'), String(c.level)),
          bar(c.xp / need),
          h('small', null, `${num(c.xp)} / ${num(need)} XP`),
          row(tt('career.reputation'), `${c.reputation.toFixed(0)} / 100`), bar(c.reputation / 100),
          row(tt('career.trips'), num(s.tripsCompleted)),
          row(tt('career.passengers'), num(s.totalPassengers)),
          row(tt('career.km'), num(s.totalKm)),
          row(tt('career.revenue'), money(s.totalRevenue)),
          row(tt('career.cleanStreak'), `${s.cleanStreak} (${tt('career.best')} ${s.bestCleanStreak})`),
          row(tt('career.fiveStar'), String(s.fiveStarTrips)),
          row(tt('career.cities'), `${c.unlockedCities.length} / ${CITIES.length}`),
        ),
        h('section', { class: 'panel' },
          h('h2', null, tt('career.history')),
          trips.length === 0 ? h('p', { class: 'muted' }, tt('career.noTrips')) :
            h('table', { class: 'table' },
              h('thead', null, h('tr', null, h('th', null, tt('career.route')), h('th', null, tt('career.pax')), h('th', null, tt('career.rating')), h('th', null, tt('career.profit')))),
              h('tbody', null, trips.map((r) => h('tr', null,
                h('td', null, `${tt('city.' + r.fromId)} → ${tt('city.' + r.toId)}${r.byDriverId ? ' 👤' : ''}`),
                h('td', null, `${r.passengers}/${r.seats}`),
                h('td', null, stars(r.rating)),
                h('td', { class: r.profit >= 0 ? 'good' : 'bad' }, money(r.profit)))))),
        ),
      ),
    );
  },
};

export const companyScreen: ScreenDef = {
  id: 'company',
  titleKey: 'menu.company',
  render(app, root) {
    const { ctx } = app;
    const c = ctx.state.company;
    const cm = ctx.company;
    const cost = cm.officeUpgradeCost();
    const rep7 = ctx.economy.reportRange(7);
    const rep1 = ctx.economy.reportRange(1);
    const input = h('input', { class: 'input', id: 'company-name', value: c.name, maxlength: COMPANY_NAME_MAX, autocomplete: 'off' });
    root.append(
      h('div', { class: 'two-col' },
        h('section', { class: 'panel' },
          h('h2', null, tt('company.identity')),
          h('label', { class: 'field' }, h('span', null, tt('company.name')),
            h('div', { class: 'inline' }, input, btn(tt('common.save'), () => {
              const r = cm.setName((input as HTMLInputElement).value);
              if (!r.ok) app.ui.toast('error', tt('company.err.name')); else app.ui.toast('success', tt('company.saved'));
            }, 'btn-secondary'))),
          h('div', { class: 'field' }, h('span', null, tt('company.color')),
            h('div', { class: 'swatches' }, COMPANY_COLORS.map((col) =>
              h('button', { type: 'button', class: `swatch${c.color === col ? ' on' : ''}`, style: { background: col }, 'aria-label': col, on: { click: () => cm.setColor(col) } })))),
          h('div', { class: 'field' }, h('span', null, tt('company.logo')),
            h('div', { class: 'swatches' }, COMPANY_LOGOS.map((lg) =>
              h('button', { type: 'button', class: `swatch logo${c.logo === lg ? ' on' : ''}`, on: { click: () => cm.setLogo(lg) } }, LOGO_GLYPH[lg] ?? '🚌')))),
          h('div', { class: 'company-card', style: { borderColor: c.color } }, h('span', { class: 'logo-big', style: { color: c.color } }, LOGO_GLYPH[c.logo] ?? '🚌'), h('b', null, c.name)),
        ),
        h('section', { class: 'panel' },
          h('h2', null, tt('company.office')),
          row(tt('company.officeLevel'), `${c.officeLevel} / ${OFFICE_COSTS.length}`),
          row(tt('company.driverSlots'), String(cm.driverSlots())),
          cost === null ? h('span', { class: 'chip ok' }, tt('garage.maxed')) :
            btn(`${tt('company.upgradeOffice')} · ${money(cost)}`, () => {
              const r = cm.buyOffice();
              if (!r.ok) app.ui.toast('error', tt(`company.err.${r.error}`)); else { app.ui.toast('success', tt('company.officeUpgraded')); app.audio.ui('coin'); }
            }, 'btn-primary'),
          h('small', { class: 'muted' }, tt('company.officeHint')),
          h('h2', null, tt('company.finance')),
          row(tt('company.today'), `${money(rep1.revenue)} / −${money(rep1.expenses)}`),
          row(tt('company.week'), `${money(rep7.revenue)} / −${money(rep7.expenses)}`),
          row(tt('company.net7'), h('b', { class: rep7.revenue - rep7.expenses >= 0 ? 'good' : 'bad' }, money(rep7.revenue - rep7.expenses))),
          h('h3', null, tt('company.ledger')),
          h('div', { class: 'ledger' },
            ctx.state.ledger.slice(-14).reverse().map((t) => h('div', { class: 'kv' },
              h('span', { class: 'k' }, `${new Date(t.time).toLocaleTimeString(i18n.locale, { hour: '2-digit', minute: '2-digit' })} · ${tt('tx.' + t.type)}`),
              h('span', { class: `v ${t.amount >= 0 ? 'good' : 'bad'}` }, `${t.amount >= 0 ? '+' : '−'}${t.currency === 'gold' ? '◆' : '$'}${num(Math.abs(t.amount))}`)))),
        ),
      ),
    );
  },
};

export const mapScreen: ScreenDef = {
  id: 'map',
  titleKey: 'menu.map',
  render(app, root) {
    const { ctx } = app;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'map-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', tt('map.aria'));
    const mk = (tag: string, attrs: Record<string, string>, text?: string) => {
      const el = document.createElementNS(svgNS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      if (text) el.textContent = text;
      svg.appendChild(el);
      return el;
    };
    mk('rect', { x: '0', y: '0', width: '100', height: '100', fill: 'var(--map-bg)' });
    for (const cn of CONNECTIONS) {
      const a = CITY_BY_ID[cn.a];
      const b = CITY_BY_ID[cn.b];
      const open = ctx.routes.isConnectionUnlocked(cn.id);
      mk('line', { x1: String(a.x), y1: String(a.y), x2: String(b.x), y2: String(b.y), stroke: open ? 'var(--accent)' : 'var(--muted)', 'stroke-width': open ? '1.2' : '0.6', 'stroke-dasharray': open ? '' : '2 2' });
    }
    for (const city of CITIES) {
      const open = ctx.routes.isCityUnlocked(city.id);
      mk('circle', { cx: String(city.x), cy: String(city.y), r: String(2 + city.size * 2), fill: open ? 'var(--good)' : 'var(--muted)', stroke: '#fff', 'stroke-width': '0.4' });
      mk('text', { x: String(city.x), y: String(city.y - 4.5), 'text-anchor': 'middle', 'font-size': '3.2', fill: 'var(--text)' }, tt(`city.${city.id}`));
    }
    const list = h('div', { class: 'cards' },
      CITIES.map((city) => {
        const open = ctx.routes.isCityUnlocked(city.id);
        const chk = ctx.routes.canUnlockCity(city.id);
        return h('article', { class: `card${open ? '' : ' locked'}` },
          h('h3', null, tt(`city.${city.id}`)),
          row(tt('map.size'), '●'.repeat(Math.max(1, Math.round(city.size * 3)))),
          open ? h('span', { class: 'chip ok' }, tt('map.open')) : [
            row(tt('map.requires'), `${tt('common.level')} ${city.unlockLevel}`),
            btn(`${tt('map.unlock')} · ${money(city.unlockCost)}`, () => {
              const r = ctx.routes.unlockCity(city.id);
              if (!r.ok) app.ui.toast('error', tt(`map.err.${r.reason}`)); else { app.ui.toast('success', tt('map.unlocked')); app.audio.ui('ok'); }
            }, 'btn-primary', !chk.ok),
            !chk.ok ? h('small', { class: 'error' }, tt(`map.err.${chk.reason}`)) : null,
          ]);
      }),
    );
    root.append(h('section', { class: 'panel' }, h('h2', null, tt('menu.map')), svg, h('small', { class: 'muted' }, tt('map.fictional'))), list);
  },
};

export const driversScreen: ScreenDef = {
  id: 'drivers',
  titleKey: 'menu.drivers',
  render(app, root) {
    const { ctx } = app;
    const cm = ctx.company;
    const st = ctx.state;
    const err = (e?: string) => app.ui.toast('error', tt(`drivers.err.${e ?? 'notFound'}`));
    const skillBars = (d: { experience: number; skill: number; fuelEfficiency: number; customerSatisfaction: number }) =>
      h('div', { class: 'skills' },
        (['experience', 'skill', 'fuelEfficiency', 'customerSatisfaction'] as const).map((k) =>
          h('div', { class: 'skill' }, h('small', null, tt(`drivers.${k}`)), bar(d[k] / 10))));

    const hired = st.drivers.map((d) => {
      const busOpts = st.buses.filter((b) => !b.assignedDriverId || b.assignedDriverId === d.id);
      const routeOpts = ctx.routes.unlockedConnections();
      const busSel = h('select', { class: 'input' }, h('option', { value: '' }, '—'), busOpts.map((b) => h('option', { value: b.uid }, `${tt('bus.' + b.modelId + '.name')} · ${b.plate}`)));
      busSel.value = d.assignedBusUid ?? '';
      const routeSel = h('select', { class: 'input' }, h('option', { value: '' }, '—'), routeOpts.flatMap((c) => (c.motorway ? ['highway', 'old'] : ['old']).map((v) => h('option', { value: `${c.id}|${v}` }, `${tt('city.' + c.a)} ⇄ ${tt('city.' + c.b)} (${tt('play.variant.' + v)})`))));
      routeSel.value = d.assignedConnectionId ? `${d.assignedConnectionId}|${d.assignedVariant}` : '';
      const salary = h('input', { class: 'input', type: 'number', min: 0, step: 50, value: d.salaryPerDay });
      return h('article', { class: 'card' },
        h('h3', null, `👤 ${d.name}`, h('span', { class: `chip st-${d.status}` }, tt(`drivers.status.${d.status}`))),
        skillBars(d),
        row(tt('drivers.trips'), String(d.tripsDone)),
        row(tt('drivers.profit'), money(d.profitGenerated)),
        h('small', { class: 'muted' }, d.lastReport ? tt(`drivers.report.${d.lastReport}`) : ''),
        h('label', { class: 'field' }, h('span', null, tt('drivers.bus')), busSel),
        h('label', { class: 'field' }, h('span', null, tt('drivers.route')), routeSel),
        h('label', { class: 'field' }, h('span', null, `${tt('drivers.salary')} (${tt('drivers.fair')}: ${money(cm.fairSalary(d))})`),
          h('div', { class: 'inline' }, salary, btn(tt('common.save'), () => { const r = cm.setSalary(d.id, Number((salary as HTMLInputElement).value)); if (!r.ok) err(r.error); else app.ui.toast('success', tt('company.saved')); }, 'btn-secondary'))),
        h('div', { class: 'actions' },
          btn(tt('drivers.assign'), () => {
            const [conn, variant] = routeSel.value ? routeSel.value.split('|') : [null, 'highway'];
            const r = cm.assign(d.id, busSel.value || null, conn, variant as RouteVariant);
            if (!r.ok) err(r.error); else { app.ui.toast('success', tt('drivers.assigned')); app.audio.ui('ok'); }
          }, 'btn-primary'),
          btn(tt('drivers.fire'), () => app.ui.confirm(tt('drivers.fire'), tt('drivers.fireConfirm', { name: d.name }), () => cm.fire(d.id), tt('drivers.fire'), true), 'btn-danger')));
    });

    const cands = cm.candidates().filter((cd) => !st.drivers.some((d) => d.id === cd.id));
    const slotsFree = cm.driverSlots() - st.drivers.length;
    root.append(
      h('section', { class: 'panel' },
        h('h2', null, tt('drivers.title')),
        h('p', null, tt('drivers.intro', { n: st.drivers.length, m: cm.driverSlots() })),
        h('p', { class: 'muted' }, tt('drivers.offlineNote')),
        h('div', { class: 'actions' }, btn(tt('drivers.collect'), () => {
          const rep = cm.tickDrivers();
          app.ui.modal(tt('drivers.report'), h('div', null,
            row(tt('drivers.trips'), String(rep.trips)), row(tt('drivers.revenue'), money(rep.revenue)), row(tt('drivers.expenses'), money(rep.expenses)),
            row(tt('drivers.salaryPaid'), money(rep.salary)), row(tt('career.profit'), h('b', { class: rep.profit >= 0 ? 'good' : 'bad' }, money(rep.profit)))));
        }, 'btn-secondary', st.drivers.length === 0))),
      h('div', { class: 'cards' }, hired),
      h('section', { class: 'panel' }, h('h2', null, tt('drivers.hire')),
        slotsFree <= 0 ? h('p', { class: 'muted' }, tt('drivers.noSlots')) : null,
        h('div', { class: 'cards' }, cands.map((cd) =>
          h('article', { class: 'card' }, h('h3', null, cd.name), skillBars(cd),
            row(tt('drivers.fair'), money(cd.fairSalary)), row(tt('drivers.fee'), money(cd.hiringFee)),
            btn(tt('drivers.hireBtn'), () => { const r = cm.hire(cd.id); if (!r.ok) err(r.error); else { app.ui.toast('success', tt('drivers.hired')); app.audio.ui('ok'); } }, 'btn-primary', slotsFree <= 0))))),
    );
  },
};
