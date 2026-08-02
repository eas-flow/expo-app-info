import { describe, expect, it } from 'vitest';
import { CliError, parseArgs } from '../src/cli.mjs';

const DEFAULTS = {
  help: false,
  version: false,
  json: false,
  csv: false,
  account: null,
  platform: null,
  usage: false,
  history: null,
};

describe('parseArgs', () => {
  it('parses --usage', () => {
    expect(parseArgs(['--usage'])).toEqual({ ...DEFAULTS, usage: true });
  });

  it('parses --usage combined with --json and --account', () => {
    expect(parseArgs(['--usage', '--json', '--account', 'myorg'])).toEqual({
      ...DEFAULTS,
      usage: true,
      json: true,
      account: 'myorg',
    });
  });

  it('parses -h', () => {
    expect(parseArgs(['-h'])).toEqual({ ...DEFAULTS, help: true });
  });

  it('parses --help', () => {
    expect(parseArgs(['--help'])).toEqual({ ...DEFAULTS, help: true });
  });

  it('parses -v', () => {
    expect(parseArgs(['-v'])).toEqual({ ...DEFAULTS, version: true });
  });

  it('parses --version', () => {
    expect(parseArgs(['--version'])).toEqual({ ...DEFAULTS, version: true });
  });

  it('returns all defaults when no args are given', () => {
    expect(parseArgs([])).toEqual(DEFAULTS);
  });

  it('handles a combination of flags (last one wins is not relevant, both get set)', () => {
    expect(parseArgs(['--help', '--version'])).toEqual({ ...DEFAULTS, help: true, version: true });
  });

  it('throws CliError on an unknown option', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(CliError);
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown option: --bogus/);
  });

  it('parses --json', () => {
    expect(parseArgs(['--json'])).toEqual({ ...DEFAULTS, json: true });
  });

  it('parses --csv', () => {
    expect(parseArgs(['--csv'])).toEqual({ ...DEFAULTS, csv: true });
  });

  it('throws when --json and --csv are combined', () => {
    expect(() => parseArgs(['--json', '--csv'])).toThrow(/cannot be used together/);
  });

  it('parses --account with a space-separated value', () => {
    expect(parseArgs(['--account', 'myorg'])).toEqual({ ...DEFAULTS, account: 'myorg' });
  });

  it('parses --account=value', () => {
    expect(parseArgs(['--account=myorg'])).toEqual({ ...DEFAULTS, account: 'myorg' });
  });

  it('throws when --account has no value', () => {
    expect(() => parseArgs(['--account'])).toThrow(/--account requires a value/);
  });

  it('parses --platform and lowercases it', () => {
    expect(parseArgs(['--platform', 'IOS'])).toEqual({ ...DEFAULTS, platform: 'ios' });
  });

  it('parses --platform=value', () => {
    expect(parseArgs(['--platform=android'])).toEqual({ ...DEFAULTS, platform: 'android' });
  });

  it('throws on an invalid --platform value', () => {
    expect(() => parseArgs(['--platform', 'windows'])).toThrow(/Invalid --platform value/);
  });

  it('throws when --platform has no value', () => {
    expect(() => parseArgs(['--platform'])).toThrow(/--platform requires a value/);
  });

  it('parses --history with a space-separated value as a number', () => {
    expect(parseArgs(['--history', '5'])).toEqual({ ...DEFAULTS, history: 5 });
  });

  it('parses --history=value', () => {
    expect(parseArgs(['--history=10'])).toEqual({ ...DEFAULTS, history: 10 });
  });

  it('parses --history 1 (the same as the default behavior, but explicit)', () => {
    expect(parseArgs(['--history', '1'])).toEqual({ ...DEFAULTS, history: 1 });
  });

  it('throws when --history has no value', () => {
    expect(() => parseArgs(['--history'])).toThrow(/--history requires a value/);
  });

  it('throws on a non-numeric --history value', () => {
    expect(() => parseArgs(['--history', 'abc'])).toThrow(/Invalid --history value/);
  });

  it('throws on a zero or negative --history value', () => {
    expect(() => parseArgs(['--history', '0'])).toThrow(/Invalid --history value/);
    expect(() => parseArgs(['--history', '-1'])).toThrow(/Invalid --history value/);
  });

  it('throws on a non-integer --history value', () => {
    expect(() => parseArgs(['--history', '2.5'])).toThrow(/Invalid --history value/);
  });

  it('throws when --history exceeds the max of 100', () => {
    expect(() => parseArgs(['--history', '101'])).toThrow(/Invalid --history value/);
  });

  it('accepts --history at the max of 100', () => {
    expect(parseArgs(['--history', '100'])).toEqual({ ...DEFAULTS, history: 100 });
  });

  it('throws when --history is combined with --usage', () => {
    expect(() => parseArgs(['--usage', '--history', '5'])).toThrow(
      /--history cannot be combined with --usage/
    );
  });

  it('combines --history with --account and --platform', () => {
    expect(parseArgs(['--history', '3', '--account', 'myorg', '--platform', 'ios'])).toEqual({
      ...DEFAULTS,
      history: 3,
      account: 'myorg',
      platform: 'ios',
    });
  });
});
