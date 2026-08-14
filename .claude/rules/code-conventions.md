---
description: What a comment may say, and what may exist in the code at all. Comments explain why and never what; nothing gets added that is already there. Read before writing or reviewing code in any package.
paths:
  - "packages/*/bin/**"
  - "packages/*/src/**"
  - "packages/*/test/**"
---

# Code conventions

## MUST

- **Comment only what the code cannot say for itself.** No restating a
  signature, no narrating control flow.
- **A comment naming another file, function, or API field is a promise** to
  keep both ends in step. Re-read it whenever you touch either end.
- **Check a thing isn't already there before adding it** — no duplicate
  fetch, no defensive layer that can't fire, no option/flag/helper/queried
  field without a consumer, no second way to do one thing.
- **Removing what a change made pointless is part of that change**, not a
  follow-up.

---

## Comments explain why, never what

Code that can be read is not commented. Do not restate a signature, narrate
control flow, or describe what a well-named function obviously does — that
comment is noise on the first read and a lie after the next refactor.

Comment only what the code cannot say for itself: an EAS API behavior
confirmed by probing an undocumented endpoint, a constraint that silently
breaks something if changed (every date boundary staying UTC), a rejected
alternative, a deliberate omission. Keep those short — a sentence or two, not
a JSDoc essay.

A comment naming another file, function, or API field is a promise to keep
both ends in step, and that promise has already been broken here more than
once: a helper documented against modules a refactor had deleted, an API
client crediting the wrong file with `process.exit`, a date helper explaining
a billing field the CLI had stopped querying. Name another file only when the
reader can't follow without it, and re-read those lines whenever you touch
either end.

## Nothing redundant in the code either

The same standard applies to what the code does, not just what it says about
itself. Before adding anything, check it isn't already there:

- **No duplicate work.** A value already fetched or computed is passed along,
  not fetched again — `--group-by app` adds no API call precisely because the
  per-app counts were already in hand.
- **No defensive layers that can't fire.** Don't re-validate what `parseArgs`
  already rejected, don't null-check a value the caller guarantees, don't
  catch an error only to rethrow it unchanged.
- **No option, flag, parameter, helper, or queried field without a
  consumer.** These CLIs are small and zero-dependency on purpose; anything
  that only *might* be needed is not needed. A GraphQL field nothing reads
  is the same mistake as an uncalled helper, and worse in one way: it reads
  as load-bearing and discourages changing the query. Delete it — git
  remembers.
- **No second way to do one thing.** One date formatter, one table renderer,
  one filter path. A near-copy of an existing helper is a sign the original
  needed a parameter, not a sibling.

When a change makes existing code unreachable or pointless, removing it is
part of that change, not a follow-up.
