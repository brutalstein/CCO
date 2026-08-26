# fake-claude

A standalone, spawnable Node script that emulates just enough of the real
`claude` CLI surface for `CurrentClaudeAdapter` integration tests
(21_TESTING_STRATEGY.md section 4: "every adapter parser must be testable
without installed Claude", tested here via a real subprocess rather than the
in-process `FakeClaudeAdapter`).

## Supported invocations

| Command | Behavior |
|---|---|
| `fake-claude.mjs --version` | prints `2.1.246 (Claude Code)` |
| `fake-claude.mjs --help` | prints help text containing `plugin`, `--settings`, `workflow`, `mcp` (so `detectFeatures`/`detectToolSearchStatus` report full support) |
| `fake-claude.mjs plugin list --json` | prints the fixture in `../plugin-inventories/two-plugins.json` |
| `fake-claude.mjs plugin details <id> --json` | prints a details object for `security-tools@example` or `frontend-kit@example`, or `{}` for an unknown id |
| `fake-claude.mjs -p <prompt> --output-format <fmt> ...` | prints one deterministic stream-JSON/text line and exits 0, for benchmark-harness integration tests |

Exit code is always `0` for a recognized invocation; unrecognized flags print
nothing and exit `1`, exercising CCO's fallback-to-native path.

## Usage

```bash
node fixtures/fake-claude/fake-claude.mjs --version
```

To drive `CurrentClaudeAdapter` against it directly, `chmod +x` the script and
pass its path as `ProbeContext.claudeBinaryHint` (POSIX only - the adapter
spawns `claudeBinaryHint` with `shell: false`, so a Windows CI lane would need
a `.cmd` wrapper; no such wrapper or automated integration test is wired up
in this initial implementation, so this fixture is currently exercised only
by direct/manual invocation).
