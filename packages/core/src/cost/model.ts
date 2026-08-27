import type { ExecutionPlan } from '../planning/planner.js';
import type { CompiledProfile } from '../types.js';
import type { ToolSearchStatus } from '@cco/claude-adapter';

export type CacheDisruptionClass = 'none' | 'append_only' | 'deferred_tool_change' | 'tool_prefix_change' | 'model_switch' | 'unknown';

export interface CostCategory {
  value: number;
  source: 'anthropic_projected' | 'local_estimate' | 'unknown';
}

export interface CostProjection {
  categories: Record<string, CostCategory>;
  cacheDisruptionClass: CacheDisruptionClass;
  totalTokenEstimate: number;
}

export interface ProfileCostInput {
  profile: CompiledProfile;
  toolSearchStatus?: ToolSearchStatus;
  mcpTopologyChanged?: boolean;
}

export interface PlanCostInput {
  plan: ExecutionPlan;
}

export interface CostModel {
  profileCost(input: ProfileCostInput): CostProjection;
  planCost(input: PlanCostInput): CostProjection;
}

/** Multi-category cost accounting, never a single opaque number (10_TOKEN_COST_CACHE_MODEL.md). */
export class DefaultCostModel implements CostModel {
  profileCost(input: ProfileCostInput): CostProjection {
    const p = input.profile.costProjection;
    const cacheDisruptionClass: CacheDisruptionClass = !input.mcpTopologyChanged
      ? 'none'
      : input.toolSearchStatus === 'deferred-supported'
        ? 'deferred_tool_change'
        : input.toolSearchStatus === 'prefix-loaded-or-search-disabled'
          ? 'tool_prefix_change'
          : 'unknown';
    return {
      categories: {
        alwaysOnBefore: { value: p.alwaysOnBefore, source: 'anthropic_projected' },
        alwaysOnAfter: { value: p.alwaysOnAfter, source: 'anthropic_projected' },
        unknownBeforeCount: { value: p.unknownBefore, source: 'unknown' },
        unknownAfterCount: { value: p.unknownAfter, source: 'unknown' }
      },
      cacheDisruptionClass,
      totalTokenEstimate: p.alwaysOnAfter
    };
  }

  planCost(input: PlanCostInput): CostProjection {
    const plan = input.plan;
    const injectionTokens = Math.round(plan.expectedEffectiveCost * 300);
    const reliefTokens = Math.round(plan.mainContextRelief * 300);
    return {
      categories: {
        routeInjection: { value: injectionTokens, source: 'local_estimate' },
        mainContextRelief: { value: reliefTokens, source: 'local_estimate' }
      },
      cacheDisruptionClass: plan.modelRecommendation ? 'model_switch' : plan.type === 'native' ? 'none' : 'append_only',
      totalTokenEstimate: injectionTokens
    };
  }
}
