---
name: status
description: Shows current CCO session profile, selected/pruned plugin count, projected listing cost, router state and compatibility. User-invoked only, never auto-triggered by the model.
disable-model-invocation: true
---

Run `cco analyze --json` in the current project directory (falling back to `cco doctor --json` if no profile has been compiled yet) and present the result to the user:

- current mode and profile id;
- selected vs. pruned plugin counts;
- projected always-on token cost before/after, net of CCO's own overhead;
- runtime router availability and compatibility status;
- any managed-policy constraints or fallback reasons.

Do not recompute or reinterpret the numbers yourself; report exactly what the CLI returns. If the `cco` executable is not on PATH, tell the user to run `cco init` first.
