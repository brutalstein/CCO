import { describe, expect, it } from 'vitest';
import { detectFeatures, detectToolSearchStatus, parseVersion, versionFamily } from '../src/probes.js';

describe('Claude compatibility probes', () => {
  it('A02: normalizes the reference Claude version', () => {
    expect(parseVersion('Claude Code 2.1.246')).toBe('2.1.246');
    expect(versionFamily('2.1.246')).toBe('2.1-current');
  });

  it('A03: unknown newer versions remain probe-driven and do not crash', () => {
    expect(versionFamily(parseVersion('Claude Code 99.7.3'))).toBe('99.7-current');
    expect(detectFeatures('options: --settings; plugin; workflow')).toMatchObject({ settingsOverlay: true, pluginListJson: true });
  });

  it('H01/H02: distinguishes explicit deferred Tool Search, fallback, and unknown MCP help', () => {
    expect(detectToolSearchStatus('Native Tool Search enabled')).toBe('deferred-supported');
    expect(detectToolSearchStatus('Tool Search disabled by provider')).toBe('prefix-loaded-or-search-disabled');
    expect(detectToolSearchStatus('--mcp-config <file>')).toBe('unknown');
  });
});
