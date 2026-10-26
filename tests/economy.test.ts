import { describe, expect, it } from 'vitest';
import { makeEnv } from './helpers';

describe('EconomyManager', () => {
  it('records before/after balances for every transaction', () => {
    const { ctx } = makeEnv();
    const start = ctx.state.cash;
    ctx.economy.add('cash', 500, 'devGrant', { description: 'test' });
    ctx.economy.spend('cash', 200, 'fuel', { ref: 'x' });
    const [a, b] = ctx.state.ledger.slice(-2);
    expect(a.before).toBe(start);
    expect(a.after).toBe(start + 500);
    expect(b.before).toBe(start + 500);
    expect(b.after).toBe(start + 300);
    expect(b.amount).toBe(-200);
    expect(b.type).toBe('fuel');
    expect(typeof b.time).toBe('number');
  });

  it('never lets a balance go negative', () => {
    const { ctx } = makeEnv();
    ctx.state.cash = 100;
    expect(ctx.economy.spend('cash', 101, 'fuel')).toBe(false);
    expect(ctx.state.cash).toBe(100);
    const r = ctx.economy.spendUpTo(250, 'salary');
    expect(r.paid).toBe(100);
    expect(r.unpaid).toBe(150);
    expect(ctx.state.cash).toBe(0);
  });

  it('rejects invalid amounts', () => {
    const { ctx } = makeEnv();
    const c = ctx.state.cash;
    expect(ctx.economy.add('cash', -5, 'devGrant')).toBeNull();
    expect(ctx.economy.add('cash', NaN, 'devGrant')).toBeNull();
    expect(ctx.economy.spend('cash', -5, 'fuel')).toBe(false);
    expect(ctx.state.cash).toBe(c);
  });

  it('grantOnce applies a reward only once, even when called concurrently', () => {
    const { ctx } = makeEnv();
    let n = 0;
    const apply = () => {
      n += 1;
      ctx.economy.add('cash', 1000, 'devGrant');
    };
    const c = ctx.state.cash;
    expect(ctx.economy.grantOnce('k1', apply)).toBe(true);
    expect(ctx.economy.grantOnce('k1', apply)).toBe(false);
    expect(ctx.economy.grantOnce('k1', apply)).toBe(false);
    expect(n).toBe(1);
    expect(ctx.state.cash).toBe(c + 1000);
  });

  it('keeps the ledger bounded', () => {
    const { ctx } = makeEnv();
    for (let i = 0; i < 400; i++) ctx.economy.add('cash', 1, 'devGrant');
    expect(ctx.state.ledger.length).toBeLessThanOrEqual(300);
  });
});
