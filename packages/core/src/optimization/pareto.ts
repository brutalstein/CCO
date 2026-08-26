export interface ParetoDimensions {
  quality: number;
  coverage: number;
  cost: number;
  latency: number;
}

/**
 * Pareto dominance filter (08_OPTIMIZATION_ENGINE.md section 9, 32_ALGORITHMS_PSEUDOCODE.md
 * section 8). A dominates B if A is no worse on quality/coverage/cost/latency and strictly
 * better on at least one. Removes candidates that cannot be justified before any scalar tie-break.
 */
export function paretoFilter<T>(candidates: Array<{ item: T; dims: ParetoDimensions }>): Array<{ item: T; dims: ParetoDimensions }> {
  return candidates.filter((a) => !candidates.some((b) => b !== a && dominates(b.dims, a.dims)));
}

function dominates(b: ParetoDimensions, a: ParetoDimensions): boolean {
  const noWorse = b.quality >= a.quality && b.coverage >= a.coverage && b.cost <= a.cost && b.latency <= a.latency;
  const strictlyBetter = b.quality > a.quality || b.coverage > a.coverage || b.cost < a.cost || b.latency < a.latency;
  return noWorse && strictlyBetter;
}
