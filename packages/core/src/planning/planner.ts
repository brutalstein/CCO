import type { CapabilityGraph, EvidenceIndex, RepoFingerprint, TaskIntent } from '../types.js';
import { rankCapabilities, type ScoredCapability } from '../routing/scoring.js';

export type ExecutionPlanType = 'native' | 'single-skill' | 'skill-agent' | 'subagent' | 'workflow' | 'agent-team';

export interface ExecutionPlan {
  type: ExecutionPlanType;
  capabilityIds: string[];
  modelRecommendation?: string;
  expectedQualityClass: 'A' | 'B' | 'C' | 'D';
  coverageEstimate: number;
  expectedEffectiveCost: number;
  mainContextRelief: number;
  experimental: boolean;
  reasons: string[];
}

const NATIVE_COVERAGE_FLOOR = 0.5;

export interface RuntimeCapabilityGraph {
  graph: CapabilityGraph;
  runtimeCapabilityIds: Set<string>;
}

export interface Planner {
  candidates(intent: TaskIntent, runtime: RuntimeCapabilityGraph, repo: RepoFingerprint | undefined, evidence: EvidenceIndex, agentTeamsEnabled: boolean): ExecutionPlan[];
}

/**
 * Native-mechanism planner (07_RUNTIME_ROUTER_AND_PLANNER.md section 8,
 * 17_MODEL_AGENT_WORKFLOW_POLICY.md). Produces candidate execution forms over
 * Claude's own mechanisms only; never invents an independent task executor.
 */
export class DefaultPlanner implements Planner {
  candidates(intent: TaskIntent, runtime: RuntimeCapabilityGraph, repo: RepoFingerprint | undefined, evidence: EvidenceIndex, agentTeamsEnabled: boolean): ExecutionPlan[] {
    const nodes = runtime.graph.nodes.filter((n) => runtime.runtimeCapabilityIds.has(n.id) && n.type !== 'plugin');
    const ranked = rankCapabilities(nodes, intent, repo, evidence, runtime.graph);

    const plans: ExecutionPlan[] = [
      {
        type: 'native',
        capabilityIds: [],
        expectedQualityClass: 'B',
        coverageEstimate: NATIVE_COVERAGE_FLOOR,
        expectedEffectiveCost: 0,
        mainContextRelief: 0,
        experimental: false,
        reasons: ['always-available baseline']
      }
    ];

    const topSkillOrAgent = ranked.find((r) => r.node.type === 'skill' || r.node.type === 'agent');
    if (topSkillOrAgent && topSkillOrAgent.score > 0.3) {
      plans.push(this.singleOrPair(topSkillOrAgent, ranked, intent));
    }

    const topWorkflow = ranked.find((r) => r.node.type === 'workflow');
    if (topWorkflow && topWorkflow.score > 0.3 && intent.parallelism !== 'low') {
      plans.push({
        type: 'workflow',
        capabilityIds: [topWorkflow.node.id],
        expectedQualityClass: 'C',
        coverageEstimate: topWorkflow.coverage,
        expectedEffectiveCost: 0.3,
        mainContextRelief: 0.2,
        experimental: false,
        reasons: ['native workflow matches structured/parallel intent']
      });
    }

    if (agentTeamsEnabled && intent.parallelism === 'high' && intent.complexity === 'high') {
      const agents = ranked.filter((r) => r.node.type === 'agent').slice(0, 3);
      if (agents.length >= 2) {
        plans.push({
          type: 'agent-team',
          capabilityIds: agents.map((a) => a.node.id),
          expectedQualityClass: 'C',
          coverageEstimate: agents[0].coverage,
          expectedEffectiveCost: 0.7,
          mainContextRelief: 0.1,
          experimental: true,
          reasons: ['experimental teams enabled and prompt implies independent parallel work']
        });
      }
    }

    return plans;
  }

  private singleOrPair(top: ScoredCapability, ranked: ScoredCapability[], intent: TaskIntent): ExecutionPlan {
    const skill = top.node.type === 'skill' ? top : ranked.find((r) => r.node.type === 'skill');
    const agent = top.node.type === 'agent' ? top : ranked.find((r) => r.node.type === 'agent');

    if (skill && agent && skill.node.id !== agent.node.id) {
      return {
        type: 'skill-agent',
        capabilityIds: [skill.node.id, agent.node.id],
        expectedQualityClass: 'B',
        coverageEstimate: Math.max(skill.coverage, agent.coverage),
        expectedEffectiveCost: 0.4,
        mainContextRelief: intent.complexity === 'high' ? 0.3 : 0.1,
        experimental: false,
        reasons: ['skill provides procedure, specialized agent bounds implementation']
      };
    }

    return {
      type: 'single-skill',
      capabilityIds: [top.node.id],
      expectedQualityClass: 'B',
      coverageEstimate: top.coverage,
      expectedEffectiveCost: 0.15,
      mainContextRelief: 0,
      experimental: false,
      reasons: ['dominant relevance match']
    };
  }
}
