---
name: explain
description: Shows the reasoning behind the last CCO profile compilation or route decision - which capabilities were kept, pruned or injected and why. User-invoked only, never auto-triggered by the model.
disable-model-invocation: true
---

Run `cco explain --last --json` in the current project directory and present the result to the user:

- each profile decision's action (keep/prune) and reason codes;
- the last route decision (if any), its confidence and reason code;
- unknowns/uncertainties the compiler chose to be conservative about;
- evidence ids backing any aggressive-mode decisions.

Do not fabricate reasons not present in the CLI output. If nothing has been compiled yet, tell the user to run `cco analyze` or `cco run` first.
