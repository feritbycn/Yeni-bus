import type { Currency, GameEvents, GameState, Transaction, TransactionType } from '../core/types';
import type { EventBus } from '../core/EventBus';
import type { ClockService } from './ClockService';
import { MAX_LEDGER, MAX_PROCESSED_IDS } from '../data/constants';
import { capArray, dayKey, uid } from '../core/utils';

const OPERATING_EXPENSES: TransactionType[] = ['fuel', 'maintenance', 'repair', 'salary', 'toll', 'fine', 'terminalFee', 'towing'];

export interface SpendOptions {
  ref?: string;
  description?: string;
}

/**
 * Single owner of cash and gold. Every change creates a ledger entry (type, amount, before, after,
 * time, ref, description). Balances can never become negative, and grantOnce()/idempotency keys
 * prevent double payment when a reward or purchase callback fires more than once.
 */
export class EconomyManager {
  constructor(
    private readonly state: GameState,
    private readonly bus: EventBus<GameEvents>,
    private readonly clock: ClockService,
  ) {}

  balance(currency: Currency): number {
    return currency === 'cash' ? this.state.cash : this.state.gold;
  }

  canAfford(currency: Currency, amount: number): boolean {
    return Number.isFinite(amount) && amount >= 0 && this.balance(currency) >= amount;
  }

  private setBalance(currency: Currency, value: number): void {
    if (currency === 'cash') this.state.cash = value;
    else this.state.gold = value;
  }

  private record(type: TransactionType, currency: Currency, amount: number, before: number, after: number, opts: SpendOptions): Transaction {
    const tx: Transaction = {
      id: uid('tx'),
      type,
      currency,
      amount,
      before,
      after,
      time: this.clock.now(),
      ref: opts.ref,
      description: opts.description ?? type,
    };
    this.state.ledger.push(tx);
    capArray(this.state.ledger, MAX_LEDGER);
    return tx;
  }

  /** Adds money. Amount must be a finite number >= 0. */
  add(currency: Currency, amount: number, type: TransactionType, opts: SpendOptions = {}): Transaction | null {
    if (!Number.isFinite(amount) || amount < 0) return null;
    const amt = Math.round(amount * 100) / 100;
    const before = this.balance(currency);
    const after = before + amt;
    this.setBalance(currency, after);
    const tx = this.record(type, currency, amt, before, after, opts);
    if (currency === 'cash' && type === 'tripRevenue') this.report(amt, 0);
    if (currency === 'cash' && amt > 0) this.bus.emit('moneyEarned', { amount: amt });
    this.bus.emit('stateChanged', undefined);
    return tx;
  }

  /** Spends money. Fails (returns false, nothing changes) when funds are insufficient. */
  spend(currency: Currency, amount: number, type: TransactionType, opts: SpendOptions = {}): boolean {
    if (!Number.isFinite(amount) || amount < 0) return false;
    const amt = Math.round(amount * 100) / 100;
    const before = this.balance(currency);
    if (before < amt) return false;
    const after = before - amt;
    this.setBalance(currency, after);
    this.record(type, currency, -amt, before, after, opts);
    if (currency === 'cash' && OPERATING_EXPENSES.includes(type)) this.report(0, amt);
    this.bus.emit('stateChanged', undefined);
    return true;
  }

  /**
   * Operating costs that may exceed the current balance (e.g. a salary while broke).
   * Charges what is available and returns the unpaid remainder; balance never goes below zero.
   */
  spendUpTo(amount: number, type: TransactionType, opts: SpendOptions = {}): { paid: number; unpaid: number } {
    const want = Math.max(0, amount);
    const paid = Math.min(want, this.state.cash);
    if (paid > 0) this.spend('cash', paid, type, opts);
    return { paid, unpaid: want - paid };
  }

  /** True if this idempotency key has already been applied. */
  hasProcessed(key: string): boolean {
    return this.state.processedIds.includes(key);
  }

  markProcessed(key: string): void {
    if (this.state.processedIds.includes(key)) return;
    this.state.processedIds.push(key);
    capArray(this.state.processedIds, MAX_PROCESSED_IDS);
  }

  /**
   * Runs `apply` exactly once per key. Used for mission rewards, ad rewards, purchases, daily
   * rewards. Returns false (and does nothing) if the key was seen before.
   */
  grantOnce(key: string, apply: () => void): boolean {
    if (this.hasProcessed(key)) return false;
    this.markProcessed(key);
    apply();
    this.bus.emit('stateChanged', undefined);
    return true;
  }

  private report(revenue: number, expenses: number): void {
    const k = dayKey(this.clock.now());
    const r = (this.state.company.reports[k] ??= { revenue: 0, expenses: 0 });
    r.revenue += revenue;
    r.expenses += expenses;
    this.state.stats.totalRevenue += revenue;
    this.state.stats.totalExpenses += expenses;
    const keys = Object.keys(this.state.company.reports).sort();
    while (keys.length > 21) delete this.state.company.reports[keys.shift()!];
  }

  /** Revenue/expense totals for the last N days (inclusive of today). */
  reportRange(days: number): { revenue: number; expenses: number } {
    const out = { revenue: 0, expenses: 0 };
    const now = this.clock.now();
    for (let i = 0; i < days; i++) {
      const r = this.state.company.reports[dayKey(now - i * 86_400_000)];
      if (r) {
        out.revenue += r.revenue;
        out.expenses += r.expenses;
      }
    }
    return out;
  }
}
