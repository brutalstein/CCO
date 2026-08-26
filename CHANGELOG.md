# Changelog

All notable changes to this project are documented in this file. Format
loosely follows [Keep a Changelog](https://keepachangelog.com/), versioning
follows the rules in `25_INSTALLATION_DISTRIBUTION_RELEASE.md` section 5.

## [1.0.0] - Unreleased

### Added

- Initial implementation of the CCO CLI (`apps/cli`): `init`, `doctor`,
  `inventory`, `analyze`, `run`, `task`, `explain`, `profile`, `audit`,
  `benchmark`, `tune`, `rate`, `config`, `data`, and the internal `__hook`
  command.
- `packages/platform`: OS-appropriate paths, atomic JSON/JSONL file I/O,
  process launcher with signal forwarding.
- `packages/claude-adapter`: version-family probing, plugin inventory/details
  parsing, settings-overlay builder with monotonicity validation, hook
  input/output codec, stream-JSON parsing, current + fake adapters.
- `packages/core`: capability graph builder, repository fingerprinting,
  session profile compiler, deterministic lexical intent classifier and
  runtime router/planner, Pareto + lexicographic optimizer, non-inferiority
  quality gate, local JSON/JSONL state store, redacting telemetry writer.
- `packages/report`: human-readable renderers for doctor/inventory/analyze/
  explain output.
- `packages/benchmark`: isolated baseline-vs-candidate benchmark runner with
  non-inferiority statistics.
- `plugin/cco`: minimal Claude Code plugin — `SessionStart` /
  `UserPromptSubmit` / `SessionEnd` hooks backed by a self-contained esbuild
  bundle, plus four user-invoked diagnostic skills
  (`status`, `explain`, `audit`, `profile`).

### Fixed

Found and fixed by actually running CCO against a live Claude Code install,
not by inspection:

- Plugin manifest declared `hooks` redundantly with Claude Code's own
  convention-based `hooks/hooks.json` autoload, causing a duplicate-hooks
  load error on install.
- `graph/tags.ts`'s auto-extracted domain tags (`domain:frontend`) never
  matched the domain tags `RepoFingerprint.domains` actually produces
  (`domain:frontend-ui`), so repo-affinity KEEP decisions for auto-tagged
  plugins never fired. See `packages/core/test/repo-affinity.test.ts`.
- The benchmark harness's headless `claude -p` invocations had no
  `--permission-mode`, so file edits were silently permission-denied in
  every trial, and `--output-format stream-json` without `--verbose` makes
  the real CLI exit immediately with an error — both meant no benchmark
  trial had ever actually completed a task.
- `claude plugin details <id>` has no `--json` mode on the real CLI (only
  `-h/--help`); the adapter was requesting one anyway, so cost/component
  data for every real installed plugin was silently lost and every plugin
  fell back to `KEEP_UNCERTAIN`. Replaced with a parser for the CLI's actual
  human-readable output (`packages/claude-adapter/src/plugin-details.ts`),
  including locale-grouped numbers (`~1.420 tok`). Verified against 11 real
  plugins on a live install.

### Known gaps in this initial cut

- Cross-platform CI execution and npm/marketplace publication have not been
  run in this development environment. One benchmark suite has been run
  against a live `claude` binary (`benchmarks/published/`); broader suite
  coverage is still open.
- The full `33_ACCEPTANCE_TEST_MATRIX.md` is not yet exhaustively mapped to
  automated tests; unit coverage exists for the profile compiler, router,
  settings-overlay monotonicity, config validation and benchmark statistics.
