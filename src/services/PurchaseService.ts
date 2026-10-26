import type { GameEvents, GameState, PurchaseRecord } from '../core/types';
import type { EventBus } from '../core/EventBus';
import type { EconomyManager } from '../systems/EconomyManager';
import type { GarageManager } from '../systems/GarageManager';
import type { ClockService } from '../systems/ClockService';
import type { PremiumService } from './PremiumService';
import { PRODUCTS, PRODUCT_BY_ID, type ProductDef } from '../data/shop';
import { capArray } from '../core/utils';

export interface StoreProductInfo {
  id: string;
  /** Localized price text supplied by the platform store. NEVER hard-code prices. */
  priceLabel: string;
  available: boolean;
}

export type PurchaseStatus = 'success' | 'cancelled' | 'failed' | 'pending' | 'unavailable';

export interface PurchaseResult {
  status: PurchaseStatus;
  productId: string;
  transactionId?: string;
  /** true only after the store (and ideally your server) verified the receipt/token. */
  verified?: boolean;
  /** subscription expiry reported by the store (ms epoch) */
  expiresAt?: number;
  error?: string;
}

export type StoreUpdate =
  | { kind: 'refund'; productId: string; transactionId: string }
  | { kind: 'cancelled'; productId: string; transactionId: string }
  | { kind: 'renewed'; productId: string; transactionId: string; expiresAt: number }
  | { kind: 'completed'; result: PurchaseResult };

/** Platform billing integration. Real SDK code lives ONLY in adapters (see docs/IN_APP_PURCHASES.md). */
export interface PurchaseAdapter {
  readonly id: string;
  /** true = simulated purchases (no real money). Must be shown as TEST in the UI. */
  readonly isTest: boolean;
  isAvailable(): boolean;
  getProducts(ids: string[]): Promise<StoreProductInfo[]>;
  purchase(productId: string): Promise<PurchaseResult>;
  /** Returns currently owned non-consumables and active subscriptions. */
  restore(): Promise<PurchaseResult[]>;
  /** Optional push channel for refunds, renewals, cancellations and deferred completions. */
  subscribe?(cb: (u: StoreUpdate) => void): () => void;
}

export type BuyFailure = 'unavailable' | 'busy' | 'cancelled' | 'failed' | 'pending' | 'unverified' | 'unknownProduct' | 'duplicate' | 'testDisabled';

export interface BuyResult {
  ok: boolean;
  reason?: BuyFailure;
  test?: boolean;
  record?: PurchaseRecord;
}

export class PurchaseService {
  private busy = false;
  private unsub: (() => void) | null = null;

  constructor(
    private readonly state: GameState,
    private readonly bus: EventBus<GameEvents>,
    private readonly economy: EconomyManager,
    private readonly garage: GarageManager,
    private readonly premium: PremiumService,
    private readonly clock: ClockService,
    private realAdapter: PurchaseAdapter,
    private testAdapter: PurchaseAdapter | null = null,
  ) {
    this.attach();
  }

  setRealAdapter(a: PurchaseAdapter): void {
    this.realAdapter = a;
    this.attach();
  }

  /** Adapter currently used. The test adapter is only used when the player enabled Test Mode. */
  activeAdapter(): PurchaseAdapter {
    return this.state.settings.testMode && this.testAdapter ? this.testAdapter : this.realAdapter;
  }

  isTestMode(): boolean {
    return this.activeAdapter().isTest;
  }

  private attach(): void {
    this.unsub?.();
    this.unsub = this.realAdapter.subscribe ? this.realAdapter.subscribe((u) => this.handleUpdate(u)) : null;
  }

  async products(): Promise<(ProductDef & StoreProductInfo)[]> {
    const adapter = this.activeAdapter();
    let infos: StoreProductInfo[] = [];
    try {
      infos = await adapter.getProducts(PRODUCTS.map((p) => p.id));
    } catch {
      infos = [];
    }
    return PRODUCTS.map((p) => {
      const info = infos.find((i) => i.id === p.id);
      return { ...p, priceLabel: info?.priceLabel ?? '—', available: !!info?.available && adapter.isAvailable() };
    });
  }

  isOwnedPermanent(p: ProductDef): boolean {
    const e = this.state.purchases.entitlements;
    if (!p.unlock) return false;
    if (p.unlock.removeAds) return e.removeAds;
    if (p.unlock.garageExpansion) return e.garageExpansion;
    if (p.unlock.busId) return e.unlockedBusIds.includes(p.unlock.busId);
    if (p.unlock.cosmeticPack) return e.cosmeticPacks.includes(p.unlock.cosmeticPack);
    return false;
  }

  async buy(productId: string): Promise<BuyResult> {
    const product = PRODUCT_BY_ID[productId];
    if (!product) return { ok: false, reason: 'unknownProduct' };
    if (this.busy) return { ok: false, reason: 'busy' };
    const adapter = this.activeAdapter();
    if (!adapter.isAvailable()) return { ok: false, reason: 'unavailable' };
    if (product.kind === 'permanent' && this.isOwnedPermanent(product)) return { ok: false, reason: 'duplicate' };
    this.busy = true;
    this.state.purchases.pending.push({ productId, startedAt: this.clock.now() });
    this.bus.emit('stateChanged', undefined);
    try {
      let res: PurchaseResult;
      try {
        res = await adapter.purchase(productId);
      } catch (e) {
        res = { status: 'failed', productId, error: String(e) };
      }
      if (res.status === 'pending') {
        // keep the pending entry; completion arrives later via subscribe()/recheckPending()
        const p = this.state.purchases.pending.find((x) => x.productId === productId);
        if (p && res.transactionId) p.transactionId = res.transactionId;
        return { ok: false, reason: 'pending', test: adapter.isTest };
      }
      this.clearPending(productId);
      if (res.status === 'cancelled') return { ok: false, reason: 'cancelled', test: adapter.isTest };
      if (res.status === 'unavailable') return { ok: false, reason: 'unavailable', test: adapter.isTest };
      if (res.status !== 'success') return { ok: false, reason: 'failed', test: adapter.isTest };
      if (!res.verified || !res.transactionId) return { ok: false, reason: 'unverified', test: adapter.isTest };
      const applied = this.apply(res, adapter.isTest);
      if (!applied) return { ok: false, reason: 'duplicate', test: adapter.isTest };
      return { ok: true, test: adapter.isTest, record: applied };
    } finally {
      this.busy = false;
      this.bus.emit('stateChanged', undefined);
    }
  }

  private clearPending(productId: string): void {
    const i = this.state.purchases.pending.findIndex((p) => p.productId === productId);
    if (i >= 0) this.state.purchases.pending.splice(i, 1);
  }

  /** Grants a VERIFIED purchase exactly once (idempotent on transaction id). */
  apply(res: PurchaseResult, isTest: boolean): PurchaseRecord | null {
    const p = PRODUCT_BY_ID[res.productId];
    if (!p || !res.transactionId || !res.verified) return null;
    const key = `iap:${res.transactionId}`;
    if (this.state.purchases.processed.includes(res.transactionId)) return null;
    let record: PurchaseRecord | null = null;
    const done = this.economy.grantOnce(key, () => {
      const granted: PurchaseRecord['granted'] = {};
      const ledgerType = isTest ? 'testPurchase' : 'purchase';
      const ent = this.state.purchases.entitlements;
      if (p.kind === 'consumable' && p.grant) {
        if (p.grant.cash) {
          this.economy.add('cash', p.grant.cash, ledgerType, { ref: res.transactionId, description: p.id });
          granted.cash = p.grant.cash;
        }
        if (p.grant.gold) {
          this.economy.add('gold', p.grant.gold, ledgerType, { ref: res.transactionId, description: p.id });
          granted.gold = p.grant.gold;
        }
        if (p.grant.fuelFill) {
          const b = this.garage.selectedBus();
          if (b) {
            this.garage.fillFree(b.uid);
            granted.fuelUnits = 1;
          }
        }
      } else if (p.kind === 'permanent' && p.unlock) {
        if (p.unlock.removeAds) ent.removeAds = true;
        if (p.unlock.garageExpansion) ent.garageExpansion = true;
        if (p.unlock.busId && !ent.unlockedBusIds.includes(p.unlock.busId)) ent.unlockedBusIds.push(p.unlock.busId);
        if (p.unlock.cosmeticPack && !ent.cosmeticPacks.includes(p.unlock.cosmeticPack)) ent.cosmeticPacks.push(p.unlock.cosmeticPack);
      } else if (p.kind === 'subscription') {
        const expires = res.expiresAt ?? this.clock.now() + (p.periodDays ?? 30) * 86_400_000;
        this.premium.activateSubscription(p.id, res.transactionId!, expires, isTest ? 'test' : 'store');
      }
      record = {
        transactionId: res.transactionId!,
        productId: p.id,
        time: this.clock.now(),
        source: isTest ? 'test' : 'store',
        status: 'completed',
        granted,
      };
      this.state.purchases.history.push(record);
      capArray(this.state.purchases.history, 100);
      this.state.purchases.processed.push(res.transactionId!);
      capArray(this.state.purchases.processed, 400);
      this.state.stats.purchasesCount += 1;
    });
    if (!done || !record) return null;
    this.bus.emit('purchaseCompleted', { productId: p.id });
    return record;
  }

  /** Restores permanent items and subscriptions (consumables are never restored). */
  async restore(): Promise<{ ok: boolean; restored: number; reason?: BuyFailure }> {
    const adapter = this.activeAdapter();
    if (!adapter.isAvailable()) return { ok: false, restored: 0, reason: 'unavailable' };
    let results: PurchaseResult[] = [];
    try {
      results = await adapter.restore();
    } catch {
      return { ok: false, restored: 0, reason: 'failed' };
    }
    let restored = 0;
    for (const r of results) {
      const p = PRODUCT_BY_ID[r.productId];
      if (!p || p.kind === 'consumable') continue;
      if (this.apply(r, adapter.isTest)) restored += 1;
    }
    this.bus.emit('stateChanged', undefined);
    return { ok: true, restored };
  }

  /** Resolves purchases that were still pending when the app was closed. */
  async recheckPending(): Promise<void> {
    if (this.state.purchases.pending.length === 0) return;
    const adapter = this.activeAdapter();
    if (!adapter.isAvailable()) return;
    await this.restore();
    const now = this.clock.now();
    // pending entries older than 3 days that were never completed are dropped (nothing was granted)
    this.state.purchases.pending = this.state.purchases.pending.filter((p) => now - p.startedAt < 3 * 86_400_000);
  }

  handleUpdate(u: StoreUpdate): void {
    switch (u.kind) {
      case 'completed':
        if (u.result.status === 'success' && u.result.verified) {
          this.clearPending(u.result.productId);
          this.apply(u.result, false);
        }
        break;
      case 'refund':
        this.refund(u.transactionId);
        break;
      case 'cancelled':
        if (PRODUCT_BY_ID[u.productId]?.kind === 'subscription') this.premium.markCancelled();
        break;
      case 'renewed':
        if (PRODUCT_BY_ID[u.productId]?.kind === 'subscription') {
          this.premium.activateSubscription(u.productId, u.transactionId, u.expiresAt, 'store');
        }
        break;
    }
    this.bus.emit('stateChanged', undefined);
  }

  /**
   * Refund policy: permanent unlocks and subscriptions are revoked immediately; consumable currency
   * is deducted as far as the balance allows (never below zero).
   */
  refund(transactionId: string): boolean {
    const rec = this.state.purchases.history.find((r) => r.transactionId === transactionId);
    if (!rec || rec.status === 'refunded') return false;
    const p = PRODUCT_BY_ID[rec.productId];
    rec.status = 'refunded';
    if (!p) return true;
    const ent = this.state.purchases.entitlements;
    if (p.kind === 'permanent' && p.unlock) {
      if (p.unlock.removeAds) ent.removeAds = false;
      if (p.unlock.garageExpansion) ent.garageExpansion = false;
      if (p.unlock.busId) ent.unlockedBusIds = ent.unlockedBusIds.filter((x) => x !== p.unlock!.busId);
      if (p.unlock.cosmeticPack) ent.cosmeticPacks = ent.cosmeticPacks.filter((x) => x !== p.unlock!.cosmeticPack);
    } else if (p.kind === 'subscription') {
      this.premium.revokeSubscription(transactionId);
    } else if (p.kind === 'consumable') {
      const cash = Math.min(rec.granted.cash ?? 0, this.state.cash);
      const gold = Math.min(rec.granted.gold ?? 0, this.state.gold);
      if (cash > 0) this.economy.spend('cash', cash, 'refund', { ref: transactionId, description: `refund ${p.id}` });
      if (gold > 0) this.economy.spend('gold', gold, 'refund', { ref: transactionId, description: `refund ${p.id}` });
    }
    this.bus.emit('stateChanged', undefined);
    return true;
  }
}
