import path from 'node:path';
import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import type { ClaudeAdapter, ClaudeEnvironment } from '@cco/claude-adapter';
import { parseStreamJsonLines } from '@cco/claude-adapter';
import type { ProcessLauncher } from '@cco/platform';
import { createIsolatedCopy, cleanupIsolatedCopy } from './isolation.js';
import { evaluateNonInferiority } from './stats.js';
import type { ArmSummary, BenchmarkArm, BenchmarkRun, BenchmarkSuite, TrialResult, UsageTotals } from './types.js';

const DEFAULT_TRIAL_TIMEOUT_MS = 5 * 60 * 1000;

export interface BenchmarkRunOptions {
  minExploratoryTrialsPerArm?: number;
  publicClaimTrialsPerArm?: number;
  artifactRoot?: string;
}

export interface BenchmarkRunner {
  runSuite(suite: BenchmarkSuite, arms: BenchmarkArm[], tolerance: number, options?: BenchmarkRunOptions): Promise<BenchmarkRun>;
}

/** Baseline/candidate runner. Every trial owns a fresh disposable copy. */
export class DefaultBenchmarkRunner implements BenchmarkRunner {
  constructor(
    private readonly adapter: ClaudeAdapter,
    private readonly launcher: ProcessLauncher,
    private readonly environment: ClaudeEnvironment
  ) {}

  async runSuite(suite: BenchmarkSuite, arms: BenchmarkArm[], tolerance: number, options: BenchmarkRunOptions = {}): Promise<BenchmarkRun> {
    const runId = 'run_' + crypto.randomBytes(8).toString('hex');
    const trials: TrialResult[] = [];
    const order = this.alternatingOrder(arms, suite.trials);

    for (const { arm, trialIndex } of order) {
      trials.push(await this.runOneTrial(suite, arm, trialIndex, runId, options.artifactRoot));
    }

    const arms_: ArmSummary[] = arms.map((arm) => {
      const armTrials = trials.filter((trial) => trial.arm === arm.label);
      const usable = armTrials.filter((trial) => !trial.infrastructureFailure);
      return {
        arm: arm.label,
        trials: armTrials.length,
        successRate: usable.length > 0 ? usable.filter((trial) => trial.success).length / usable.length : 0,
        infrastructureFailures: armTrials.filter((trial) => trial.infrastructureFailure).length,
        usageTotals: usageTotals(armTrials)
      };
    });

    const baseline = trials.filter((trial) => trial.arm === 'baseline');
    const candidate = trials.filter((trial) => trial.arm === 'candidate');
    const verdict = baseline.length > 0 && candidate.length > 0 ? evaluateNonInferiority(baseline, candidate, tolerance) : null;
    const minExploratory = options.minExploratoryTrialsPerArm ?? 3;
    const publicClaim = options.publicClaimTrialsPerArm ?? 10;
    const usablePerArm = arms_.length > 0 ? Math.min(...arms_.map((arm) => arm.trials - arm.infrastructureFailures)) : 0;
    const noInfrastructureFailures = arms_.every((arm) => arm.infrastructureFailures === 0);
    const grade = usablePerArm >= publicClaim ? 'public-claim' : usablePerArm >= minExploratory ? 'exploratory' : 'smoke';
    const eligibleForOptimization = !!verdict?.nonInferior && grade !== 'smoke' && noInfrastructureFailures;

    return {
      suiteId: suite.id,
      runId,
      createdAt: new Date().toISOString(),
      arms: arms_,
      trials,
      trialOrder: order.map(({ arm, trialIndex }) => `${arm.label}:${trialIndex}`),
      verdict,
      qualification: {
        grade,
        eligibleForOptimization,
        eligibleForPublicClaim: eligibleForOptimization && grade === 'public-claim',
        preregisteredTolerance: tolerance,
        minExploratoryTrialsPerArm: minExploratory,
        publicClaimTrialsPerArm: publicClaim
      }
    };
  }

  private alternatingOrder(arms: BenchmarkArm[], trialsPerArm: number): Array<{ arm: BenchmarkArm; trialIndex: number }> {
    const out: Array<{ arm: BenchmarkArm; trialIndex: number }> = [];
    for (let i = 0; i < trialsPerArm; i++) {
      const ordered = i % 2 === 0 ? arms : arms.slice().reverse();
      for (const arm of ordered) out.push({ arm, trialIndex: i });
    }
    return out;
  }

  private async runOneTrial(suite: BenchmarkSuite, arm: BenchmarkArm, trialIndex: number, runId: string, artifactRoot?: string): Promise<TrialResult> {
    const start = Date.now();
    const workDir = await createIsolatedCopy(suite.fixture.path);
    const infrastructure = (): TrialResult => ({
      arm: arm.label,
      trialIndex,
      success: false,
      deterministicFailures: [],
      wallMs: Date.now() - start,
      usage: {},
      infrastructureFailure: true,
      rawArtifactPath: null,
      subagentOrWorkflowEvents: 0
    });

    try {
      if (!this.environment.found) return infrastructure();
      const prompt = await fs.readFile(path.join(workDir, suite.promptFile), 'utf8').catch(() => null);
      if (prompt === null) return infrastructure();

      const spec = this.adapter.benchmarkInvocation({
        prompt,
        model: suite.claude.model,
        maxTurns: suite.claude.maxTurns,
        maxBudgetUsd: suite.claude.maxBudgetUsd,
        outputFormat: 'stream-json',
        cwd: workDir,
        settingsFile: arm.settingsFile ?? undefined,
        permissionMode: 'acceptEdits'
      });

      let result;
      try {
        result = await this.launcher.runCapture({ command: spec.command, args: spec.args, cwd: spec.cwd, env: spec.env }, DEFAULT_TRIAL_TIMEOUT_MS);
      } catch {
        return infrastructure();
      }
      if (result.timedOut) return infrastructure();

      const summary = parseStreamJsonLines(result.stdout);
      const checks = await this.runChecks(suite, workDir);
      const rawArtifactPath = await this.saveRawArtifact(artifactRoot, runId, arm.label, trialIndex, result.stdout);
      const subagentOrWorkflowEvents = summary.events.filter((event) => {
        if (!event || typeof event !== 'object') return false;
        const record = event as Record<string, unknown>;
        return typeof record.parent_tool_use_id === 'string' || /subagent|workflow/i.test(String(record.type ?? ''));
      }).length;
      const invocationInfrastructureFailure = result.code !== 0 && summary.events.length === 0;

      return {
        arm: arm.label,
        trialIndex,
        success: result.code === 0 && checks.failures.length === 0 && !checks.infrastructureFailure,
        deterministicFailures: checks.failures,
        wallMs: Date.now() - start,
        usage: summary.usage,
        infrastructureFailure: checks.infrastructureFailure || invocationInfrastructureFailure,
        rawArtifactPath,
        subagentOrWorkflowEvents
      };
    } finally {
      await cleanupIsolatedCopy(workDir);
    }
  }

  private async saveRawArtifact(root: string | undefined, runId: string, arm: string, trialIndex: number, stdout: string): Promise<string | null> {
    if (!root) return null;
    const relative = `trials/${arm}-${trialIndex}.jsonl`;
    const target = path.join(root, runId, ...relative.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, stdout, { mode: 0o600 });
    return relative;
  }

  private async runChecks(suite: BenchmarkSuite, workDir: string): Promise<{ failures: string[]; infrastructureFailure: boolean }> {
    const failures: string[] = [];
    let infrastructureFailure = false;
    for (const check of suite.checks) {
      if (check.type === 'command' && check.command?.length) {
        try {
          const result = await this.launcher.runCapture({ command: check.command[0], args: check.command.slice(1), cwd: workDir }, DEFAULT_TRIAL_TIMEOUT_MS);
          if (result.timedOut) infrastructureFailure = true;
          else if (result.code !== 0) failures.push(check.commandId ?? check.command.join(' '));
        } catch {
          infrastructureFailure = true;
        }
      } else if (check.type === 'file-assertion' && check.rule) {
        const [operation, relative] = check.rule.split(':', 2);
        const target = path.resolve(workDir, relative ?? '');
        const contained = path.relative(workDir, target);
        if (!relative || contained.startsWith('..') || path.isAbsolute(contained)) {
          infrastructureFailure = true;
          continue;
        }
        const exists = await fs.stat(target).then(() => true).catch(() => false);
        if ((operation === 'exists' && !exists) || (operation === 'not-exists' && exists)) {
          failures.push(check.commandId ?? check.rule);
        } else if (operation !== 'exists' && operation !== 'not-exists') {
          infrastructureFailure = true;
        }
      }
    }
    return { failures, infrastructureFailure };
  }
}

function usageTotals(trials: TrialResult[]): UsageTotals {
  return trials.reduce((total, trial) => ({
    inputTokens: total.inputTokens + (trial.usage.inputTokens ?? 0),
    outputTokens: total.outputTokens + (trial.usage.outputTokens ?? 0),
    cacheReadTokens: total.cacheReadTokens + (trial.usage.cacheReadTokens ?? 0),
    cacheWriteTokens: total.cacheWriteTokens + (trial.usage.cacheWriteTokens ?? 0),
    costUsd: total.costUsd + (trial.usage.costUsd ?? 0),
    wallMs: total.wallMs + trial.wallMs,
    subagentOrWorkflowEvents: total.subagentOrWorkflowEvents + trial.subagentOrWorkflowEvents
  }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, wallMs: 0, subagentOrWorkflowEvents: 0 });
}
