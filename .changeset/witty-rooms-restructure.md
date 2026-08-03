---
"expo-app-info": patch
---

Internal restructure (issue #30): split the display-mode flows out of `src/cli.mjs` into `src/commands/{list,usage,plan}.mjs`, move argument parsing to `src/args.mjs`, and consolidate UTC date helpers into `src/dates.mjs` and progress reporting into `src/progress.mjs`. Pure code moves — no change to the table, `--json`/`--csv` output, error messages, exit codes, or query shapes.
