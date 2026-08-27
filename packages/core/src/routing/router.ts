import { DefaultIntentClassifier } from './classifier.js';
import { rankCapabilities } from './scoring.js';
import { DefaultPlanner, type RuntimeCapabilityGraph } from '../planning/planner.js';
import { DefaultOptimizer } from '../optimization/optimizer.js';
import type { CapabilityGraph, CCOConfig, EvidenceIndex, RepoFingerprint, RouteDecision } from '../types.js';
import { SCHEMA_VERSION } from '../types.js';

export interface RouteInput {
  prompt: string;
  cwd: string;
  sessionId: string;
  permissionMode?: string;
  profileId: string;
  profileValid: boolean;
  graph: CapabilityGraph;
  runtimeCapabilityIds: Set<string>;
  repo?: RepoFingerprint;
  evidence: EvidenceIndex;
  config: CCOConfig;
  agentTeamsEnabled: boolean;
  nowMs?: () => number;
}

export interface RouteResult {
  decision: RouteDecision;
  hintText: string | null;
}

export interface RuntimeRouter {
  route(input: RouteInput): RouteResult;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function sessionIdHash(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return 'h' + (h >>> 0).toString(16);
}

const AMBIGUITY_ABSTAIN_SCORE = 0.28;

/**
 * Deterministic runtime router (07_RUNTIME_ROUTER_AND_PLANNER.md, 32_ALGORITHMS_PSEUDOCODE.md
 * section 7). Pure and deadline-bounded; abstains (returns no context) on every uncertain path
 * rather than guessing (NFR-002, FR-011).
 */
export class DefaultRuntimeRouter implements RuntimeRouter {
  route(input: RouteInput): RouteResult {
    const start = (input.nowMs ?? Date.now)();
    const deadline = start + input.config.routing.hardDeadlineMs;
    const classifier = new DefaultIntentClassifier();

    if (!input.profileValid) return this.abstain(input, 'STALE_PROFILE', 0);
    if (!input.config.routing.enabled) return this.abstain(input, 'ROUTING_DISABLED', 0);

    const intent = classifier.classify({ prompt: input.prompt, repo: input.repo });
    if (intent.confidence < 0.3) return this.abstain(input, 'LOW_INTENT_CONFIDENCE', intent.confidence, intent);

    const runtimeNodes = input.graph.nodes.filter((n) => input.runtimeCapabilityIds.has(n.id) && n.type !== 'plugin');
    const rankedAvailable = rankCapabilities(runtimeNodes, intent, input.repo, input.evidence, input.graph);

    if ((input.nowMs ?? Date.now)() > deadline) return this.abstain(input, 'DEADLINE', intent.confidence, intent);

    const top = rankedAvailable[0];
    const second = rankedAvailable[1];
    const threshold = input.config.routing.confidenceThreshold * AMBIGUITY_ABSTAIN_SCORE * 2;

    if (!top || top.score < threshold) {
      const allNodes = input.graph.nodes.filter((n) => n.type !== 'plugin');
      const rankedAll = rankCapabilities(allNodes, intent, input.repo, input.evidence, input.graph);
      const globalTop = rankedAll[0];
      if (globalTop && globalTop.score >= threshold && !input.runtimeCapabilityIds.has(globalTop.node.id)) {
        return this.abstain(input, 'OUT_OF_PROFILE_INTENT', intent.confidence, intent);
      }
      return this.abstain(input, 'LOW_SCORE', intent.confidence, intent);
    }
    if (second && top.score - second.score < input.config.routing.ambiguityMargin) {
      return this.abstain(input, 'AMBIGUOUS', intent.confidence, intent);
    }

    const runtime: RuntimeCapabilityGraph = { graph: input.graph, runtimeCapabilityIds: input.runtimeCapabilityIds };
    const plans = new DefaultPlanner().candidates(intent, runtime, input.repo, input.evidence, input.agentTeamsEnabled);
    const selected = new DefaultOptimizer().selectPlan(plans, { agentTeamsEnabled: input.agentTeamsEnabled });

    if ((input.nowMs ?? Date.now)() > deadline) return this.abstain(input, 'DEADLINE', intent.confidence, intent);
    if (selected.type === 'native') return this.abstain(input, 'NATIVE_BEST', intent.confidence, intent);

    const text = this.compactRouteText(selected, intent);
    if (estimateTokens(text) > input.config.routing.maxInjectedTokens) {
      return this.abstain(input, 'CONTEXT_BUDGET', intent.confidence, intent);
    }
    if ((input.nowMs ?? Date.now)() > deadline) return this.abstain(input, 'DEADLINE', intent.confidence, intent);

    const decision: RouteDecision = {
      schemaVersion: SCHEMA_VERSION,
      sessionIdHash: sessionIdHash(input.sessionId),
      profileId: input.profileId,
      timestamp: new Date().toISOString(),
      intent: { operations: intent.operations, confidence: intent.confidence },
      action: 'inject',
      planType: selected.type,
      capabilityIds: selected.capabilityIds,
      confidence: top.score,
      reasonCode: 'HIGH_MARGIN_MATCH',
      injectedEstimatedTokens: estimateTokens(text),
      wallMs: (input.nowMs ?? Date.now)() - start
    };
    return { decision, hintText: text };
  }

  private abstain(input: RouteInput, reasonCode: string, confidence: number, intent?: { operations: string[] }): RouteResult {
    const decision: RouteDecision = {
      schemaVersion: SCHEMA_VERSION,
      sessionIdHash: sessionIdHash(input.sessionId),
      profileId: input.profileId,
      timestamp: new Date().toISOString(),
      intent: { operations: intent?.operations ?? [], confidence },
      action: 'abstain',
      planType: 'native',
      capabilityIds: [],
      confidence,
      reasonCode,
      injectedEstimatedTokens: 0,
      wallMs: 0
    };
    return { decision, hintText: null };
  }

  private compactRouteText(selected: { type: string; capabilityIds: string[] }, intent: { operations: string[]; domains: string[]; confidence: number }): string {
    const task = [...intent.operations, ...intent.domains].join('+') || 'general';
    const names = selected.capabilityIds.map((id) => id.split('/').pop() ?? id).join(', ');
    return `CCO route (confidence ${intent.confidence.toFixed(2)}): task=${task}. Prefer ${names}. Keep native tool selection; do not use unavailable capabilities.`;
  }
}
