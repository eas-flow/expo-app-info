import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.mjs';
import { CliError } from '../src/cli.mjs';

const DEFAULTS = {
  help: false,
  version: false,
  json: false,
  csv: false,
  platform: null,
  usage: false,
  plan: false,
  history: null,
  month: null,
};

describe('parseArgs', () => {
  // Table-driven happy path: argv → expected overrides on DEFAULTS.
  it.each([
    [[], {}],
    [['-h'], { help: true }],
    [['--help'], { help: true }],
    [['-v'], { version: true }],
    [['--version'], { version: true }],
    [['--help', '--version'], { help: true, version: true }],
    [['--json'], { json: true }],
    [['--csv'], { csv: true }],
    [['--usage'], { usage: true }],
    [['--usage', '--json'], { usage: true, json: true }],
    [['--platform', 'IOS'], { platform: 'ios' }], // lowercased
    [['--platform=android'], { platform: 'android' }],
    [['--history', '5'], { history: 5 }],
    [['--history=10'], { history: 10 }],
    [['--history', '1'], { history: 1 }], // explicit default
    [['--history', '100'], { history: 100 }], // at MAX_HISTORY
    [['--history', '3', '--platform', 'ios'], { history: 3, platform: 'ios' }],
    [['--plan'], { plan: true }],
    [['--plan', '--json'], { plan: true, json: true }],
    [['--plan', '--csv'], { plan: true, csv: true }],
    [['--plan', '--platform', 'ios'], { plan: true, platform: 'ios' }],
    [['--usage', '--month', '6'], { usage: true, month: 6 }],
    [['--usage', '--month=12'], { usage: true, month: 12 }], // at MAX_MONTH
  ])('parses %j', (argv, expected) => {
    expect(parseArgs(argv)).toEqual({ ...DEFAULTS, ...expected });
  });

  // Table-driven errors: argv → thrown message. Exclusive-pair checks run
  // after the parse loop (src/args.mjs), so argv order does not matter and
  // one direction per pair is enough. Numeric validation shares one code
  // path per flag; boundary representatives: below-min, above-max,
  // non-numeric, non-integer, missing value.
  it.each([
    [['--bogus'], /Unknown option: --bogus/],
    // --account was removed in issue #22 (displayName replaced slug filtering)
    [['--account', 'myorg'], /Unknown option: --account/],
    [['--json', '--csv'], /cannot be used together/],
    [['--platform', 'windows'], /Invalid --platform value/],
    [['--platform'], /--platform requires a value/],
    [['--history'], /--history requires a value/],
    [['--history', 'abc'], /Invalid --history value/],
    [['--history', '0'], /Invalid --history value/],
    [['--history', '2.5'], /Invalid --history value/],
    [['--history', '101'], /Invalid --history value/],
    [['--usage', '--history', '5'], /--history cannot be combined with --usage/],
    [['--plan', '--usage'], /--plan cannot be combined with --usage/],
    [['--plan', '--history', '3'], /--plan cannot be combined with --history/],
    [['--usage', '--month'], /--month requires a value/],
    [['--usage', '--month', 'abc'], /Invalid --month value/],
    [['--usage', '--month', '0'], /Invalid --month value/],
    [['--usage', '--month', '2.5'], /Invalid --month value/],
    [['--usage', '--month', '13'], /Invalid --month value/],
    [['--month', '6'], /--month can only be used with --usage/],
  ])('throws on %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(CliError);
    expect(() => parseArgs(argv)).toThrow(message);
  });
});
