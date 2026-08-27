import { describe, expect, it } from 'vitest';
import { DefaultOptimizer, DefaultPlanner, type ExecutionPlan } from '../src/index.js';
import type { CapabilityGraph, TaskIntent } from '../src/types.js';

const native: ExecutionPlan = {
  type: 'native',
  capabilityIds: [],
  expectedQualityClass: 'B',
  coverageEstimate: 0.5,
  expectedEffectiveCost: 0,
  mainContextRelief: 0,
  experimental: false,
  reasons: ['baseline']
};

describe('planner policy gates', () => {
  it('G07: native wins when a specialized plan has no quality or coverage benefit', () => {
    const specialized: ExecutionPlan = {
      ...native,
      type: 'single-skill',
      capabilityIds: ['skill:x'],
      expectedEffectiveCost: 0.1,
      reasons: ['no measured benefit']
    };
    expect(new DefaultOptimizer().selectPlan([specialized, native], { agentTeamsEnabled: false }).type).toBe('native');
  });

  it('G08/G09: disabled teams are never proposed and planner does not override the user model', () => {
    const graph: CapabilityGraph = {
      schemaVersion: 1,
      inventoryFingerprint: 'inv',
      generatedAt: '2026-01-01T00:00:00.000Z',
      nodes: [],
      edges: [],
      buildAlgorithmVersion: 'graph-1',
      sourceHashes: {}
    };
    const intent: TaskIntent = {
      schemaVersion: 1,
      operations: ['code-review'],
      domains: ['security'],
      languages: [],
      artifacts: [],
      complexity: 'high',
      parallelism: 'high',
      confidence: 0.9,
      classifierVersion: 'intent-1'
    };
    const plans = new DefaultPlanner().candidates(intent, { graph, runtimeCapabilityIds: new Set() }, undefined, { records: [] }, false);
    expect(plans.some((plan) => plan.type === 'agent-team')).toBe(false);
    expect(plans.every((plan) => plan.modelRecommendation === undefined)).toBe(true);
  });
});
