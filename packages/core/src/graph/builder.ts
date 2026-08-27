import { canonicalHash } from '@cco/platform';
import { extractTags } from './tags.js';
import { similarity, REDUNDANCY_THRESHOLD } from './similarity.js';
import {
  GRAPH_ALGORITHM_VERSION,
  SCHEMA_VERSION,
  type CapabilityEdge,
  type CapabilityGraph,
  type CapabilityNode,
  type InventorySnapshot,
  type RepoFingerprint
} from '../types.js';

const MAX_PAIRWISE_NODES = 800;

export interface CapabilityGraphBuilder {
  build(inventory: InventorySnapshot, repo?: RepoFingerprint): CapabilityGraph;
}

/**
 * Deterministic capability graph builder (05_CAPABILITY_MODEL.md, 32_ALGORITHMS_PSEUDOCODE.md
 * section 4). Pure apart from GRAPH_ALGORITHM_VERSION; identical inventory/repo input always
 * produces an identical node/edge set and hash.
 */
export class DefaultCapabilityGraphBuilder implements CapabilityGraphBuilder {
  build(inventory: InventorySnapshot, repo?: RepoFingerprint): CapabilityGraph {
    const nodes: CapabilityNode[] = [];
    const edges: CapabilityEdge[] = [];

    for (const plugin of inventory.plugins) {
      const pluginId = `plugin:${plugin.canonicalId}`;
      const details = inventory.pluginDetails[plugin.canonicalId];
      const semantic = classifySemanticUnits(
        details?.description && details.description !== plugin.name ? [plugin.name, details.description] : [plugin.name],
        'metadata'
      );
      const tags = semantic.tags;
      const affinity = repo ? repoAffinityBoost(tags, repo) : 0;

      nodes.push({
        id: pluginId,
        type: 'plugin',
        ownerPluginId: null,
        displayName: plugin.name,
        descriptionHash: canonicalHash({ name: plugin.name, description: details?.description ?? null }),
        tags: affinity > 0 ? [...tags, { id: 'affine_to:repo', confidence: affinity, source: 'repo-fingerprint' }] : tags,
        availability: plugin.enabled ? 'baseline_enabled' : 'baseline_disabled',
        cost: {
          alwaysOnTokens: details?.alwaysOnTokens,
          source: details ? (details.source as 'anthropic_projected' | 'unknown') : 'unknown'
        },
        riskFlags: details?.riskFlags ?? [],
        metadataParseConfidence: details ? 0.95 : 0.5,
        semanticCoverage: semantic.semanticCoverage,
        semanticClassificationConfidence: semantic.semanticClassificationConfidence,
        dependencies: (details?.dependencies ?? []).map((d) => `plugin:${d}`),
        managed: plugin.managed ?? false,
        protected: false,
        baselineEnabled: plugin.enabled
      });

      for (const dep of details?.dependencies ?? []) {
        edges.push({ type: 'depends_on', from: pluginId, to: `plugin:${dep}`, confidence: 1, provenance: 'anthropic_projected' });
      }

      for (const comp of details?.components ?? []) {
        const compId = `${comp.type}:${plugin.canonicalId}/${comp.id}`;
        const componentSemantic = classifySemanticUnits([comp.name], 'metadata');
        const compTags = componentSemantic.tags;
        nodes.push({
          id: compId,
          type: normalizeComponentType(comp.type),
          ownerPluginId: pluginId,
          displayName: comp.name,
          descriptionHash: canonicalHash(comp.name),
          tags: compTags,
          availability: plugin.enabled ? 'baseline_enabled' : 'baseline_disabled',
          cost: { source: 'unknown' },
          riskFlags: [],
          metadataParseConfidence: 0.7,
          semanticCoverage: componentSemantic.semanticCoverage,
          semanticClassificationConfidence: componentSemantic.semanticClassificationConfidence,
          dependencies: [],
          managed: plugin.managed ?? false,
          protected: false,
          baselineEnabled: plugin.enabled
        });
        edges.push({ type: 'contains', from: pluginId, to: compId, confidence: 1, provenance: 'anthropic_projected' });
      }
    }

    if (nodes.length <= MAX_PAIRWISE_NODES) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const sim = similarity(
            { name: a.displayName, description: a.displayName, tags: a.tags, ownerPluginId: a.ownerPluginId },
            { name: b.displayName, description: b.displayName, tags: b.tags, ownerPluginId: b.ownerPluginId }
          );
          if (sim.score > REDUNDANCY_THRESHOLD) {
            edges.push({ type: 'redundant_with', from: a.id, to: b.id, confidence: sim.score, provenance: 'lexical-similarity' });
          }
        }
      }
    }

    nodes.sort((a, b) => a.id.localeCompare(b.id));
    edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type));

    const graph: Omit<CapabilityGraph, 'inventoryFingerprint'> & { inventoryFingerprint: string } = {
      schemaVersion: SCHEMA_VERSION,
      inventoryFingerprint: inventory.id,
      generatedAt: inventory.capturedAt,
      nodes,
      edges,
      buildAlgorithmVersion: GRAPH_ALGORITHM_VERSION,
      sourceHashes: { inventory: inventory.id, repo: repo?.id ?? 'none' }
    };
    return graph;
  }
}

function classifySemanticUnits(
  units: string[],
  source: string
): { tags: CapabilityNode['tags']; semanticCoverage: number; semanticClassificationConfidence: number } {
  const meaningfulUnits = [...new Set(units.map((unit) => unit.trim()).filter(Boolean))];
  const byId = new Map<string, CapabilityNode['tags'][number]>();
  let recognized = 0;
  for (const unit of meaningfulUnits) {
    const unitTags = extractTags('', unit, source);
    if (unitTags.length > 0) recognized++;
    for (const tag of unitTags) {
      const existing = byId.get(tag.id);
      if (!existing || existing.confidence < tag.confidence) byId.set(tag.id, tag);
    }
  }
  const tags = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    tags,
    semanticCoverage: meaningfulUnits.length > 0 ? recognized / meaningfulUnits.length : 0,
    semanticClassificationConfidence: tags.reduce((max, tag) => Math.max(max, tag.confidence), 0)
  };
}

function normalizeComponentType(type: string): CapabilityNode['type'] {
  const t = type.toLowerCase();
  if (t.includes('skill')) return 'skill';
  if (t.includes('agent')) return 'agent';
  if (t.includes('hook')) return 'hook';
  if (t.includes('mcp')) return 'mcp_server';
  if (t.includes('lsp')) return 'lsp_server';
  if (t.includes('workflow')) return 'workflow';
  return 'instruction_source';
}

function repoAffinityBoost(tags: { id: string }[], repo: RepoFingerprint): number {
  const repoTagIds = new Set([
    ...repo.languages.map((l) => `lang:${l.id}`),
    ...repo.frameworks.map((f) => `framework:${f}`),
    ...repo.domains.map((d) => `domain:${d}`)
  ]);
  const hit = tags.some((t) => repoTagIds.has(t.id));
  return hit ? 0.8 : 0;
}
