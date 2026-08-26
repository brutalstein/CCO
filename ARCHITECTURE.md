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
