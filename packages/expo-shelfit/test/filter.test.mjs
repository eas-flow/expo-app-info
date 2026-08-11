import { describe, expect, it } from 'vitest';
import { CliError } from '../src/cli.mjs';
import { createAppFilter, resolveAccount } from '../src/filter.mjs';

describe('resolveAccount', () => {
  const accounts = [
    { id: 'acc-1', name: 'myorg', displayName: 'My Organization' },
    { id: 'acc-2', name: 'otherorg', displayName: null },
    { id: 'acc-3', name: 'dup-a', displayName: 'Shared Name' },
    { id: 'acc-4', name: 'dup-b', displayName: 'Shared Name' },
  ];

  it('matches by unique slug', () => {
    expect(resolveAccount(accounts, 'myorg')).toEqual(accounts[0]);
  });

  it('matches by slug case-insensitively', () => {
    expect(resolveAccount(accounts, 'MyOrg')).toEqual(accounts[0]);
  });

  it('matches by EAS Display name when slug does not match', () => {
    expect(resolveAccount(accounts, 'My Organization')).toEqual(accounts[0]);
  });

  it('matches by Display name case-insensitively', () => {
    expect(resolveAccount(accounts, 'my organization')).toEqual(accounts[0]);
  });

  it('slug wins over Display name when both could match', () => {
    // 'otherorg' only matches by slug (no displayName set) — sanity check
    // that the slug-first lookup doesn't require a displayName to exist.
    expect(resolveAccount(accounts, 'otherorg')).toEqual(accounts[1]);
  });

  it('throws with candidates when a Display name matches more than one account', () => {
    expect(() => resolveAccount(accounts, 'Shared Name')).toThrow(CliError);
    expect(() => resolveAccount(accounts, 'Shared Name')).toThrow(/dup-a, dup-b/);
  });

  it('throws with "Did you mean" suggestions on no match (prefix)', () => {
    expect(() => resolveAccount(accounts, 'myo')).toThrow(/Did you mean: myorg/);
  });

  it('throws with "Did you mean" suggestions on no match (substring)', () => {
    expect(() => resolveAccount(accounts, 'org')).toThrow(/Did you mean:.*myorg/);
  });

  it('throws with no suggestion line when nothing is even a partial match', () => {
    let error;
    try {
      resolveAccount(accounts, 'zzz-nope');
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(CliError);
    expect(error.message).not.toContain('Did you mean');
    expect(error.message).toContain('No account matched "zzz-nope"');
  });
});

describe('createAppFilter', () => {
  const appsA = [
    { id: 'app-1', name: 'Storefront', slug: 'storefront' },
    { id: 'app-2', name: 'Field Ops', slug: 'field-ops' },
  ];
  const appsB = [{ id: 'app-3', name: 'Prototype', slug: 'prototype' }];

  it('is a no-op filter when slug is null', () => {
    const filter = createAppFilter(null);
    expect(filter.filter(appsA)).toEqual(appsA);
    expect(filter.filter(appsB)).toEqual(appsB);
    expect(() => filter.finalize()).not.toThrow();
  });

  it('narrows one account to just the matching app, case-insensitively', () => {
    const filter = createAppFilter('STOREFRONT');
    expect(filter.filter(appsA)).toEqual([appsA[0]]);
    expect(() => filter.finalize()).not.toThrow();
  });

  it('returns an empty array for accounts without the matching app', () => {
    const filter = createAppFilter('storefront');
    expect(filter.filter(appsB)).toEqual([]);
  });

  it('finalize() throws with suggestions when nothing matched across every account seen', () => {
    // 'store' is a prefix of 'storefront' but not an exact match — exercises
    // the "Did you mean" path (prefix/substring, not Levenshtein — #84).
    const filter = createAppFilter('store');
    filter.filter(appsA);
    filter.filter(appsB);
    expect(() => filter.finalize()).toThrow(CliError);
    expect(() => filter.finalize()).toThrow(/Did you mean: storefront/);
  });

  it('finalize() does not throw once any account has matched', () => {
    const filter = createAppFilter('prototype');
    filter.filter(appsA);
    filter.filter(appsB);
    expect(() => filter.finalize()).not.toThrow();
  });
});
