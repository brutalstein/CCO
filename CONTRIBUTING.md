# Contributing

CCO is an unofficial, open-source companion CLI + plugin for Claude Code. This
file is the practical quick-start for the governance rules below.

## Repository principles

- Evidence before performance claims: any README percentage/cost/quality claim
  needs a reproducible benchmark artifact (`BENCHMARKS.md`).
- Security invariants (`SECURITY.md`) are not style preferences; a change that
  weakens one is rejected regardless of the token savings it buys.
- Official Claude Code behavior must be sourced from official docs/changelog,
  routed through `packages/claude-adapter`, never scattered version checks.
- No hidden analytics; telemetry stays local-only (`ADR-017`).

## Development setup

```bash
npm ci
npm run build      # tsc -b across all workspaces
npm test           # vitest run
npm run build:plugin  # bundles plugin/cco/bin/cco-hook.mjs with esbuild
```

## Contribution classes

- **Normal change** (bug fix, docs, new adapter fixture, tag mapping): open a
  PR directly with tests.
- **Architecture-sensitive change** (persisted data schema, settings-overlay
  behavior, quality gate, new executable hook, new external service, MCP
  server addition, model-backed routing default, any security invariant):
  requires an ADR entry in `34_DECISION_RECORDS.md` and maintainer review
  before implementation.
- **Claim-sensitive change**: any new or changed public claim about savings,
  cost or quality requires a benchmark artifact under `benchmarks/published/`.

## Code style

- TypeScript, ESM (`NodeNext`), strict mode. No `require()`.
- `packages/core` stays platform-independent; OS/filesystem/process behavior
  lives only in `packages/platform`; all Claude-CLI-specific parsing lives
  only in `packages/claude-adapter`.
- Prefer the smallest correct change; do not add speculative abstractions.
- Every profile decision and route decision must carry a structured reason
  code (`FR-012`) — no opaque score-only decisions.

## Tests

- Unit tests live under each package's `test/` directory (Vitest).
- A change to routing/scoring/profile-compilation logic needs a test that
  would fail without the change.
- Do not mock away the safety validator (`DefaultSafetyValidator`) in tests
  that exercise the profile compiler or launcher; it is the last line of
  defense against unauthorized enablement or a leaked `permissions` key.

## Pull requests

- Keep the diff scoped to one contribution class.
- Update reason-code documentation (`06_SESSION_PROFILE_COMPILER.md` /
  `07_RUNTIME_ROUTER_AND_PLANNER.md`) when you add or change one.
- CI must pass: lint, typecheck, unit tests, plugin bundle build.
