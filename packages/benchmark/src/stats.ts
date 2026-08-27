import type { NonInferiorityResult, TrialResult } from './types.js';

const Z_95_ONE_SIDED = 1.645;

function successRate(trials: TrialResult[]): number {
  const usable = trials.filter((t) => !t.infrastructureFailure);
  if (usable.length === 0) return 0;
  return usable.filter((t) => t.success).length / usable.length;
}

/** One-sided Newcombe score interval over two independent Wilson proportions. */
export function evaluateNonInferiority(baseline: TrialResult[], candidate: TrialResult[], tolerance: number): NonInferiorityResult {
  const deterministicRegression = candidate.some((t) => !t.infrastructureFailure && t.deterministicFailures.length > 0 && !baselineHasSameFailure(baseline, t));

  const baselineSuccess = successRate(baseline);
  const candidateSuccess = successRate(candidate);
  const n1 = candidate.filter((t) => !t.infrastructureFailure).length;
  const n2 = baseline.filter((t) => !t.infrastructureFailure).length;

  const difference = candidateSuccess - baselineSuccess;
  const candidateInterval = wilson(candidateSuccess, n1);
  const baselineInterval = wilson(baselineSuccess, n2);
  const lowerBound = n1 > 0 && n2 > 0
    ? difference - Math.sqrt((candidateSuccess - candidateInterval.lower) ** 2 + (baselineInterval.upper - baselineSuccess) ** 2)
    : -1;
  const nonInferior = !deterministicRegression && lowerBound >= -tolerance;

  return { baselineSuccess, candidateSuccess, difference, lowerBound, tolerance, nonInferior, deterministicRegression };
}

function wilson(rate: number, n: number): { lower: number; upper: number } {
  if (n <= 0) return { lower: 0, upper: 1 };
  const z2 = Z_95_ONE_SIDED ** 2;
  const denominator = 1 + z2 / n;
  const center = (rate + z2 / (2 * n)) / denominator;
  const margin = Z_95_ONE_SIDED * Math.sqrt((rate * (1 - rate)) / n + z2 / (4 * n * n)) / denominator;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function baselineHasSameFailure(baseline: TrialResult[], candidateTrial: TrialResult): boolean {
  return baseline.some((b) => !b.infrastructureFailure && candidateTrial.deterministicFailures.every((f) => b.deterministicFailures.includes(f)));
}
