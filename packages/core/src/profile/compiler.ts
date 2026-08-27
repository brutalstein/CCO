import { canonicalHash } from '@cco/platform';
import type { ClaudeEnvironment } from '@cco/claude-adapter';
import { profileIntegrityHash } from '../security/validator.js';
import { evaluateEvidenceApplicability } from '../quality/evidence.js';
import {
  CCO_VERSION,
  EVIDENCE_STATISTICS_METHOD,
  GRAPH_ALGORITHM_VERSION,
  INTENT_CLASSIFIER_VERSION,
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
  taskFamilies?: string[];
  model?: string;
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
  return affinity.repo <= max && taskOk && plugin.semanticCoverage >= config.optimization.semanticCoverageMin &&
    plugin.semanticClassificationConfidence >= config.optimization.semanticClassificationConfidenceMin;
}

function envelopeSemanticCertainty(plugin: CapabilityNode, graph: CapabilityGraph): { coverage: number; classificationConfidence: number } {
  const nodes = [plugin, ...componentsOf(graph, plugin.id)];
  return {
    coverage: nodes.reduce((sum, node) => sum + node.semanticCoverage, 0) / nodes.length,
    classificationConfidence: Math.max(...nodes.map((node) => node.semanticClassificationConfidence))
  };
}

function hasStrongRelevance(affinity: Affinity): boolean {
  return affinity.repo > 0.5 || (affinity.task ?? 0) > 0.5;
}

function preflightReasons(input: CompileProfileInput): string[] {
  const reasons: string[] = [];
  if (input.inventory.schemaVersion !== SCHEMA_VERSION) reasons.push('INCOMPATIBLE_INVENTORY_SCHEMA');
  if (input.repo.schemaVersion !== SCHEMA_VERSION) reasons.push('INCOMPATIBLE_REPOSITORY_SCHEMA');
  if (input.graph.schemaVersion !== SCHEMA_VERSION) reasons.push('INCOMPATIBLE_GRAPH_SCHEMA');
  if (!input.environment.found) reasons.push('UNSUPPORTED_CLAUDE_ENVIRONMENT');
  if (!input.inventory.baselineStateHash) reasons.push('LEGACY_INVENTORY_WITHOUT_BASELINE_STATE');
  if (input.inventory.partial) reasons.push('PARTIAL_INVENTORY');
  if (input.repo.partial) reasons.push('PARTIAL_REPOSITORY');
  if (input.graph.buildAlgorithmVersion !== GRAPH_ALGORITHM_VERSION) reasons.push('INCOMPATIBLE_GRAPH_ALGORITHM');
  if (input.graph.inventoryFingerprint !== input.inventory.id || input.graph.sourceHashes.inventory !== input.inventory.id) reasons.push('STALE_GRAPH_INVENTORY');
  if (input.graph.sourceHashes.repo !== input.repo.id) reasons.push('STALE_GRAPH_REPOSITORY');
  return reasons;
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

    const fallbackReasons = preflightReasons(input);
    if (fallbackReasons.length > 0) {
      return this.build({ ...input, mode: 'native' }, baselineIds, [], decisions, 'native-fallback', fallbackReasons);
    }

    const neverDisable = new Set([...config.profile.neverDisable, ...(input.explicitProfile?.neverDisable ?? [])]);
    const protectedIds = new Set([...config.profile.protected, ...(input.explicitProfile?.protectedIds ?? [])]);
    const excluded = new Set(input.explicitProfile?.excluded ?? []);

    const pruned: string[] = [];
    const kept: string[] = [];
    const evidenceCandidates = new Set<string>();

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
      const semantic = envelopeSemanticCertainty(node, graph);

      if (mode === 'observe') {
        kept.push(canonicalId);
        decisions.push(decision(canonicalId, 'keep', ['KEEP_UNCERTAIN'], 'observe mode: analysis only, no delta applied', { affinity }));
        continue;
      }

      if (semantic.coverage < config.optimization.semanticCoverageMin || semantic.classificationConfidence < config.optimization.semanticClassificationConfidenceMin) {
        kept.push(canonicalId);
        decisions.push(decision(canonicalId, 'keep', ['KEEP_UNCERTAIN'], 'semantic coverage or classification confidence below floor', {
          affinity,
          metadataParseConfidence: node.metadataParseConfidence,
          semanticCoverage: semantic.coverage,
          semanticClassificationConfidence: semantic.classificationConfidence
        }));
        continue;
      }

      if (hasStrongRelevance(affinity)) {
        const code: ProfileReasonCode = (affinity.task ?? 0) > affinity.repo ? 'KEEP_HIGH_TASK_AFFINITY' : 'KEEP_HIGH_REPO_AFFINITY';
        kept.push(canonicalId);
        decisions.push(decision(canonicalId, 'keep', [code], 'relevant to repository or task envelope', { affinity }));
        continue;
      }

      if (structurallyIrrelevant({
        ...node,
        semanticCoverage: semantic.coverage,
        semanticClassificationConfidence: semantic.classificationConfidence
      }, affinity, config)) {
        pruned.push(canonicalId);
        decisions.push(decision(canonicalId, 'prune', ['PRUNE_STRUCTURAL_IRRELEVANCE'], 'no repository/task affinity; no dependency', { affinity }));
        continue;
      }

      kept.push(canonicalId);
      decisions.push(decision(canonicalId, 'keep', ['KEEP_UNCERTAIN'], 'insufficient evidence to prune safely', { affinity }));
      if (mode === 'aggressive') evidenceCandidates.add(canonicalId);
    }

    if (mode === 'aggressive') {
      for (const record of input.evidence.records) {
        const rawCapabilityIds = record.applicability?.capabilityIds;
        const capabilityIds = Array.isArray(rawCapabilityIds) ? rawCapabilityIds.filter((id): id is string => typeof id === 'string') : [];
        if (capabilityIds.length === 0 || capabilityIds.some((id) => !evidenceCandidates.has(id) && !pruned.includes(id))) continue;
        const proposedPruned = [...new Set([...pruned, ...capabilityIds])];
        const proposedKept = baselineIds.filter((id) => !proposedPruned.includes(id));
        const closed = this.closeDependencies(proposedKept, proposedPruned, decisions, graph);
        if (capabilityIds.some((id) => !closed.finalPruned.includes(id))) continue;
        const identity = profileSemanticIdentity(input, closed.finalKept, closed.finalPruned);
        const applicability = evaluateEvidenceApplicability(record, {
          capabilityIds,
          taskFamilies: input.taskFamilies ?? [],
          claudeVersionFamily: input.environment.versionFamily,
          model: input.model ?? 'default',
          optimizerVersion: OPTIMIZER_MODEL_VERSION,
          graphVersion: GRAPH_ALGORITHM_VERSION,
          classifierVersion: input.intent?.classifierVersion ?? INTENT_CLASSIFIER_VERSION,
          candidateProfileId: identity.id,
          candidateSemanticsHash: identity.semanticsHash,
          baselineProfileId: 'native',
          minimumTrials: input.config.optimization.quality.minExploratoryTrialsPerArm,
          tolerancePolicy: 'pre-registered-exact-v1',
          tolerance: input.config.optimization.quality.defaultTolerance
        });
        if (!applicability.eligible) continue;
        for (const id of capabilityIds) {
          if (!evidenceCandidates.has(id)) continue;
          const keptIndex = kept.indexOf(id);
          if (keptIndex >= 0) kept.splice(keptIndex, 1);
          if (!pruned.includes(id)) pruned.push(id);
          const decisionIndex = decisions.findIndex((item) => item.subjectId === id);
          const replacement = decision(id, 'prune', ['PRUNE_NONINFERIOR_REDUNDANT'], 'exact candidate authorized by compatible non-inferiority evidence', { evidenceId: record.id });
          if (decisionIndex >= 0) decisions[decisionIndex] = replacement;
          else decisions.push(replacement);
        }
      }
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

  private build(
    input: CompileProfileInput,
    keptIds: string[],
    prunedIds: string[],
    decisions: ProfileDecision[],
    qualityStatus: string,
    fallbackReasons: string[] = []
  ): CompiledProfile {
    const { inventory, graph, repo, intent, config, mode } = input;
    const baselineIds = inventory.plugins.filter((p) => p.enabled).map((p) => p.canonicalId);
    const intentHash = intent ? canonicalHash(intent) : null;

    const identity = profileSemanticIdentity(input, keptIds, prunedIds);

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
      ccoVersion: CCO_VERSION,
      id: identity.id,
      semanticsHash: identity.semanticsHash,
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
      fallbackReasons,
      algorithmVersions: { optimizer: OPTIMIZER_MODEL_VERSION, graph: GRAPH_ALGORITHM_VERSION, classifier: intent?.classifierVersion ?? INTENT_CLASSIFIER_VERSION },
      decisions,
      runtimeCapabilityIds,
      integrityHash: ''
    };
    profile.integrityHash = profileIntegrityHash(profile);
    return profile;
  }
}

export function profileSemanticIdentity(
  input: CompileProfileInput,
  keptIds: string[],
  prunedIds: string[]
): { id: string; semanticsHash: string } {
  const semanticsHash = canonicalHash({
    schemaVersion: SCHEMA_VERSION,
    mode: input.mode,
    inventoryId: input.inventory.id,
    baselineStateHash: input.inventory.baselineStateHash ?? null,
    repoId: input.repo.id,
    repoInputsHash: input.repo.fingerprintInputsHash,
    intentHash: input.intent ? canonicalHash(input.intent) : null,
    config: input.config,
    explicitProfile: input.explicitProfile ?? null,
    selected: keptIds.slice().sort(),
    pruned: prunedIds.slice().sort(),
    optimizerVersion: OPTIMIZER_MODEL_VERSION,
    graphVersion: GRAPH_ALGORITHM_VERSION,
    classifierVersion: input.intent?.classifierVersion ?? INTENT_CLASSIFIER_VERSION,
    statisticsMethod: EVIDENCE_STATISTICS_METHOD
  });
  return { semanticsHash, id: 'profile_' + semanticsHash };
}

function decision(subjectId: string, action: 'keep' | 'prune', codes: ProfileReasonCode[], explanation: string, inputs: Record<string, unknown>): ProfileDecision {
  return { subjectId, action, reasonCodes: codes, explanation, inputs, confidence: 0.9 };
}
