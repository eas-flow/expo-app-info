import { describe, expect, it } from 'vitest';
import { planConcurrencyHeader, toPlanDisplayRows } from '../../../src/features/plan/format.mjs';

const planEntry = {
  account: 'myorg',
  plan: 'Production',
  planId: 'production',
  status: 'active',
  concurrencyTotal: 2,
  concurrencyIos: 1,
  concurrencyAndroid: 1,
  trialEnd: null,
};

const planEntryTrialing = {
  account: 'myorg',
  plan: 'Production',
  planId: 'production',
  status: 'trialing',
  concurrencyTotal: 2,
  concurrencyIos: 1,
  concurrencyAndroid: 1,
  trialEnd: '2026-08-15T00:00:00.000Z',
};

const planEntryNoPlan = {
  account: 'other',
  plan: null,
  planId: null,
  status: null,
  concurrencyTotal: null,
  concurrencyIos: null,
  concurrencyAndroid: null,
  trialEnd: null,
};

describe('toPlanDisplayRows', () => {
  it('maps an account with a plan to display strings, combining all three concurrency numbers', () => {
    expect(toPlanDisplayRows([planEntry])).toEqual([
      ['myorg', 'Production', 'production', 'active', '2 / 1 / 1', '-'],
    ]);
  });

  it('shows the trial end date as YYYY-MM-DD when set', () => {
    const row = toPlanDisplayRows([planEntryTrialing])[0];
    expect(row[5]).toBe('2026-08-15');
  });

  it('shows "-" for every unavailable plan field', () => {
    expect(toPlanDisplayRows([planEntryNoPlan])).toEqual([['other', '-', '-', '-', '-', '-']]);
  });

  it("reports only that platform's concurrency when --platform is set", () => {
    const iosRow = toPlanDisplayRows([planEntry], { platform: 'ios' })[0];
    expect(iosRow[4]).toBe('1');

    const androidRow = toPlanDisplayRows([planEntry], { platform: 'android' })[0];
    expect(androidRow[4]).toBe('1');
  });

  it('renders a zero concurrency as "0", not "-"', () => {
    const row = toPlanDisplayRows([
      { ...planEntry, concurrencyTotal: 0, concurrencyIos: 0, concurrencyAndroid: 0 },
    ])[0];
    expect(row[4]).toBe('0 / 0 / 0');
  });

  it('shows the account display name instead of the slug when mapped (table-only)', () => {
    const accountDisplayNames = new Map([['myorg', 'My Organization']]);
    const row = toPlanDisplayRows([planEntry], { accountDisplayNames })[0];
    expect(row[0]).toBe('My Organization');
  });

  it('falls back to the slug when no accountDisplayNames map is given', () => {
    const row = toPlanDisplayRows([planEntry])[0];
    expect(row[0]).toBe('myorg');
  });
});

describe('planConcurrencyHeader', () => {
  it('labels the column per platform filter', () => {
    expect(planConcurrencyHeader(null)).toBe('CONCURRENCY (TOTAL/IOS/AND)');
    expect(planConcurrencyHeader('ios')).toBe('CONCURRENCY (IOS)');
    expect(planConcurrencyHeader('android')).toBe('CONCURRENCY (ANDROID)');
  });
});
