---
name: audit
description: Runs CCO's metadata-only security audit over installed extensions and summarizes risk indicators. User-invoked only, never auto-triggered by the model.
disable-model-invocation: true
---

Run `cco audit --json` in the current project directory and summarize the findings for the user:

- risky patterns found (broad tool grants, executable hooks, MCP auth/config exposure, untrusted project-scope directives);
- which plugin/component each finding is attached to, with provenance;
- explicitly note that this is a metadata/config scan, not a malware verdict, and that no extension code was executed.

If the user asks for a deeper scan, suggest `cco audit --deep`, and remind them it still never executes extension code.
