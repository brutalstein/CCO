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

### Fixed (dependency security)

- Resolved all 5 `npm audit` findings (3 moderate, 1 high, 1 critical) in
  the esbuild/vite/vitest transitive dev-tooling chain by bumping esbuild
  and vitest to their next major versions. Dev-tooling only, never shipped
  in the runtime bundle, but a clean upgrade was available (0 test/lint/
  build regressions), so fixed rather than left as an accepted gap.

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

### Fixed (second whole-project audit pass)

- `claude plugin details` real CLI output includes a `Description:` line, but
  the parser chain (`parsePluginDetailsText`/`parsePluginDetailsJson`)
  discarded it entirely, so `graph/builder.ts` tagged every plugin from its
  bare name alone (`extractTags(plugin.name, plugin.name, ...)`). Generically
  named plugins like `clangd-lsp` got zero tags. Plumbed `description` through
  `PluginDetailsSource` -> `InventorySnapshot.pluginDetails` -> tag
  extraction. Verified against a live install: `clangd-lsp`'s real
  description now yields a tag where it previously yielded none.
- `optimization.safePruneAffinityMax`/`metadataConfidenceMin`
  (`packages/core/src/config/validate.ts`) gate `DefaultProfileCompiler`'s
  prune-safety decision directly but were accepted unbounded from user
  config, unlike every other safety-relevant numeric field. Added `[0, 1]`
  range validation.
- README claimed `cco init` "installs the small companion plugin"; the real
  `cmdInit` (`apps/cli/src/commands/init.ts`) only probes the Claude install
  and writes local CCO config — it never calls plugin install. Corrected the
  README claim and `cco init`'s own guidance text (which pointed only at a
  dev-only `--plugin-dir` flow) to reference the real public two-command
  install path. Verified `cco init` is idempotent against a live install
  (byte-identical output across two runs).
- **CLI package was not actually installable outside the monorepo.**
  `apps/cli/package.json` declared `@cco/core`/`@cco/claude-adapter`/
  `@cco/platform`/`@cco/report`/`@cco/benchmark` as ordinary npm dependencies;
  none are published, so `npm install` of the `npm pack` tarball in a real
  isolated environment failed immediately with an npm `404`. This directly
  contradicted the "CLI package installs and runs cleanly" claim in
  `docs/CLAIMS.md`, which had evidently never been verified via a truly
  isolated install. Fixed by bundling the CLI into a single self-contained
  `dist/bundle.js` with esbuild (`scripts/build-cli.mjs`), same technique
  already used for the plugin hook bundle. Re-verified end-to-end: fresh
  `npm pack` -> isolated `npm install` -> real `cco --help/doctor/inventory/
  analyze` via the actual Windows npm shim, against a live Claude Code
  install.

### Fixed (evidence pipeline wiring)

- `EvidenceRecord`/`EvidenceIndex` were fully implemented and unit-tested
  but no real command ever populated them: `cco run`/`task`
  (`process-launch.ts`), `cco analyze`, `cco benchmark run`'s own candidate
  compile, the CLI's `__hook` command, and — the one that actually matters
  for real installed-plugin sessions — the plugin's bundled hook entry
  (`scripts/plugin-hook-entry.mjs`) all hardcoded
  `evidence: { records: [] }`. This made `PRUNE_NONINFERIOR_REDUNDANT`
  permanently unreachable in aggressive mode and silently zeroed the
  router's `evidencePrior` scoring factor on every prompt. Added
  `JsonStateStore.listEvidence()` and wired all six call sites to it.
  Verified with new unit tests (`state-store.test.ts`, an aggressive-mode
  suite in `profile-compiler.test.ts`) and live, against 3 real
  `EvidenceRecord`s already on this machine from prior live benchmark runs.

### Known gaps in this initial cut

- npm/marketplace publication has not been run. One benchmark suite
  (`simple-utility-v1`) has been run against a live `claude` binary
  (`benchmarks/published/`) — smoke-level only (2 trials/arm, one task
  family). Additional task families (debug/fix, tests, documentation,
  frontend, backend) and public-claim-grade sample sizes (root `CLAUDE.md`
  sections 11-12) are not yet run; treat every current benchmark claim as
  smoke/exploratory, not public-claim grade.
- `DefaultOptimizer`/`DefaultPlanner` (`packages/core/src/optimization/
  optimizer.ts`, `packages/core/src/planning/planner.ts`) remain unit-tested
  library code with no live caller — no claim is made that CCO's shipped
  commands use Pareto/lexicographic execution-plan selection today.
- The full `33_ACCEPTANCE_TEST_MATRIX.md` is not yet exhaustively mapped to
  automated tests; unit coverage exists for the profile compiler (including
  the section-9 fixture matrix), router (including the section-8
  qualification corpus), settings-overlay monotonicity, config validation
  and benchmark statistics.
