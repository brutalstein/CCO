import { canonicalHash } from '@cco/platform';
import type { ClaudeEnvironment } from '@cco/claude-adapter';
import {
  OPTIMIZER_MODEL_VERSION,
  SCHEMA_VERSION,
  type CapabilityGraph,
  type CapabilityNode,
  type CCOConfig,
  type CompiledProfile,
  type EvidenceIndex,
  type InventorySnapshot,
  type NamedProfile,
  type OptimizationMode,
  type ProfileDecision,
  type ProfileReasonCode,
  type RepoFingerprint,
  type TaskIntent
} from '../types.js';

/** Canonical CCO plugin identity prefix; the CCO runtime plugin is always required for `cco run`. */
const CCO_PLUGIN_PREFIXES = ['cco@', 'cco'];

export interface CompileProfileInput {
  inventory: InventorySnapshot;
  graph: CapabilityGraph;
  repo: RepoFingerprint;
  intent?: TaskIntent;
  config: CCOConfig;
  evidence: EvidenceIndex;
  environment: ClaudeEnvironment;
  mode: OptimizationMode;
  explicitProfile?: NamedProfile;
}

export interface ProfileCompiler {
  compile(input: CompileProfileInput): CompiledProfile;
}

interface Affinity {
  repo: number;
  task: number | null;
}

function pluginNodes(graph: CapabilityGraph): CapabilityNode[] {
  return graph.nodes.filter((n) => n.type === 'plugin');
}

function componentsOf(graph: CapabilityGraph, pluginId: string): CapabilityNode[] {
  return graph.nodes.filter((n) => n.ownerPluginId === pluginId);
}

function isCcoPlugin(canonicalId: string): boolean {
  return CCO_PLUGIN_PREFIXES.some((p) => canonicalId === p || canonicalId.startsWith(p));
}

function repoEnvelopeTagIds(repo: RepoFingerprint): Set<string> {
  return new Set([
    ...repo.languages.map((l) => 'lang:' + l.id),
    ...repo.frameworks.map((f) => 'framework:' + f),
    ...repo.domains.map((d) => 'domain:' + d)
  ]);
}

function taskEnvelopeTagIds(intent: TaskIntent): Set<string> {
  return new Set([
    ...intent.operations.map((o) => 'operation:' + o),
    ...intent.domains.map((d) => 'domain:' + d),
    ...intent.languages.map((l) => 'lang:' + l)
  ]);
}

/** Combined affinity across the plugin node and every component it owns (06_SESSION_PROFILE_COMPILER.md section 5). */
function envelopeAffinity(plugin: CapabilityNode, graph: CapabilityGraph, repo: RepoFingerprint, intent: TaskIntent | undefined): Affinity {
  const repoTags = repoEnvelopeTagIds(repo);
  const taskTags = intent ? taskEnvelopeTagIds(intent) : null;
  const nodes = [plugin, ...componentsOf(graph, plugin.id)];

  let repoScore = 0;
  let taskScore = 0;
  for (const node of nodes) {
    for (const tag of node.tags) {
      if (repoTags.has(tag.id)) repoScore = Math.max(repoScore, tag.confidence);
      if (taskTags?.has(tag.id)) taskScore = Math.max(taskScore, tag.confidence);
    }
  }
  return { repo: repoScore, task: intent ? taskScore : null };
}

function structurallyIrrelevant(plugin: CapabilityNode, affinity: Affinity, config: CCOConfig): boolean {
  const max = config.optimization.safePruneAffinityMax;
  const taskOk = affinity.task === null || affinity.task <= max;
  return affinity.repo <= max && taskOk && plugin.metadataConfidence >= config.optimization.metadataConfidenceMin;
}

function hasStrongRelevance(affinity: Affinity): boolean {
  return affinity.repo > 0.5 || (affinity.task ?? 0) > 0.5;
}

/**
 * Session profile compiler (06_SESSION_PROFILE_COMPILER.md, 32_ALGORITHMS_PSEUDOCODE.md section 5).
 * Lexicographic policy: safety/policy/dependencies first, then quality/coverage, only then cost.
 * Never enables a baseline-disabled plugin; unknown metadata always resolves to "keep".
 */
export class DefaultProfileCompiler implements ProfileCompiler {
  compile(input: CompileProfileInput): CompiledProfile {
    const { inventory, graph, repo, intent, config, mode } = input;
    const baselineIds = inventory.plugins.filter((p) => p.enabled).map((p) => p.canonicalId);
    const decisions: ProfileDecision[] = [];

    if (mode === 'native') {
      return this.build(input, baselineIds, [], decisions, 'native-no-delta');
    }

    const neverDisable = new Set([...config.profile.neverDisable, ...(input.explicitProfile?.neverDisable ?? [])]);
    const protectedIds = new Set([...config.profile.protected, ...(input.explicitProfile?.protectedIds ?? [])]);
    const excluded = new Set(input.explicitProfile?.excluded ?? []);

    const pruned: string[] = [];
    const kept: string[] = [];

    for (const canonicalId of baselineIds) {
      const record = inventory.plugins.find((p) => p.canonicalId === canonicalId)!;
      const node = pluginNodes(graph).find((n) => n.id === 'plugin:' + canonicalId);

      if (record.managed) {
        kept.push(canonicalId);
        decisions.push(decision(canonicalId, 'keep', ['KEEP_MANAGED'], 'managed plugin', {}));
        continue;
      }
      if (isCcoPlugin(canonicalId)) {
        kept.push(canonicalId);
        decisions.push(decision(canonicalId, 'keep', ['KEEP_DEPENDENCY'], 'CCO runtime plugin', {}));
        continue;
      }
      if (neverDisable.has(canonicalId)) {
        kept.push(canonicalId);
        decisions.push(decision(canonicalId, 'keep', ['KEEP_USER_PIN'], 'user pin', {}));
        continue;
      }
      if (excluded.has(canonicalId)) {
        pruned.push(canonicalId);
        decisions.push(decision(canonicalId, 'prune', ['PRUNE_EXPLICIT_PROFILE'], 'excluded by named profile', {}));
        continue;
      }
      if (protectedIds.has(canonicalId)) {
        kept.push(canonicalId);
        decisions.push(decision(canonicalId, 'keep', ['KEEP_PROTECTED'], 'protected/opaque', {}));
        continue;
      }
      if (!node) {
        kept.push(canonicalId);
        decisions.push(decision(canonicalId, 'keep', ['KEEP_UNCERTAIN'], 'no graph metadata available', {}));
        continue;
      }

      const affinity = envelopeAffinity(node, graph, repo, intent);

      if (mode === 'observe') {
        kept.push(canonicalId);
        decisions.push(decision(canonicalId, 'keep', ['KEEP_UNCERTAIN'], 'observe mode: analysis only, no delta applied', { affinity }));
        continue;
      }

      if (node.metadataConfidence < config.optimization.metadataConfidenceMin) {
        kept.push(canonicalId);
        decisions.push(decision(canonicalId, 'keep', ['KEEP_UNCERTAIN'], 'metadata confidence below floor', { affinity, metadataConfidence: node.metadataConfidence }));
        continue;
      }

      if (hasStrongRelevance(affinity)) {
        const code: ProfileReasonCode = (affinity.task ?? 0) > affinity.repo ? 'KEEP_HIGH_TASK_AFFINITY' : 'KEEP_HIGH_REPO_AFFINITY';
        kept.push(canonicalId);
        decisions.push(decision(canonicalId, 'keep', [code], 'relevant to repository or task envelope', { affinity }));
        continue;
      }

      if (structurallyIrrelevant(node, affinity, config)) {
        pruned.push(canonicalId);
        decisions.push(decision(canonicalId, 'prune', ['PRUNE_STRUCTURAL_IRRELEVANCE'], 'no repository/task affinity; no dependency', { affinity }));
        continue;
      }

      const nonInferiorEvidenceId = this.findNonInferiorEvidence(input, canonicalId, graph);
      if (mode === 'aggressive' && nonInferiorEvidenceId) {
        pruned.push(canonicalId);
        decisions.push(decision(canonicalId, 'prune', ['PRUNE_NONINFERIOR_REDUNDANT'], 'redundant with non-inferiority evidence', { affinity, evidenceId: nonInferiorEvidenceId }));
        continue;
      }

      kept.push(canonicalId);
      decisions.push(decision(canonicalId, 'keep', ['KEEP_UNCERTAIN'], 'insufficient evidence to prune safely', { affinity }));
    }

    const { finalKept, finalPruned, finalDecisions } = this.closeDependencies(kept, pruned, decisions, graph);
    return this.build(input, finalKept, finalPruned, finalDecisions, 'compiled');
  }

  private closeDependencies(
    kept: string[],
    pruned: string[],
    decisions: ProfileDecision[],
    graph: CapabilityGraph
  ): { finalKept: string[]; finalPruned: string[]; finalDecisions: ProfileDecision[] } {
    const keptSet = new Set(kept);
    const prunedSet = new Set(pruned);
    const decisionMap = new Map(decisions.map((d) => [d.subjectId, d]));

    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of graph.edges) {
        if (edge.type !== 'depends_on') continue;
        const fromId = edge.from.replace('plugin:', '');
        const toId = edge.to.replace('plugin:', '');
        if (keptSet.has(fromId) && prunedSet.has(toId)) {
          prunedSet.delete(toId);
          keptSet.add(toId);
          decisionMap.set(toId, decision(toId, 'keep', ['KEEP_DEPENDENCY'], 'required by a selected capability: ' + fromId, {}));
          changed = true;
        }
      }
    }

    return {
      finalKept: [...keptSet],
      finalPruned: [...prunedSet],
      finalDecisions: [...decisionMap.values()]
    };
  }

  private findNonInferiorEvidence(input: CompileProfileInput, canonicalId: string, _graph: CapabilityGraph): string | null {
    const match = input.evidence.records.find(
      (r) => r.status === 'active' && r.quality.nonInferior && r.suiteId.includes(canonicalId)
    );
    return match?.id ?? null;
  }

  private build(
    input: CompileProfileInput,
    keptIds: string[],
    prunedIds: string[],
    decisions: ProfileDecision[],
    qualityStatus: string
  ): CompiledProfile {
    const { inventory, graph, repo, intent, config, mode } = input;
    const baselineIds = inventory.plugins.filter((p) => p.enabled).map((p) => p.canonicalId);
    const intentHash = intent ? canonicalHash(intent) : null;

    const id = 'profile_' + canonicalHash({ mode, inventoryId: inventory.id, repoId: repo.id, intentHash, config, explicitProfile: input.explicitProfile });

    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const costOf = (id2: string) => nodeById.get('plugin:' + id2)?.cost;
    const sumCost = (ids: string[]) => ids.reduce((acc, id2) => acc + (costOf(id2)?.alwaysOnTokens ?? 0), 0);
    const unknownCount = (ids: string[]) => ids.filter((id2) => (costOf(id2)?.source ?? 'unknown') === 'unknown').length;

    const overlayEnabled: Record<string, boolean> = {};
    for (const id2 of prunedIds) overlayEnabled[id2] = false;

    const runtimeCapabilityIds = graph.nodes
      .filter((n) => (n.type === 'plugin' ? keptIds.includes(n.id.replace('plugin:', '')) : n.ownerPluginId && keptIds.includes(n.ownerPluginId.replace('plugin:', ''))))
      .map((n) => n.id)
      .sort();

    const evidenceIds = [...new Set(decisions.map((d) => d.inputs.evidenceId as string | undefined).filter((x): x is string => !!x))];

    const profile: CompiledProfile = {
      schemaVersion: SCHEMA_VERSION,
      id,
      createdAt: new Date().toISOString(),
      mode,
      inventoryId: inventory.id,
      repoFingerprintId: repo.id,
      intentHash,
      baseline: { enabledPluginIds: baselineIds.slice().sort() },
      selected: { enabledPluginIds: keptIds.slice().sort(), prunedPluginIds: prunedIds.slice().sort() },
      overlay: { enabledPlugins: overlayEnabled },
      costProjection: {
        alwaysOnBefore: sumCost(baselineIds),
        alwaysOnAfter: sumCost(keptIds),
        unknownBefore: unknownCount(baselineIds),
        unknownAfter: unknownCount(keptIds)
      },
      quality: { status: qualityStatus, evidenceIds },
      decisions,
      runtimeCapabilityIds,
      integrityHash: ''
    };
    profile.integrityHash = canonicalHash({ ...profile, integrityHash: undefined, id: undefined, createdAt: undefined });
    void OPTIMIZER_MODEL_VERSION;
    return profile;
  }
}

function decision(subjectId: string, action: 'keep' | 'prune', codes: ProfileReasonCode[], explanation: string, inputs: Record<string, unknown>): ProfileDecision {
  return { subjectId, action, reasonCodes: codes, explanation, inputs, confidence: 0.9 };
}
