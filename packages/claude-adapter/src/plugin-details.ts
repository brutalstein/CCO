import type { PluginDetailsSource } from './interface.js';

/**
 * Tolerant parser for `claude plugin details <id> --json` (01_RESEARCH_BASELINE.md 2.3).
 * Returns null (never zero) on any parse failure so cost stays "unknown"
 * (05_CAPABILITY_MODEL.md section 6, 10_TOKEN_COST_CACHE_MODEL.md section 4).
 */
export function parsePluginDetailsJson(canonicalId: string, raw: string): PluginDetailsSource | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;

  const componentsRaw = Array.isArray(d.components) ? d.components : [];
  const components = componentsRaw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      type: typeof c.type === 'string' ? c.type : 'unknown',
      id: typeof c.id === 'string' ? c.id : String(c.name ?? 'unknown'),
      name: typeof c.name === 'string' ? c.name : 'unknown'
    }));

  const alwaysOn =
    typeof d.alwaysOnTokens === 'number'
      ? d.alwaysOnTokens
      : typeof (d.cost as Record<string, unknown> | undefined)?.alwaysOnTokens === 'number'
        ? ((d.cost as Record<string, unknown>).alwaysOnTokens as number)
        : undefined;

  return {
    canonicalId,
    components,
    alwaysOnTokens: alwaysOn,
    tokenSource: alwaysOn !== undefined ? 'anthropic_projected' : 'unknown',
    dependencies: Array.isArray(d.dependencies) ? d.dependencies.filter((x): x is string => typeof x === 'string') : [],
    riskFlags: Array.isArray(d.riskFlags) ? d.riskFlags.filter((x): x is string => typeof x === 'string') : []
  };
}
