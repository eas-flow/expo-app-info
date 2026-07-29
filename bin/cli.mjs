#!/usr/bin/env node
// expo-app-info — List every Expo (EAS) app with its latest build version per platform.
// MIT License. No runtime dependencies.

import { readFileSync } from 'node:fs';

const API = process.env.EXPO_API_URL ?? 'https://api.expo.dev/graphql';
const CONCURRENCY = 8;

// ---------------------------------------------------------------- auth

/**
 * The EXPO_TOKEN environment variable is the only supported credential.
 * Keeping the token out of argv and off disk means it cannot leak through
 * shell history, the process list, or a stray config file.
 */
function resolveAuthHeaders() {
  const token = process.env.EXPO_TOKEN?.trim();

  if (!token) {
    fail(
      'EXPO_TOKEN is not set.\n' +
        '  Create a personal access token at https://expo.dev/settings/access-tokens\n' +
        '  then export it:\n' +
        '    export EXPO_TOKEN=xxxxx'
    );
  }

  return { authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------- graphql

const authHeaders = {};

async function gql(query, variables = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: JSON.stringify({ query, variables }),
  });

  if (res.status === 401 || res.status === 403) {
    fail('Authentication failed (401/403). The token or session may have expired.');
  }
  if (!res.ok) fail(`HTTP ${res.status} from ${API}`);

  const json = await res.json();
  if (json.errors?.length) fail(`GraphQL error: ${json.errors.map((e) => e.message).join(', ')}`);
  return json.data;
}

const Q_ACCOUNTS = `query CurrentAccounts { meActor { id accounts { id name } } }`;

const Q_APPS = `query AccountApps($accountId: String!, $after: String) {
  account { byId(accountId: $accountId) { id
    appsPaginated(first: 100, after: $after) {
      edges { node { id name slug } }
      pageInfo { hasNextPage endCursor }
    }
  } }
}`;

const Q_BUILDS = `query LatestBuilds($appId: String!) {
  app { byId(appId: $appId) { id
    ios: builds(offset: 0, limit: 1, filter: { platform: IOS, status: FINISHED }) {
      platform appVersion appBuildVersion createdAt
    }
    android: builds(offset: 0, limit: 1, filter: { platform: ANDROID, status: FINISHED }) {
      platform appVersion appBuildVersion createdAt
    }
  } }
}`;

async function fetchAccounts() {
  const data = await gql(Q_ACCOUNTS);
  return data?.meActor?.accounts ?? [];
}

async function fetchApps(accountId) {
  const apps = [];
  let after = null;
  for (;;) {
    const page = (await gql(Q_APPS, { accountId, after })).account.byId.appsPaginated;
    apps.push(...page.edges.map((e) => e.node));
    if (!page.pageInfo.hasNextPage) return apps;
    after = page.pageInfo.endCursor;
  }
}

async function fetchLatestBuilds(appId) {
  const app = (await gql(Q_BUILDS, { appId })).app.byId;
  return [...app.ios, ...app.android];
}

/** Run `task` over `items` with a bounded number of in-flight requests. */
async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await task(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------- rendering

const isTTY = process.stdout.isTTY;
const dim = (s) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s);

/** Display width, counting East Asian wide characters as 2 columns. */
function width(str) {
  let w = 0;
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6);
    w += wide ? 2 : 1;
  }
  return w;
}

const pad = (str, len) => str + ' '.repeat(Math.max(0, len - width(str)));

function renderTable(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(width(h), ...rows.map((r) => width(r[i] ?? '')))
  );
  const line = (l, m, r) => dim(l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r);

  const out = [];
  out.push(line('┌', '┬', '┐'));
  out.push(
    dim('│') + headers.map((h, i) => ` ${bold(pad(h, widths[i]))} `).join(dim('│')) + dim('│')
  );
  out.push(line('├', '┼', '┤'));
  for (const row of rows) {
    out.push(
      dim('│') + row.map((c, i) => ` ${pad(c ?? '', widths[i])} `).join(dim('│')) + dim('│')
    );
  }
  out.push(line('└', '┴', '┘'));
  return out.join('\n');
}

function relativeDate(iso) {
  if (!iso) return '-';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function progress(msg) {
  if (!process.stderr.isTTY) return;
  process.stderr.write(`\r\x1b[2K${dim(msg)}`);
}

function clearProgress() {
  if (process.stderr.isTTY) process.stderr.write('\r\x1b[2K');
}

function fail(msg) {
  clearProgress();
  console.error(`${isTTY ? '\x1b[31m' : ''}✖ ${msg}${isTTY ? '\x1b[0m' : ''}`);
  process.exit(1);
}

// ---------------------------------------------------------------- main

const HELP = `
  expo-app-info — List every Expo (EAS) app with its latest build version per platform.

  Usage
    $ export EXPO_TOKEN=xxxxx
    $ npx expo-app-info

  Options
    -h, --help       Show this help
    -v, --version    Show version

  Authentication
    EXPO_TOKEN environment variable only. Create a personal access token at
    https://expo.dev/settings/access-tokens

    The token is never read from argv or from disk, so it cannot leak through
    your shell history or the process list.

  Notes
    VERSION / BUILD come from the latest *successful* EAS build, not from your
    local app.json. Apps that have never been built show "-".
`;

function parseArgs(argv) {
  const opts = { help: false, version: false };

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '-v' || arg === '--version') {
      opts.version = true;
    } else {
      fail(`Unknown option: ${arg}\n  Run \`expo-app-info --help\` to see usage.`);
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) return console.log(HELP);
  if (opts.version) {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return console.log(pkg.version);
  }

  Object.assign(authHeaders, resolveAuthHeaders());

  progress('Fetching accounts…');
  const accounts = await fetchAccounts();
  if (accounts.length === 0) fail('No accounts found for this token.');

  const rows = [];
  for (const account of accounts) {
    progress(`Fetching apps in ${account.name}…`);
    const apps = await fetchApps(account.id);

    let done = 0;
    const buildsPerApp = await mapWithConcurrency(apps, CONCURRENCY, async (app) => {
      const builds = await fetchLatestBuilds(app.id);
      progress(`${account.name}: ${++done}/${apps.length} apps…`);
      return builds;
    });

    apps.forEach((app, i) => {
      const builds = buildsPerApp[i];
      if (builds.length === 0) {
        rows.push([account.name, app.name, app.slug, '-', '-', '-', '-']);
        return;
      }
      for (const b of builds) {
        rows.push([
          account.name,
          app.name,
          app.slug,
          b.platform.toLowerCase(),
          b.appVersion ?? '-',
          b.appBuildVersion ?? '-',
          relativeDate(b.createdAt),
        ]);
      }
    });
  }

  clearProgress();

  if (rows.length === 0) {
    console.log('No apps found.');
    return;
  }

  console.log(
    renderTable(['ACCOUNT', 'APP', 'SLUG', 'PLATFORM', 'VERSION', 'BUILD', 'LAST BUILD'], rows)
  );
  console.log(dim(`\n  ${rows.length} row(s). VERSION/BUILD = latest successful EAS build.`));
}

main().catch((err) => fail(err?.message ?? String(err)));
