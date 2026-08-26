import type { ExecutionPlan } from '../planning/planner.js';
import { paretoFilter, type ParetoDimensions } from './pareto.js';
import type { CompiledProfile } from '../types.js';

export interface OptimizationContext {
  agentTeamsEnabled: boolean;
}

export interface ProfileCandidate {
  label: string;
  profile: CompiledProfile;
  qualityClass: 'A' | 'B' | 'C' | 'D';
  costEstimate: number;
}

export interface Optimizer {
  selectProfile(candidates: ProfileCandidate[], ctx: OptimizationContext): ProfileCandidate;
  selectPlan(candidates: ExecutionPlan[], ctx: OptimizationContext): ExecutionPlan;
}

const QUALITY_RANK: Record<string, number> = { A: 3, B: 2, C: 1, D: 0 };

/**
 * Feasibility -> Pareto -> lexicographic final selection (08_OPTIMIZATION_ENGINE.md
 * sections 9-10). A cheaper candidate never outranks one with better quality/coverage.
 */
export class DefaultOptimizer implements Optimizer {
  selectProfile(candidates: ProfileCandidate[], _ctx: OptimizationContext): ProfileCandidate {
    return candidates
      .slice()
      .sort((a, b) => QUALITY_RANK[b.qualityClass] - QUALITY_RANK[a.qualityClass] || a.costEstimate - b.costEstimate)[0];
  }

  selectPlan(candidates: ExecutionPlan[], ctx: OptimizationContext): ExecutionPlan {
    const native = candidates.find((c) => c.type === 'native');
    const feasible = candidates.filter((c) => c.expectedQualityClass !== 'D' && (!c.experimental || ctx.agentTeamsEnabled));
    if (feasible.length === 0) return native ?? candidates[0];

    const wrapped = feasible.map((plan) => ({
      item: plan,
      dims: {
        quality: QUALITY_RANK[plan.expectedQualityClass],
        coverage: plan.coverageEstimate,
        cost: plan.expectedEffectiveCost,
        latency: plan.expectedEffectiveCost
      } satisfies ParetoDimensions
    }));

    const survivors = paretoFilter(wrapped);
    survivors.sort((a, b) => {
      if (b.dims.quality !== a.dims.quality) return b.dims.quality - a.dims.quality;
      if (b.dims.coverage !== a.dims.coverage) return b.dims.coverage - a.dims.coverage;
      if (a.dims.cost !== b.dims.cost) return a.dims.cost - b.dims.cost;
      if (a.item.type === 'native') return -1;
      if (b.item.type === 'native') return 1;
      return 0;
    });

    return survivors[0]?.item ?? native ?? candidates[0];
  }
}
