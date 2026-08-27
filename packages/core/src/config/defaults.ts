import { SCHEMA_VERSION, type CCOConfig } from '../types.js';

/** Canonical config defaults (24_CONFIGURATION_REFERENCE.md section 2). */
export function defaultConfig(): CCOConfig {
  return {
    schemaVersion: SCHEMA_VERSION,
    mode: 'safe',
    profile: { strategy: 'auto', defaultName: null, neverDisable: [], protected: [] },
    routing: {
      enabled: true,
      confidenceThreshold: 0.78,
      ambiguityMargin: 0.12,
      maxInjectedTokens: 220,
      hardDeadlineMs: 100,
      tieBreaker: 'none'
    },
    optimization: {
      safePruneAffinityMax: 0.08,
      semanticCoverageMin: 0.5,
      semanticClassificationConfidenceMin: 0.8,
      quality: {
        mode: 'non-inferiority',
        defaultTolerance: 0.0,
        minExploratoryTrialsPerArm: 3,
        publicClaimTrialsPerArm: 10
      },
      modelOptimization: false,
      preferStableProfile: true
    },
    repository: { maxTrackedFiles: 50000, maxManifestBytes: 262144, maxTotalParsedBytes: 4194304 },
    privacy: {
      storeRawPrompts: false,
      storeTranscriptContent: false,
      storePromptHash: true,
      remoteTelemetry: false,
      eventRetentionDays: 30
    },
    benchmark: { defaultTrials: 3, isolation: 'copy', saveRawStreams: true },
    experimental: { agentTeams: false, llmRoutingTieBreaker: false }
  };
}
