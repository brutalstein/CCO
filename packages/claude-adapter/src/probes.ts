import type { ClaudeFeatures, ToolSearchStatus } from './interface.js';

/** Reference snapshot this blueprint was researched against (01_RESEARCH_BASELINE.md). */
export const REFERENCE_CLAUDE_VERSION = '2.1.246';

const VERSION_RE = /(\d+)\.(\d+)\.(\d+)/;

export function parseVersion(raw: string): string | null {
  const m = raw.match(VERSION_RE);
  return m ? m[0] : null;
}

export function versionFamily(version: string | null): string {
  if (!version) return 'unknown';
  const [major, minor] = version.split('.');
  return `${major}.${minor}-current`;
}

/**
 * Conservative feature probe: unless a capability is positively evidenced by --help output,
 * treat it as unsupported (01_RESEARCH_BASELINE.md section 13 compatibility rule).
 */
export function detectFeatures(helpText: string): ClaudeFeatures {
  const has = (needle: string) => helpText.toLowerCase().includes(needle.toLowerCase());
  return {
    pluginListJson: has('plugin'),
    pluginDetails: has('plugin'),
    settingsOverlay: has('--settings'),
    toolSearchExpected: detectToolSearchStatus(helpText) === 'deferred-supported',
    workflows: has('workflow'),
    agentTeams: has('team')
  };
}

export function detectToolSearchStatus(helpText: string): ToolSearchStatus {
  const normalized = helpText.toLowerCase();
  if (/tool[- ]search/.test(normalized)) {
    if (/disable(?:d)?[^\n]{0,40}tool[- ]search|tool[- ]search[^\n]{0,40}disable(?:d)?/.test(normalized)) {
      return 'prefix-loaded-or-search-disabled';
    }
    return 'deferred-supported';
  }
  return 'unknown';
}
