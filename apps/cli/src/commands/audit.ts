import { DefaultCapabilityGraphBuilder, deepAuditPlugin, type StaticAuditFinding } from '@cco/core';
import { createContext, printJson } from '../context.js';
import type { ParsedArgs } from '../argv.js';
import { flagBool, flagString } from '../argv.js';

interface AuditFinding {
  pluginId: string;
  indicator: string;
  provenance: StaticAuditFinding['provenance'];
  relativePath?: string;
}

/** `cco audit` (13_CLI_SPEC.md section 10, 11_SECURITY_PRIVACY_THREAT_MODEL.md section 13). Metadata-only; never executes anything. */
export async function cmdAudit(parsed: ParsedArgs): Promise<number> {
  const json = flagBool(parsed.flags, 'json');
  const deep = flagBool(parsed.flags, 'deep');
  const onlyPlugin = flagString(parsed.flags, 'plugin');
  const ctx = await createContext(process.cwd(), json);

  const inventory = await ctx.inventoryService.loadOrRefresh({ cwd: ctx.cwd });
  const graph = new DefaultCapabilityGraphBuilder().build(inventory);

  const findings: AuditFinding[] = [];
  for (const plugin of inventory.plugins) {
    if (onlyPlugin && plugin.canonicalId !== onlyPlugin) continue;
    const details = inventory.pluginDetails[plugin.canonicalId];
    if (!details) findings.push({ pluginId: plugin.canonicalId, indicator: 'unknown token cost/version', provenance: 'claude-metadata' });
    for (const flag of details?.riskFlags ?? []) findings.push({ pluginId: plugin.canonicalId, indicator: flag, provenance: 'claude-metadata' });
    const components = graph.nodes.filter((n) => n.ownerPluginId === 'plugin:' + plugin.canonicalId);
    if (components.some((c) => c.type === 'hook')) findings.push({ pluginId: plugin.canonicalId, indicator: 'executable hook present', provenance: 'claude-metadata' });
    if (components.some((c) => c.type === 'mcp_server')) findings.push({ pluginId: plugin.canonicalId, indicator: 'mcp server present (credential data not collected)', provenance: 'claude-metadata' });
    if (deep) findings.push(...await deepAuditPlugin(plugin));
  }

  const warnings = deep && inventory.plugins.some((plugin) => (!onlyPlugin || plugin.canonicalId === onlyPlugin) && !plugin.installPath)
    ? ['one or more plugins had no Claude-provided install path; their deep scan was skipped']
    : [];

  if (json) {
    printJson(findings, 'audit', true, warnings);
  } else {
    if (findings.length === 0) console.log('no risk indicators found (metadata-level scan)');
    for (const f of findings) console.log(`${f.pluginId}: ${f.indicator}${f.relativePath ? ` (${f.relativePath})` : ''} [${f.provenance}]`);
    for (const w of warnings) console.log('note: ' + w);
  }
  return 0;
}
