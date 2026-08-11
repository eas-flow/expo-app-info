// EAS GraphQL client. No process.exit/console here — every failure throws ApiError;
// src/cli.mjs is the only place that turns errors into exit codes and messages.

import { ApiError } from '../errors.mjs';
import { progress } from './terminal/progress.mjs';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

// Retried: 408/429/5xx and network-level failures (fetch reject, abort/timeout).
// Never retried: 401/403 (auth) and 400 (GraphQL validation errors).
function isRetryableStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

function retryAfterMs(res) {
  const header = res.headers?.get?.('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

// Exponential backoff (500ms, 1s, 2s, ...) with up to 20% jitter, unless the
// server gave a Retry-After.
function backoffMs(attempt, retryAfter) {
  if (retryAfter !== null) return retryAfter;
  const base = 500 * 2 ** (attempt - 1);
  return base + Math.random() * base * 0.2;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// `displayName` (nullable) backs the human table's friendlier ACCOUNT name;
// `name` is always the unique slug.
const Q_ACCOUNTS = `query CurrentAccounts { meActor { id accounts { id name displayName } } }`;

const Q_APPS = `query AccountApps($accountId: String!, $after: String) {
  account { byId(accountId: $accountId) { id
    appsPaginated(first: 100, after: $after) {
      edges { node { id name slug } }
      pageInfo { hasNextPage endCursor }
    }
  } }
}`;

// One `ios:`/`android:` aliased `builds(...)` field per requested platform, so
// a caller that only wants one doesn't pay for fetching and discarding the
// other. `--platform` is the caller-facing switch.
const ALL_PLATFORMS = ['ios', 'android'];

// `status` is deliberately omitted from `filter` — confirmed against the real
// API (scripts/probe-build-status.mjs) that leaving it out returns builds in
// every status, not just FINISHED, and that the field isn't required.
// Filtering client-side afterwards would throw away exactly what the STATUS
// column exists to show.
function buildAliases(platforms, { offset, fields }) {
  return platforms
    .map(
      (p) =>
        `${p}: builds(offset: ${offset}, limit: $limit, filter: { platform: ${p.toUpperCase()} }) { ${fields} }`
    )
    .join('\n    ');
}

function buildsQuery(platforms) {
  return `query RecentBuilds($appId: String!, $limit: Int!) {
  app { byId(appId: $appId) { id
    ${buildAliases(platforms, { offset: 0, fields: 'platform status appVersion appBuildVersion createdAt' })}
  } }
}`;
}

// Billing-scoped, so a token without billing permission errors per account —
// the CLI degrades that to "-" rather than failing the run. No price field: not
// confirmed to exist against a real token. `--stats` deliberately queries none
// of this, since billing-period metrics can't be sliced into calendar ranges.
const Q_SUBSCRIPTION = `query AccountSubscription($accountId: String!) {
  account { byId(accountId: $accountId) { id
    subscription {
      id planId name status trialEnd
      concurrencies { total ios android }
    }
  } }
}`;

// buildsQuery's shape, paginated by `offset` so --stats can walk arbitrarily
// far back, and without the version fields --stats never displays.
function buildsPageQuery(platforms) {
  return `query BuildsPage($appId: String!, $offset: Int!, $limit: Int!) {
  app { byId(appId: $appId) { id
    ${buildAliases(platforms, { offset: '$offset', fields: 'status createdAt' })}
  } }
}`;
}

// Well under the `limit: 100` confirmed accepted by the API
// (scripts/probe-history.mjs).
const BUILD_PAGE_SIZE = 50;

// Hard stop in case the API's undocumented offset behavior stops holding (e.g.
// it keeps returning the same full page) — 10k builds/app, past any realistic
// --month window.
const MAX_BUILD_PAGES = 200;

/** Parsed once so monthIndexForBuild compares numbers instead of re-parsing. */
function toMonthBounds(months) {
  return months.map((m) => ({ startMs: Date.parse(m.start), endMs: Date.parse(m.end) }));
}

/** -1 when the build falls outside every requested month, or `createdAt` was NaN. */
function monthIndexForBuild(createdAtMs, bounds) {
  for (let i = 0; i < bounds.length; i++) {
    if (createdAtMs >= bounds[i].startMs && createdAtMs < bounds[i].endMs) {
      return i;
    }
  }
  return -1;
}

// Only these 3 have been confirmed against the real API
// (scripts/probe-build-status.mjs). Anything else — a queued build, or a status
// this unofficial API adds later — is counted in no bucket rather than guessed
// at, since it hasn't reached a terminal outcome.
const STATUS_COUNT_KEY = { FINISHED: 'success', ERRORED: 'errored', CANCELED: 'canceled' };

function emptyStatusCounts() {
  return { success: 0, errored: 0, canceled: 0 };
}

/**
 * A factory rather than module-scoped state, so tests can spin up an isolated
 * client per test with a mocked `fetchImpl`.
 */
export function createApiClient({
  apiUrl,
  authHeaders = {},
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
} = {}) {
  async function gql(query, variables = {}) {
    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(apiUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...authHeaders },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (attempt > maxRetries) {
          throw new ApiError(
            `Request to ${apiUrl} failed after ${attempt} attempt(s): ${err.message}`,
            { cause: err }
          );
        }
        progress(`Request failed, retrying (attempt ${attempt + 1})…`);
        await sleep(backoffMs(attempt, null));
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        throw new ApiError(
          'Authentication failed (401/403). The token or session may have expired.'
        );
      }

      if (isRetryableStatus(res.status)) {
        if (attempt > maxRetries) {
          throw new ApiError(`HTTP ${res.status} from ${apiUrl} after ${attempt} attempt(s)`);
        }
        progress(`HTTP ${res.status}, retrying (attempt ${attempt + 1})…`);
        await sleep(backoffMs(attempt, retryAfterMs(res)));
        continue;
      }

      // Validation errors come back as HTTP 400 with a normal GraphQL error body —
      // read it before giving up, so `errors[].message` isn't lost to a bare status code.
      let json;
      try {
        json = await res.json();
      } catch {
        throw new ApiError(`HTTP ${res.status} from ${apiUrl}`);
      }

      if (json.errors?.length) {
        throw new ApiError(`GraphQL error: ${json.errors.map((e) => e.message).join(', ')}`);
      }
      if (!res.ok) throw new ApiError(`HTTP ${res.status} from ${apiUrl}`);

      return json.data;
    }
  }

  async function fetchAccounts() {
    const data = await gql(Q_ACCOUNTS);
    return data?.meActor?.accounts ?? [];
  }

  async function fetchApps(accountId) {
    const apps = [];
    let after = null;
    for (;;) {
      const data = await gql(Q_APPS, { accountId, after });
      const page = data?.account?.byId?.appsPaginated;
      if (!page)
        throw new ApiError(`AccountApps: unexpected response shape for account ${accountId}`);
      apps.push(...page.edges.map((e) => e.node));
      if (!page.pageInfo.hasNextPage) return apps;
      after = page.pageInfo.endCursor;
    }
  }

  /**
   * The `limit` most recent builds per platform *regardless of status*, so a
   * platform whose latest attempt errored or was canceled surfaces that build
   * instead of falling back to an older successful one.
   *
   * `platform` narrows which alias is even requested, rather than fetching
   * both and discarding one.
   *
   * The API's ordering for `builds(offset, limit)` is undocumented, so each
   * slice is sorted here rather than trusted — with `limit: 1` a wrong order
   * never showed up, but it would with `limit > 1`.
   */
  async function fetchBuilds(appId, { limit = 1, platform } = {}) {
    const platforms = platform ? [platform] : ALL_PLATFORMS;
    const data = await gql(buildsQuery(platforms), { appId, limit });
    const app = data?.app?.byId;
    if (!app || platforms.some((p) => !Array.isArray(app[p]))) {
      throw new ApiError(`RecentBuilds: unexpected response shape for app ${appId}`);
    }
    const byNewest = (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return platforms.flatMap((p) => [...app[p]].sort(byNewest));
  }

  /**
   * Build counts for one app, bucketed by platform and UTC calendar month:
   * `months` in, a parallel array of `{ ios, android }` counts out. A build in
   * a status STATUS_COUNT_KEY doesn't list falls into no bucket at all.
   *
   * Each platform stops paging independently, once a page comes back short or
   * every build in it predates the oldest requested month — the latter relies
   * on the API's undocumented order holding newest-first, as observed in
   * scripts/probe-history.mjs. A finished platform's alias is dropped from
   * subsequent queries rather than skipped client-side.
   *
   * Throws ApiError; src/features/stats/service.mjs#fetchStatsEntries decides
   * that degrades that account's rows rather than failing the run.
   */
  async function countBuildsByMonth(appId, months, { platform } = {}) {
    const bounds = toMonthBounds(months);
    const counts = months.map(() => ({ ios: emptyStatusCounts(), android: emptyStatusCounts() }));
    const oldestStartMs = bounds[bounds.length - 1].startMs;

    let offset = 0;
    let iosDone = platform === 'android';
    let androidDone = platform === 'ios';
    let pageCount = 0;

    while (!iosDone || !androidDone) {
      if (++pageCount > MAX_BUILD_PAGES) {
        throw new ApiError(
          `BuildsPage: exceeded ${MAX_BUILD_PAGES} pages for app ${appId} without pagination ending as expected`
        );
      }
      const platforms = [];
      if (!iosDone) platforms.push('ios');
      if (!androidDone) platforms.push('android');

      const data = await gql(buildsPageQuery(platforms), { appId, offset, limit: BUILD_PAGE_SIZE });
      const page = data?.app?.byId;
      if (!page || platforms.some((p) => !Array.isArray(page[p]))) {
        throw new ApiError(`BuildsPage: unexpected response shape for app ${appId}`);
      }
      const iosPage = iosDone
        ? []
        : page.ios.map((b) => ({ ms: Date.parse(b.createdAt), status: b.status }));
      const androidPage = androidDone
        ? []
        : page.android.map((b) => ({ ms: Date.parse(b.createdAt), status: b.status }));

      for (const { ms, status } of iosPage) {
        const i = monthIndexForBuild(ms, bounds);
        if (i === -1) continue;
        const key = STATUS_COUNT_KEY[status];
        if (key) counts[i].ios[key]++;
      }
      for (const { ms, status } of androidPage) {
        const i = monthIndexForBuild(ms, bounds);
        if (i === -1) continue;
        const key = STATUS_COUNT_KEY[status];
        if (key) counts[i].android[key]++;
      }

      if (!iosDone) {
        const exhausted = iosPage.length < BUILD_PAGE_SIZE;
        const pastOldest = iosPage.length > 0 && iosPage.every(({ ms }) => ms < oldestStartMs);
        if (exhausted || pastOldest) iosDone = true;
      }
      if (!androidDone) {
        const exhausted = androidPage.length < BUILD_PAGE_SIZE;
        const pastOldest =
          androidPage.length > 0 && androidPage.every(({ ms }) => ms < oldestStartMs);
        if (exhausted || pastOldest) androidDone = true;
      }

      offset += BUILD_PAGE_SIZE;
    }

    return counts;
  }

  /** Throws like everything else here; src/features/plan/command.mjs treats a missing plan as non-fatal. */
  async function fetchSubscription(accountId) {
    const data = await gql(Q_SUBSCRIPTION, { accountId });
    return data?.account?.byId?.subscription ?? null;
  }

  return { gql, fetchAccounts, fetchApps, fetchBuilds, fetchSubscription, countBuildsByMonth };
}
