// EAS GraphQL client. No process.exit / console here — every failure throws
// an ApiError so the CLI layer (src/cli.mjs) is the single place that turns
// errors into exit codes and printed messages.

export class ApiError extends Error {}

export const Q_ACCOUNTS = `query CurrentAccounts { meActor { id accounts { id name } } }`;

export const Q_APPS = `query AccountApps($accountId: String!, $after: String) {
  account { byId(accountId: $accountId) { id
    appsPaginated(first: 100, after: $after) {
      edges { node { id name slug } }
      pageInfo { hasNextPage endCursor }
    }
  } }
}`;

export const Q_BUILDS = `query LatestBuilds($appId: String!) {
  app { byId(appId: $appId) { id
    ios: builds(offset: 0, limit: 1, filter: { platform: IOS, status: FINISHED }) {
      platform appVersion appBuildVersion createdAt
    }
    android: builds(offset: 0, limit: 1, filter: { platform: ANDROID, status: FINISHED }) {
      platform appVersion appBuildVersion createdAt
    }
  } }
}`;

// Billing-scoped fields. A token without billing permission on the account
// gets a GraphQL error here rather than data, so the CLI queries this
// separately and degrades to "-" instead of failing the whole run.
export const Q_ACCOUNT_PLAN = `query AccountPlan($accountId: String!) {
  account { byId(accountId: $accountId) { id
    subscription {
      id planId name status trialEnd
      concurrencies { total ios android }
    }
    billingPeriod { start end }
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
    if (!res.ok) throw new ApiError(`HTTP ${res.status} from ${apiUrl}`);

    const json = await res.json();
    if (json.errors?.length) {
      throw new ApiError(`GraphQL error: ${json.errors.map((e) => e.message).join(', ')}`);
    }
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

  async function fetchLatestBuilds(appId) {
    const app = (await gql(Q_BUILDS, { appId })).app.byId;
    return [...app.ios, ...app.android];
  }

  /**
   * Subscription + current billing period for one account. Throws like every
   * other method here; the caller decides whether a missing plan is fatal
   * (it isn't — see src/cli.mjs, which renders "-" and keeps going).
   */
  async function fetchAccountPlan(accountId) {
    const account = (await gql(Q_ACCOUNT_PLAN, { accountId })).account.byId;
    return {
      subscription: account?.subscription ?? null,
      billingPeriod: account?.billingPeriod ?? null,
    };
  }

  return { gql, fetchAccounts, fetchApps, fetchLatestBuilds, fetchAccountPlan };
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
