import { describe, expect, it } from 'vitest';
import { DAY, makeEnv } from './helpers';
import { PREMIUM_FREE_CLAIMS_PER_DAY } from '../src/data/constants';
import { TestPurchaseAdapter, WebStoreAdapter } from '../src/services/adapters/PurchaseAdapters';
import { createGameContext } from '../src/core/GameContext';
import { MemoryStorage } from '../src/systems/SaveManager';
import { FakeAdAdapter } from './helpers';

describe('rewarded ads', () => {
  it('grants the reward once after a verified completion', async () => {
    const { ctx } = makeEnv();
    const c = ctx.state.cash;
    const r = await ctx.ads.claim('cash');
    expect(r.ok).toBe(true);
    expect(ctx.state.cash).toBe(c + ctx.ads.cashRewardAmount());
    expect(ctx.state.ads.countByType['cash']).toBe(1);
  });

  it('gives nothing when the ad fails to load', async () => {
    const { ctx, ad } = makeEnv();
    ad.loadOk = false;
    const c = ctx.state.cash;
    const r = await ctx.ads.claim('cash');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('loadFailed');
    expect(ctx.state.cash).toBe(c);
  });

  it('gives nothing when the ad is dismissed before completion', async () => {
    const { ctx, ad } = makeEnv();
    ad.next = 'dismissed';
    const c = ctx.state.cash;
    const r = await ctx.ads.claim('gold');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('dismissed');
    expect(ctx.state.cash).toBe(c);
    expect(ctx.state.gold).toBe(20);
  });

  it('gives nothing for unverified completions', async () => {
    const { ctx, ad } = makeEnv();
    ad.verified = false;
    const r = await ctx.ads.claim('cash');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unverified');
  });

  it('the same provider transaction id cannot be redeemed twice', async () => {
    const { ctx, ad, time } = makeEnv();
    ad.fixedTx = 'same-tx';
    const c0 = ctx.state.cash;
    expect((await ctx.ads.claim('cash')).ok).toBe(true);
    const c1 = ctx.state.cash;
    time.now += 60_000;
    const r = await ctx.ads.claim('cash');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('duplicate');
    expect(ctx.state.cash).toBe(c1);
    expect(c1).toBeGreaterThan(c0);
  });

  it('respects cooldown and daily limits, and resets next day', async () => {
    const { ctx, time } = makeEnv();
    expect((await ctx.ads.claim('cash')).ok).toBe(true);
    const cd = await ctx.ads.claim('cash');
    expect(cd.reason).toBe('cooldown');
    for (let i = 0; i < 4; i++) {
      time.now += 60_000;
      expect((await ctx.ads.claim('cash')).ok).toBe(true);
    }
    time.now += 60_000;
    expect((await ctx.ads.claim('cash')).reason).toBe('limit');
    time.now += DAY;
    expect((await ctx.ads.claim('cash')).ok).toBe(true);
  });

  it('does not waste a video on a boost that is already active', async () => {
    const { ctx, time } = makeEnv();
    expect((await ctx.ads.claim('tripRevenue')).ok).toBe(true);
    time.now += 60_000;
    const again = await ctx.ads.claim('tripRevenue');
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('alreadyActive');
    expect(ctx.state.boosts.revenue).toBe(1);
  });

  it('double daily reward only after the daily reward was claimed', async () => {
    const { ctx } = makeEnv();
    expect((await ctx.ads.claim('doubleDaily')).ok).toBe(false);
    ctx.daily.claim();
    expect((await ctx.ads.claim('doubleDaily')).ok).toBe(true);
    expect(ctx.daily.status().canDouble).toBe(false);
  });

  it('premium members claim ad-free from a daily quota, then fall back to optional ads', async () => {
    const { ctx, time, ad } = makeEnv();
    ctx.premium.activateSubscription('premium_monthly', 'tx', time.now + 10 * DAY, 'store');
    for (let i = 0; i < PREMIUM_FREE_CLAIMS_PER_DAY; i++) {
      const r = await ctx.ads.claim('cash');
      expect(r.ok).toBe(true);
      expect(r.mode).toBe('premiumFree');
    }
    expect(ad.counter).toBe(0);
    const after = await ctx.ads.claim('cash');
    expect(after.mode).toBe('ad');
  });

  it('concurrent claims do not double pay', async () => {
    const { ctx } = makeEnv();
    const c = ctx.state.cash;
    const [a, b] = await Promise.all([ctx.ads.claim('cash'), ctx.ads.claim('cash')]);
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
    expect(ctx.state.cash).toBe(c + ctx.ads.cashRewardAmount());
  });

  it('the web test ad adapter is flagged as test', () => {
    const { ctx } = makeEnv();
    expect(ctx.ads.adapterInfo.isTest).toBe(true);
  });
});

describe('purchases', () => {
  it('web adapter cannot buy anything', async () => {
    const storage = new MemoryStorage();
    const { ctx } = createGameContext({ storage, adAdapter: new FakeAdAdapter(), purchaseAdapter: new WebStoreAdapter(), testPurchaseAdapter: null });
    const r = await ctx.purchases.buy('cash_small');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unavailable');
    expect(ctx.state.cash).toBe(30_000);
  });

  it('verified consumable purchase grants once', async () => {
    const { ctx, store } = makeEnv();
    const c = ctx.state.cash;
    const r = await ctx.purchases.buy('cash_small');
    expect(r.ok).toBe(true);
    expect(ctx.state.cash).toBe(c + 25_000);
    expect(ctx.state.purchases.history.length).toBe(1);
    // duplicate notification with the same transaction id
    const rec = ctx.state.purchases.history[0];
    ctx.purchases.handleUpdate({ kind: 'completed', result: { status: 'success', productId: 'cash_small', transactionId: rec.transactionId, verified: true } });
    expect(ctx.state.cash).toBe(c + 25_000);
    expect(store.txCounter).toBe(1);
  });

  it('failed, cancelled, pending and unverified purchases change nothing', async () => {
    const { ctx, store } = makeEnv();
    const c = ctx.state.cash;
    for (const st of ['failed', 'cancelled'] as const) {
      store.nextStatus = st;
      const r = await ctx.purchases.buy('cash_small');
      expect(r.ok).toBe(false);
    }
    store.nextStatus = 'pending';
    const p = await ctx.purchases.buy('gold_pack');
    expect(p.reason).toBe('pending');
    expect(ctx.state.purchases.pending.length).toBe(1);
    store.nextStatus = 'success';
    store.verified = false;
    const u = await ctx.purchases.buy('cash_small');
    expect(u.reason).toBe('unverified');
    expect(ctx.state.cash).toBe(c);
    expect(ctx.state.gold).toBe(20);
    expect(ctx.state.purchases.history.length).toBe(0);
  });

  it('a pending purchase completes later through the store update channel', async () => {
    const { ctx, store } = makeEnv();
    store.nextStatus = 'pending';
    await ctx.purchases.buy('gold_pack');
    ctx.purchases.handleUpdate({ kind: 'completed', result: { status: 'success', productId: 'gold_pack', transactionId: 'late-1', verified: true } });
    expect(ctx.state.gold).toBe(20 + 200);
    expect(ctx.state.purchases.pending.length).toBe(0);
  });

  it('permanent unlocks work, cannot be bought twice, and are restorable', async () => {
    const { ctx, store } = makeEnv();
    expect((await ctx.purchases.buy('remove_ads')).ok).toBe(true);
    expect(ctx.premium.adsFree()).toBe(true);
    expect((await ctx.purchases.buy('remove_ads')).reason).toBe('duplicate');
    // wipe entitlements, then restore from the store
    ctx.state.purchases.entitlements.removeAds = false;
    ctx.state.purchases.processed = [];
    ctx.state.processedIds = [];
    store.restoreList = [{ status: 'success', productId: 'remove_ads', transactionId: 'store-1', verified: true }];
    const res = await ctx.purchases.restore();
    expect(res.restored).toBe(1);
    expect(ctx.state.purchases.entitlements.removeAds).toBe(true);
  });

  it('refunds revoke permanent items and subscriptions, and deduct consumables safely', async () => {
    const { ctx } = makeEnv();
    await ctx.purchases.buy('remove_ads');
    await ctx.purchases.buy('premium_monthly');
    await ctx.purchases.buy('cash_small');
    const [ads, sub, cash] = ctx.state.purchases.history;
    ctx.state.cash = 1000; // spent most of it
    ctx.purchases.refund(ads.transactionId);
    ctx.purchases.refund(sub.transactionId);
    ctx.purchases.refund(cash.transactionId);
    expect(ctx.state.purchases.entitlements.removeAds).toBe(false);
    expect(ctx.premium.isPremium()).toBe(false);
    expect(ctx.premium.status()).toBe('refunded');
    expect(ctx.state.cash).toBe(0);
    expect(ctx.purchases.refund(cash.transactionId)).toBe(false);
  });

  it('test-mode purchases are simulated, labelled test and kept separate', async () => {
    const storage = new MemoryStorage();
    const t = { now: Date.UTC(2026, 9, 26, 12) };
    const { ctx } = createGameContext({
      storage,
      now: () => t.now,
      adAdapter: new FakeAdAdapter(),
      purchaseAdapter: new WebStoreAdapter(),
      testPurchaseAdapter: new TestPurchaseAdapter(() => t.now),
    });
    // test mode OFF: nothing can be bought
    expect((await ctx.purchases.buy('cash_small')).reason).toBe('unavailable');
    ctx.settings.update({ testMode: true });
    const r = await ctx.purchases.buy('cash_small');
    expect(r.ok).toBe(true);
    expect(r.test).toBe(true);
    expect(ctx.state.purchases.history[0].source).toBe('test');
    expect(ctx.state.ledger.some((x) => x.type === 'testPurchase')).toBe(true);
    expect(ctx.state.ledger.some((x) => x.type === 'purchase')).toBe(false);
    const prods = await ctx.purchases.products();
    expect(prods[0].priceLabel).toBe('TEST');
    // a test subscription is flagged
    await ctx.purchases.buy('premium_monthly');
    expect(ctx.premium.isTestSubscription()).toBe(true);
  });

  it('products carry no hard-coded prices', async () => {
    const { PRODUCTS } = await import('../src/data/shop');
    for (const p of PRODUCTS) expect(Object.keys(p)).not.toContain('price');
  });
});

describe('premium', () => {
  it('grants rights while active and removes them when the period ends', async () => {
    const { ctx, time } = makeEnv();
    expect(ctx.premium.isPremium()).toBe(false);
    await ctx.purchases.buy('premium_monthly');
    expect(ctx.premium.isPremium()).toBe(true);
    expect(ctx.premium.adsFree()).toBe(true);
    expect(ctx.premium.garageDiscount()).toBeGreaterThan(0);
    expect(ctx.premium.canShowInterstitial()).toBe(false);
    time.now += 31 * DAY;
    ctx.premium.refresh();
    expect(ctx.premium.status()).toBe('expired');
    expect(ctx.premium.isPremium()).toBe(false);
    expect(ctx.premium.garageDiscount()).toBe(0);
    expect(ctx.premium.adsFree()).toBe(false);
  });

  it('a cancelled subscription keeps rights only until expiry and is not shown as active', async () => {
    const { ctx, time } = makeEnv();
    await ctx.purchases.buy('premium_monthly');
    ctx.purchases.handleUpdate({ kind: 'cancelled', productId: 'premium_monthly', transactionId: 'x' });
    expect(ctx.premium.status()).toBe('cancelled');
    expect(ctx.premium.isPremium()).toBe(true);
    time.now += 40 * DAY;
    expect(ctx.premium.isPremium()).toBe(false);
  });

  it('premium cosmetics fall back to defaults once Premium ends', async () => {
    const { ctx, time } = makeEnv();
    await ctx.purchases.buy('premium_monthly');
    const bus = ctx.state.buses[0];
    expect(ctx.garage.applyCosmetic(bus.uid, 'paint_midnight', time.now).ok).toBe(true);
    expect(ctx.garage.effectiveCosmetic(bus, 'paint', time.now)).toBe('paint_midnight');
    time.now += 40 * DAY;
    expect(ctx.garage.effectiveCosmetic(bus, 'paint', time.now)).toBe('paint_white');
    expect(ctx.garage.applyCosmetic(bus.uid, 'paint_royal', time.now).ok).toBe(false);
  });

  it('premium does not raise physical seat capacity', async () => {
    const { ctx } = makeEnv();
    const before = ctx.garage.effectiveStats(ctx.state.buses[0]).seats;
    await ctx.purchases.buy('premium_yearly');
    expect(ctx.garage.effectiveStats(ctx.state.buses[0]).seats).toBe(before);
  });

  it('premium gives a garage discount on upgrades', async () => {
    const { ctx } = makeEnv();
    const b = ctx.state.buses[0];
    const normal = ctx.garage.upgradeCost(b.uid, 'engine');
    await ctx.purchases.buy('premium_monthly');
    expect(ctx.garage.upgradeCost(b.uid, 'engine')).toBeLessThan(normal);
  });
});
