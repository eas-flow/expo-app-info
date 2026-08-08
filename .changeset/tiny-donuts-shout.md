---
"@my-shelfio/expo-shelfit": major
---

Remove `--json` / `--csv` output modes. The table was the only real consumer of the machine-readable contract, so it's removed rather than frozen going into v1.0.0 — it can return in a future minor release if there's demand.

- `src/args.mjs`: `--json`/`--csv` flags, the mutual-exclusivity check, and their HELP text are gone.
- `src/format.mjs`: `FIELDS`/`USAGE_FIELDS`/`PLAN_FIELDS` and the `formatJSON`/`formatCSV` converters are gone; the table-row converters (`toDisplayRows`, `toUsageDisplayRows`, `toPlanDisplayRows`) are unchanged.
- `src/commands/{list,usage,plan}.mjs`: the JSON/CSV output branches are gone; every mode now always prints the table.
- README/README.ja: "Machine-readable output" section removed, "Output stability" rewritten, Roadmap and FAQ updated.
