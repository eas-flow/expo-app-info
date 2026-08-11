import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.mjs';
import { CliError } from '../src/cli.mjs';

const DEFAULTS = {
  help: false,
  version: false,
  platform: null,
  usage: false,
  plan: false,
  history: null,
  month: null,
  account: null,
  app: null,
  local: false,
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
    [['--usage'], { usage: true }],
    [['--platform', 'IOS'], { platform: 'ios' }], // lowercased
    [['--platform=android'], { platform: 'android' }],
    [['--history', '5'], { history: 5 }],
    [['--history=10'], { history: 10 }],
    [['--history', '1'], { history: 1 }], // explicit default
    [['--history', '100'], { history: 100 }], // at MAX_HISTORY
    [['--history', '3', '--platform', 'ios'], { history: 3, platform: 'ios' }],
    [['--plan'], { plan: true }],
    [['--plan', '--platform', 'ios'], { plan: true, platform: 'ios' }],
    [['--usage', '--month', '6'], { usage: true, month: 6 }],
    [['--usage', '--month=12'], { usage: true, month: 12 }], // at MAX_MONTH
    [['--account', 'myorg'], { account: 'myorg' }],
    [['--account=myorg'], { account: 'myorg' }],
    [['--app', 'storefront'], { app: 'storefront' }],
    [['--app=storefront'], { app: 'storefront' }],
    [
      ['--account', 'myorg', '--app', 'storefront', '--history', '5'],
      { account: 'myorg', app: 'storefront', history: 5 },
    ],
    [['--account', 'myorg', '--usage'], { account: 'myorg', usage: true }],
    [['--account', 'myorg', '--plan'], { account: 'myorg', plan: true }],
    [['--app', 'storefront', '--usage'], { app: 'storefront', usage: true }],
    [['--local'], { local: true }],
    [['--local', '--history', '5'], { local: true, history: 5 }],
    [['--local', '--platform', 'ios'], { local: true, platform: 'ios' }],
    [
      ['--local', '--account', 'myorg', '--app', 'storefront'],
      { local: true, account: 'myorg', app: 'storefront' },
    ],
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
    // --json/--csv were removed
    [['--json'], /Unknown option: --json/],
    [['--csv'], /Unknown option: --csv/],
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
    // 3 exclusive modes at once (#57): reports only the first colliding pair.
    [['--usage', '--plan', '--history', '3'], /--plan cannot be combined with --history/],
    [['--usage', '--month'], /--month requires a value/],
    [['--usage', '--month', 'abc'], /Invalid --month value/],
    [['--usage', '--month', '0'], /Invalid --month value/],
    [['--usage', '--month', '2.5'], /Invalid --month value/],
    [['--usage', '--month', '13'], /Invalid --month value/],
    [['--month', '6'], /--month can only be used with --usage/],
    [['--account'], /--account requires a value/],
    [['--account', ''], /--account requires a non-empty value/],
    [['--account', '   '], /--account requires a non-empty value/],
    [['--app'], /--app requires a value/],
    [['--app', ''], /--app requires a non-empty value/],
    [['--app', 'storefront', '--plan'], /--app cannot be used with --plan/],
    [['--plan', '--app', 'storefront'], /--app cannot be used with --plan/],
    [['--local', '--usage'], /--local cannot be used with --usage/],
    [['--usage', '--local'], /--local cannot be used with --usage/],
    [['--local', '--plan'], /--local cannot be used with --plan/],
    [['--plan', '--local'], /--local cannot be used with --plan/],
  ])('throws on %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(CliError);
    expect(() => parseArgs(argv)).toThrow(message);
  });
});
