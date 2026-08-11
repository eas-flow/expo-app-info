import { describe, expect, it } from 'vitest';
import { DEPRECATED_USAGE_WARNING, parseArgs } from '../src/args.mjs';
import { CliError } from '../src/cli.mjs';

const DEFAULTS = {
  help: false,
  version: false,
  platform: null,
  stats: false,
  plan: false,
  history: null,
  month: null,
  account: null,
  app: null,
  groupBy: null,
  local: false,
  warnings: [],
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
    [['--stats'], { stats: true }],
    [['--platform', 'IOS'], { platform: 'ios' }], // lowercased
    [['--platform=android'], { platform: 'android' }],
    [['--history', '5'], { history: 5 }],
    [['--history=10'], { history: 10 }],
    [['--history', '1'], { history: 1 }], // explicit default
    [['--history', '100'], { history: 100 }], // at MAX_HISTORY
    [['--history', '3', '--platform', 'ios'], { history: 3, platform: 'ios' }],
    [['--plan'], { plan: true }],
    [['--plan', '--platform', 'ios'], { plan: true, platform: 'ios' }],
    [['--stats', '--month', '6'], { stats: true, month: 6 }],
    [['--stats', '--month=12'], { stats: true, month: 12 }], // at MAX_MONTH
    [['--account', 'myorg'], { account: 'myorg' }],
    [['--account=myorg'], { account: 'myorg' }],
    [['--app', 'storefront'], { app: 'storefront' }],
    [['--app=storefront'], { app: 'storefront' }],
    [
      ['--account', 'myorg', '--app', 'storefront', '--history', '5'],
      { account: 'myorg', app: 'storefront', history: 5 },
    ],
    [['--stats', '--group-by', 'app'], { stats: true, groupBy: 'app' }],
    [['--stats', '--group-by=app'], { stats: true, groupBy: 'app' }],
    [['--stats', '--group-by', 'account'], { stats: true, groupBy: 'account' }], // explicit default
    [['--stats', '--group-by', 'APP'], { stats: true, groupBy: 'app' }], // lowercased
    [
      ['--stats', '--group-by', 'app', '--month', '6', '--platform', 'ios'],
      { stats: true, groupBy: 'app', month: 6, platform: 'ios' },
    ],
    [
      ['--stats', '--group-by', 'app', '--app', 'storefront'],
      { stats: true, groupBy: 'app', app: 'storefront' },
    ],
    [['--account', 'myorg', '--stats'], { account: 'myorg', stats: true }],
    [['--account', 'myorg', '--plan'], { account: 'myorg', plan: true }],
    [['--app', 'storefront', '--stats'], { app: 'storefront', stats: true }],
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
    [['--stats', '--history', '5'], /--history cannot be combined with --stats/],
    [['--plan', '--stats'], /--plan cannot be combined with --stats/],
    [['--plan', '--history', '3'], /--plan cannot be combined with --history/],
    // 3 exclusive modes at once (#57): reports only the first colliding pair.
    [['--stats', '--plan', '--history', '3'], /--plan cannot be combined with --history/],
    [['--stats', '--month'], /--month requires a value/],
    [['--stats', '--month', 'abc'], /Invalid --month value/],
    [['--stats', '--month', '0'], /Invalid --month value/],
    [['--stats', '--month', '2.5'], /Invalid --month value/],
    [['--stats', '--month', '13'], /Invalid --month value/],
    [['--month', '6'], /--month can only be used with --stats/],
    [['--stats', '--group-by'], /--group-by requires a value/],
    [['--stats', '--group-by', 'platform'], /Invalid --group-by value: "platform"/],
    [['--stats', '--group-by', ''], /Invalid --group-by value/],
    // The message must not say "--groupBy": opts keys are camelCase, flags are not.
    [['--group-by', 'app'], /--group-by can only be used with --stats/],
    [['--plan', '--group-by', 'app'], /--group-by can only be used with --stats/],
    [['--history', '5', '--group-by', 'app'], /--group-by can only be used with --stats/],
    [['--account'], /--account requires a value/],
    [['--account', ''], /--account requires a non-empty value/],
    [['--account', '   '], /--account requires a non-empty value/],
    [['--app'], /--app requires a value/],
    [['--app', ''], /--app requires a non-empty value/],
    [['--app', 'storefront', '--plan'], /--app cannot be used with --plan/],
    [['--plan', '--app', 'storefront'], /--app cannot be used with --plan/],
    [['--local', '--stats'], /--local cannot be used with --stats/],
    [['--stats', '--local'], /--local cannot be used with --stats/],
    [['--local', '--plan'], /--local cannot be used with --plan/],
    [['--plan', '--local'], /--local cannot be used with --plan/],
  ])('throws on %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(CliError);
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

// --usage is the pre-#89 name for --stats. It still parses to exactly the
// same opts, plus a deprecation warning; it goes away in the next major.
describe('parseArgs — the deprecated --usage alias', () => {
  it('parses to the same opts as --stats, apart from the warning', () => {
    const { warnings, ...deprecated } = parseArgs(['--usage', '--month', '6', '--platform', 'ios']);
    const { warnings: none, ...current } = parseArgs([
      '--stats',
      '--month',
      '6',
      '--platform',
      'ios',
    ]);
    expect(deprecated).toEqual(current);
    expect(warnings).toEqual([DEPRECATED_USAGE_WARNING]);
    expect(none).toEqual([]);
  });

  it('warns once even when --usage is repeated', () => {
    expect(parseArgs(['--usage', '--usage']).warnings).toEqual([DEPRECATED_USAGE_WARNING]);
  });

  it('names --stats in the warning so the message is actionable', () => {
    expect(DEPRECATED_USAGE_WARNING).toMatch(/--usage is deprecated/);
    expect(DEPRECATED_USAGE_WARNING).toMatch(/Use --stats instead/);
  });

  // Errors echo the flag the user actually typed — reporting --stats to
  // someone who wrote --usage would name a flag absent from their command.
  it.each([
    [['--usage', '--plan'], /--plan cannot be combined with --usage\./],
    [['--usage', '--history', '5'], /--history cannot be combined with --usage\./],
    [['--usage', '--local'], /--local cannot be used with --usage\./],
  ])('reports --usage, not --stats, on %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });

  it.each([
    [['--stats', '--plan'], /--plan cannot be combined with --stats\./],
    [['--stats', '--history', '5'], /--history cannot be combined with --stats\./],
    [['--stats', '--local'], /--local cannot be used with --stats\./],
  ])('reports --stats on %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });

  // No mode flag was typed at all, so there is nothing to echo: point at the
  // current name rather than the one on its way out.
  it('points --month at --stats when neither mode flag was given', () => {
    expect(() => parseArgs(['--month', '6'])).toThrow('--month can only be used with --stats.');
  });

  it('prefers --stats in errors when both flags are passed', () => {
    expect(() => parseArgs(['--usage', '--stats', '--plan'])).toThrow(
      '--plan cannot be combined with --stats.'
    );
    expect(parseArgs(['--usage', '--stats']).warnings).toEqual([DEPRECATED_USAGE_WARNING]);
  });
});
