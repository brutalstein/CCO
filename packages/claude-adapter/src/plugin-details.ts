import type { PluginDetailComponent, PluginDetailsSource } from './interface.js';

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
    description: typeof d.description === 'string' ? d.description : undefined,
    components,
    alwaysOnTokens: alwaysOn,
    tokenSource: alwaysOn !== undefined ? 'anthropic_projected' : 'unknown',
    dependencies: Array.isArray(d.dependencies) ? d.dependencies.filter((x): x is string => typeof x === 'string') : [],
    riskFlags: Array.isArray(d.riskFlags) ? d.riskFlags.filter((x): x is string => typeof x === 'string') : []
  };
}

const SECTION_LABELS: Record<string, string> = {
  'Skills': 'skill',
  'Agents': 'agent',
  'Hooks': 'hook',
  'MCP servers': 'mcp_server',
  'LSP servers': 'lsp_server'
};
const SECTION_RE = /^\s*(Skills|Agents|Hooks|MCP servers|LSP servers)\s*\((\d+)\)(?:\s+(.*))?$/;
const DESCRIPTION_RE = /^\s*Description:\s*(.+)$/;
// The number may be locale-grouped ("~1.420 tok" meaning 1420, not 1.42) — strip
// grouping punctuation before parsing rather than assuming a plain integer.
const ALWAYS_ON_RE = /Always-on:\s*~?([\d.,]+)\s*tok/;

function stripTrailingAnnotation(s: string): string {
  return s.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/**
 * Parser for `claude plugin details <id>` (no `--json`, the real CLI has no JSON mode
 * for this subcommand — only `-h/--help` — confirmed against a live install). Reads the
 * same "Component inventory" / "Projected token cost" text sections the CLI prints for a
 * human. Returns null (never zero) on total parse failure so cost stays "unknown".
 */
export function parsePluginDetailsText(canonicalId: string, raw: string): PluginDetailsSource | null {
  if (!raw || !raw.trim()) return null;

  const components: PluginDetailComponent[] = [];
  let alwaysOnTokens: number | undefined;
  let description: string | undefined;

  for (const line of raw.split(/\r?\n/)) {
    const desc = DESCRIPTION_RE.exec(line);
    if (desc) {
      description = desc[1].trim();
      continue;
    }
    const section = SECTION_RE.exec(line);
    if (section) {
      const [, label, countStr, namesRaw] = section;
      const count = Number(countStr);
      const type = SECTION_LABELS[label] ?? 'unknown';
      if (count > 0 && namesRaw) {
        const names = stripTrailingAnnotation(namesRaw)
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean);
        for (const name of names) components.push({ type, id: `${type}:${name}`, name });
      }
      continue;
    }
    const cost = ALWAYS_ON_RE.exec(line);
    if (cost) alwaysOnTokens = Number(cost[1].replace(/[.,]/g, ''));
  }

  if (alwaysOnTokens === undefined && components.length === 0) return null;

  return {
    canonicalId,
    description,
    components,
    alwaysOnTokens,
    tokenSource: alwaysOnTokens !== undefined ? 'anthropic_projected' : 'unknown',
    dependencies: [],
    riskFlags: []
  };
}
