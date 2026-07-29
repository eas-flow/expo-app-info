import { describe, expect, it } from 'vitest';
import { CliError, parseArgs } from '../src/cli.mjs';

describe('parseArgs', () => {
  it('parses -h', () => {
    expect(parseArgs(['-h'])).toEqual({ help: true, version: false });
  });

  it('parses --help', () => {
    expect(parseArgs(['--help'])).toEqual({ help: true, version: false });
  });

  it('parses -v', () => {
    expect(parseArgs(['-v'])).toEqual({ help: false, version: true });
  });

  it('parses --version', () => {
    expect(parseArgs(['--version'])).toEqual({ help: false, version: true });
  });

  it('returns both false when no args are given', () => {
    expect(parseArgs([])).toEqual({ help: false, version: false });
  });

  it('handles a combination of flags (last one wins is not relevant, both get set)', () => {
    expect(parseArgs(['--help', '--version'])).toEqual({ help: true, version: true });
  });

  it('throws CliError on an unknown option', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(CliError);
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown option: --bogus/);
  });
});
