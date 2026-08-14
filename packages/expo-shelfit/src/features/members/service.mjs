import { ApiError } from '../../errors.mjs';
import { mapWithConcurrency } from '../../shared/concurrency.mjs';
import { clearProgress, progressCount } from '../../shared/terminal/progress.mjs';

const ROLE_OWNER = 'OWNER';

/**
 * Subscription/membership fields are billing- and org-adjacent, so a token
 * that can't read one account's data degrades just that account rather than
 * failing the run. A degraded account emits exactly one row (MEMBER/ROLE/
 * plan cells all "-"), same as the old --plan's per-account degrade — a
 * fetch failure happens before this CLI can even tell whether the account
 * is personal or organizational, so there is no member list to expand into
 * rows.
 *
 * Returns `{ entries, warnings }` — `entries` is ready for
 * features/members/format.mjs#toMembersDisplayRows; `warnings` is a plain
 * string array (no console output here).
 */
export async function fetchMembersEntries(client, accounts) {
  const warnings = [];
  let done = 0;

  const results = await mapWithConcurrency(accounts, async (account) => {
    try {
      return { data: await client.fetchAccountMembers(account.id), error: null };
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      return { data: null, error: err };
    } finally {
      progressCount('Fetching members', ++done, accounts.length, 'accounts');
    }
  });

  clearProgress();

  const entries = [];
  results.forEach(({ data, error }, i) => {
    const account = accounts[i];
    if (error) {
      warnings.push(`${account.name}: ${error.message}`);
      entries.push(degradedEntry(account));
      return;
    }
    // `data` is null when the account itself was missing from an
    // otherwise-2xx response — degrade silently, same as the old
    // fetchSubscription's null-without-warning path.
    if (!data) {
      entries.push(degradedEntry(account));
      return;
    }
    entries.push(...accountEntries(account, data));
  });

  return { entries, warnings };
}

function degradedEntry(account) {
  return {
    account: account.name,
    isPersonal: null,
    member: null,
    role: null,
    ...emptyPlanFields(),
  };
}

function emptyPlanFields() {
  return {
    plan: null,
    planId: null,
    status: null,
    concurrencyTotal: null,
    concurrencyIos: null,
    concurrencyAndroid: null,
    trialEnd: null,
  };
}

function planFields(subscription) {
  if (!subscription) return emptyPlanFields();
  return {
    plan: subscription.name ?? null,
    planId: subscription.planId ?? null,
    status: subscription.status ?? null,
    concurrencyTotal: subscription.concurrencies?.total ?? null,
    concurrencyIos: subscription.concurrencies?.ios ?? null,
    concurrencyAndroid: subscription.concurrencies?.android ?? null,
    trialEnd: subscription.trialEnd ?? null,
  };
}

/** A robot member has no `userActor` (only `User` actors get one); its `actor.firstName` stands in, marked "(robot)" so MEMBER distinguishes it without a separate TYPE column. */
function memberName(member) {
  if (member.userActor) return member.userActor.username;
  return `${member.actor?.firstName ?? '?'} (robot)`;
}

function accountEntries(account, { subscription, ownerUserActor, members }) {
  const plan = planFields(subscription);

  // Personal account: EAS creates one of these per sign-up, so it stays in
  // the table (ORG "-") rather than being filtered out — otherwise a user
  // with no organizations would see an empty table under --members.
  if (ownerUserActor) {
    return [
      {
        account: account.name,
        isPersonal: true,
        member: ownerUserActor.username,
        role: ROLE_OWNER,
        ...plan,
      },
    ];
  }

  // Organization: one row per member. An org always has at least one owner,
  // but an empty list is handled the same way a zero-count group is
  // elsewhere in this CLI — printed as a row, not silently dropped.
  if (members.length === 0) {
    return [{ account: account.name, isPersonal: false, member: null, role: null, ...plan }];
  }

  return members.map((m) => ({
    account: account.name,
    isPersonal: false,
    member: memberName(m),
    role: m.role ?? null,
    ...plan,
  }));
}
