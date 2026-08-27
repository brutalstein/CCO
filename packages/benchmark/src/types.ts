export interface BenchmarkCheck {
  type: 'command' | 'file-assertion';
  commandId?: string;
  command?: string[];
  rule?: string;
}

export interface BenchmarkSuite {
  schemaVersion: number;
  id: string;
  taskFamily: string[];
  fixture: { type: 'local'; path: string };
  promptFile: string;
  claude: { model?: string; maxTurns?: number; maxBudgetUsd?: number };
  checks: BenchmarkCheck[];
  trials: number;
}

export interface BenchmarkArm {
  label: string;
  settingsFile: string | null;
}

export interface TrialResult {
  arm: string;
  trialIndex: number;
  success: boolean;
  deterministicFailures: string[];
  wallMs: number;
  usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; costUsd?: number };
  infrastructureFailure: boolean;
  rawArtifactPath: string | null;
  subagentOrWorkflowEvents: number;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  wallMs: number;
  subagentOrWorkflowEvents: number;
}

export interface ArmSummary {
  arm: string;
  trials: number;
  successRate: number;
  infrastructureFailures: number;
  usageTotals: UsageTotals;
}

export type EvidenceGrade = 'smoke' | 'exploratory' | 'public-claim';

export interface BenchmarkQualification {
  grade: EvidenceGrade;
  eligibleForOptimization: boolean;
  eligibleForPublicClaim: boolean;
  preregisteredTolerance: number;
  minExploratoryTrialsPerArm: number;
  publicClaimTrialsPerArm: number;
}

export interface NonInferiorityResult {
  baselineSuccess: number;
  candidateSuccess: number;
  difference: number;
  lowerBound: number;
  tolerance: number;
  nonInferior: boolean;
  deterministicRegression: boolean;
}

export interface BenchmarkRun {
  suiteId: string;
  runId: string;
  createdAt: string;
  arms: ArmSummary[];
  trials: TrialResult[];
  trialOrder: string[];
  verdict: NonInferiorityResult | null;
  qualification: BenchmarkQualification;
}
