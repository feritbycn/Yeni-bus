import type { App, ScreenDef } from '../UIManager';
import type { BuyResult } from '../../services/PurchaseService';
import { h, btn, row, tt, money } from '../dom';
import { type ProductDef } from '../../data/shop';
import { i18n } from '../../i18n/LocalizationManager';

function buyMessage(app: App, r: BuyResult): void {
  if (r.ok) {
    app.ui.toast('success', r.test ? tt('shop.testBought') : tt('shop.bought'));
    app.audio.ui('coin');
  } else {
    app.ui.toast(r.reason === 'cancelled' ? 'warn' : 'error', tt(`shop.err.${r.reason ?? 'failed'}`));
  }
}

function productCard(app: App, p: ProductDef & { priceLabel: string; available: boolean }): HTMLElement {
  const { ctx } = app;
  const owned = p.kind === 'permanent' && ctx.purchases.isOwnedPermanent(p);
  const test = ctx.purchases.isTestMode();
  return h('article', { class: 'card product', 'data-product': p.id },
    h('h3', null, tt(`product.${p.id}.name`)),
    h('p', null, tt(`product.${p.id}.desc`)),
    h('div', { class: 'price' }, p.available ? p.priceLabel : '—', test ? h('span', { class: 'chip test' }, tt('common.testBadge')) : null),
    owned ? h('span', { class: 'chip ok' }, tt('shop.owned'))
      : btn(p.available ? tt('shop.buy') : tt('shop.unavailable'), async () => buyMessage(app, await ctx.purchases.buy(p.id)), 'btn-primary', !p.available));
}

export const shopScreen: ScreenDef = {
  id: 'shop',
  titleKey: 'menu.shop',
  render(app, root) {
    const { ctx } = app;
    const grid = h('div', { class: 'cards' }, h('p', { class: 'muted' }, tt('common.loading')));
    const adapterOk = ctx.purchases.activeAdapter().isAvailable();
    root.append(
      h('section', { class: 'panel' },
        h('h2', null, tt('menu.shop')),
        !adapterOk ? h('div', { class: 'banner' }, 'ℹ ' + tt('shop.noBilling')) : null,
        ctx.purchases.isTestMode() ? h('div', { class: 'banner test' }, '⚠ ' + tt('shop.testBanner')) : null,
        h('div', { class: 'actions' }, btn(tt('shop.restore'), async () => {
          const r = await ctx.purchases.restore();
          app.ui.toast(r.ok ? 'success' : 'warn', r.ok ? tt('shop.restored', { n: r.restored }) : tt(`shop.err.${r.reason ?? 'unavailable'}`));
        }, 'btn-secondary')),
        h('h3', null, tt('shop.virtual')),
        h('p', { class: 'muted' }, tt('shop.earnFree')),
        h('div', { class: 'actions wrap' },
          btn(`${tt('shop.freeCash')} (${money(ctx.ads.cashRewardAmount())})`, () => app.ui.show('rewarded'), 'btn-ghost'),
          btn(tt('menu.daily'), () => app.ui.show('daily'), 'btn-ghost')),
      ),
      grid,
    );
    let alive = true;
    void ctx.purchases.products().then((list) => {
      if (!alive) return;
      grid.replaceChildren(...list.filter((p) => p.kind !== 'subscription').map((p) => productCard(app, p)));
    });
    return () => {
      alive = false;
    };
  },
};

export const premiumScreen: ScreenDef = {
  id: 'premium',
  titleKey: 'menu.premium',
  render(app, root) {
    const { ctx } = app;
    const pr = ctx.premium;
    const status = pr.status();
    const sub = ctx.state.purchases.subscription;
    const perks = ['noAds', 'garageDiscount', 'cosmetics', 'daily', 'freeVideos', 'missions', 'garageSlots'];
    const plans = h('div', { class: 'cards' }, h('p', { class: 'muted' }, tt('common.loading')));
    const adapterOk = ctx.purchases.activeAdapter().isAvailable();
    root.append(
      h('section', { class: 'panel premium-panel' },
        h('h2', null, '★ ' + tt('menu.premium')),
        h('p', null, tt('premium.intro')),
        h('ul', { class: 'perks' }, perks.map((k) => h('li', null, tt(`premium.perk.${k}`, { n: 8, d: 20 })))),
        row(tt('premium.status'), h('b', { class: status === 'active' ? 'good' : '' }, tt(`premium.status.${status}`))),
        pr.expiresAt() > 0 ? row(tt('premium.expires'), new Date(pr.expiresAt()).toLocaleString(i18n.locale)) : null,
        pr.isTestSubscription() ? h('div', { class: 'banner test' }, '⚠ ' + tt('premium.testSub')) : null,
        sub.status === 'expired' || sub.status === 'refunded' ? h('p', { class: 'muted' }, tt('premium.expiredNote')) : null,
        !adapterOk ? h('div', { class: 'banner' }, 'ℹ ' + tt('shop.noBilling')) : null,
        ctx.purchases.isTestMode() ? h('div', { class: 'banner test' }, '⚠ ' + tt('shop.testBanner')) : null,
        h('p', { class: 'muted' }, tt('premium.terms')),
      ),
      plans,
      h('section', { class: 'panel' },
        h('div', { class: 'actions wrap' },
          btn(tt('shop.restore'), async () => {
            const r = await ctx.purchases.restore();
            app.ui.toast(r.ok ? 'success' : 'warn', r.ok ? tt('shop.restored', { n: r.restored }) : tt(`shop.err.${r.reason ?? 'unavailable'}`));
          }, 'btn-secondary'),
          btn(tt('premium.manage'), () => app.ui.modal(tt('premium.manage'), h('p', null, tt('premium.manageText')), [{ label: tt('common.ok') }]), 'btn-ghost')),
      ),
    );
    let alive = true;
    void ctx.purchases.products().then((list) => {
      if (!alive) return;
      plans.replaceChildren(...list.filter((p) => p.kind === 'subscription').map((p) =>
        h('article', { class: 'card product', 'data-product': p.id },
          h('h3', null, tt(`product.${p.id}.name`)),
          h('p', null, tt(`product.${p.id}.desc`)),
          h('div', { class: 'price' }, p.available ? p.priceLabel : '—', ctx.purchases.isTestMode() ? h('span', { class: 'chip test' }, tt('common.testBadge')) : null),
          btn(p.available ? tt('premium.subscribe') : tt('shop.unavailable'), async () => buyMessage(app, await ctx.purchases.buy(p.id)), 'btn-primary', !p.available || status === 'active'))));
    });
    return () => {
      alive = false;
    };
  },
};

