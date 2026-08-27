# P0 Correctness Hardening Implementation Plan

> Execute in order. Every behavior change starts with a failing regression test.

**Goal:** Close P0-1 through P0-5 while preserving native fail-open behavior and
all existing safety guarantees.

**Architecture:** Pure core functions own semantic certainty, normalized inventory
state, repository identity, evidence applicability, and compiler preflight. CLI and
plugin flows orchestrate those shared functions without duplicating decisions.

**Stack:** TypeScript, Node.js, Vitest, JSON Schema generation, esbuild packaging.

---

## Task 1: Version the changed contracts

**Files:**

- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/state-store.test.ts`

1. Add a failing compatibility test proving legacy evidence remains readable but
   is distinguishable from current evidence.
2. Add independent semantic-certainty fields, inventory baseline-state hash,
   repository input hash, profile semantic hash/fallback reasons, and structured
   v2 evidence types.
3. Increment only the affected schema/optimizer/graph identifiers.
4. Run `npm test -- --run packages/core/test/state-store.test.ts`.

## Task 2: Make semantic certainty explicit

**Files:**

- Modify: `packages/core/src/graph/tags.ts`
- Modify: `packages/core/src/graph/builder.ts`
- Modify: `packages/core/src/profile/compiler.ts`
- Modify: `packages/core/src/profile/reasons.ts`
- Add: `packages/core/test/semantic-certainty.test.ts`
- Modify: `packages/core/test/profile-compiler.test.ts`
- Modify: `packages/core/test/compiler-fixture-matrix.test.ts`

1. Add real builder-to-compiler failing tests for required cases A-F.
2. Implement deterministic semantic-unit classification and plugin-envelope
   aggregation, independent of token-cost knowledge.
3. Require positive semantic coverage/confidence for structural pruning.
4. Preserve pins, dependency restoration, protected/managed handling, and
   baseline-disabled behavior.
5. Run focused graph/compiler tests.

## Task 3: Bind inventory cache to live state

**Files:**

- Modify: `packages/claude-adapter/src/interface.ts`
- Modify: `packages/claude-adapter/src/plugin-list.ts`
- Modify: `packages/claude-adapter/src/current.ts`
- Modify: `packages/claude-adapter/src/fake.ts`
- Modify: `packages/core/src/inventory/service.ts`
- Add: `packages/core/test/inventory-service.test.ts`
- Modify: `packages/claude-adapter/test/plugin-list.test.ts`

1. Add failing tests for ordering stability, install/uninstall, enabled/version/
   managed changes, unchanged-state reuse, probe failure, and legacy cache.
2. Implement a pure canonical baseline normalizer/hash.
3. Probe the live list before cache reuse and refresh details only after mismatch.
4. Treat failures and legacy cache entries conservatively.
5. Run adapter and inventory focused tests.

## Task 4: Bind repository identity to bounded content

**Files:**

- Modify: `packages/core/src/repo/fingerprint.ts`
- Modify: `packages/core/src/config/defaults.ts`
- Modify: `packages/core/src/config/validate.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `apps/cli/src/process-launch.ts`
- Modify: `apps/cli/src/commands/analyze.ts`
- Modify: `apps/cli/src/commands/benchmark.ts`
- Modify: `packages/core/test/repo-fingerprint.test.ts`
- Modify: `packages/core/test/config-validate.test.ts`

1. Add failing content-change, canonical JSON, privacy, symlink, cap/partial,
   containment, fixture-regression, and determinism tests.
2. Hash canonical JSON or bounded inspected bytes and aggregate sorted relative
   path/digest pairs without persisting content or absolute paths.
3. Reject symlink inputs and enforce root containment.
4. Pass configured scan bounds through every CLI path.
5. Remove the inert public `deepScan` contract while accepting the legacy key.
6. Run repository/config/CLI focused tests.

## Task 5: Centralize strict evidence applicability

**Files:**

- Add: `packages/core/src/quality/evidence.ts`
- Modify: `packages/core/src/quality/gate.ts`
- Modify: `packages/core/src/profile/compiler.ts`
- Modify: `packages/core/src/routing/scoring.ts`
- Modify: `apps/cli/src/commands/benchmark.ts`
- Modify: `apps/cli/src/commands/tune.ts`
- Add: `packages/core/test/evidence-applicability.test.ts`
- Modify: `packages/core/test/profile-compiler.test.ts`
- Modify: `packages/core/test/router.test.ts`
- Modify: `packages/benchmark/src/stats.ts`

1. Add one failing test for every required mismatch dimension and an exact-match
   positive test.
2. Implement pure applicability evaluation with explicit rejection reasons.
3. Eliminate `suiteId` parsing and generic evidence priors.
4. Make compiler, quality gate, routing, tuning, CLI, and hook consumers use the
   same applicability result.
5. Persist new benchmark evidence with explicit algorithm/statistical metadata.
6. Run evidence/compiler/router/benchmark focused tests.

## Task 6: Enforce native fallback for partial or stale inputs

**Files:**

- Modify: `packages/core/src/profile/compiler.ts`
- Modify: `packages/core/src/security/validator.ts`
- Modify: `packages/core/src/hooks/handler.ts`
- Modify: `apps/cli/src/process-launch.ts`
- Modify: `apps/cli/src/commands/analyze.ts`
- Modify: `apps/cli/src/commands/benchmark.ts`
- Modify: `packages/core/test/hook-safety.test.ts`
- Modify: `apps/cli/test/process-launch.test.ts`

1. Add failing tests for partial inventory/repository, stale graph, algorithm
   mismatch, unsupported environment, and invalid integrity.
2. Implement centralized compiler preflight and machine-readable fallback reasons.
3. Make non-strict launch omit the overlay and strict launch fail explicitly.
4. Ensure analyze/benchmark/hook flows preserve the same outcome.
5. Run focused safety tests and rebuild the plugin bundle.

## Task 7: Align schemas and documentation

**Files:**

- Modify: `scripts/generate-schemas.mjs`
- Modify: `schemas/*.schema.json`
- Add: `schemas/evidence.schema.json`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `BENCHMARKS.md`
- Modify: `docs/CLAIMS.md`
- Modify: `CHANGELOG.md`

1. Update generated schemas to exactly describe current v2 contracts.
2. Run `npm run generate:schemas` and require a deterministic second run.
3. Document semantic certainty, cache identity, content hashing, evidence matching,
   native fallback, and conservative migration.
4. Keep claims bounded to available benchmark evidence.

## Task 8: Adversarial audit and complete qualification

**Files:**

- Add/modify only regression tests exposing defects found during the audit.

1. Run the eight adversarial scenarios from the task specification.
2. Run `npm ci` from the committed lockfile.
3. Run `npm run lint`.
4. Run `npm run build`.
5. Run `npm test` and record file/test counts.
6. Run the schema generation consistency check used by CI.
7. Run `npm run build:plugin`.
8. Run `npm run package:release`.
9. Run `npm run verify:release`.
10. If Claude is available, run real `cco doctor`, `cco inventory`, and
    `cco analyze`; report unavailable gates honestly.
11. Run `graphify update .` and inspect the final diff for duplicated or divergent
    decision logic.
12. Commit only task-owned files and produce the requested P0 closure report.
