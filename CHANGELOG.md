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

### Known gaps in this initial cut

- Live-Claude-binary smoke tests, cross-platform CI execution and npm/
  marketplace publication have not been run in this development environment.
- The full `33_ACCEPTANCE_TEST_MATRIX.md` is not yet exhaustively mapped to
  automated tests; unit coverage exists for the profile compiler, router,
  settings-overlay monotonicity, config validation and benchmark statistics.
