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

  it('throws with a "Did you mean" suggestion for a 1-character typo', () => {
    expect(() => resolveAccount(accounts, 'myo')).toThrow(/Did you mean: myorg/);
  });

  it('throws with a "Did you mean" suggestion for transposed characters', () => {
    // Levenshtein (not prefix/substring) is what catches this: 'myogr' isn't
    // a prefix or substring of 'myorg', but it's one transposition away.
    expect(() => resolveAccount(accounts, 'myogr')).toThrow(/Did you mean: myorg/);
  });

  it('throws with a "Did you mean" suggestion for a Display name typo', () => {
    expect(() => resolveAccount(accounts, 'My Organizaton')).toThrow(
      /Did you mean: My Organization/
    );
  });

  it('ranks suggestions by edit distance and includes ties', () => {
    // 'dup-c' is one substitution away from both 'dup-a' and 'dup-b' — both
    // should surface, not just the first one found.
    expect(() => resolveAccount(accounts, 'dup-c')).toThrow(/Did you mean: dup-a, dup-b/);
  });

  it('throws with no suggestion line when nothing is even a near match', () => {
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

  it('finalize() throws with a suggestion when nothing matched across every account seen', () => {
    // 'storfront' (missing 'e') is one edit away from 'storefront' — the
    // issue #84's own example of a typo the suggestions should catch.
    const filter = createAppFilter('storfront');
    filter.filter(appsA);
    filter.filter(appsB);
    expect(() => filter.finalize()).toThrow(CliError);
    expect(() => filter.finalize()).toThrow(/Did you mean: storefront/);
  });

  it('finalize() throws with no suggestion when nothing is even a near match', () => {
    const filter = createAppFilter('nope-at-all');
    filter.filter(appsA);
    filter.filter(appsB);
    let error;
    try {
      filter.finalize();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(CliError);
    expect(error.message).not.toContain('Did you mean');
  });

  it('finalize() does not throw once any account has matched', () => {
    const filter = createAppFilter('prototype');
    filter.filter(appsA);
    filter.filter(appsB);
    expect(() => filter.finalize()).not.toThrow();
  });
});
