# Benchmarks

Every performance/quality claim CCO makes publicly must map to a reproducible
benchmark artifact in this repository (`NFR-010`). This file is the index of
published results; it intentionally starts empty.

## Status

No public benchmark artifacts have been published yet. This initial
implementation has not been run against a live Claude Code binary in its
development environment, so no savings/quality percentage is claimed here.
Do not cite a number for CCO's token savings or quality non-inferiority until
an entry appears below with an artifact under `benchmarks/published/`.

## How results get here

1. Define or select a suite under `benchmarks/suites/` (task family,
   validator commands, trial count, tolerance).
2. Run `cco benchmark run <suite> --candidate <profile> --baseline native
   --trials N --json`, in a disposable workspace (worktree or copy
   isolation - the harness refuses a dirty working directory).
3. `cco benchmark show <run-id>` / `cco benchmark export <run-id> --out
   benchmarks/published/<run-id>` to attach the raw, inspectable result.
4. Add a row below linking to the exported artifact. Non-inferiority must be
   satisfied (`09_QUALITY_MODEL_AND_EVALS.md`) before a "safe to prune"
   claim is made for that task family.
5. Editing a published suite's prompts/checks in place is not allowed
   (`27_OPEN_SOURCE_GOVERNANCE.md` section 7) - bump the suite version and
   publish a new artifact instead.

## Published results

| Date | Suite | Claude version | Baseline | Candidate | Quality | Token delta | Artifact |
|---|---|---|---|---|---|---|---|
| _none yet_ | | | | | | | |
