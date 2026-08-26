import path from 'node:path';
import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import type { ClaudeAdapter, ClaudeEnvironment } from '@cco/claude-adapter';
import { parseJsonOutput, parseStreamJsonLines } from '@cco/claude-adapter';
import type { ProcessLauncher } from '@cco/platform';
import { createIsolatedCopy, cleanupIsolatedCopy } from './isolation.js';
import { evaluateNonInferiority } from './stats.js';
import type { ArmSummary, BenchmarkArm, BenchmarkRun, BenchmarkSuite, TrialResult } from './types.js';

const DEFAULT_TRIAL_TIMEOUT_MS = 5 * 60 * 1000;

export interface BenchmarkRunner {
  runSuite(suite: BenchmarkSuite, arms: BenchmarkArm[], tolerance: number): Promise<BenchmarkRun>;
}

/**
 * Baseline-vs-candidate benchmark runner (20_BENCHMARK_HARNESS.md, FR-014).
 * Never runs against the user's live working tree; every trial gets a disposable copy.
 */
export class DefaultBenchmarkRunner implements BenchmarkRunner {
  constructor(
    private readonly adapter: ClaudeAdapter,
    private readonly launcher: ProcessLauncher,
    private readonly environment: ClaudeEnvironment
  ) {}

  async runSuite(suite: BenchmarkSuite, arms: BenchmarkArm[], tolerance: number): Promise<BenchmarkRun> {
    const trials: TrialResult[] = [];
    const order = this.alternatingOrder(arms, suite.trials);

    for (const { arm, trialIndex } of order) {
      trials.push(await this.runOneTrial(suite, arm, trialIndex));
    }

    const arms_: ArmSummary[] = arms.map((arm) => {
      const armTrials = trials.filter((t) => t.arm === arm.label);
      const usable = armTrials.filter((t) => !t.infrastructureFailure);
      return {
        arm: arm.label,
        trials: armTrials.length,
        successRate: usable.length > 0 ? usable.filter((t) => t.success).length / usable.length : 0,
        infrastructureFailures: armTrials.filter((t) => t.infrastructureFailure).length
      };
    });

    const baseline = trials.filter((t) => t.arm === 'baseline');
    const candidate = trials.filter((t) => t.arm === 'candidate');
    const verdict = baseline.length > 0 && candidate.length > 0 ? evaluateNonInferiority(baseline, candidate, tolerance) : null;

    return {
      suiteId: suite.id,
      runId: 'run_' + crypto.randomBytes(8).toString('hex'),
      createdAt: new Date().toISOString(),
      arms: arms_,
      trials,
      verdict
    };
  }

  private alternatingOrder(arms: BenchmarkArm[], trialsPerArm: number): Array<{ arm: BenchmarkArm; trialIndex: number }> {
    const out: Array<{ arm: BenchmarkArm; trialIndex: number }> = [];
    for (let i = 0; i < trialsPerArm; i++) {
      for (const arm of arms) out.push({ arm, trialIndex: i });
    }
    return out;
  }

  private async runOneTrial(suite: BenchmarkSuite, arm: BenchmarkArm, trialIndex: number): Promise<TrialResult> {
    const start = Date.now();
    const workDir = await createIsolatedCopy(suite.fixture.path);
    try {
      if (!this.environment.found) {
        return {
          arm: arm.label,
          trialIndex,
          success: false,
          deterministicFailures: [],
          wallMs: Date.now() - start,
          usage: {},
          infrastructureFailure: true,
          rawArtifactPath: null
        };
      }

      const prompt = await fs.readFile(path.join(workDir, suite.promptFile), 'utf8').catch(() => '');
      const spec = this.adapter.benchmarkInvocation({
        prompt,
        model: suite.claude.model,
        maxTurns: suite.claude.maxTurns,
        outputFormat: 'stream-json',
        cwd: workDir,
        settingsFile: arm.settingsFile ?? undefined
      });

      const result = await this.launcher.runCapture({ command: spec.command, args: spec.args, cwd: spec.cwd, env: spec.env }, DEFAULT_TRIAL_TIMEOUT_MS);
      if (result.timedOut) {
        return { arm: arm.label, trialIndex, success: false, deterministicFailures: [], wallMs: Date.now() - start, usage: {}, infrastructureFailure: true, rawArtifactPath: null };
      }

      const summary = suite.claude ? parseStreamJsonLines(result.stdout) : parseJsonOutput(result.stdout);
      const failures = await this.runChecks(suite, workDir);

      return {
        arm: arm.label,
        trialIndex,
        success: result.code === 0 && failures.length === 0,
        deterministicFailures: failures,
        wallMs: Date.now() - start,
        usage: summary.usage,
        infrastructureFailure: false,
        rawArtifactPath: null
      };
    } finally {
      await cleanupIsolatedCopy(workDir);
    }
  }

  private async runChecks(suite: BenchmarkSuite, workDir: string): Promise<string[]> {
    const failures: string[] = [];
    for (const check of suite.checks) {
      if (check.type === 'command' && check.command && check.command.length > 0) {
        const res = await this.launcher.runCapture({ command: check.command[0], args: check.command.slice(1), cwd: workDir }, DEFAULT_TRIAL_TIMEOUT_MS);
        if (res.code !== 0) failures.push(check.commandId ?? check.command.join(' '));
      }
    }
    return failures;
  }
}
