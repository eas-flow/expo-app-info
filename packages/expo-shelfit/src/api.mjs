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

// Both buildsQuery/buildsPageQuery below build one `ios:`/`android:` aliased
// `builds(...)` field per requested platform, so a caller that only wants
// one platform doesn't pay for fetching (and discarding) the other. `--platform`
// is the caller-facing switch for this; see fetchBuilds/countBuildsByMonth.
const ALL_PLATFORMS = ['ios', 'android'];

function buildAliases(platforms, { offset, fields }) {
  return platforms
    .map(
      (p) =>
        `${p}: builds(offset: ${offset}, limit: $limit, filter: { platform: ${p.toUpperCase()}, status: FINISHED }) { ${fields} }`
    )
    .join('\n    ');
}

function buildsQuery(platforms) {
  return `query RecentBuilds($appId: String!, $limit: Int!) {
  app { byId(appId: $appId) { id
    ${buildAliases(platforms, { offset: 0, fields: 'platform appVersion appBuildVersion createdAt' })}
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
// arbitrarily far back into an app's build history. Only `createdAt` is
// needed here — counting/bucketing by calendar month happens client-side in
// countBuildsByMonth, not appVersion/appBuildVersion display.
function buildsPageQuery(platforms) {
  return `query BuildsPage($appId: String!, $offset: Int!, $limit: Int!) {
  app { byId(appId: $appId) { id
    ${buildAliases(platforms, { offset: '$offset', fields: 'createdAt' })}
  } }
}`;
}

// Page size for buildsPageQuery; `limit: 100` confirmed accepted by the API
// (scripts/probe-history.mjs). Non-zero offset not separately probed, but
// same offset/limit shape.
const BUILD_PAGE_SIZE = 50;

/**
 * Which month bucket (index into `months`) a build's `createdAt` falls into,
 * or -1 if it is outside every requested month (older than the oldest one).
 * `months` is a list of `{ start, end }` UTC calendar-month boundaries
 * (ISO 8601, `end` exclusive — the instant the next month starts), ordered
 * newest first, as produced by src/dates.mjs#calendarMonths().
 */
function monthIndexForBuild(createdAt, months) {
  const t = new Date(createdAt).getTime();
  for (let i = 0; i < months.length; i++) {
    if (t >= new Date(months[i].start).getTime() && t < new Date(months[i].end).getTime()) {
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
    const app = (await gql(buildsQuery(platforms), { appId, limit })).app.byId;
    const byNewest = (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return platforms.flatMap((p) => [...app[p]].sort(byNewest));
  }

  /**
   * Successful (FINISHED) build counts for one app, bucketed by platform and
   * UTC calendar month, for `--usage`. `months` is a list of
   * `{ start, end }` boundaries ordered newest first (src/dates.mjs's
   * calendarMonths()); the return value is a parallel array of
   * `{ ios, android }` counts, one entry per month in `months`.
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
    const counts = months.map(() => ({ ios: 0, android: 0 }));
    const oldestStartMs = new Date(months[months.length - 1].start).getTime();

    let offset = 0;
    let iosDone = platform === 'android';
    let androidDone = platform === 'ios';

    while (!iosDone || !androidDone) {
      const platforms = [];
      if (!iosDone) platforms.push('ios');
      if (!androidDone) platforms.push('android');

      const page = (
        await gql(buildsPageQuery(platforms), { appId, offset, limit: BUILD_PAGE_SIZE })
      ).app.byId;
      const iosPage = iosDone ? [] : page.ios;
      const androidPage = androidDone ? [] : page.android;

      for (const b of iosPage) {
        const i = monthIndexForBuild(b.createdAt, months);
        if (i !== -1) counts[i].ios++;
      }
      for (const b of androidPage) {
        const i = monthIndexForBuild(b.createdAt, months);
        if (i !== -1) counts[i].android++;
      }

      if (!iosDone) {
        const exhausted = iosPage.length < BUILD_PAGE_SIZE;
        const pastOldest =
          iosPage.length > 0 &&
          iosPage.every((b) => new Date(b.createdAt).getTime() < oldestStartMs);
        if (exhausted || pastOldest) iosDone = true;
      }
      if (!androidDone) {
        const exhausted = androidPage.length < BUILD_PAGE_SIZE;
        const pastOldest =
          androidPage.length > 0 &&
          androidPage.every((b) => new Date(b.createdAt).getTime() < oldestStartMs);
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
 * Shared in-flight request cap for every parallelized fetch in this CLI
 * (see mapWithConcurrency below) — the guardrail that keeps request count
 * growth from turning into request *rate* growth.
 */
export const CONCURRENCY = 8;

/** Run `task` over `items` with a bounded number of in-flight requests. */
export async function mapWithConcurrency(items, limit, task) {
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
