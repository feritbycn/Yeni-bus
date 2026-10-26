import type { PurchaseAdapter, PurchaseResult, StoreProductInfo } from '../PurchaseService';
import { PRODUCT_BY_ID } from '../../data/shop';
import { uid } from '../../core/utils';

/**
 * Default adapter for the web / GitHub Pages build. There is NO real payment flow in a browser build
 * of this project, so nothing can be bought and the store shows products as unavailable.
 */
export class WebStoreAdapter implements PurchaseAdapter {
  readonly id = 'web-no-billing';
  readonly isTest = false;

  isAvailable(): boolean {
    return false;
  }

  async getProducts(ids: string[]): Promise<StoreProductInfo[]> {
    return ids.map((id) => ({ id, priceLabel: '—', available: false }));
  }

  async purchase(productId: string): Promise<PurchaseResult> {
    return { status: 'unavailable', productId };
  }

  async restore(): Promise<PurchaseResult[]> {
    return [];
  }
}

/**
 * Simulated store, enabled only when the player turns on Test Mode in Settings.
 * Grants are recorded as `testPurchase`; subscriptions are flagged source = "test".
 * No money is involved and the UI shows a TEST badge everywhere it is used.
 */
export class TestPurchaseAdapter implements PurchaseAdapter {
  readonly id = 'test-purchase-adapter';
  readonly isTest = true;

  constructor(private readonly now: () => number = () => Date.now()) {}

  isAvailable(): boolean {
    return true;
  }

  async getProducts(ids: string[]): Promise<StoreProductInfo[]> {
    return ids.map((id) => ({ id, priceLabel: 'TEST', available: true }));
  }

  async purchase(productId: string): Promise<PurchaseResult> {
    await new Promise((r) => setTimeout(r, 300));
    const p = PRODUCT_BY_ID[productId];
    if (!p) return { status: 'failed', productId, error: 'unknown product' };
    return {
      status: 'success',
      productId,
      transactionId: uid('testtx'),
      verified: true,
      expiresAt: p.kind === 'subscription' ? this.now() + (p.periodDays ?? 30) * 86_400_000 : undefined,
    };
  }

  async restore(): Promise<PurchaseResult[]> {
    return [];
  }
}
