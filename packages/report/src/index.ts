import type { ClaudeEnvironment } from '@cco/claude-adapter';
import type { CompiledProfile, InventorySnapshot, ProfileDecision } from '@cco/core';
import { explainReasonCodes } from '@cco/core';

/** Human-readable terminal reports (13_CLI_SPEC.md, 00_EXECUTIVE_SPEC.md section 4). Pure formatting only. */

export function renderDoctorReport(env: ClaudeEnvironment, pluginStatus: string): string {
  const lines = [
    `Claude Code: ${env.found ? (env.version ?? 'unknown version') : 'NOT FOUND'}`,
    `plugin list --json: ${env.features.pluginListJson ? 'supported' : 'unsupported'}`,
    `plugin details: ${env.features.pluginDetails ? 'supported' : 'unsupported'}`,
    `--settings overlay: ${env.features.settingsOverlay ? 'supported' : 'unsupported'}`,
    `Tool Search: ${env.toolSearchStatus}`,
    `workflows: ${env.features.workflows ? 'supported' : 'unsupported'}`,
    `CCO plugin: ${pluginStatus}`
  ];
  if (env.errors.length > 0) lines.push('warnings: ' + env.errors.join('; '));
  return lines.join('\n');
}

export function renderInventoryReport(inv: InventorySnapshot): string {
  const enabled = inv.plugins.filter((p) => p.enabled).length;
  const unknownCost = inv.plugins.filter((p) => p.enabled && !inv.pluginDetails[p.canonicalId]?.alwaysOnTokens).length;
  const lines = [
    `Installed plugins: ${inv.plugins.length}`,
    `Baseline enabled: ${enabled}`,
    `Unknown-cost enabled plugins: ${unknownCost}`,
    inv.partial ? `partial: true (missing: ${inv.missingSources.join(', ') || 'plugin details'})` : 'partial: false'
  ];
  return lines.join('\n');
}

export function renderAnalyzeReport(profile: CompiledProfile): string {
  const c = profile.costProjection;
  const reduction = c.alwaysOnBefore > 0 ? Math.round((1 - c.alwaysOnAfter / c.alwaysOnBefore) * 100) : 0;
  const lines = [
    `CCO profile: ${profile.mode}`,
    `Selected: ${profile.selected.enabledPluginIds.length} / Baseline: ${profile.baseline.enabledPluginIds.length}`,
    `Pruned this session: ${profile.selected.prunedPluginIds.length}`,
    `Projected always-on: ${c.alwaysOnBefore} -> ${c.alwaysOnAfter} tokens (${reduction >= 0 ? '-' : '+'}${Math.abs(reduction)}%)`,
    `Unknown-cost plugins: before=${c.unknownBefore} after=${c.unknownAfter}`,
    `Quality: ${profile.quality.status}`
  ];
  if (profile.fallbackReasons.length > 0) {
    lines.push(`Native fallback: ${profile.fallbackReasons.join('; ')}`);
  }
  if (profile.selected.prunedPluginIds.length > 0) {
    lines.push('', 'Pruned:');
    for (const id of profile.selected.prunedPluginIds) {
      const d = profile.decisions.find((x) => x.subjectId === id);
      lines.push(`  - ${id}: ${d ? explainReasonCodes(d.reasonCodes) : 'no reason recorded'}`);
    }
  }
  return lines.join('\n');
}

export function renderExplainReport(profile: CompiledProfile): string {
  const lines = [`Profile ${profile.id} (${profile.mode}, created ${profile.createdAt})`, ''];
  for (const d of profile.decisions as ProfileDecision[]) {
    lines.push(`${d.action === 'prune' ? '-' : '+'} ${d.subjectId}`);
    lines.push(`    ${explainReasonCodes(d.reasonCodes)}`);
  }
  return lines.join('\n');
}
