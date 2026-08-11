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

/** Single page only; multi-page pagination is covered in test/api.test.mjs. */
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

export function buildsResponse({ ios = [], android = [], appId = 'app-1' } = {}) {
  return jsonResponse({ data: { app: { byId: { id: appId, ios, android } } } });
}
