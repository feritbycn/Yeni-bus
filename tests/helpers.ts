import { createGameContext, type GameContext } from '../src/core/GameContext';
import { MemoryStorage } from '../src/systems/SaveManager';
import type { AdShowResult, RewardedAdAdapter } from '../src/services/RewardedAdService';
import type { PurchaseAdapter, PurchaseResult, StoreProductInfo } from '../src/services/PurchaseService';
import { PRODUCT_BY_ID } from '../src/data/shop';

export const T0 = Date.UTC(2026, 9, 26, 12, 0, 0);

export class FakeAdAdapter implements RewardedAdAdapter {
  readonly id = 'fake-ad';
  readonly isTest = true;
  loadOk = true;
  next: AdShowResult['status'] = 'completed';
  verified = true;
  counter = 0;
  fixedTx: string | null = null;
  isSupported(): boolean {
    return true;
  }
  async load(): Promise<boolean> {
    return this.loadOk;
  }
  async show(): Promise<AdShowResult> {
    if (this.next !== 'completed') return { status: this.next };
    this.counter += 1;
    return { status: 'completed', transactionId: this.fixedTx ?? `fake-${this.counter}`, verified: this.verified };
  }
}

export class FakeStoreAdapter implements PurchaseAdapter {
  readonly id = 'fake-store';
  isTest = false;
  available = true;
  nextStatus: PurchaseResult['status'] = 'success';
  verified = true;
  txCounter = 0;
  fixedTx: string | null = null;
  expiresInMs = 30 * 86_400_000;
  now: () => number = () => T0;
  restoreList: PurchaseResult[] = [];
  isAvailable(): boolean {
    return this.available;
  }
  async getProducts(ids: string[]): Promise<StoreProductInfo[]> {
    return ids.map((id) => ({ id, priceLabel: 'store price', available: this.available }));
  }
  async purchase(productId: string): Promise<PurchaseResult> {
    if (this.nextStatus !== 'success') return { status: this.nextStatus, productId };
    this.txCounter += 1;
    const p = PRODUCT_BY_ID[productId];
    return {
      status: 'success',
      productId,
      transactionId: this.fixedTx ?? `store-${this.txCounter}`,
      verified: this.verified,
      expiresAt: p?.kind === 'subscription' ? this.now() + this.expiresInMs : undefined,
    };
  }
  async restore(): Promise<PurchaseResult[]> {
    return this.restoreList;
  }
}

export interface TestEnv {
  ctx: GameContext;
  storage: MemoryStorage;
  time: { now: number };
  ad: FakeAdAdapter;
  store: FakeStoreAdapter;
}

export function makeEnv(setup?: (env: TestEnv) => void): TestEnv {
  const storage = new MemoryStorage();
  const time = { now: T0 };
  const ad = new FakeAdAdapter();
  const store = new FakeStoreAdapter();
  store.now = () => time.now;
  const { ctx } = createGameContext({ storage, now: () => time.now, adAdapter: ad, purchaseAdapter: store, testPurchaseAdapter: null });
  const env: TestEnv = { ctx, storage, time, ad, store };
  setup?.(env);
  return env;
}

export const DAY = 86_400_000;
