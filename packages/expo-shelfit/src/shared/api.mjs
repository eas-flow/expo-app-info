// EAS GraphQL client. No process.exit/console here — every failure throws ApiError;
// bin/cli.mjs is the only place that turns errors into exit codes and messages.

import { ApiError } from '../errors.mjs';
import { progress } from './terminal/progress.mjs';

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

const ALL_PLATFORMS = ['ios', 'android'];

// One `ios:`/`android:` aliased `builds(...)` field per requested platform, so
// a caller that only wants one doesn't pay for fetching and discarding the
// other. `--platform` is the caller-facing switch.
//
// `status` is deliberately omitted from `filter` — confirmed against the real
// API that leaving it out returns builds in every status, not just FINISHED,
// and that the field isn't required. Filtering client-side afterwards would
// throw away exactly what the STATUS column exists to show.
function buildAliases(platforms, { offset, fields }) {
  return platforms
    .map(
      (p) =>
        `${p}: builds(offset: ${offset}, limit: $limit, filter: { platform: ${p.toUpperCase()} }) { ${fields} }`
    )
    .join('\n    ');
}

// `RuntimeUpdatesFilterInput` carries only `channel` — there is no platform
// filter — so one runtime's page mixes iOS and Android updates and
// latestRuntimeUpdate picks its own out. Asking for 1 would therefore return
// the other platform's update half the time; 10 covers several publishes to
// both platforms.
const RUNTIME_UPDATE_PAGE_SIZE = 10;

// SUBMIT and UPDATE are sub-selections of `builds` rather than aliases of
// `app.submissions`/`app.updateGroups`, so each build row carries its own —
// still one request per app.
//
// `Build.submissions` is the reverse of `Submission.submittedBuild`: exactly
// the submissions of *that* build attempt, so the association needs no
// matching on the client. `completedAt` is deliberately not queried — it
// stays null even for a FINISHED submission (confirmed against the real
// API), so the SUBMIT column's date comes from `createdAt`, the same field
// builds and updates use.
//
// An OTA update has no build to belong to — it targets a *runtime version* —
// so `Build.runtime`'s updates are the closest true association: what has
// been published to the runtime this build shipped. A build with no runtime
// (`runtime` is nullable) simply has no UPDATE. `Update.branch` is itself an
// object (`UpdateBranch!`, not a plain string) — the API rejects a bare
// `branch` with "must have a selection of subfields" — so `{ name }` is
// required; latestRuntimeUpdate reads `.branch.name` back out.
function appOverviewQuery(platforms) {
  const aliases = platforms.map(
    (p) =>
      `${p}Builds: builds(offset: 0, limit: $limit, filter: { platform: ${p.toUpperCase()} }) {
      platform status appVersion appBuildVersion sdkVersion cliVersion createdAt
      submissions { status createdAt }
      runtime { updates(first: ${RUNTIME_UPDATE_PAGE_SIZE}) { edges { node { platform branch { name } createdAt } } } }
    }`
  );

  return `query AppOverview($appId: String!, $limit: Int!) {
  app { byId(appId: $appId) { id
    ${aliases.join('\n    ')}
  } }
}`;
}

const byNewest = (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

/** The most recent attempt, so a build re-submitted after a failure reads as its retry. */
function latestSubmission(submissions) {
  const [latest] = [...submissions].sort(byNewest);
  return latest ? { status: latest.status, createdAt: latest.createdAt } : null;
}

/**
 * The runtime's page holds both platforms' updates (see
 * RUNTIME_UPDATE_PAGE_SIZE), so the build's own platform is matched here
 * rather than assumed.
 */
function latestRuntimeUpdate(runtime, platform) {
  // Case-folded because the two ends disagree: `Build.platform` is the
  // `AppPlatform` enum ("IOS"), `Update.platform` is a plain `String!`
  // ("ios"). Comparing them directly matches nothing and empties the UPDATE
  // column for every row — silently, since "no update yet" is a legitimate
  // result. Folding also survives EAS changing the string's case.
  const wanted = platform?.toUpperCase();
  const [latest] = (runtime?.updates?.edges ?? [])
    .map((edge) => edge.node)
    .filter((update) => update.platform?.toUpperCase() === wanted)
    .sort(byNewest);
  return latest ? { branch: latest.branch?.name ?? null, createdAt: latest.createdAt } : null;
}

// Well under whatever cap the API enforces on membersPaginated; kept the
// same as BUILD_PAGE_SIZE's role for builds — one page covers almost every
// account, and paging is cheap when it's not.
const MEMBERS_PAGE_SIZE = 100;

// subscription + membership fields all live on Account, so one query covers
// --members entirely — no extra request even when an org's members need a
// second page. Billing-scoped `subscription`, so a token without billing
// permission errors per account; the CLI degrades that to "-" rather than
// failing the run. No price field: not confirmed to exist against a real
// token. `--stats` deliberately queries none of this, since billing-period
// metrics can't be sliced into calendar ranges.
//
// `ownerUserActor` is non-null exactly for personal accounts (confirmed
// against the real API) — organizations have no single owning user. A
// member's `userActor` is set only when that member is a human (`User`);
// a robot member has `userActor: null` and is named via `actor`'s `Robot`
// fragment instead. This inline fragment is safe on `actor` (typed `Actor`,
// the real interface) even though the same fragment on `ownerUserActor`
// (typed `UserActor`, not `Actor`) fails with "can never be of type
// Robot" — confirmed by probing the real API.
const Q_ACCOUNT_MEMBERS = `query AccountMembers($accountId: String!, $after: String) {
  account { byId(accountId: $accountId) { id
    subscription {
      id planId name status trialEnd
      concurrencies { total ios android }
    }
    ownerUserActor { id username }
    membersPaginated(first: ${MEMBERS_PAGE_SIZE}, after: $after) {
      edges { node { id role userActor { id username } actor { id ... on Robot { firstName } } } }
      pageInfo { hasNextPage endCursor }
    }
  } }
}`;

// The old buildsQuery's shape (now appOverviewQuery's `<platform>Builds`
// alias), paginated by `offset` so --stats can walk arbitrarily far back, and
// without the version fields --stats never displays.
function buildsPageQuery(platforms) {
  return `query BuildsPage($appId: String!, $offset: Int!, $limit: Int!) {
  app { byId(appId: $appId) { id
    ${buildAliases(platforms, { offset: '$offset', fields: 'status createdAt metrics { buildDuration }' })}
  } }
}`;
}

// Well under the `limit: 100` confirmed accepted by the API.
const BUILD_PAGE_SIZE = 50;

// Hard stop in case the API's undocumented offset behavior stops holding (e.g.
// it keeps returning the same full page) — 10k builds/app, past any realistic
// --month window.
const MAX_BUILD_PAGES = 200;

/** Parsed once so monthIndexForBuild compares numbers instead of re-parsing. */
function toMonthBounds(months) {
  return months.map((m) => ({ startMs: Date.parse(m.start), endMs: Date.parse(m.end) }));
}

/** -1 when the build falls outside every requested month, or `createdAt` was NaN. */
function monthIndexForBuild(createdAtMs, bounds) {
  for (let i = 0; i < bounds.length; i++) {
    if (createdAtMs >= bounds[i].startMs && createdAtMs < bounds[i].endMs) {
      return i;
    }
  }
  return -1;
}

// Only these 3 have been confirmed against the real API. Anything else — a
// queued build, or a status this unofficial API adds later — is counted in
// no bucket rather than guessed at, since it hasn't reached a terminal
// outcome.
const STATUS_COUNT_KEY = { FINISHED: 'success', ERRORED: 'errored', CANCELED: 'canceled' };

function emptyStatusCounts() {
  return { success: 0, errored: 0, canceled: 0, buildDurationMs: 0 };
}

/**
 * A factory rather than module-scoped state, so tests can spin up an isolated
 * client per test with a mocked `fetchImpl`.
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
   * Builds, each with the submission that shipped it and the latest update
   * published to its runtime — one app.byId query, same request count as the
   * old builds-only fetch.
   *
   * `builds` is the `limit` most recent build *attempts* per platform
   * *regardless of status*, so a platform whose latest attempt errored or
   * was canceled surfaces that build instead of falling back to an older
   * successful one — same contract the old fetchBuilds had. `platform`
   * narrows which aliases are even requested, rather than fetching both and
   * discarding one.
   *
   * Each build's `submission`/`update` is null when it has none, so an
   * unsubmitted build reads as "-" rather than borrowing a newer build's
   * value. The raw `submissions`/`runtime` sub-selections are folded away
   * here — nothing downstream has to know an update lives under a runtime,
   * or that `branch` is an object rather than a string.
   *
   * The API's ordering is undocumented everywhere, so every slice is sorted
   * here rather than trusted.
   */
  async function fetchAppOverview(appId, { limit = 1, platform } = {}) {
    const platforms = platform ? [platform] : ALL_PLATFORMS;
    const data = await gql(appOverviewQuery(platforms), { appId, limit });
    const app = data?.app?.byId;
    if (!app || !platforms.every((p) => Array.isArray(app[`${p}Builds`]))) {
      throw new ApiError(`AppOverview: unexpected response shape for app ${appId}`);
    }

    const builds = platforms.flatMap((p) => [...app[`${p}Builds`]].sort(byNewest));
    if (builds.some((b) => !Array.isArray(b.submissions))) {
      throw new ApiError(`AppOverview: unexpected response shape for app ${appId}`);
    }

    return {
      builds: builds.map(({ submissions, runtime, ...build }) => ({
        ...build,
        submission: latestSubmission(submissions),
        update: latestRuntimeUpdate(runtime, build.platform),
      })),
    };
  }

  /**
   * Build counts for one app, bucketed by platform and UTC calendar month:
   * `months` in, `{ counts, missingMetricsCount }` out — `counts` is a
   * parallel array of `{ ios, android }` counts (each with a summed
   * `buildDurationMs`), `missingMetricsCount` is how many counted builds
   * (STATUS_COUNT_KEY only) had no `metrics.buildDuration` to add. A build in
   * a status STATUS_COUNT_KEY doesn't list falls into no bucket, and isn't
   * counted as missing metrics either — it was never counted at all.
   *
   * Each platform stops paging independently, once a page comes back short or
   * every build in it predates the oldest requested month — the latter relies
   * on the API's undocumented order holding newest-first, as observed by
   * probing. A finished platform's alias is dropped from subsequent queries
   * rather than skipped client-side.
   *
   * Throws ApiError; src/features/stats/service.mjs#fetchStatsEntries degrades
   * that account's rows rather than failing the run.
   */
  async function countBuildsByMonth(appId, months, { platform } = {}) {
    const bounds = toMonthBounds(months);
    const counts = months.map(() => ({ ios: emptyStatusCounts(), android: emptyStatusCounts() }));
    const oldestStartMs = bounds[bounds.length - 1].startMs;
    let missingMetricsCount = 0;

    let offset = 0;
    let pageCount = 0;
    let pending = ALL_PLATFORMS.filter((p) => !platform || p === platform);

    while (pending.length > 0) {
      if (++pageCount > MAX_BUILD_PAGES) {
        throw new ApiError(
          `BuildsPage: exceeded ${MAX_BUILD_PAGES} pages for app ${appId} without pagination ending as expected`
        );
      }

      const data = await gql(buildsPageQuery(pending), { appId, offset, limit: BUILD_PAGE_SIZE });
      const page = data?.app?.byId;
      if (!page || pending.some((p) => !Array.isArray(page[p]))) {
        throw new ApiError(`BuildsPage: unexpected response shape for app ${appId}`);
      }

      const stillPending = [];
      for (const p of pending) {
        const builds = page[p].map((b) => ({
          ms: Date.parse(b.createdAt),
          status: b.status,
          durationMs: typeof b.metrics?.buildDuration === 'number' ? b.metrics.buildDuration : null,
        }));

        for (const { ms, status, durationMs } of builds) {
          const i = monthIndexForBuild(ms, bounds);
          if (i === -1) continue;
          const key = STATUS_COUNT_KEY[status];
          if (!key) continue;
          counts[i][p][key]++;
          if (durationMs === null) missingMetricsCount++;
          else counts[i][p].buildDurationMs += durationMs;
        }

        const exhausted = builds.length < BUILD_PAGE_SIZE;
        const pastOldest = builds.length > 0 && builds.every(({ ms }) => ms < oldestStartMs);
        if (!exhausted && !pastOldest) stillPending.push(p);
      }
      pending = stillPending;

      offset += BUILD_PAGE_SIZE;
    }

    return { counts, missingMetricsCount };
  }

  /**
   * Subscription + personal-vs-organization + membership info for one
   * account, paginating `membersPaginated` when an org exceeds
   * MEMBERS_PAGE_SIZE. Returns `null` (not a throw) when the account itself
   * is missing from an otherwise-2xx response — mirrors the old
   * `fetchSubscription`'s degrade-gracefully behavior, since
   * src/features/members/service.mjs treats a missing account as non-fatal,
   * same as a genuinely failed one.
   *
   * Throws ApiError for a GraphQL error (via `gql`) or a malformed
   * mid-pagination response — src/features/members/service.mjs degrades
   * that account's row rather than failing the run.
   */
  async function fetchAccountMembers(accountId) {
    let after = null;
    let result = null;
    const members = [];

    for (;;) {
      const data = await gql(Q_ACCOUNT_MEMBERS, { accountId, after });
      const account = data?.account?.byId;
      if (!account) return null;

      if (!result) {
        result = {
          subscription: account.subscription ?? null,
          ownerUserActor: account.ownerUserActor ?? null,
        };
      }

      const page = account.membersPaginated;
      if (!page || !Array.isArray(page.edges)) {
        throw new ApiError(`AccountMembers: unexpected response shape for account ${accountId}`);
      }
      members.push(...page.edges.map((e) => e.node));

      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor;
    }

    return { ...result, members };
  }

  return {
    gql,
    fetchAccounts,
    fetchApps,
    fetchAppOverview,
    fetchAccountMembers,
    countBuildsByMonth,
  };
}
