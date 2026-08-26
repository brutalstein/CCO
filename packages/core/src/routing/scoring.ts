import type { CapabilityGraph, CapabilityNode, EvidenceIndex, RepoFingerprint, TaskIntent } from '../types.js';

function taskTagIds(intent: TaskIntent): Set<string> {
  return new Set([
    ...intent.operations.map((o) => 'operation:' + o),
    ...intent.domains.map((d) => 'domain:' + d),
    ...intent.languages.map((l) => 'lang:' + l)
  ]);
}

function repoTagIds(repo?: RepoFingerprint): Set<string> {
  if (!repo) return new Set();
  return new Set([...repo.languages.map((l) => 'lang:' + l.id), ...repo.frameworks.map((f) => 'framework:' + f), ...repo.domains.map((d) => 'domain:' + d)]);
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const tb = new Set(b.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.max(ta.size, tb.size);
}

export interface ScoredCapability {
  node: CapabilityNode;
  score: number;
  /** Fraction of required task tags this capability covers (08_OPTIMIZATION_ENGINE.md section 8). */
  coverage: number;
}

/**
 * Capability rank score (07_RUNTIME_ROUTER_AND_PLANNER.md section 6). Weights are
 * algorithm-versioned constants, tuned only via benchmark calibration (08_OPTIMIZATION_ENGINE.md
 * section 15), never adjusted online.
 */
export function scoreCapability(node: CapabilityNode, intent: TaskIntent, repo: RepoFingerprint | undefined, evidence: EvidenceIndex, graph: CapabilityGraph): ScoredCapability {
  const taskTags = taskTagIds(intent);
  const repoTags = repoTagIds(repo);

  const nodeText = node.displayName + ' ' + node.tags.map((t) => t.id).join(' ');
  const intentText = [...intent.operations, ...intent.domains, ...intent.languages].join(' ');
  const lexicalMatch = tokenOverlap(nodeText, intentText);

  const tagHits = node.tags.filter((t) => taskTags.has(t.id));
  const coverage = taskTags.size > 0 ? tagHits.length / taskTags.size : 0;

  const repoAffinity = node.tags.some((t) => repoTags.has(t.id)) ? Math.max(...node.tags.filter((t) => repoTags.has(t.id)).map((t) => t.confidence), 0) : 0;

  const evidencePrior = evidence.records.some((r) => r.status === 'active' && r.taskFamily.some((f) => intent.operations.includes(f))) ? 0.6 : 0.3;

  const specificity = node.type === 'plugin' ? 0.3 : 0.7;
  const availabilityConfidence = node.metadataConfidence;

  const redundancyPenalty = graph.edges.some((e) => e.type === 'redundant_with' && (e.from === node.id || e.to === node.id)) ? 0.05 : 0;
  const experimentalPenalty = node.riskFlags.includes('experimental') ? 0.1 : 0;

  const score =
    0.35 * lexicalMatch +
    0.2 * coverage +
    0.15 * repoAffinity +
    0.15 * evidencePrior +
    0.1 * specificity +
    0.05 * availabilityConfidence -
    redundancyPenalty -
    experimentalPenalty;

  return { node, score, coverage };
}

export function rankCapabilities(nodes: CapabilityNode[], intent: TaskIntent, repo: RepoFingerprint | undefined, evidence: EvidenceIndex, graph: CapabilityGraph): ScoredCapability[] {
  return nodes.map((node) => scoreCapability(node, intent, repo, evidence, graph)).sort((a, b) => b.score - a.score);
}
