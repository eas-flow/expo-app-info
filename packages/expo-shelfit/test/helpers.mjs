// Kept deliberately minimal: only what the display-mode test files actually
// duplicate.

export function jsonResponse(body, { status = 200, ok = true } = {}) {
  return { status, ok, json: async () => body };
}

/** Returns each response in call order — only safe where call order is fixed. */
export function fetchSequence(responses) {
  let call = 0;
  return async () => responses[call++];
}

export function accountsResponse(accounts = [{ id: 'acc-1', name: 'myorg' }]) {
  return jsonResponse({ data: { meActor: { accounts } } });
}

/** Single page only; multi-page pagination is covered in test/shared/api.test.mjs. */
export function appsResponse(
  apps = [{ id: 'app-1', name: 'Storefront', slug: 'storefront' }],
  accountId = 'acc-1'
) {
  return jsonResponse({
    data: {
      account: {
        byId: {
          id: accountId,
          appsPaginated: {
            edges: apps.map((node) => ({ node })),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    },
  });
}

/**
 * BuildsPage's shape (`--stats`, `src/shared/api.mjs#buildsPageQuery`) — a
 * flat `ios`/`android` alias per platform, unrelated to and unchanged by
 * AppOverview's `<platform>Builds`/`Submissions`/`Updates` aliases below.
 */
export function buildsResponse({ ios = [], android = [], appId = 'app-1' } = {}) {
  return jsonResponse({ data: { app: { byId: { id: appId, ios, android } } } });
}

/**
 * AppOverview's shape (default app list, `src/shared/api.mjs#appOverviewQuery`).
 * `ios`/`android` are `{ builds, submissions, updates }` (all default `[]`)
 * — an array shorthand is treated as `{ builds: [...] }`, since most tests
 * only care about builds. Passing `undefined` for a platform omits its keys
 * entirely, matching what --platform actually requests.
 */
export function appOverviewResponse({ ios = [], android = [], appId = 'app-1' } = {}) {
  const byId = { id: appId };
  for (const [prefix, value] of [
    ['ios', ios],
    ['android', android],
  ]) {
    if (value === undefined) continue;
    const data = Array.isArray(value) ? { builds: value } : value;
    byId[`${prefix}Builds`] = data.builds ?? [];
    byId[`${prefix}Submissions`] = data.submissions ?? [];
    byId[`${prefix}Updates`] = data.updates ?? [];
  }
  return jsonResponse({ data: { app: { byId } } });
}
