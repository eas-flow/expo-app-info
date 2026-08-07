---
"expo-app-info": patch
---

Simplify verbose source comments (issue #35): compress long-form rationale in `scripts/probe-*.mjs`, `src/api.mjs`, `src/args.mjs`, and `src/cli.mjs` into shorter conclusion + why notes instead of re-explaining API behavior already documented elsewhere. Comment-only change — no change to logic, output, or the `--json`/`--csv` contract.
