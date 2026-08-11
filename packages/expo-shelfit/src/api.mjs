// EAS GraphQL client. No process.exit/console here — every failure throws ApiError;
// src/cli.mjs is the only place that turns errors into exit codes and messages.

import { progress } from './progress.mjs';

export class ApiError extends Error {}

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

// Both buildsQuery/buildsPageQuery below build one `ios:`/`android:` aliased
// `builds(...)` field per requested platform, so a caller that only wants
// one platform doesn't pay for fetching (and discarding) the other. `--platform`
// is the caller-facing switch for this; see fetchBuilds/countBuildsByMonth.
const ALL_PLATFORMS = ['ios', 'android'];

// `status` is deliberately omitted from `filter` — confirmed against the
// real API (scripts/probe-build-status.mjs, issue #83) that leaving it out
// returns builds in every status (FINISHED/ERRORED/CANCELED and whatever
// else), not just FINISHED, and that the field does not require a value.
// Filtering to one status client-side after the fact would still work but
// would throw away exactly the information #83 exists to surface.
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

// `--usage` moved off this billing-scoped shape to client-side UTC calendar-month
// counting below (buildsPageQuery/countBuildsByMonth): billing-period metrics can't
// be sliced into arbitrary calendar ranges. Only the subscription fields survive
// here, for `--plan`.
//
// Billing-scoped: a token without billing permission errors per account; the
// CLI degrades that to "-" rather than failing the run. No price field —
// not yet confirmed to exist against a real token.
const Q_SUBSCRIPTION = `query AccountSubscription($accountId: String!) {
  account { byId(accountId: $accountId) { id
    subscription {
      id planId name status trialEnd
      concurrencies { total ios android }
    }
  } }
}`;

// `--usage`. Same shape as buildsQuery above but paginated with
// `offset`/`limit` instead of a fixed small `limit`, so callers can walk
// arbitrarily far back into an app's build history. `createdAt` places a
// build in a calendar month; `status` buckets it into success/errored/
// canceled once there — see countBuildsByMonth. No appVersion/appBuildVersion,
// since --usage never displays them.
function buildsPageQuery(platforms) {
  return `query BuildsPage($appId: String!, $offset: Int!, $limit: Int!) {
  app { byId(appId: $appId) { id
    ${buildAliases(platforms, { offset: '$offset', fields: 'status createdAt' })}
  } }
}`;
}

// Page size for buildsPageQuery; `limit: 100` confirmed accepted by the API
// (scripts/probe-history.mjs). Non-zero offset not separately probed, but
// same offset/limit shape.
const BUILD_PAGE_SIZE = 50;

// Hard stop for countBuildsByMonth's pagination in case the API's
// undocumented ordering/offset behavior stops holding (e.g. always returns
// the same full page) — 200 x BUILD_PAGE_SIZE(50) = 10k builds/app, well
// past any realistic --month window.
const MAX_BUILD_PAGES = 200;

/**
 * Normalizes `{ start, end }` UTC calendar-month boundaries (ISO 8601
 * strings, as produced by src/dates.mjs#calendarMonths()) to
 * `{ startMs, endMs }` once, so `monthIndexForBuild` below can compare
 * plain numbers instead of re-parsing the same boundaries on every call.
 */
function toMonthBounds(months) {
  return months.map((m) => ({ startMs: Date.parse(m.start), endMs: Date.parse(m.end) }));
}

/**
 * Which month bucket (index into `bounds`) a build's `createdAtMs` falls
 * into, or -1 if it is outside every requested month (older than the oldest
 * one, or an unparseable `createdAt` that produced `NaN`). `bounds` is
 * `{ startMs, endMs }[]` (end exclusive — the instant the next month
 * starts), ordered newest first, as produced by `toMonthBounds` above.
 */
function monthIndexForBuild(createdAtMs, bounds) {
  for (let i = 0; i < bounds.length; i++) {
    if (createdAtMs >= bounds[i].startMs && createdAtMs < bounds[i].endMs) {
      return i;
    }
  }
  return -1;
}

// Raw EAS `status` enum value -> the count bucket it lands in for
// countBuildsByMonth (--usage). Only these 3 have been confirmed against the
// real API (scripts/probe-build-status.mjs, issue #83); anything not listed
// here — a still in-progress/queued build, or any other status this
// unofficial API introduces later — is deliberately not counted in any
// bucket rather than guessed at, since it hasn't reached a terminal outcome.
const STATUS_COUNT_KEY = { FINISHED: 'success', ERRORED: 'errored', CANCELED: 'canceled' };

function emptyStatusCounts() {
  return { success: 0, errored: 0, canceled: 0 };
}

/**
 * Creates a client bound to one API URL / auth header set. Keeping this a
 * factory (rather than module-scoped state) means tests can spin up an
 * isolated client per test with a mocked `fetchImpl`.
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
   * Up to `limit` most recent builds per platform *regardless of status*
   * (FINISHED/ERRORED/CANCELED/anything else — see the module comment on
   * `buildAliases`), newest first, merged into one array (ios entries first,
   * then android). `limit` defaults to 1 to preserve the "latest build
   * attempt per platform" behavior most callers want — as of #83 that is the
   * latest *attempt*, not the latest successful one; a platform whose most
   * recent build errored or was canceled now surfaces that build instead of
   * silently falling back to an older successful one.
   *
   * `platform` (`'ios'` | `'android'` | omitted for both) narrows which
   * `builds(...)` alias is even requested — the query is built to only ask
   * for what's needed, not fetched-then-filtered.
   *
   * The API's own ordering for `builds(offset, limit)` is not documented, so
   * each platform's slice is sorted by `createdAt` descending here rather
   * than trusted as-is — with `limit: 1` a wrong order never showed up, but
   * it would with `limit > 1`.
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
   * Success/errored/canceled build counts for one app, bucketed by platform
   * and UTC calendar month, for `--usage` (#83 — before this, only FINISHED
   * builds were counted at all). `months` is a list of `{ start, end }`
   * boundaries ordered newest first (src/dates.mjs's calendarMonths()); the
   * return value is a parallel array of `{ ios, android }` counts, one entry
   * per month in `months`, where each of `ios`/`android` is
   * `{ success, errored, canceled }` (see STATUS_COUNT_KEY/emptyStatusCounts
   * above). A build whose status isn't one of those three — most commonly
   * still in-progress/queued — falls into none of them: it hasn't reached a
   * terminal outcome yet, so it would misrepresent whichever bucket it got
   * dropped into.
   *
   * Pages through buildsPageQuery() newest-first, a fixed BUILD_PAGE_SIZE at
   * a time. By default both platforms are requested in the same page; with
   * `platform` set, only that platform's alias is ever requested. Each
   * platform stops independently once either a page comes back short
   * (fewer than BUILD_PAGE_SIZE — no more builds exist) or every build in a
   * page is older than the oldest requested month's start (further pages
   * would only be older still, assuming the API's undocumented order holds
   * newest-first, as observed for tested accounts in
   * scripts/probe-history.mjs) — once a platform is done, its alias is
   * dropped from every subsequent page's query, not just skipped client-side.
   * Throws ApiError like every other method here; the caller
   * (src/commands/usage.mjs#runUsage) decides a failure degrades that whole
   * account's rows rather than failing the run.
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

  /**
   * Current subscription (plan, status, trial end, concurrency) for one
   * account — no billing period or build counts. Used by `--plan`.
   * Throws like every other method here; the caller
   * (src/commands/plan.mjs#runPlan) decides a missing plan isn't fatal.
   */
  async function fetchSubscription(accountId) {
    const data = await gql(Q_SUBSCRIPTION, { accountId });
    return data?.account?.byId?.subscription ?? null;
  }

  return { gql, fetchAccounts, fetchApps, fetchBuilds, fetchSubscription, countBuildsByMonth };
}

/**
 * Shared in-flight request cap for every parallelized fetch in this CLI,
 * enforced by `defaultSemaphore` below.
 *
 * Do not call `mapWithConcurrency` from inside a task that is itself
 * running under `mapWithConcurrency` against the same semaphore — a task
 * holds its slot for its whole duration, so nesting can exhaust the pool
 * and deadlock. See `mapWithConcurrency` below.
 */
export const CONCURRENCY = 8;

/** FIFO counting semaphore: `acquire()` waits for a free slot, `release()` frees one. */
export function createSemaphore(limit) {
  let active = 0;
  const queue = [];

  function acquire() {
    if (active < limit) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  }

  function release() {
    active--;
    const next = queue.shift();
    if (next) {
      active++;
      next();
    }
  }

  return { acquire, release };
}

const defaultSemaphore = createSemaphore(CONCURRENCY);

/**
 * Run `task` over `items` concurrently, gated by `semaphore` (default:
 * `defaultSemaphore`, shared process-wide so the cap holds across call
 * sites — do not nest calls against the same semaphore, see CONCURRENCY).
 */
export async function mapWithConcurrency(items, task, { semaphore = defaultSemaphore } = {}) {
  return Promise.all(
    items.map(async (item, i) => {
      await semaphore.acquire();
      try {
        return await task(item, i);
      } finally {
        semaphore.release();
      }
    })
  );
}
