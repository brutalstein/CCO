# cco (Claude Code plugin)

Minimal in-session companion for the Claude Capability Optimizer CLI. This plugin adds:

- `SessionStart` / `UserPromptSubmit` / `SessionEnd` hooks that read the immutable session
  profile compiled by `cco run`/`cco task` and, when confident, inject a compact routing hint;
- four user-invoked diagnostic skills: `/cco:status`, `/cco:explain`, `/cco:audit`, `/cco:profile`.

It ships no MCP servers, agents, LSP servers or workflows, and adds no always-on context of its
own beyond the two hook events above. See `bin/cco-hook.mjs` — a self-contained bundle generated
by `scripts/build-plugin.mjs` from the monorepo's `@cco/core`/`@cco/claude-adapter`/`@cco/platform`
packages, so this plugin does not depend on a globally installed `cco` executable.

Install the CCO CLI separately (`npm install -g claude-capability-optimizer`, then `cco init`) to
compile and launch optimized sessions; this plugin only reads what the CLI already wrote.
