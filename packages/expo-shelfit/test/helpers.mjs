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
 * AppOverview's `<platform>Builds` alias below.
 */
export function buildsResponse({ ios = [], android = [], appId = 'app-1' } = {}) {
  return jsonResponse({ data: { app: { byId: { id: appId, ios, android } } } });
}

/**
 * AppOverview's shape (default app list, `src/shared/api.mjs#appOverviewQuery`):
 * a `<platform>Builds` alias holding builds that each carry their own
 * `submissions` and `runtime`. Both default per build, so a fixture that
 * doesn't care about SUBMIT/UPDATE can leave them out. Passing `undefined`
 * for a platform omits its alias entirely, matching what --platform requests.
 */
export function appOverviewResponse({ ios = [], android = [], appId = 'app-1' } = {}) {
  const byId = { id: appId };
  for (const [prefix, builds] of [
    ['ios', ios],
    ['android', android],
  ]) {
    if (builds === undefined) continue;
    byId[`${prefix}Builds`] = builds.map(({ submissions = [], runtime = null, ...build }) => ({
      ...build,
      submissions,
      runtime,
    }));
  }
  return jsonResponse({ data: { app: { byId } } });
}

/**
 * Raw `Build.runtime` shape: a Relay connection whose nodes carry `platform`
 * (one runtime's page mixes both) and a `branch` that is an `UpdateBranch`
 * object, not a plain string. `Update.platform` is a lowercase `String!`,
 * unlike `Build.platform`'s uppercase `AppPlatform` enum — callers pass
 * `'ios'`/`'android'` here, matching what the real API returns.
 */
export function runtimeWith(updates) {
  return { updates: { edges: updates.map((node) => ({ node })) } };
}
