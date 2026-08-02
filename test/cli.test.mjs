import { describe, expect, it } from 'vitest';
import { CliError, parseArgs } from '../src/cli.mjs';

const DEFAULTS = {
  help: false,
  version: false,
  json: false,
  csv: false,
  platform: null,
  usage: false,
  plan: false,
  history: null,
};

describe('parseArgs', () => {
  it('parses --usage', () => {
    expect(parseArgs(['--usage'])).toEqual({ ...DEFAULTS, usage: true });
  });

  it('parses --usage combined with --json', () => {
    expect(parseArgs(['--usage', '--json'])).toEqual({
      ...DEFAULTS,
      usage: true,
      json: true,
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

  it('combines --history with --platform', () => {
    expect(parseArgs(['--history', '3', '--platform', 'ios'])).toEqual({
      ...DEFAULTS,
      history: 3,
      platform: 'ios',
    });
  });

  it('throws CliError on --account, which was removed (issue #22 — Account.displayName in the table replaced the need for filtering by slug for now)', () => {
    expect(() => parseArgs(['--account', 'myorg'])).toThrow(/Unknown option: --account/);
  });

  it('parses --plan', () => {
    expect(parseArgs(['--plan'])).toEqual({ ...DEFAULTS, plan: true });
  });

  it('parses --plan combined with --json', () => {
    expect(parseArgs(['--plan', '--json'])).toEqual({ ...DEFAULTS, plan: true, json: true });
  });

  it('parses --plan combined with --csv', () => {
    expect(parseArgs(['--plan', '--csv'])).toEqual({ ...DEFAULTS, plan: true, csv: true });
  });

  it('combines --plan with --platform', () => {
    expect(parseArgs(['--plan', '--platform', 'ios'])).toEqual({
      ...DEFAULTS,
      plan: true,
      platform: 'ios',
    });
  });

  it('throws when --plan is combined with --usage', () => {
    expect(() => parseArgs(['--plan', '--usage'])).toThrow(
      /--plan cannot be combined with --usage/
    );
  });

  it('throws when --usage is combined with --plan (order does not matter)', () => {
    expect(() => parseArgs(['--usage', '--plan'])).toThrow(
      /--plan cannot be combined with --usage/
    );
  });

  it('throws when --plan is combined with --history', () => {
    expect(() => parseArgs(['--plan', '--history', '3'])).toThrow(
      /--plan cannot be combined with --history/
    );
  });

  it('throws when --history is combined with --plan (order does not matter)', () => {
    expect(() => parseArgs(['--history', '3', '--plan'])).toThrow(
      /--plan cannot be combined with --history/
    );
  });
});
