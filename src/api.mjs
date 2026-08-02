// EAS GraphQL client. No process.exit / console here — every failure throws
// an ApiError so the CLI layer (src/cli.mjs) is the single place that turns
// errors into exit codes and printed messages.

export class ApiError extends Error {}

// `displayName` is fetched alongside the unique `name` slug so the CLI can
// show a friendlier name in the human table (issue #22) while keeping `name`
// as the value --json/--csv emit and that used to back --account filtering
// (removed in the same change — see issue #22). It is nullable — not every
// account has one set.
export const Q_ACCOUNTS = `query CurrentAccounts { meActor { id accounts { id name displayName } } }`;

export const Q_APPS = `query AccountApps($accountId: String!, $after: String) {
  account { byId(accountId: $accountId) { id
    appsPaginated(first: 100, after: $after) {
      edges { node { id name slug } }
      pageInfo { hasNextPage endCursor }
    }
  } }
}`;

export const Q_BUILDS = `query RecentBuilds($appId: String!, $limit: Int!) {
  app { byId(appId: $appId) { id
    ios: builds(offset: 0, limit: $limit, filter: { platform: IOS, status: FINISHED }) {
      platform appVersion appBuildVersion createdAt
    }
    android: builds(offset: 0, limit: $limit, filter: { platform: ANDROID, status: FINISHED }) {
      platform appVersion appBuildVersion createdAt
    }
  } }
}`;

// Billing-scoped fields. A token without billing permission on the account
// gets a GraphQL error here rather than data, so the CLI queries this
// separately and degrades to "-" instead of failing the whole run.
//
// `billingPeriod` takes a required `date` and returns whichever billing
// period contains it — passing "now" gets the current one. The same date is
// reused for `byBillingPeriod` so both fields describe the same window.
//
// Per-platform build counts live under
// `usageMetrics.byBillingPeriod(...).planMetrics[].platformBreakdown`, found
// by walking `EstimatedUsage` in the schema — NOT via `filterParams` on
// `metricsForServiceMetric`, which accepts (and silently ignores) any key.
// See scripts/probe-usage.mjs and issue #15 for how this was confirmed.
export const Q_ACCOUNT_PLAN = `query AccountPlan($accountId: String!, $now: DateTime!) {
  account { byId(accountId: $accountId) { id
    subscription {
      id planId name status trialEnd
      concurrencies { total ios android }
    }
    billingPeriod(date: $now) { start end }
    usageMetrics {
      byBillingPeriod(date: $now, service: BUILDS) {
        planMetrics {
          serviceMetric
          metricType
          value
          platformBreakdown { ios { value } android { value } }
        }
      }
    }
  } }
}`;

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

    // This API (like many GraphQL servers) returns a non-2xx status — 400 in
    // particular — for query validation errors, not only for transport
    // failures. Read the body before giving up on a non-2xx response so
    // `errors[].message` (the actually useful part) isn't discarded in favor
    // of a bare status code.
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
   * it would with `limit > 1` (see issue #17).
   */
  async function fetchBuilds(appId, { limit = 1 } = {}) {
    const app = (await gql(Q_BUILDS, { appId, limit })).app.byId;
    const byNewest = (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return [...[...app.ios].sort(byNewest), ...[...app.android].sort(byNewest)];
  }

  /**
   * Subscription, current billing period, and this-period build counts per
   * platform, for one account. Throws like every other method here; the
   * caller decides whether a missing plan is fatal (it isn't — see
   * src/cli.mjs, which renders "-" and keeps going).
   *
   * `now` is a parameter (default `new Date()`) so callers can pin the
   * billing-period lookup to a fixed instant in tests.
   */
  async function fetchAccountPlan(accountId, { now = new Date() } = {}) {
    const account = (await gql(Q_ACCOUNT_PLAN, { accountId, now: now.toISOString() })).account.byId;

    const buildMetric = account?.usageMetrics?.byBillingPeriod?.planMetrics?.find(
      (m) => m.serviceMetric === 'BUILDS'
    );

    return {
      subscription: account?.subscription ?? null,
      billingPeriod: account?.billingPeriod ?? null,
      buildsByPlatform: buildMetric?.platformBreakdown
        ? {
            ios: buildMetric.platformBreakdown.ios?.value ?? null,
            android: buildMetric.platformBreakdown.android?.value ?? null,
          }
        : null,
    };
  }

  return { gql, fetchAccounts, fetchApps, fetchBuilds, fetchAccountPlan };
}

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
