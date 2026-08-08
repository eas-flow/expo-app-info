// EAS GraphQL client. No process.exit/console here — every failure throws ApiError;
// src/cli.mjs is the only place that turns errors into exit codes and messages.

export class ApiError extends Error {}

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

const Q_BUILDS = `query RecentBuilds($appId: String!, $limit: Int!) {
  app { byId(appId: $appId) { id
    ios: builds(offset: 0, limit: $limit, filter: { platform: IOS, status: FINISHED }) {
      platform appVersion appBuildVersion createdAt
    }
    android: builds(offset: 0, limit: $limit, filter: { platform: ANDROID, status: FINISHED }) {
      platform appVersion appBuildVersion createdAt
    }
  } }
}`;

// `--usage` moved off this billing-scoped shape to client-side UTC calendar-month
// counting below (Q_BUILDS_PAGE/countBuildsByMonth): billing-period metrics can't
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

// `--usage`. Same shape as Q_BUILDS above but paginated with
// `offset`/`limit` instead of a fixed small `limit`, so callers can walk
// arbitrarily far back into an app's build history. Only `createdAt` is
// needed here — counting/bucketing by calendar month happens client-side in
// countBuildsByMonth, not appVersion/appBuildVersion display.
const Q_BUILDS_PAGE = `query BuildsPage($appId: String!, $offset: Int!, $limit: Int!) {
  app { byId(appId: $appId) { id
    ios: builds(offset: $offset, limit: $limit, filter: { platform: IOS, status: FINISHED }) {
      createdAt
    }
    android: builds(offset: $offset, limit: $limit, filter: { platform: ANDROID, status: FINISHED }) {
      createdAt
    }
  } }
}`;

// Page size for Q_BUILDS_PAGE; `limit: 100` confirmed accepted by the API
// (scripts/probe-history.mjs). Non-zero offset not separately probed, but
// same offset/limit shape.
const BUILD_PAGE_SIZE = 50;

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

/**
 * Creates a client bound to one API URL / auth header set. Keeping this a
 * factory (rather than module-scoped state) means tests can spin up an
 * isolated client per test with a mocked `fetchImpl`.
 */
export function createApiClient({ apiUrl, authHeaders = {}, fetchImpl = fetch } = {}) {
  async function gql(query, variables = {}) {
    const res = await fetchImpl(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 401 || res.status === 403) {
      throw new ApiError('Authentication failed (401/403). The token or session may have expired.');
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

  /**
   * Up to `limit` most recent *successful* (FINISHED) builds per platform,
   * newest first, merged into one array (ios entries first, then android).
   * `limit` defaults to 1 to preserve the "latest build per platform"
   * behavior most callers want.
   *
   * The API's own ordering for `builds(offset, limit)` is not documented, so
   * each platform's slice is sorted by `createdAt` descending here rather
   * than trusted as-is — with `limit: 1` a wrong order never showed up, but
   * it would with `limit > 1`.
   */
  async function fetchBuilds(appId, { limit = 1 } = {}) {
    const app = (await gql(Q_BUILDS, { appId, limit })).app.byId;
    const byNewest = (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return [...[...app.ios].sort(byNewest), ...[...app.android].sort(byNewest)];
  }

  /**
   * Successful (FINISHED) build counts for one app, bucketed by platform and
   * UTC calendar month, for `--usage`. `months` is a list of
   * `{ start, end }` boundaries ordered newest first (src/dates.mjs's
   * calendarMonths()); the return value is a parallel array of
   * `{ ios, android }` counts, one entry per month in `months`.
   *
   * Pages through Q_BUILDS_PAGE newest-first, a fixed BUILD_PAGE_SIZE at a
   * time, for both platforms in the same request. Each platform stops
   * independently once either a page comes back short
   * (fewer than BUILD_PAGE_SIZE — no more builds exist) or every build in a
   * page is older than the oldest requested month's start (further pages
   * would only be older still, assuming the API's undocumented order holds
   * newest-first, as observed for tested accounts in
   * scripts/probe-history.mjs). Throws ApiError like every other method
   * here; the caller (src/commands/usage.mjs#runUsage) decides a failure degrades that
   * whole account's rows rather than failing the run.
   */
  async function countBuildsByMonth(appId, months) {
    const bounds = toMonthBounds(months);
    const counts = months.map(() => ({ ios: 0, android: 0 }));
    const oldestStartMs = bounds[bounds.length - 1].startMs;

    let offset = 0;
    let iosDone = false;
    let androidDone = false;

    while (!iosDone || !androidDone) {
      const page = (await gql(Q_BUILDS_PAGE, { appId, offset, limit: BUILD_PAGE_SIZE })).app.byId;
      const iosPage = iosDone ? [] : page.ios.map((b) => Date.parse(b.createdAt));
      const androidPage = androidDone ? [] : page.android.map((b) => Date.parse(b.createdAt));

      for (const createdAtMs of iosPage) {
        const i = monthIndexForBuild(createdAtMs, bounds);
        if (i !== -1) counts[i].ios++;
      }
      for (const createdAtMs of androidPage) {
        const i = monthIndexForBuild(createdAtMs, bounds);
        if (i !== -1) counts[i].android++;
      }

      if (!iosDone) {
        const exhausted = iosPage.length < BUILD_PAGE_SIZE;
        const pastOldest = iosPage.length > 0 && iosPage.every((ms) => ms < oldestStartMs);
        if (exhausted || pastOldest) iosDone = true;
      }
      if (!androidDone) {
        const exhausted = androidPage.length < BUILD_PAGE_SIZE;
        const pastOldest = androidPage.length > 0 && androidPage.every((ms) => ms < oldestStartMs);
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
    const account = (await gql(Q_SUBSCRIPTION, { accountId })).account.byId;
    return account?.subscription ?? null;
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
