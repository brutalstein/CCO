import type { PluginInventorySource } from './interface.js';

/**
 * Tolerant parser for `claude plugin list --json` (01_RESEARCH_BASELINE.md 2.2,
 * 04_CLAUDE_CODE_INTEGRATION.md section 3). Unknown/extra fields are ignored rather
 * than causing a crash (22_FAILURE_MODES_FALLBACKS.md "Claude CLI format drift").
 * On any structural failure, returns [] so the caller can fall back to native mode.
 */
export function parsePluginListJson(raw: string): PluginInventorySource[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }

  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { plugins?: unknown[] })?.plugins)
      ? (data as { plugins: unknown[] }).plugins
      : null;

  if (!list) return [];

  const out: PluginInventorySource[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const canonicalId = typeof e.id === 'string' ? e.id : typeof e.canonicalId === 'string' ? e.canonicalId : null;
    const name = typeof e.name === 'string' ? e.name : canonicalId;
    if (!canonicalId || !name) continue;
    out.push({
      canonicalId,
      name,
      version: typeof e.version === 'string' ? e.version : undefined,
      sourceType: typeof e.source === 'string' ? e.source : typeof e.sourceType === 'string' ? e.sourceType : 'unknown',
      enabled: e.enabled === true,
      managed: e.managed === true
    });
  }
  return out;
}
