import type { NonInferiorityResult, TrialResult } from './types.js';

const Z_95_ONE_SIDED = 1.645;

function successRate(trials: TrialResult[]): number {
  const usable = trials.filter((t) => !t.infrastructureFailure);
  if (usable.length === 0) return 0;
  return usable.filter((t) => t.success).length / usable.length;
}

/**
 * Normal-approximation non-inferiority test on the difference of two success proportions
 * (09_QUALITY_MODEL_AND_EVALS.md section 4, 32_ALGORITHMS_PSEUDOCODE.md section 9).
 * ponytail: normal approximation, not a bootstrap interval; adequate for the trial counts
 * this product recommends (>=3 exploratory, >=10 public-claim) — upgrade to an exact/bootstrap
 * interval if a suite needs sub-3-trial statistical claims.
 */
export function evaluateNonInferiority(baseline: TrialResult[], candidate: TrialResult[], tolerance: number): NonInferiorityResult {
  const deterministicRegression = candidate.some((t) => !t.infrastructureFailure && t.deterministicFailures.length > 0 && !baselineHasSameFailure(baseline, t));

  const baselineSuccess = successRate(baseline);
  const candidateSuccess = successRate(candidate);
  const n1 = candidate.filter((t) => !t.infrastructureFailure).length;
  const n2 = baseline.filter((t) => !t.infrastructureFailure).length;

  const se =
    n1 > 0 && n2 > 0
      ? Math.sqrt((candidateSuccess * (1 - candidateSuccess)) / n1 + (baselineSuccess * (1 - baselineSuccess)) / n2)
      : 1;

  const difference = candidateSuccess - baselineSuccess;
  const lowerBound = difference - Z_95_ONE_SIDED * se;
  const nonInferior = !deterministicRegression && lowerBound >= -tolerance;

  return { baselineSuccess, candidateSuccess, difference, lowerBound, tolerance, nonInferior, deterministicRegression };
}

function baselineHasSameFailure(baseline: TrialResult[], candidateTrial: TrialResult): boolean {
  return baseline.some((b) => !b.infrastructureFailure && candidateTrial.deterministicFailures.every((f) => b.deterministicFailures.includes(f)));
}
