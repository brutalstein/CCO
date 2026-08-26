import { describe, it, expect } from 'vitest';
import { DefaultRuntimeRouter, type RouteInput } from '../src/routing/router.js';
import { defaultConfig } from '../src/config/defaults.js';
import type { CapabilityGraph, CapabilityNode } from '../src/types.js';

function node(id: string, type: CapabilityNode['type'], owner: string | null, tags: string[]): CapabilityNode {
  return {
    id,
    type,
    ownerPluginId: owner,
    displayName: id,
    descriptionHash: 'h',
    tags: tags.map((t) => ({ id: t, confidence: 0.9, source: 'metadata' })),
    availability: 'baseline_enabled',
    cost: { source: 'unknown' },
    riskFlags: [],
    metadataConfidence: 0.9,
    dependencies: [],
    managed: false,
    protected: false,
    baselineEnabled: true
  };
}

const graph: CapabilityGraph = {
  schemaVersion: 1,
  inventoryFingerprint: 'inv',
  generatedAt: new Date().toISOString(),
  nodes: [
    node('plugin:security-tools@x', 'plugin', null, ['domain:security']),
    node('skill:security-tools@x/review-auth', 'skill', 'plugin:security-tools@x', ['domain:security', 'operation:code-review'])
  ],
  edges: [],
  buildAlgorithmVersion: 'graph-1',
  sourceHashes: {}
};

const runtimeCapabilityIds = new Set(graph.nodes.map((n) => n.id));

function baseInput(prompt: string): RouteInput {
  return {
    prompt,
    cwd: '/repo',
    sessionId: 'session-1',
    profileId: 'profile_test',
    profileValid: true,
    graph,
    runtimeCapabilityIds,
    evidence: { records: [] },
    config: defaultConfig(),
    agentTeamsEnabled: false
  };
}

describe('DefaultRuntimeRouter', () => {
  it('G03: abstains on an ambiguous tiny prompt', () => {
    const { decision } = new DefaultRuntimeRouter().route(baseInput('fix it'));
    expect(decision.action).toBe('abstain');
  });

  it('routes a clear security-review prompt to the matching skill', () => {
    const { decision } = new DefaultRuntimeRouter().route(baseInput('please do a security review of the authentication code'));
    expect(decision.action).toBe('inject');
    expect(decision.capabilityIds).toContain('skill:security-tools@x/review-auth');
  });

  it('G06: route capability IDs are always a subset of runtime-available IDs', () => {
    const { decision } = new DefaultRuntimeRouter().route(baseInput('please do a security review of the authentication code'));
    for (const id of decision.capabilityIds) expect(runtimeCapabilityIds.has(id)).toBe(true);
  });

  it('G10: identical prompt/profile produce the same route decision', () => {
    const prompt = 'please do a security review of the authentication code';
    const a = new DefaultRuntimeRouter().route(baseInput(prompt)).decision;
    const b = new DefaultRuntimeRouter().route(baseInput(prompt)).decision;
    expect(a.action).toBe(b.action);
    expect(a.capabilityIds).toEqual(b.capabilityIds);
    expect(a.reasonCode).toBe(b.reasonCode);
  });

  it('abstains when the profile is stale/invalid', () => {
    const input = baseInput('please do a security review of the authentication code');
    input.profileValid = false;
    const { decision } = new DefaultRuntimeRouter().route(input);
    expect(decision.action).toBe('abstain');
    expect(decision.reasonCode).toBe('STALE_PROFILE');
  });
});
