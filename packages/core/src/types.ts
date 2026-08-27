import type { PluginInventorySource, ClaudeEnvironment } from '@cco/claude-adapter';

export const SCHEMA_VERSION = 1;
export const CCO_VERSION = '1.0.0';
export const OPTIMIZER_MODEL_VERSION = 'optimizer-1';
export const GRAPH_ALGORITHM_VERSION = 'graph-1';
export const INTENT_CLASSIFIER_VERSION = 'intent-1';

export type OptimizationMode = 'observe' | 'safe' | 'aggressive' | 'native';

export type CapabilityType =
  | 'plugin'
  | 'skill'
  | 'agent'
  | 'hook'
  | 'mcp_server'
  | 'mcp_tool'
  | 'lsp_server'
  | 'workflow'
  | 'instruction_source'
  | 'model_option';

export type Availability =
  | 'baseline_disabled'
  | 'baseline_enabled'
  | 'profile_selected'
  | 'profile_pruned'
  | 'runtime_available';

export interface CapabilityTag {
  id: string;
  confidence: number;
  source: string;
}

export interface CapabilityCost {
  alwaysOnTokens?: number;
  invokeTokens?: number;
  source: 'anthropic_projected' | 'local_estimate' | 'unknown';
}

export interface CapabilityNode {
  id: string;
  type: CapabilityType;
  ownerPluginId: string | null;
  displayName: string;
  descriptionHash: string;
  tags: CapabilityTag[];
  availability: Availability;
  cost: CapabilityCost;
  riskFlags: string[];
  metadataConfidence: number;
  dependencies: string[];
  managed: boolean;
  protected: boolean;
  baselineEnabled: boolean;
}

export type CapabilityEdgeType =
  | 'contains'
  | 'depends_on'
  | 'exposes'
  | 'affine_to'
  | 'redundant_with'
  | 'complements'
  | 'conflicts_with'
  | 'invokes'
  | 'constrained_by'
  | 'observed_with';

export interface CapabilityEdge {
  type: CapabilityEdgeType;
  from: string;
  to: string;
  confidence: number;
  provenance: string;
}

export interface CapabilityGraph {
  schemaVersion: number;
  inventoryFingerprint: string;
  generatedAt: string;
  nodes: CapabilityNode[];
  edges: CapabilityEdge[];
  buildAlgorithmVersion: string;
  sourceHashes: Record<string, string>;
}

export interface InventorySnapshot {
  schemaVersion: number;
  id: string;
  capturedAt: string;
  claude: ClaudeEnvironment;
  plugins: PluginInventorySource[];
  pluginDetails: Record<string, { alwaysOnTokens?: number; source: string; description?: string; dependencies: string[]; riskFlags: string[]; components: { type: string; id: string; name: string }[] }>;
  partial: boolean;
  missingSources: string[];
}

export interface RepoLanguage {
  id: string;
  weight: number;
}

export interface RepoFingerprint {
  schemaVersion: number;
  id: string;
  rootHash: string;
  git: { isRepo: boolean; branch: string | null; dirty: boolean };
  languages: RepoLanguage[];
  frameworks: string[];
  domains: string[];
  manifests: string[];
  workspaceKind: 'single-package' | 'monorepo';
  partial: boolean;
  fingerprintInputsHash: string;
}

export interface TaskIntent {
  schemaVersion: number;
  operations: string[];
  domains: string[];
  languages: string[];
  artifacts: string[];
  complexity: 'low' | 'medium' | 'high';
  parallelism: 'low' | 'medium' | 'high';
  confidence: number;
  classifierVersion: string;
}

export type ProfileReasonCode =
  | 'KEEP_MANAGED'
  | 'KEEP_USER_PIN'
  | 'KEEP_DEPENDENCY'
  | 'KEEP_HIGH_REPO_AFFINITY'
  | 'KEEP_HIGH_TASK_AFFINITY'
  | 'KEEP_UNIQUE_CAPABILITY'
  | 'KEEP_UNCERTAIN'
  | 'KEEP_QUALITY_EVIDENCE'
  | 'KEEP_PROTECTED'
  | 'PRUNE_STRUCTURAL_IRRELEVANCE'
  | 'PRUNE_NONINFERIOR_REDUNDANT'
  | 'PRUNE_EXPLICIT_PROFILE'
  | 'BLOCKED_BY_MANAGED_POLICY';

export interface ProfileDecision {
  subjectId: string;
  action: 'keep' | 'prune';
  reasonCodes: ProfileReasonCode[];
  explanation: string;
  inputs: Record<string, unknown>;
  confidence: number;
}

export interface CompiledProfile {
  schemaVersion: number;
  ccoVersion: string;
  id: string;
  createdAt: string;
  mode: OptimizationMode;
  inventoryId: string;
  repoFingerprintId: string;
  intentHash: string | null;
  baseline: { enabledPluginIds: string[] };
  selected: { enabledPluginIds: string[]; prunedPluginIds: string[] };
  overlay: { enabledPlugins: Record<string, boolean> };
  costProjection: {
    alwaysOnBefore: number;
    alwaysOnAfter: number;
    unknownBefore: number;
    unknownAfter: number;
  };
  quality: { status: string; evidenceIds: string[] };
  decisions: ProfileDecision[];
  runtimeCapabilityIds: string[];
  integrityHash: string;
}

export interface RouteDecision {
  schemaVersion: number;
  sessionIdHash: string;
  profileId: string;
  timestamp: string;
  intent: { operations: string[]; confidence: number };
  action: 'inject' | 'abstain';
  planType: string;
  capabilityIds: string[];
  confidence: number;
  reasonCode: string;
  injectedEstimatedTokens: number;
  wallMs: number;
}

export interface TelemetryEvent {
  schemaVersion: number;
  eventVersion: number;
  timestamp: string;
  type: string;
  ccoVersion: string;
  claudeVersion: string | null;
  projectId: string;
  sessionIdHash: string;
  payload: Record<string, unknown>;
}

export interface EvidenceRecord {
  schemaVersion: number;
  id: string;
  suiteId: string;
  taskFamily: string[];
  claudeVersionFamily: string;
  model: string;
  baselineProfileHash: string;
  candidateProfileHash: string;
  trials: number;
  quality: {
    baselineSuccess: number;
    candidateSuccess: number;
    difference: number;
    lowerBound: number;
    tolerance: number;
    nonInferior: boolean;
  };
  cost: Record<string, unknown>;
  createdAt: string;
  status: 'active' | 'quarantined';
}

export interface EvidenceIndex {
  records: EvidenceRecord[];
}

export interface CCOConfig {
  schemaVersion: number;
  mode: OptimizationMode;
  profile: { strategy: 'auto' | 'named'; defaultName: string | null; neverDisable: string[]; protected: string[] };
  routing: {
    enabled: boolean;
    confidenceThreshold: number;
    ambiguityMargin: number;
    maxInjectedTokens: number;
    hardDeadlineMs: number;
    tieBreaker: 'none' | 'claude';
  };
  optimization: {
    safePruneAffinityMax: number;
    metadataConfidenceMin: number;
    quality: {
      mode: 'non-inferiority';
      defaultTolerance: number;
      minExploratoryTrialsPerArm: number;
      publicClaimTrialsPerArm: number;
    };
    modelOptimization: boolean;
    preferStableProfile: boolean;
  };
  repository: { maxTrackedFiles: number; maxManifestBytes: number; maxTotalParsedBytes: number; deepScan: boolean };
  privacy: {
    storeRawPrompts: boolean;
    storeTranscriptContent: boolean;
    storePromptHash: boolean;
    remoteTelemetry: boolean;
    eventRetentionDays: number;
  };
  benchmark: { defaultTrials: number; isolation: 'worktree' | 'copy'; saveRawStreams: boolean };
  experimental: { agentTeams: boolean; llmRoutingTieBreaker: boolean };
  neverDisable?: string[];
}

export interface NamedProfile {
  name: string;
  neverDisable: string[];
  protectedIds: string[];
  excluded: string[];
}
