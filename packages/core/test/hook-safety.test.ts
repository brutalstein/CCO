import { describe, expect, it } from 'vitest';
import {
  CCO_VERSION,
  profileIntegrityHash,
  sessionStartDigest,
  userPromptSubmitRoute,
  validateHookArtifacts,
  type CapabilityGraph,
  type CompiledProfile
} from '../src/index.js';

function artifacts(): { profile: CompiledProfile; graph: CapabilityGraph } {
  const graph: CapabilityGraph = {
    schemaVersion: 1,
    inventoryFingerprint: 'inv_fixture',
    generatedAt: new Date(0).toISOString(),
    nodes: [{
      id: 'skill:fixture/review',
      type: 'skill',
      ownerPluginId: 'plugin:fixture@example',
      displayName: 'review',
      descriptionHash: 'hash',
      tags: [],
      availability: 'runtime_available',
      cost: { source: 'unknown' },
      riskFlags: [],
      metadataConfidence: 1,
      dependencies: [],
      managed: false,
      protected: false,
      baselineEnabled: true
    }],
    edges: [],
    buildAlgorithmVersion: 'graph-1',
    sourceHashes: { inventory: 'inv_fixture', repo: 'repo_fixture' }
  };
  const profile: CompiledProfile = {
    schemaVersion: 1,
    ccoVersion: CCO_VERSION,
    id: 'profile_fixture',
    createdAt: new Date(0).toISOString(),
    mode: 'safe',
    inventoryId: 'inv_fixture',
    repoFingerprintId: 'repo_fixture',
    intentHash: null,
    baseline: { enabledPluginIds: ['fixture@example'] },
    selected: { enabledPluginIds: ['fixture@example'], prunedPluginIds: [] },
    overlay: { enabledPlugins: {} },
    costProjection: { alwaysOnBefore: 10, alwaysOnAfter: 10, unknownBefore: 0, unknownAfter: 0 },
    quality: { status: 'compiled', evidenceIds: [] },
    decisions: [],
    runtimeCapabilityIds: ['skill:fixture/review'],
    integrityHash: ''
  };
  profile.integrityHash = profileIntegrityHash(profile);
  return { profile, graph };
}

describe('hook artifact safety', () => {
  it('F03: accepts an intact profile paired with its graph', () => {
    const { profile, graph } = artifacts();
    expect(validateHookArtifacts(profile, graph)).toEqual([]);
  });

  it('F03/K02: rejects a tampered profile before routing', () => {
    const { profile, graph } = artifacts();
    profile.overlay.enabledPlugins['other@example'] = true;
    expect(validateHookArtifacts(profile, graph).map((issue) => issue.code)).toContain('PROFILE_INTEGRITY');
  });

  it('F09: rejects a CLI/plugin major-version mismatch', () => {
    const { profile, graph } = artifacts();
    expect(validateHookArtifacts(profile, graph, '2.0.0').map((issue) => issue.code)).toContain('CCO_VERSION_MISMATCH');
  });

  it('rejects a stale graph or missing runtime capability', () => {
    const { profile, graph } = artifacts();
    graph.sourceHashes.repo = 'repo_other';
    graph.nodes = [];
    const codes = validateHookArtifacts(profile, graph).map((issue) => issue.code);
    expect(codes).toContain('GRAPH_STALE');
    expect(codes).toContain('RUNTIME_CAPABILITY_MISSING');
  });

  it('F04: session digest remains below the 120-token estimate budget', () => {
    const { profile, graph } = artifacts();
    const digest = sessionStartDigest({ profile, graph, config: {} as never, evidence: { records: [] }, agentTeamsEnabled: false });
    expect(digest).not.toBeNull();
    expect(Math.ceil((digest?.length ?? 0) / 4)).toBeLessThanOrEqual(120);
  });

  it('F05/F06/F08: prompt routing stays compact, non-blocking, and below the p95 latency budget', () => {
    const { profile, graph } = artifacts();
    graph.nodes[0].tags = [
      { id: 'domain:security', confidence: 0.9, source: 'fixture' },
      { id: 'operation:code-review', confidence: 0.9, source: 'fixture' }
    ];
    const input = {
      profile,
      graph,
      config: {
        routing: { enabled: true, confidenceThreshold: 0.72, ambiguityMargin: 0.08, maxInjectedTokens: 220, hardDeadlineMs: 100 }
      } as never,
      evidence: { records: [] },
      agentTeamsEnabled: false
    };
    const durations: number[] = [];
    let result = userPromptSubmitRoute(input, 'perform a security review of authentication code', '/repo', 'session');
    for (let i = 0; i < 500; i++) {
      const start = performance.now();
      result = userPromptSubmitRoute(input, 'perform a security review of authentication code', '/repo', 'session');
      durations.push(performance.now() - start);
    }
    durations.sort((a, b) => a - b);
    expect(Math.ceil((result.hintText?.length ?? 0) / 4)).toBeLessThanOrEqual(220);
    expect(result).not.toHaveProperty('block');
    expect(durations[Math.floor(durations.length * 0.95)]).toBeLessThanOrEqual(75);
  });
});
