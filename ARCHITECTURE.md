# Architecture

CCO is a hybrid product: a companion CLI (`cco`) that does the actual
pre-session optimization through Claude Code's documented ephemeral
`--settings` overlay mechanism, plus a minimal Claude Code plugin that adds
fast per-prompt routing hooks and a handful of user-invoked diagnostic
skills. The plugin alone cannot remove extension metadata Claude has already
loaded at session start — the CLI is what actually does the optimization;
the plugin only adds the runtime routing layer on top of it.

Source-tree mapping:

| Package | Owns |
|---|---|
| `packages/platform` | OS paths, atomic file I/O, process launching |
| `packages/claude-adapter` | all Claude-CLI-version-specific parsing/contracts |
| `packages/core` | platform-independent product logic (graph, compiler, router, optimizer, quality gate, telemetry) |
| `packages/report` | human-readable rendering of CLI output |
| `packages/benchmark` | isolated baseline-vs-candidate benchmark harness |
| `apps/cli` | UX/process orchestration only - no duplicated algorithm |
| `plugin/cco` | minimal distribution bundle importing the same core logic |

## Correctness boundaries

The capability graph records metadata parse confidence, semantic coverage,
and semantic classification confidence independently. A readable plugin with
no recognized semantics is unknown, not irrelevant, and cannot be structurally
pruned. Child skills/agents/components contribute to the plugin's semantic
envelope without allowing known token cost to masquerade as semantic knowledge.

Inventory cache identity includes a canonically sorted live plugin-list state
hash. Repository identity includes privacy-preserving, bounded content digests
of inspected manifests and never follows manifest symlinks. Partial inventory,
partial repository analysis, or a graph that does not match both exact inputs
causes a zero-delta native fallback.

Persisted evidence crosses one core applicability boundary. Schema/statistics,
optimizer/graph/classifier versions, Claude family, model, task family,
capability set, candidate profile semantics, qualification, regression state,
trials, and tolerance policy must all match. CLI and plugin routing consume the
same core invariants; orchestration layers do not reimplement them.
