# Benchmarks

Every performance/quality claim CCO makes publicly must map to a reproducible
benchmark artifact in this repository (`NFR-010`). This file is the index of
published results; it intentionally starts empty.

## Status

One suite (`simple-utility-v1`) has been run against a real, live Claude Code
CLI install (see the published result below): 2 trials per arm, a small
single-file JavaScript edit task, `baseline` (native) vs `candidate` (CCO's
compiled profile for this repository). Both arms completed the task in every
trial (0 observed quality delta). This is a real live smoke result, but two
trials are below the exploratory evidence floor and therefore do not establish
statistical non-inferiority or authorize profile promotion.

The published smoke artifact predates the v2 applicability contract. It remains
readable and reproducible historical evidence, but it cannot authorize current
aggressive pruning. New promotion-eligible records must carry the exact candidate
semantics, capability set, runtime/model/task scope, algorithm versions,
`newcombe-wilson-v1` method, deterministic-regression result, and tolerance policy.

That run's measured token delta between arms was not large enough to be
distinguishable from cache-variance noise at 2 trials, because on the
machine it ran on almost every installed plugin was already relevant to the
repository (little was actually prunable there — see the caveat in
`README.md`'s "Real numbers" section). The `scripts/demo-savings.mjs`
example makes the pruning behavior itself easy to verify directly against
the shipped compiler code, independent of any one machine's installed
plugin set.

While building this suite, two real defects in the benchmark harness were
found and fixed by actually running it live (never previously exercised
against a real `claude` binary): `--output-format stream-json` requires
`--verbose` in headless `-p` mode or the CLI errors immediately, and headless
trials need an explicit `--permission-mode` or file edits are silently
denied. Both fixes are in `packages/claude-adapter/src/current.ts` and
`packages/benchmark/src/runner.ts`.

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
| 2026-08-26 | `simple-utility-v1` | 2.1.246 | native, 2 trials, 2/2 success | CCO safe profile, 2 trials, 2/2 success | smoke pass; not statistical non-inferiority | not distinguishable from noise at n=2 on this machine's plugin set | `benchmarks/published/simple-utility-v1-run_56a34bbd3db70084/summary.json` |
