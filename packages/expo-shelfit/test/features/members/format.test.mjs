import { describe, expect, it } from 'vitest';
import {
  membersConcurrencyHeader,
  toMembersDisplayRows,
} from '../../../src/features/members/format.mjs';

const orgMemberEntry = {
  account: 'myorg',
  isPersonal: false,
  member: 'alice',
  role: 'OWNER',
  plan: 'Production',
  planId: 'production',
  status: 'active',
  concurrencyTotal: 2,
  concurrencyIos: 1,
  concurrencyAndroid: 1,
  trialEnd: null,
};

const orgMemberEntryTrialing = {
  ...orgMemberEntry,
  status: 'trialing',
  trialEnd: '2026-08-15T00:00:00.000Z',
};

const personalEntry = {
  account: 'alice',
  isPersonal: true,
  member: 'alice',
  role: 'OWNER',
  plan: 'Free',
  planId: 'free',
  status: null,
  concurrencyTotal: null,
  concurrencyIos: null,
  concurrencyAndroid: null,
  trialEnd: null,
};

const degradedEntry = {
  account: 'other',
  isPersonal: null,
  member: null,
  role: null,
  plan: null,
  planId: null,
  status: null,
  concurrencyTotal: null,
  concurrencyIos: null,
  concurrencyAndroid: null,
  trialEnd: null,
};

describe('toMembersDisplayRows', () => {
  it('maps an organization member to display strings, combining all three concurrency numbers', () => {
    expect(toMembersDisplayRows([orgMemberEntry])).toEqual([
      ['myorg', 'alice', 'OWNER', 'Production', 'production', 'active', '2 / 1 / 1', '-'],
    ]);
  });

  it('shows the trial end date as YYYY-MM-DD when set', () => {
    const row = toMembersDisplayRows([orgMemberEntryTrialing])[0];
    expect(row[7]).toBe('2026-08-15');
  });

  it('shows "-" in ORG for a personal account, even though the account is known', () => {
    const row = toMembersDisplayRows([personalEntry])[0];
    expect(row[0]).toBe('-');
    expect(row[1]).toBe('alice');
    expect(row[2]).toBe('OWNER');
  });

  it('shows the account name (not "-") in ORG for a degraded row, so the failed account is still identifiable', () => {
    const row = toMembersDisplayRows([degradedEntry])[0];
    expect(row[0]).toBe('other');
  });

  it('shows "-" for every unavailable field on a degraded row', () => {
    expect(toMembersDisplayRows([degradedEntry])).toEqual([
      ['other', '-', '-', '-', '-', '-', '-', '-'],
    ]);
  });

  it("reports only that platform's concurrency when --platform is set", () => {
    const iosRow = toMembersDisplayRows([orgMemberEntry], { platform: 'ios' })[0];
    expect(iosRow[6]).toBe('1');

    const androidRow = toMembersDisplayRows([orgMemberEntry], { platform: 'android' })[0];
    expect(androidRow[6]).toBe('1');
  });

  it('renders a zero concurrency as "0", not "-"', () => {
    const row = toMembersDisplayRows([
      { ...orgMemberEntry, concurrencyTotal: 0, concurrencyIos: 0, concurrencyAndroid: 0 },
    ])[0];
    expect(row[6]).toBe('0 / 0 / 0');
  });

  it('shows the account display name instead of the slug in ORG when mapped (table-only)', () => {
    const accountDisplayNames = new Map([['myorg', 'My Organization']]);
    const row = toMembersDisplayRows([orgMemberEntry], { accountDisplayNames })[0];
    expect(row[0]).toBe('My Organization');
  });

  it('falls back to the slug in ORG when no accountDisplayNames map is given', () => {
    const row = toMembersDisplayRows([orgMemberEntry])[0];
    expect(row[0]).toBe('myorg');
  });

  it('never applies accountDisplayNames to a personal row, since ORG is always "-" there', () => {
    const accountDisplayNames = new Map([['alice', 'Somebody Else']]);
    const row = toMembersDisplayRows([personalEntry], { accountDisplayNames })[0];
    expect(row[0]).toBe('-');
  });

  it('shows "-" for MEMBER/ROLE when an org has no members (empty-group placeholder row)', () => {
    const row = toMembersDisplayRows([{ ...orgMemberEntry, member: null, role: null }])[0];
    expect(row[1]).toBe('-');
    expect(row[2]).toBe('-');
  });
});

describe('membersConcurrencyHeader', () => {
  it('labels the column per platform filter', () => {
    expect(membersConcurrencyHeader(null)).toBe('CONCURRENCY (TOTAL/IOS/AND)');
    expect(membersConcurrencyHeader('ios')).toBe('CONCURRENCY (IOS)');
    expect(membersConcurrencyHeader('android')).toBe('CONCURRENCY (ANDROID)');
  });
});
