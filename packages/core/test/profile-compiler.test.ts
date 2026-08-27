import { describe, it, expect } from 'vitest';
import { DefaultProfileCompiler, profileSemanticIdentity, type CompileProfileInput } from '../src/profile/compiler.js';
import { defaultConfig } from '../src/config/defaults.js';
import {
  EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_STATISTICS_METHOD,
  GRAPH_ALGORITHM_VERSION,
  INTENT_CLASSIFIER_VERSION,
  OPTIMIZER_MODEL_VERSION,
  type CapabilityGraph,
  type CapabilityNode,
  type EvidenceRecord,
  type InventorySnapshot,
  type RepoFingerprint
} from '../src/types.js';
import { minimalFixture } from '@cco/claude-adapter';

function node(id: string, tags: string[], confidence = 0.95): CapabilityNode {
  return {
    id,
    type: 'plugin',
    ownerPluginId: null,
    displayName: id,
    descriptionHash: 'h',
    tags: tags.map((t) => ({ id: t, confidence: 0.85, source: 'metadata' })),
    availability: 'baseline_enabled',
    cost: { alwaysOnTokens: 200, source: 'anthropic_projected' },
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

const inventory: InventorySnapshot = {
  schemaVersion: 2,
  id: 'inv_test',
  capturedAt: new Date().toISOString(),
  claude: minimalFixture().environment,
  baselineStateHash: 'baseline_test',
  plugins: [
    { canonicalId: 'frontend-design@x', name: 'frontend-design', sourceType: 'marketplace', enabled: true },
    { canonicalId: 'generic-helper@x', name: 'generic-helper', sourceType: 'marketplace', enabled: true },
    { canonicalId: 'security-tools@x', name: 'security-tools', sourceType: 'marketplace', enabled: true },
    { canonicalId: 'crypto-lib@x', name: 'crypto-lib', sourceType: 'marketplace', enabled: true },
    { canonicalId: 'disabled-plugin@x', name: 'disabled-plugin', sourceType: 'marketplace', enabled: false }
  ],
  pluginDetails: {},
  partial: false,
  missingSources: []
};

const graph: CapabilityGraph = {
  schemaVersion: 2,
  inventoryFingerprint: inventory.id,
  generatedAt: new Date().toISOString(),
  nodes: [
    node('plugin:frontend-design@x', ['domain:frontend']),
    node('plugin:generic-helper@x', [], 0.5),
    node('plugin:security-tools@x', ['domain:security']),
    node('plugin:crypto-lib@x', ['domain:frontend-ui'])
  ],
  edges: [{ type: 'depends_on', from: 'plugin:security-tools@x', to: 'plugin:crypto-lib@x', confidence: 1, provenance: 'test' }],
  buildAlgorithmVersion: GRAPH_ALGORITHM_VERSION,
  sourceHashes: { inventory: inventory.id, repo: 'repo_test' }
};

const repo: RepoFingerprint = {
  schemaVersion: 2,
  id: 'repo_test',
  rootHash: 'r',
  git: { isRepo: true, branch: 'main', dirty: false },
  languages: [{ id: 'rust', weight: 1 }],
  frameworks: ['cargo'],
  domains: ['backend-api'],
  manifests: ['Cargo.toml'],
  workspaceKind: 'single-package',
  partial: false,
  fingerprintInputsHash: 'x'
};

function baseInput(overrides: Partial<CompileProfileInput> = {}): CompileProfileInput {
  return {
    inventory,
    graph,
    repo,
    config: defaultConfig(),
    evidence: { records: [] },
    environment: minimalFixture().environment,
    mode: 'safe',
    ...overrides
  };
}

describe('DefaultProfileCompiler (safe mode)', () => {
  it('D01: never selects a baseline-disabled plugin', () => {
    const profile = new DefaultProfileCompiler().compile(baseInput());
    expect(profile.selected.enabledPluginIds).not.toContain('disabled-plugin@x');
    expect(profile.baseline.enabledPluginIds).not.toContain('disabled-plugin@x');
  });

  it('D06: prunes a structurally irrelevant plugin (frontend plugin, backend-only repo, no intent)', () => {
    const profile = new DefaultProfileCompiler().compile(baseInput());
    expect(profile.selected.prunedPluginIds).toContain('frontend-design@x');
    const d = profile.decisions.find((x) => x.subjectId === 'frontend-design@x');
    expect(d?.reasonCodes).toContain('PRUNE_STRUCTURAL_IRRELEVANCE');
  });

  it('D05: keeps a plugin with low metadata confidence even with no relevance signal', () => {
    const profile = new DefaultProfileCompiler().compile(baseInput());
    expect(profile.selected.enabledPluginIds).toContain('generic-helper@x');
  });

  it('keeps a plugin with high task affinity when intent matches its domain tag', () => {
    const profile = new DefaultProfileCompiler().compile(
      baseInput({ intent: { schemaVersion: 1, operations: [], domains: ['security'], languages: [], artifacts: [], complexity: 'medium', parallelism: 'low', confidence: 0.9, classifierVersion: 'intent-1' } })
    );
    expect(profile.selected.enabledPluginIds).toContain('security-tools@x');
    const d = profile.decisions.find((x) => x.subjectId === 'security-tools@x');
    expect(d?.reasonCodes).toContain('KEEP_HIGH_TASK_AFFINITY');
  });

  it('D04: restores a pruned dependency required by a kept plugin', () => {
    const profile = new DefaultProfileCompiler().compile(
      baseInput({ intent: { schemaVersion: 1, operations: [], domains: ['security'], languages: [], artifacts: [], complexity: 'medium', parallelism: 'low', confidence: 0.9, classifierVersion: 'intent-1' } })
    );
    expect(profile.selected.enabledPluginIds).toContain('crypto-lib@x');
    const d = profile.decisions.find((x) => x.subjectId === 'crypto-lib@x');
    expect(d?.reasonCodes).toContain('KEEP_DEPENDENCY');
  });

  it('D09: observe mode produces zero enablement delta', () => {
    const profile = new DefaultProfileCompiler().compile(baseInput({ mode: 'observe' }));
    expect(profile.selected.prunedPluginIds).toEqual([]);
    expect(Object.keys(profile.overlay.enabledPlugins)).toHaveLength(0);
  });

  it('D10: native mode produces zero optimization delta', () => {
    const profile = new DefaultProfileCompiler().compile(baseInput({ mode: 'native' }));
    expect(profile.selected.prunedPluginIds).toEqual([]);
    expect(profile.selected.enabledPluginIds.sort()).toEqual(profile.baseline.enabledPluginIds.sort());
  });

  it('D13: identical inputs produce an identical profile hash', () => {
    const a = new DefaultProfileCompiler().compile(baseInput());
    const b = new DefaultProfileCompiler().compile(JSON.parse(JSON.stringify(baseInput())));
    expect(a.id).toBe(b.id);
    expect(a.integrityHash).toBe(b.integrityHash);
  });

  it('overlay never contains a permissions key and only carries prune deltas', () => {
    const profile = new DefaultProfileCompiler().compile(baseInput());
    expect('permissions' in profile.overlay).toBe(false);
    for (const v of Object.values(profile.overlay.enabledPlugins)) expect(v).toBe(false);
  });

  it('respects a user neverDisable pin over structural irrelevance', () => {
    const cfg = defaultConfig();
    cfg.profile.neverDisable = ['frontend-design@x'];
    const profile = new DefaultProfileCompiler().compile(baseInput({ config: cfg }));
    expect(profile.selected.enabledPluginIds).toContain('frontend-design@x');
  });

  it.each([
    ['partial inventory', { inventory: { ...inventory, partial: true } }],
    ['partial repository', { repo: { ...repo, partial: true } }],
    ['stale graph inventory', { graph: { ...graph, inventoryFingerprint: 'old' } }],
    ['incompatible graph algorithm', { graph: { ...graph, buildAlgorithmVersion: 'graph-old' } }],
    ['unsupported Claude environment', { environment: { ...minimalFixture().environment, found: false } }]
  ])('falls back to a zero-delta native profile for %s', (_name, overrides) => {
    const profile = new DefaultProfileCompiler().compile(baseInput(overrides));
    expect(profile.mode).toBe('native');
    expect(profile.selected.prunedPluginIds).toEqual([]);
    expect(profile.overlay.enabledPlugins).toEqual({});
    expect(profile.fallbackReasons.length).toBeGreaterThan(0);
  });
});

describe('DefaultProfileCompiler (aggressive mode, non-inferiority evidence)', () => {
  // Weak-but-nonzero repo affinity (above safePruneAffinityMax=0.08, below the
  // hasStrongRelevance floor of 0.5) is the only zone where evidence-based pruning
  // can fire at all — everything above 0.5 is kept outright, everything at/below
  // 0.08 is already pruned as structurally irrelevant regardless of evidence.
  const weakAffinityNode: CapabilityNode = {
    ...node('plugin:redundant-tool@x', []),
    tags: [{ id: 'domain:backend-api', confidence: 0.3, source: 'metadata' }],
    semanticCoverage: 1,
    semanticClassificationConfidence: 0.85
  };
  const inv: InventorySnapshot = {
    ...inventory,
    plugins: [...inventory.plugins, { canonicalId: 'redundant-tool@x', name: 'redundant-tool', sourceType: 'marketplace', enabled: true }]
  };
  const g: CapabilityGraph = { ...graph, nodes: [...graph.nodes, weakAffinityNode] };

  it('keeps the weak-affinity plugin in safe mode (no evidence consulted)', () => {
    const profile = new DefaultProfileCompiler().compile(baseInput({ inventory: inv, graph: g, mode: 'safe' }));
    expect(profile.selected.enabledPluginIds).toContain('redundant-tool@x');
  });

  it('does not let legacy evidence authorize aggressive pruning', () => {
    const evidence = {
      records: [
        {
          schemaVersion: 1,
          id: 'evidence_1',
          suiteId: 'redundant-tool@x-suite',
          taskFamily: ['utility-edit'],
          claudeVersionFamily: '2.1-current',
          model: 'default',
          baselineProfileHash: 'native',
          candidateProfileHash: 'profile_x',
          trials: 10,
          quality: { baselineSuccess: 1, candidateSuccess: 1, difference: 0, lowerBound: -0.01, tolerance: 0, nonInferior: true },
          cost: {},
          createdAt: new Date().toISOString(),
          status: 'active' as const
        }
      ]
    };
    const profile = new DefaultProfileCompiler().compile(baseInput({ inventory: inv, graph: g, mode: 'aggressive', evidence }));
    expect(profile.selected.enabledPluginIds).toContain('redundant-tool@x');
  });

  it('does not prune it in aggressive mode when no matching evidence exists', () => {
    const profile = new DefaultProfileCompiler().compile(baseInput({ inventory: inv, graph: g, mode: 'aggressive' }));
    expect(profile.selected.enabledPluginIds).toContain('redundant-tool@x');
  });

  it('fails closed without throwing when persisted v2 evidence is malformed', () => {
    const malformed = { schemaVersion: 2, id: 'evidence_bad', applicability: { capabilityIds: 'not-an-array' } } as unknown as EvidenceRecord;
    const input = baseInput({ inventory: inv, graph: g, mode: 'aggressive', evidence: { records: [malformed] } });
    expect(() => new DefaultProfileCompiler().compile(input)).not.toThrow();
    expect(new DefaultProfileCompiler().compile(input).selected.enabledPluginIds).toContain('redundant-tool@x');
  });

  it('prunes only when v2 evidence authorizes the exact candidate semantics', () => {
    const input = baseInput({ inventory: inv, graph: g, mode: 'aggressive', taskFamilies: ['utility-edit'], model: 'default' });
    const withoutEvidence = new DefaultProfileCompiler().compile(input);
    const kept = withoutEvidence.selected.enabledPluginIds.filter((id) => id !== 'redundant-tool@x');
    const pruned = [...withoutEvidence.selected.prunedPluginIds, 'redundant-tool@x'];
    const identity = profileSemanticIdentity(input, kept, pruned);
    const record: EvidenceRecord = {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      id: 'evidence_exact',
      suiteId: 'unrelated-free-form-name',
      taskFamily: ['utility-edit'],
      claudeVersionFamily: input.environment.versionFamily,
      model: 'default',
      baselineProfileHash: 'native',
      candidateProfileHash: identity.id,
      trials: 3,
      quality: { baselineSuccess: 1, candidateSuccess: 1, difference: 0, lowerBound: 0, tolerance: 0, nonInferior: true, deterministicRegression: false },
      cost: {},
      createdAt: '2026-08-27T00:00:00.000Z',
      status: 'active',
      applicability: {
        capabilityIds: ['redundant-tool@x'],
        taskFamilies: ['utility-edit'],
        claudeVersionFamily: input.environment.versionFamily,
        model: 'default',
        optimizerVersion: OPTIMIZER_MODEL_VERSION,
        graphVersion: GRAPH_ALGORITHM_VERSION,
        classifierVersion: INTENT_CLASSIFIER_VERSION,
        candidateProfileId: identity.id,
        candidateSemanticsHash: identity.semanticsHash
      },
      statistics: { method: EVIDENCE_STATISTICS_METHOD, tolerancePolicy: 'pre-registered-exact-v1', deterministicRegression: false },
      qualification: { grade: 'exploratory' }
    };
    const profile = new DefaultProfileCompiler().compile({ ...input, evidence: { records: [record] } });

    expect(profile.selected.prunedPluginIds).toContain('redundant-tool@x');
    expect(profile.quality.evidenceIds).toContain('evidence_exact');
  });

  it('does not promote smoke-only evidence into aggressive pruning', () => {
    const evidence = {
      records: [{
        schemaVersion: 1,
        id: 'evidence_smoke',
        suiteId: 'redundant-tool@x-suite',
        taskFamily: ['utility-edit'],
        claudeVersionFamily: '2.1-current',
        model: 'default',
        baselineProfileHash: 'native',
        candidateProfileHash: 'profile_x',
        trials: 2,
        quality: { baselineSuccess: 1, candidateSuccess: 1, difference: 0, lowerBound: 0, tolerance: 0, nonInferior: true },
        cost: {},
        createdAt: new Date().toISOString(),
        status: 'active' as const
      }]
    };
    const profile = new DefaultProfileCompiler().compile(baseInput({ inventory: inv, graph: g, mode: 'aggressive', evidence }));
    expect(profile.selected.enabledPluginIds).toContain('redundant-tool@x');
  });
});
