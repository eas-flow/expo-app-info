// Shared helpers for the run() integration tests (test/run-*.test.mjs).
// Kept deliberately minimal: only what the display-mode test files
// actually duplicate.

/** A minimal fetch-Response stand-in for mocked GraphQL calls. */
export function jsonResponse(body, { status = 200, ok = true } = {}) {
  return { status, ok, json: async () => body };
}

/** Mock-fetch implementation that returns each response in call order. */
export function fetchSequence(responses) {
  let call = 0;
  return async () => responses[call++];
}

/** fetchAccounts response. */
export function accountsResponse(accounts = [{ id: 'acc-1', name: 'myorg' }]) {
  return jsonResponse({ data: { meActor: { accounts } } });
}

/** Single-page fetchApps response. */
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

/** fetchBuilds / builds-page response for one app. */
export function buildsResponse({ ios = [], android = [], appId = 'app-1' } = {}) {
  return jsonResponse({ data: { app: { byId: { id: appId, ios, android } } } });
}
