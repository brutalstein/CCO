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
}

export interface ArmSummary {
  arm: string;
  trials: number;
  successRate: number;
  infrastructureFailures: number;
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
  verdict: NonInferiorityResult | null;
}
