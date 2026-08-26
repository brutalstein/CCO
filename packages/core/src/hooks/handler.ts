import type { CapabilityGraph, CCOConfig, CompiledProfile, EvidenceIndex, RepoFingerprint } from '../types.js';
import { DefaultRuntimeRouter } from '../routing/router.js';

export interface HookHandlerInput {
  profile: CompiledProfile | null;
  graph: CapabilityGraph | null;
  repo?: RepoFingerprint;
  config: CCOConfig;
  evidence: EvidenceIndex;
  agentTeamsEnabled: boolean;
}

/**
 * Session digest text for SessionStart (15_HOOK_CONTRACTS.md section 2). Returns null when
 * there is nothing safe/useful to say (missing/invalid profile => hook must no-op).
 */
export function sessionStartDigest(input: HookHandlerInput): string | null {
  if (!input.profile) return null;
  const pruned = input.profile.selected.prunedPluginIds.length;
  return `CCO profile ${input.profile.mode}:auto active${pruned > 0 ? ` (${pruned} capability set pruned this session)` : ''}. Runtime routing may suggest only capabilities available in this profile; native Claude behavior remains the fallback.`;
}

/**
 * UserPromptSubmit hook core (15_HOOK_CONTRACTS.md section 3). Pure: caller supplies already
 * validated profile/graph and owns the stdin/stdout/env plumbing and the hard deadline.
 */
export function userPromptSubmitRoute(
  input: HookHandlerInput,
  prompt: string,
  cwd: string,
  sessionId: string
): { hintText: string | null; reasonCode: string } {
  if (!input.profile || !input.graph) return { hintText: null, reasonCode: 'STALE_PROFILE' };

  const result = new DefaultRuntimeRouter().route({
    prompt,
    cwd,
    sessionId,
    profileId: input.profile.id,
    profileValid: true,
    graph: input.graph,
    runtimeCapabilityIds: new Set(input.profile.runtimeCapabilityIds),
    repo: input.repo,
    evidence: input.evidence,
    config: input.config,
    agentTeamsEnabled: input.agentTeamsEnabled
  });

  return { hintText: result.hintText, reasonCode: result.decision.reasonCode };
}
