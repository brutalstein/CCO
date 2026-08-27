# Documentation claim matrix

Every externally meaningful claim CCO makes (README, plugin description,
marketplace listing) mapped to the evidence that backs it, per root
`CLAUDE.md` section 19. If a claim in README/plugin docs isn't listed here
with a PASS, treat it as unverified and open an issue rather than repeating
it in further marketing copy.

| Claim | Evidence | Status |
|---|---|---|
| Does not persistently rewrite normal Claude settings | `packages/core/src/security/validator.ts` (`validateProfile`/`validateOverlay`), `packages/claude-adapter/src/settings-overlay.ts` (`validateOverlayMonotonic`); manual before/after `settings.json` hash comparison against a live install (see README "Verified in practice") | PASS |
| Never widens permissions | `DefaultSafetyValidator.validateProfile` rejects any overlay containing a `permissions` key — release-blocking, exercised in `packages/claude-adapter/test/settings-overlay.test.ts` and `packages/core/test/profile-compiler.test.ts` ("overlay never contains a permissions key") | PASS |
| Never silently enables a baseline-disabled plugin | `validateOverlayMonotonic` + `DefaultSafetyValidator.validateProfile`'s `UNAUTHORIZED_ENABLEMENT` check; `packages/core/test/profile-compiler.test.ts` D01 | PASS |
| Benchmark trials are safety-validated before launch, same as `cco run` | `apps/cli/src/commands/benchmark.ts` calls `DefaultSafetyValidator` before writing any overlay (fixed in this audit pass); verified against a real Claude Code install | PASS |
| CLI package installs and runs cleanly | `npm pack` + install into a truly isolated directory (own `node_modules`, no monorepo workspace symlinks), `cco --help`/`doctor`/`inventory`/`analyze` run via the real Windows npm shim against a live Claude Code install. A prior pass marked this PASS without this isolation and missed a real npm `404` (unpublished `@cco/*` deps); fixed by bundling the CLI with esbuild (`scripts/build-cli.mjs`) — see CHANGELOG "second whole-project audit pass" | PASS |
| Companion plugin installs additively, doesn't disturb existing plugins | Live `claude plugin marketplace add` / `claude plugin install` run against a real GitHub clone; before/after `claude plugin list --json` diff (see README "Install") | PASS |
| Router is deterministic and abstains on low-confidence/ambiguous/out-of-profile input | `packages/core/test/router.test.ts`, `packages/core/test/router-corpus.test.ts` (19-case labeled corpus: 100% precision among injected decisions, 0 incorrect injections in the current corpus) | PASS (corpus-scale, not adversarial-scale) |
| Token reduction is real, reproducible compiler behavior, not a marketing number | `scripts/demo-savings.mjs`, `packages/core/test/profile-compiler.test.ts`, `packages/core/test/compiler-fixture-matrix.test.ts` (Matrices A-F with reason codes) | PASS |
| Live task quality is preserved (non-inferior) vs native | `benchmarks/published/simple-utility-v1-run_56a34bbd3db70084/summary.json` — **smoke only**: 1 task family, 2 trials/arm | PASS at smoke grade — **not** public-claim grade (see `09_QUALITY_MODEL_AND_EVALS.md` section 4, `BENCHMARKS.md`) |
| General "CCO preserves quality across task types" | — | **NOT SUPPORTED YET.** Only one task family has live evidence. Do not make this claim until additional families (debug/fix, tests, docs, frontend, backend) are run at exploratory-or-better grade. |
| Aggressive-mode pruning is backed by non-inferiority evidence at runtime | `packages/core/src/state/store.ts` (`JsonStateStore.listEvidence`), wired into `cco run`/`task`/`analyze`/`benchmark` and the plugin's real hook entry (`scripts/plugin-hook-entry.mjs`); `packages/core/test/state-store.test.ts`, `packages/core/test/profile-compiler.test.ts` (aggressive-mode suite); live-verified against 3 real `EvidenceRecord`s already on disk from prior live benchmark runs | PASS — `PRUNE_NONINFERIOR_REDUNDANT` is reachable from a real session once matching evidence exists. `DefaultOptimizer`/`DefaultPlanner` (`optimization/optimizer.ts`, `planning/planner.ts`) remain unit-tested library code not called from any live command — no claim is made about those. |
| Cross-platform (Windows/macOS/Linux) build and test | `.github/workflows/ci.yml` green on `ubuntu-latest`, `windows-latest`, `macos-latest` | PASS (CI-verified); only Windows has been manually exercised against a real `claude` binary in this environment |
| No command/shell injection from plugin IDs, paths, or CLI flags | Subprocess calls audited for array-form `execFileSync`/`spawn` args; one interpolated-string PowerShell command in `scripts/package-release.mjs` found and fixed to use env vars instead (this audit pass) | PASS |

## What this matrix does not establish

- No adversarial/red-team routing corpus (the section-8 corpus is a
  representative qualification sample, not an adversarial one).
- No statistically-powered (public-claim-grade) live benchmark sample for
  any task family yet — see `BENCHMARKS.md`'s smoke/exploratory/
  public-claim-grade categorization.
- No third-party security audit of the dependency tree beyond `npm audit`
  (currently 0 findings; see `CHANGELOG.md` for the esbuild/vitest major-
  version bump that resolved the prior 5).
