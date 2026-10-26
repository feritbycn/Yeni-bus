import type { AdShowResult, RewardedAdAdapter } from '../RewardedAdService';
import { uid } from '../../core/utils';

export interface TestAdPresenter {
  /** Shows a clearly labelled TEST ad overlay. Resolves 'completed' only when the countdown finished. */
  present(): Promise<'completed' | 'dismissed'>;
}

/**
 * Web / development adapter. It does NOT show a real ad and earns no revenue; the overlay it opens
 * says "TEST AD". Replace with AdMobRewardedAdapter in the Android build (docs/ADS_INTEGRATION.md).
 */
export class TestAdAdapter implements RewardedAdAdapter {
  readonly id = 'test-ad-adapter';
  readonly isTest = true;

  constructor(
    private readonly presenter: TestAdPresenter,
    private readonly failureFlag: () => boolean = () => false,
  ) {}

  isSupported(): boolean {
    return true;
  }

  async load(): Promise<boolean> {
    await new Promise((r) => setTimeout(r, 250));
    return !this.failureFlag();
  }

  async show(): Promise<AdShowResult> {
    const result = await this.presenter.present();
    if (result !== 'completed') return { status: 'dismissed' };
    return { status: 'completed', transactionId: uid('testad'), verified: true };
  }
}
