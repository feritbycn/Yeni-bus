/**
 * Browser smoke test (optional). Requires:  npm i -D playwright && npx playwright install chromium
 * Usage:  npm run build && npm run preview -- --port 4173   (in another terminal)
 *         BASE_URL=http://localhost:4173/ node scripts/e2e-smoke.mjs
 *
 * What it checks: the 16 menu screens open without console errors, then a full 3D trip is driven by a
 * tiny autopilot (fast-forwarded without rendering) until the trip completes and money is paid.
 * Software WebGL (SwiftShader) is used, so it runs headless in CI; frame rates there are NOT representative.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
// BUS=rm16 drives the trip with one of the imported 3D coaches (default: the starter bus)
const BUS = process.env.BUS ?? '';
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}?smoke`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__rm?.app, null, { timeout: 15000 });
const ids = await page.$$eval('[data-menu]', (els) => els.map((e) => e.getAttribute('data-menu')));
if (ids.length !== 16) fail(`expected 16 menu entries, got ${ids.length}`);
for (const id of ids) {
  await page.evaluate((i) => window.__rm.app.ui.show(i), id);
  await page.waitForTimeout(150);
  const empty = await page.evaluate(() => document.querySelector('.screen')?.children.length === 0);
  if (empty) fail(`screen "${id}" rendered nothing`);
}
// a REAL mouse click must reach the menu (guards against overlay layers swallowing pointer events)
await page.evaluate(() => window.__rm.app.ui.home());
await page.click('[data-menu]');
if ((await page.evaluate(() => window.__rm.app.ui.currentId)) === 'menu') fail('a real click on the first menu entry did nothing');
await page.evaluate(() => { const a = window.__rm.app; a.ui.home(); a.ctx.settings.update({ quality: 'low' }); a.ctx.state.tutorialDone = true; });

if (BUS) {
  const bought = await page.evaluate((id) => { const a = window.__rm.app; a.ctx.state.company.level = 20; a.ctx.state.cash += 5e6; const r = a.ctx.garage.buy(id); if (r.ok) a.ctx.garage.select(r.value.uid); return r.ok ? '' : r.error; }, BUS);
  if (bought) fail(`could not buy ${BUS}: ${bought}`);
}
const cash0 = await page.evaluate(() => window.__rm.app.ctx.state.cash);
const started = await page.evaluate(() => {
  const a = window.__rm.app;
  return a.startTrip({ connectionId: 'kuzeyliman-yesilvadi', reverse: false, variant: 'highway', busUid: a.ctx.garage.selectedBus().uid, departureHour: 7, ticketPrice: 106 });
});
if (!started) fail('trip did not start');
await page.waitForTimeout(500);
await page.keyboard.press('e');
await page.keyboard.press('4');
await page.keyboard.down('Space'); await page.waitForTimeout(150); await page.keyboard.up('Space');
await page.evaluate(() => window.__rm.app.engine.stopLoop());

const chunk = () => page.evaluate((n) => {
  const app = window.__rm.app, s = app.engine.session, v = s.vehicle, inp = app.engine.input, path = s.world.path, route = s.plan.route;
  let now = performance.now();
  for (let i = 0; i < n && s.phase === 'driving'; i++) {
    const man = s.plan.manifest, sNow = s.hud().progress * route.playLengthM, lane = route.profile.lanesSame[0];
    const d = path.project(v.x, v.z, sNow).d;
    const next = route.stops.find((st) => !man.hasServedStop(st.id) && sNow < st.s + 60);
    let dT = lane, vT = (s.hud().limitKmh * 0.8) / 3.6;
    if (next) {
      const dist = next.s - sNow, bay = route.profile.halfWidth + 2.45;
      if (dist < 90) dT = bay; else if (dist < 150) dT = lane + (bay - lane) * (1 - (dist - 90) / 60);
      if (dist < 160) vT = Math.max(0, Math.min(vT, Math.sqrt(Math.max(0, dist - 3)) * 1.6));
      if (dist < 3.5) vT = 0;
    }
    const ahead = s.traffic.snapshot().filter((t) => t.dir === 1 && Math.abs(t.d - d) < 2.6 && t.s > sNow && t.s - sNow < 60).sort((a, b) => a.s - b.s)[0];
    if (ahead) vT = Math.min(vT, Math.max(0, ahead.v - (35 - (ahead.s - sNow)) * 0.5), Math.max(0, (ahead.s - sNow - 14) * 0.5));
    const L = Math.max(10, Math.abs(v.speed) * 1.4);
    const P = path.lanePos(Math.min(route.playLengthM - 1, sNow + L), dT);
    const lat = (P.x - v.x) * -Math.cos(v.heading) + (P.z - v.z) * Math.sin(v.heading);
    inp.setTouchSteer(Math.max(-1, Math.min(1, (lat / L) * 3)));
    const err = vT - v.speed;
    inp.setTouchThrottle(err > 0.3 && !v.doorsOpen ? Math.min(1, err * 0.5) : 0);
    inp.setTouchBrake(err < -0.5 ? Math.min(1, -err * 0.3) : vT === 0 && Math.abs(v.speed) < 0.4 ? 0.6 : 0);
    now += 33;
    s.update(1 / 30, now);
  }
  return { phase: s.phase, summary: s.summary };
}, 300);

let last;
for (let k = 0; k < 200; k++) { last = await chunk(); if (last.phase !== 'driving') break; }
const cash1 = await page.evaluate(() => window.__rm.app.ctx.state.cash);
if (!last || last.phase !== 'finished') fail('trip never finished');
else if (last.summary.status !== 'completed') fail(`trip status ${last.summary.status}`);
else if (!(cash1 > cash0)) fail('no profit was paid');
else console.log(`OK${BUS ? ' (' + BUS + ')' : ''}: trip completed, ${last.summary.passengers} passengers, profit ${Math.round(last.summary.profit)}`);
if (errors.length) fail('console errors:\n' + errors.join('\n'));
await browser.close();
