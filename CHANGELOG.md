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

### Fixed (CI)

- `npm run lint` calls `eslint`, but `eslint` was never listed as a
  devDependency, so `npm ci` never installed it and CI failed at the lint
  step on every run since the repository was published. Added the
  dependency and verified a green run on ubuntu-latest, windows-latest, and
  macos-latest.

### Fixed (whole-project audit, root `CLAUDE.md` release qualification pass)

- `apps/cli/src/commands/benchmark.ts` built and wrote a candidate settings
  overlay to disk without ever calling `DefaultSafetyValidator`, unlike
  `cco run`'s launch path — a benchmark trial is still a real Claude launch
  and could not have caught an unauthorized-enablement or leaked
  `permissions` regression. Fixed and verified against a real Claude Code
  install (both arms passed validation and completed).
- `graph/tags.ts`'s keyword-to-tag matching used naive substring
  `includes()`, so short keywords silently matched inside unrelated words:
  `'ts '` matched inside "tests", "commits", "artifacts", "requests"
  (falsely tagging `lang:typescript`); `'design'` as a `domain:frontend-ui`
  keyword matched "design a database schema" / "design a REST API". Found
  via constructing the router qualification corpus below, not by
  inspection. Replaced with whole-word/whole-phrase boundary matching
  (`hasWholeWordMatch`) across the entire dictionary and dropped the
  over-generic `'design'` keyword.
- `packages/core/src/profile/compiler.ts`: removed a tautological
  `n.id === n.id &&` filter clause (always true, no effect) in
  `runtimeCapabilityIds` computation.
- `packages/platform/src/atomic-files.ts`'s `readJsonIfExists` had an
  ENOENT/non-ENOENT branch that both returned `null` — collapsed into one
  documented fail-open path.
- `apps/cli/src/commands/data.ts`'s `data export` didn't catch a missing
  state directory, unlike its config-directory copy in the same command.
- `scripts/package-release.mjs` built its Windows `Compress-Archive`
  PowerShell command via unescaped string interpolation; switched to
  passing paths through environment variables (root `CLAUDE.md` section 18:
  prefer argument arrays over shell construction). Inputs were always
  locally-derived, not attacker-controlled, so this was a hardening fix,
  not an exploited vulnerability.

### Added (release qualification evidence)

- `packages/core/test/router-corpus.test.ts`: a labeled router qualification
  corpus (root `CLAUDE.md` section 8) — clear, short/ambiguous,
  multilingual, domain-overlap, generic-name, near-duplicate, and
  out-of-profile cases. Current result: 19 cases, 100% precision among
  injected decisions, 0 incorrect injections, 1 confirmed out-of-profile
  abstention. Documents, rather than hides, that the intent classifier is
  an English keyword dictionary with no translation/embeddings, so
  non-English prompts correctly abstain instead of mis-routing.
- `packages/core/test/compiler-fixture-matrix.test.ts`: the six deterministic
  compiler fixture matrices from root `CLAUDE.md` section 9 (all-relevant,
  strongly-mixed, many-opaque, explicit-dependencies, generic-names/rich-tags,
  partial-metadata), each reporting baseline cost by provenance, selected/
  pruned/uncertain capabilities, and reason codes.

### Known gaps in this initial cut

- npm/marketplace publication has not been run. One benchmark suite
  (`simple-utility-v1`) has been run against a live `claude` binary
  (`benchmarks/published/`) — smoke-level only (2 trials/arm, one task
  family). Additional task families (debug/fix, tests, documentation,
  frontend, backend) and public-claim-grade sample sizes (root `CLAUDE.md`
  sections 11-12) are not yet run; treat every current benchmark claim as
  smoke/exploratory, not public-claim grade.
- `DefaultQualityGate`/`EvidenceIndex` (`packages/core/src/quality/gate.ts`)
  is implemented and unit-reachable but not wired into any live code path —
  `cco run`/`cco task`/`cco benchmark` all pass `evidence: { records: [] }`
  unconditionally, and `optimization.quality.minExploratoryTrialsPerArm` /
  `publicClaimTrialsPerArm` config values are validated by schema but never
  read at runtime. Aggressive-mode non-inferiority pruning
  (`PRUNE_NONINFERIOR_REDUNDANT`) is therefore currently unreachable from
  any real session.
- `npm audit` reports 5 pre-existing vulnerabilities (3 moderate, 1 high, 1
  critical) in the esbuild/vite/vitest transitive dev-tooling chain —
  build/test tooling only, not shipped runtime code.
- The full `33_ACCEPTANCE_TEST_MATRIX.md` is not yet exhaustively mapped to
  automated tests; unit coverage exists for the profile compiler (including
  the section-9 fixture matrix), router (including the section-8
  qualification corpus), settings-overlay monotonicity, config validation
  and benchmark statistics.
