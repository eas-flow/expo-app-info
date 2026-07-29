import { describe, expect, it } from 'vitest';
import { CliError, parseArgs } from '../src/cli.mjs';

const DEFAULTS = {
  help: false,
  version: false,
  json: false,
  csv: false,
  account: null,
  platform: null,
};

describe('parseArgs', () => {
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
});
