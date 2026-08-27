import { describe, it, expect } from 'vitest';
import { DefaultProfileCompiler, type CompileProfileInput } from '../src/profile/compiler.js';
import { defaultConfig } from '../src/config/defaults.js';
import { GRAPH_ALGORITHM_VERSION, type CapabilityGraph, type CapabilityNode, type CompiledProfile, type InventorySnapshot, type RepoFingerprint } from '../src/types.js';
import { minimalFixture } from '@cco/claude-adapter';

/**
 * Compiler fixture matrix (root CLAUDE.md section 9). Six deterministic scenarios over
 * varied plugin inventories, each reporting baseline cost by provenance, selected/pruned/
 * uncertain capabilities, reason codes, and the projected always-on token change. These are
 * deterministic compiler demonstrations, not a universal token-savings claim.
 */

function plugin(canonicalId: string, enabled = true, managed = false): InventorySnapshot['plugins'][number] {
  return { canonicalId, name: canonicalId.split('@')[0], sourceType: 'marketplace', enabled, managed };
}

function node(canonicalId: string, tags: string[], confidence: number, cost = 200): CapabilityNode {
  return {
    id: 'plugin:' + canonicalId,
    type: 'plugin',
    ownerPluginId: null,
    displayName: canonicalId,
    descriptionHash: 'h',
    tags: tags.map((t) => ({ id: t, confidence: 0.85, source: 'metadata' })),
    availability: 'baseline_enabled',
    cost: { alwaysOnTokens: cost, source: confidence >= 0.8 ? 'anthropic_projected' : 'local_estimate' },
    riskFlags: [],
    metadataParseConfidence: confidence,
    semanticCoverage: tags.length > 0 ? 1 : 0,
    semanticClassificationConfidence: tags.length > 0 ? confidence : 0,
    dependencies: [],
    managed: false,
    protected: false,
    baselineEnabled: true
  };
}

function makeGraph(nodes: CapabilityNode[], edges: CapabilityGraph['edges'] = []): CapabilityGraph {
  return { schemaVersion: 2, inventoryFingerprint: 'inv_matrix', generatedAt: new Date().toISOString(), nodes, edges, buildAlgorithmVersion: GRAPH_ALGORITHM_VERSION, sourceHashes: { inventory: 'inv_matrix', repo: 'repo_matrix' } };
}

function makeRepo(domains: string[]): RepoFingerprint {
  return {
    schemaVersion: 2,
    id: 'repo_matrix',
    rootHash: 'r',
    git: { isRepo: true, branch: 'main', dirty: false },
    languages: [],
    frameworks: [],
    domains,
    manifests: [],
    workspaceKind: 'single-package',
    partial: false,
    fingerprintInputsHash: 'x'
  };
}

function makeInventory(plugins: InventorySnapshot['plugins']): InventorySnapshot {
  return { schemaVersion: 2, id: 'inv_matrix', capturedAt: new Date().toISOString(), claude: minimalFixture().environment, baselineStateHash: 'baseline_matrix', plugins, pluginDetails: {}, partial: false, missingSources: [] };
}

interface MatrixReport {
  matrix: string;
  baselineCostByProvenance: Record<string, number>;
  selected: string[];
  pruned: string[];
  uncertain: string[];
  reasonCodes: Record<string, string[]>;
  projectedChange: { before: number; after: number; reductionPct: number };
}

function reportFor(matrix: string, profile: CompiledProfile, graph: CapabilityGraph): MatrixReport {
  const costByProvenance: Record<string, number> = {};
  for (const id of profile.baseline.enabledPluginIds) {
    const n = graph.nodes.find((x) => x.id === 'plugin:' + id);
    const source = n?.cost.source ?? 'unknown';
    costByProvenance[source] = (costByProvenance[source] ?? 0) + (n?.cost.alwaysOnTokens ?? 0);
  }
  const uncertain = profile.decisions.filter((d) => d.reasonCodes.includes('KEEP_UNCERTAIN')).map((d) => d.subjectId);
  const reasonCodes: Record<string, string[]> = {};
  for (const d of profile.decisions) reasonCodes[d.subjectId] = d.reasonCodes;
  const before = profile.costProjection.alwaysOnBefore;
  const after = profile.costProjection.alwaysOnAfter;
  const report: MatrixReport = {
    matrix,
    baselineCostByProvenance: costByProvenance,
    selected: profile.selected.enabledPluginIds,
    pruned: profile.selected.prunedPluginIds,
    uncertain,
    reasonCodes,
    projectedChange: { before, after, reductionPct: before > 0 ? Math.round((1 - after / before) * 100) : 0 }
  };
  console.log(`Compiler fixture ${matrix} report:`, JSON.stringify(report, null, 2));
  return report;
}

function compile(input: CompileProfileInput): CompiledProfile {
  return new DefaultProfileCompiler().compile(input);
}

describe('Compiler fixture matrix (root CLAUDE.md section 9)', () => {
  it('Matrix A — all relevant: near-zero pruning', () => {
    const repo = makeRepo(['backend-api', 'database']);
    const inventory = makeInventory([plugin('api-tools@x'), plugin('db-tools@x')]);
    const graph = makeGraph([node('api-tools@x', ['domain:backend-api'], 0.95), node('db-tools@x', ['domain:database'], 0.95)]);
    const profile = compile({ inventory, graph, repo, config: defaultConfig(), evidence: { records: [] }, environment: minimalFixture().environment, mode: 'safe' });
    const report = reportFor('A (all relevant)', profile, graph);

    expect(report.pruned).toEqual([]);
    expect(report.projectedChange.reductionPct).toBe(0);
  });

  it('Matrix B — strongly mixed: high-confidence irrelevant plugins pruned', () => {
    const repo = makeRepo(['backend-api', 'database']);
    const inventory = makeInventory([plugin('api-tools@x'), plugin('db-tools@x'), plugin('frontend-kit@x'), plugin('mobile-kit@x')]);
    const graph = makeGraph([
      node('api-tools@x', ['domain:backend-api'], 0.95),
      node('db-tools@x', ['domain:database'], 0.95),
      node('frontend-kit@x', ['domain:frontend-ui'], 0.95),
      node('mobile-kit@x', ['domain:mobile'], 0.95)
    ]);
    const profile = compile({ inventory, graph, repo, config: defaultConfig(), evidence: { records: [] }, environment: minimalFixture().environment, mode: 'safe' });
    const report = reportFor('B (strongly mixed)', profile, graph);

    expect(report.pruned.sort()).toEqual(['frontend-kit@x', 'mobile-kit@x']);
    expect(report.selected.sort()).toEqual(['api-tools@x', 'db-tools@x']);
    expect(report.reasonCodes['frontend-kit@x']).toContain('PRUNE_STRUCTURAL_IRRELEVANCE');
    expect(report.reasonCodes['mobile-kit@x']).toContain('PRUNE_STRUCTURAL_IRRELEVANCE');
    expect(report.projectedChange.reductionPct).toBeGreaterThan(0);
  });

  it('Matrix C — many opaque (low-confidence) plugins: most preserved', () => {
    const repo = makeRepo(['backend-api']);
    const inventory = makeInventory([plugin('opaque-1@x'), plugin('opaque-2@x'), plugin('opaque-3@x'), plugin('api-tools@x')]);
    // Below the semantic-confidence floor (0.8): unknown-purpose plugins.
    const graph = makeGraph([
      node('opaque-1@x', [], 0.4),
      node('opaque-2@x', [], 0.4),
      node('opaque-3@x', [], 0.4),
      node('api-tools@x', ['domain:backend-api'], 0.95)
    ]);
    const profile = compile({ inventory, graph, repo, config: defaultConfig(), evidence: { records: [] }, environment: minimalFixture().environment, mode: 'aggressive' });
    const report = reportFor('C (many opaque plugins)', profile, graph);

    expect(report.pruned).toEqual([]);
    expect(report.uncertain.sort()).toEqual(['opaque-1@x', 'opaque-2@x', 'opaque-3@x']);
    for (const id of ['opaque-1@x', 'opaque-2@x', 'opaque-3@x']) {
      expect(report.reasonCodes[id]).toContain('KEEP_UNCERTAIN');
    }
  });

  it('Matrix D — explicit dependencies: dependency closure preserved even when the dependency looks irrelevant alone', () => {
    const repo = makeRepo(['backend-api']);
    const inventory = makeInventory([plugin('api-tools@x'), plugin('crypto-lib@x')]);
    const graph = makeGraph(
      [node('api-tools@x', ['domain:backend-api'], 0.95), node('crypto-lib@x', ['domain:frontend-ui'], 0.95)],
      [{ type: 'depends_on', from: 'plugin:api-tools@x', to: 'plugin:crypto-lib@x', confidence: 1, provenance: 'test' }]
    );
    const profile = compile({ inventory, graph, repo, config: defaultConfig(), evidence: { records: [] }, environment: minimalFixture().environment, mode: 'aggressive' });
    const report = reportFor('D (explicit dependencies)', profile, graph);

    expect(report.pruned).toEqual([]);
    expect(report.selected.sort()).toEqual(['api-tools@x', 'crypto-lib@x']);
    expect(report.reasonCodes['crypto-lib@x']).toContain('KEEP_DEPENDENCY');
  });

  it('Matrix E — generic plugin names, rich (tag) descriptions: the decision follows tags, never the name string', () => {
    const repo = makeRepo(['security']);
    // Both plugins have deliberately generic, near-identical names; only their tag metadata
    // (as if extracted from a rich description) differs and must drive the outcome.
    const inventory = makeInventory([plugin('tool-1@x'), plugin('tool-2@x')]);
    const graph = makeGraph([node('tool-1@x', ['domain:security'], 0.95), node('tool-2@x', ['domain:frontend-ui'], 0.95)]);
    const profile = compile({ inventory, graph, repo, config: defaultConfig(), evidence: { records: [] }, environment: minimalFixture().environment, mode: 'safe' });
    const report = reportFor('E (generic names, rich descriptions)', profile, graph);

    expect(report.selected).toContain('tool-1@x');
    expect(report.pruned).toContain('tool-2@x');
    expect(report.reasonCodes['tool-1@x']).toContain('KEEP_HIGH_REPO_AFFINITY');
    expect(report.reasonCodes['tool-2@x']).toContain('PRUNE_STRUCTURAL_IRRELEVANCE');
  });

  it('Matrix F — partial metadata: conservative KEEP even with an apparent repo mismatch', () => {
    const repo = makeRepo(['backend-api']);
    const inventory = makeInventory([plugin('partial-meta@x'), plugin('no-graph-node@x'), plugin('api-tools@x')]);
    // partial-meta@x: below the confidence floor despite a domain tag that looks irrelevant.
    // no-graph-node@x: baseline-enabled but has no graph node at all (missing/partial inventory).
    const graph = makeGraph([node('partial-meta@x', ['domain:frontend-ui'], 0.3), node('api-tools@x', ['domain:backend-api'], 0.95)]);
    const profile = compile({ inventory, graph, repo, config: defaultConfig(), evidence: { records: [] }, environment: minimalFixture().environment, mode: 'aggressive' });
    const report = reportFor('F (partial metadata)', profile, graph);

    expect(report.pruned).toEqual([]);
    expect(report.uncertain.sort()).toEqual(['no-graph-node@x', 'partial-meta@x']);
    expect(report.reasonCodes['partial-meta@x']).toContain('KEEP_UNCERTAIN');
    expect(report.reasonCodes['no-graph-node@x']).toContain('KEEP_UNCERTAIN');
  });
});
