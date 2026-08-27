import { defaultConfig } from './defaults.js';
import type { CCOConfig } from '../types.js';

export interface ConfigValidationResult {
  ok: boolean;
  config: CCOConfig;
  errors: string[];
}

const KNOWN_TOP_KEYS = new Set([
  'schemaVersion',
  'mode',
  'profile',
  'routing',
  'optimization',
  'repository',
  'privacy',
  'benchmark',
  'experimental'
]);

/**
 * Strict config validator (12_DATA_MODEL_AND_SCHEMAS.md section 11, 24_CONFIGURATION_REFERENCE.md).
 * Unknown top-level keys are rejected to catch typos. Security-hardcoded rules (no remote
 * telemetry, no permission-relaxation toggle) cannot be overridden by user config, ever.
 */
export function validateConfig(input: unknown): ConfigValidationResult {
  const errors: string[] = [];
  const base = defaultConfig();

  if (input === null || typeof input !== 'object') {
    return { ok: true, config: base, errors: [] };
  }
  const obj = input as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!KNOWN_TOP_KEYS.has(key)) errors.push(`unknown config key: ${key}`);
  }

  const merged: CCOConfig = structuredClone(base);

  if (typeof obj.mode === 'string' && ['observe', 'safe', 'aggressive', 'native'].includes(obj.mode)) {
    merged.mode = obj.mode as CCOConfig['mode'];
  } else if (obj.mode !== undefined) {
    errors.push('mode must be one of observe|safe|aggressive|native');
  }

  const routing = obj.routing as Partial<CCOConfig['routing']> | undefined;
  if (routing) {
    if (routing.confidenceThreshold !== undefined) {
      if (routing.confidenceThreshold < 0.5 || routing.confidenceThreshold > 0.99) {
        errors.push('routing.confidenceThreshold out of safe range [0.5, 0.99]');
      } else merged.routing.confidenceThreshold = routing.confidenceThreshold;
    }
    if (routing.ambiguityMargin !== undefined) {
      if (routing.ambiguityMargin < 0.01 || routing.ambiguityMargin > 0.5) {
        errors.push('routing.ambiguityMargin out of safe range [0.01, 0.5]');
      } else merged.routing.ambiguityMargin = routing.ambiguityMargin;
    }
    if (routing.maxInjectedTokens !== undefined) {
      if (routing.maxInjectedTokens < 0 || routing.maxInjectedTokens > 220) {
        errors.push('routing.maxInjectedTokens out of safe range [0, 220]');
      } else merged.routing.maxInjectedTokens = routing.maxInjectedTokens;
    }
    if (routing.enabled !== undefined) merged.routing.enabled = Boolean(routing.enabled);
    if (routing.tieBreaker !== undefined) {
      if (routing.tieBreaker !== 'none' && routing.tieBreaker !== 'claude') {
        errors.push('routing.tieBreaker must be none|claude');
      } else merged.routing.tieBreaker = routing.tieBreaker;
    }
  }

  const profile = obj.profile as Partial<CCOConfig['profile']> | undefined;
  if (profile) {
    if (Array.isArray(profile.neverDisable)) merged.profile.neverDisable = profile.neverDisable.filter((x) => typeof x === 'string');
    if (Array.isArray(profile.protected)) merged.profile.protected = profile.protected.filter((x) => typeof x === 'string');
    if (typeof profile.defaultName === 'string') merged.profile.defaultName = profile.defaultName;
  }

  const privacy = obj.privacy as Partial<CCOConfig['privacy']> | undefined;
  if (privacy) {
    if (privacy.remoteTelemetry === true) {
      errors.push('privacy.remoteTelemetry cannot be enabled: no remote backend ships with CCO (11_SECURITY section 12)');
    }
    if (privacy.storeRawPrompts !== undefined) merged.privacy.storeRawPrompts = Boolean(privacy.storeRawPrompts);
    if (privacy.storeTranscriptContent !== undefined) merged.privacy.storeTranscriptContent = Boolean(privacy.storeTranscriptContent);
    if (privacy.eventRetentionDays !== undefined) merged.privacy.eventRetentionDays = privacy.eventRetentionDays;
  }

  const experimental = obj.experimental as Partial<CCOConfig['experimental']> | undefined;
  if (experimental) {
    if (experimental.agentTeams !== undefined) merged.experimental.agentTeams = Boolean(experimental.agentTeams);
    if (experimental.llmRoutingTieBreaker !== undefined) merged.experimental.llmRoutingTieBreaker = Boolean(experimental.llmRoutingTieBreaker);
  }

  const optimization = obj.optimization as Partial<CCOConfig['optimization']> | undefined;
  if (optimization) {
    if (optimization.modelOptimization !== undefined) merged.optimization.modelOptimization = Boolean(optimization.modelOptimization);
    if (optimization.safePruneAffinityMax !== undefined) {
      if (optimization.safePruneAffinityMax < 0 || optimization.safePruneAffinityMax > 1) {
        errors.push('optimization.safePruneAffinityMax out of safe range [0, 1]');
      } else merged.optimization.safePruneAffinityMax = optimization.safePruneAffinityMax;
    }
    if (optimization.metadataConfidenceMin !== undefined) {
      if (optimization.metadataConfidenceMin < 0 || optimization.metadataConfidenceMin > 1) {
        errors.push('optimization.metadataConfidenceMin out of safe range [0, 1]');
      } else merged.optimization.metadataConfidenceMin = optimization.metadataConfidenceMin;
    }
  }

  return { ok: errors.length === 0, config: merged, errors };
}
