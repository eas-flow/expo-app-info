// Shared helpers for the run() integration tests (test/run-*.test.mjs).
// Kept deliberately minimal: only what all three display-mode test files
// actually duplicate (issue #30).

/** A minimal fetch-Response stand-in for mocked GraphQL calls. */
export function jsonResponse(body, { status = 200, ok = true } = {}) {
  return { status, ok, json: async () => body };
}
