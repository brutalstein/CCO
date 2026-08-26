---
name: profile
description: Shows CCO named-profile choices and suggests profile management commands. User-invoked only, never auto-triggered by the model; never silently reconfigures the current session.
disable-model-invocation: true
---

Run `cco profile list --json` in the current project directory and present the result to the user, including each named profile's pinned/protected plugin ids and whether it is the active default.

If the user wants to change something, suggest the exact CLI command rather than doing it yourself in-session:

- `cco profile create <name> --from last|auto`
- `cco profile pin <name> --plugin <id>`
- `cco profile protect <name> --plugin <id>`
- `cco profile unpin <name> --plugin <id>`
- `cco profile delete <name>`

Never change the running session's plugin topology directly; CCO profiles only take effect on the next `cco run`/`cco task` launch.
