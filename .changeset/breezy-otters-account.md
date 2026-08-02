---
'expo-app-info': major
---

**Breaking:** removed the `--account <name>` filter. It is no longer
possible to restrict the run to a single account by its unique slug;
every account the token can see is always fetched. This was removed
rather than extended to also match the account's new EAS "Display name"
(see below) — filtering may return once the shape it should take (slug,
display name, or both) is settled ([#22](https://github.com/eas-flow/expo-app-info/issues/22)).

The human table's `ACCOUNT` column now shows the account's EAS "Display
name" when the account has one set, falling back to its unique slug
otherwise. This part is cosmetic — table only: `--json`/`--csv` always
emit the slug in the `account` field regardless, unchanged, since scripts
may rely on it as a unique key. `--usage`'s `ACCOUNT` column gets the same
table-only treatment.
