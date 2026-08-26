import { describe, it, expect } from 'vitest';
import { parsePluginDetailsText } from '../src/plugin-details.js';

// Regression test for a real bug: `claude plugin details <id> --json` does not exist on
// the actual installed Claude Code CLI (only `-h/--help` is supported for this subcommand
// — confirmed against a live install), so the adapter must parse the human-readable text
// output instead. Every fixture below is a real, unmodified `claude plugin details <id>`
// transcript captured against a live install.
describe('parsePluginDetailsText', () => {
  it('parses a plugin with skills, hooks, and a plain always-on count', () => {
    const raw = `Claude Capability Optimizer (cco) 1.0.0
  Description: Minimal in-session companion for CCO's pre-session capability optimizer.
  Source: cco@cco

Component inventory
  Skills (4)  audit, explain, profile, status
  Agents (0)
  Hooks (3)  SessionStart, UserPromptSubmit, SessionEnd  (harness-only — no model context cost)
  MCP servers (0)
  LSP servers (0)

Projected token cost
  Always-on:   ~246 tok   added to every session
`;
    const result = parsePluginDetailsText('cco@cco', raw);
    expect(result?.alwaysOnTokens).toBe(246);
    expect(result?.tokenSource).toBe('anthropic_projected');
    const skillNames = result?.components.filter((c) => c.type === 'skill').map((c) => c.name);
    expect(skillNames).toEqual(['audit', 'explain', 'profile', 'status']);
    const hookNames = result?.components.filter((c) => c.type === 'hook').map((c) => c.name);
    expect(hookNames).toEqual(['SessionStart', 'UserPromptSubmit', 'SessionEnd']);
  });

  it('parses a locale-grouped always-on count (period as thousands separator)', () => {
    const raw = `caveman 1.0.0
Component inventory
  Skills (1)  caveman
Projected token cost
  Always-on:   ~1.420 tok   added to every session
`;
    const result = parsePluginDetailsText('caveman@caveman', raw);
    expect(result?.alwaysOnTokens).toBe(1420);
  });

  it('parses a zero-cost plugin with a single annotated LSP component', () => {
    const raw = `clangd-lsp 1.0.0
Component inventory
  Skills (0)
  Agents (0)
  Hooks (0)
  MCP servers (0)
  LSP servers (1)  clangd  (out-of-process tooling; no model context cost)

Projected token cost
  Always-on:   ~0 tok   added to every session
`;
    const result = parsePluginDetailsText('clangd-lsp@claude-plugins-official', raw);
    expect(result?.alwaysOnTokens).toBe(0);
    expect(result?.components).toEqual([{ type: 'lsp_server', id: 'lsp_server:clangd', name: 'clangd' }]);
  });

  it('returns null when the text has neither a cost line nor components', () => {
    expect(parsePluginDetailsText('x@x', 'error: unknown option --json')).toBeNull();
    expect(parsePluginDetailsText('x@x', '')).toBeNull();
  });
});
