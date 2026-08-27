#!/usr/bin/env node
// Generates schemas/*.json from the canonical shapes in 12_DATA_MODEL_AND_SCHEMAS.md.
// Hand-maintained JSON Schema literals (not AST-derived from TypeScript) so the monorepo
// does not need a typescript-json-schema-class dependency for five stable record shapes;
// keep these in sync with packages/core/src/types.ts when a field is added/removed.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'schemas');

const draft = 'https://json-schema.org/draft/2020-12/schema';

const configSchema = {
  $schema: draft,
  $id: 'https://cco.dev/schemas/config.schema.json',
  title: 'CCOConfig',
  type: 'object',
  required: ['schemaVersion', 'mode', 'profile', 'routing', 'optimization', 'repository', 'privacy', 'benchmark', 'experimental'],
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'integer', const: 2 },
    mode: { enum: ['observe', 'safe', 'aggressive', 'native'] },
    profile: {
      type: 'object',
      required: ['strategy', 'defaultName', 'neverDisable', 'protected'],
      additionalProperties: false,
      properties: {
        strategy: { enum: ['auto', 'named'] },
        defaultName: { type: ['string', 'null'] },
        neverDisable: { type: 'array', items: { type: 'string' } },
        protected: { type: 'array', items: { type: 'string' } }
      }
    },
    routing: {
      type: 'object',
      required: ['enabled', 'confidenceThreshold', 'ambiguityMargin', 'maxInjectedTokens', 'hardDeadlineMs', 'tieBreaker'],
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean' },
        confidenceThreshold: { type: 'number', minimum: 0, maximum: 1 },
        ambiguityMargin: { type: 'number', minimum: 0, maximum: 1 },
        maxInjectedTokens: { type: 'integer', minimum: 0 },
        hardDeadlineMs: { type: 'integer', minimum: 0 },
        tieBreaker: { enum: ['none', 'claude'] }
      }
    },
    optimization: {
      type: 'object',
      required: ['safePruneAffinityMax', 'semanticCoverageMin', 'semanticClassificationConfidenceMin', 'quality', 'modelOptimization', 'preferStableProfile'],
      additionalProperties: false,
      properties: {
        safePruneAffinityMax: { type: 'number', minimum: 0, maximum: 1 },
        semanticCoverageMin: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
        semanticClassificationConfidenceMin: { type: 'number', minimum: 0, maximum: 1 },
        quality: {
          type: 'object',
          required: ['mode', 'defaultTolerance', 'minExploratoryTrialsPerArm', 'publicClaimTrialsPerArm'],
          additionalProperties: false,
          properties: {
            mode: { const: 'non-inferiority' },
            defaultTolerance: { type: 'number', minimum: 0, maximum: 1 },
            minExploratoryTrialsPerArm: { type: 'integer', minimum: 1 },
            publicClaimTrialsPerArm: { type: 'integer', minimum: 1 }
          }
        },
        modelOptimization: { type: 'boolean' },
        preferStableProfile: { type: 'boolean' }
      }
    },
    repository: {
      type: 'object',
      required: ['maxTrackedFiles', 'maxManifestBytes', 'maxTotalParsedBytes'],
      additionalProperties: false,
      properties: {
        maxTrackedFiles: { type: 'integer', minimum: 1 },
        maxManifestBytes: { type: 'integer', minimum: 1 },
        maxTotalParsedBytes: { type: 'integer', minimum: 1 }
      }
    },
    privacy: {
      type: 'object',
      required: ['storeRawPrompts', 'storeTranscriptContent', 'storePromptHash', 'remoteTelemetry', 'eventRetentionDays'],
      additionalProperties: false,
      properties: {
        storeRawPrompts: { type: 'boolean', const: false },
        storeTranscriptContent: { type: 'boolean', const: false },
        storePromptHash: { type: 'boolean' },
        remoteTelemetry: { type: 'boolean', const: false },
        eventRetentionDays: { type: 'integer', minimum: 1 }
      }
    },
    benchmark: {
      type: 'object',
      required: ['defaultTrials', 'isolation', 'saveRawStreams'],
      additionalProperties: false,
      properties: {
        defaultTrials: { type: 'integer', minimum: 1 },
        isolation: { enum: ['worktree', 'copy'] },
        saveRawStreams: { type: 'boolean' }
      }
    },
    experimental: {
      type: 'object',
      required: ['agentTeams', 'llmRoutingTieBreaker'],
      additionalProperties: false,
      properties: {
        agentTeams: { type: 'boolean' },
        llmRoutingTieBreaker: { type: 'boolean' }
      }
    },
    neverDisable: { type: 'array', items: { type: 'string' } }
  }
};

const capabilityTagSchema = {
  type: 'object',
  required: ['id', 'confidence', 'source'],
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    source: { type: 'string' }
  }
};

const capabilityCostSchema = {
  type: 'object',
  required: ['source'],
  additionalProperties: false,
  properties: {
    alwaysOnTokens: { type: 'number', minimum: 0 },
    invokeTokens: { type: 'number', minimum: 0 },
    source: { enum: ['anthropic_projected', 'local_estimate', 'unknown'] }
  }
};

const capabilityNodeSchema = {
  type: 'object',
  required: ['id', 'type', 'ownerPluginId', 'displayName', 'descriptionHash', 'tags', 'availability', 'cost', 'riskFlags', 'metadataParseConfidence', 'semanticCoverage', 'semanticClassificationConfidence', 'dependencies', 'managed', 'protected', 'baselineEnabled'],
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    type: { enum: ['plugin', 'skill', 'agent', 'hook', 'mcp_server', 'mcp_tool', 'lsp_server', 'workflow', 'instruction_source', 'model_option'] },
    ownerPluginId: { type: ['string', 'null'] },
    displayName: { type: 'string' },
    descriptionHash: { type: 'string' },
    tags: { type: 'array', items: capabilityTagSchema },
    availability: { enum: ['baseline_disabled', 'baseline_enabled', 'profile_selected', 'profile_pruned', 'runtime_available'] },
    cost: capabilityCostSchema,
    riskFlags: { type: 'array', items: { type: 'string' } },
    metadataParseConfidence: { type: 'number', minimum: 0, maximum: 1 },
    semanticCoverage: { type: 'number', minimum: 0, maximum: 1 },
    semanticClassificationConfidence: { type: 'number', minimum: 0, maximum: 1 },
    dependencies: { type: 'array', items: { type: 'string' } },
    managed: { type: 'boolean' },
    protected: { type: 'boolean' },
    baselineEnabled: { type: 'boolean' }
  }
};

const inventorySchema = {
  $schema: draft,
  $id: 'https://cco.dev/schemas/inventory.schema.json',
  title: 'InventorySnapshot',
  type: 'object',
  required: ['schemaVersion', 'id', 'capturedAt', 'claude', 'baselineStateHash', 'plugins', 'pluginDetails', 'partial', 'missingSources'],
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'integer', const: 2 },
    id: { type: 'string', pattern: '^inv_' },
    capturedAt: { type: 'string', format: 'date-time' },
    claude: {
      type: 'object', additionalProperties: false,
      required: ['found', 'resolvedBinaryPath', 'version', 'versionFamily', 'features', 'toolSearchStatus', 'errors'],
      properties: {
        found: { type: 'boolean' }, resolvedBinaryPath: { type: ['string', 'null'] }, version: { type: ['string', 'null'] },
        versionFamily: { type: 'string' }, toolSearchStatus: { enum: ['deferred-supported', 'prefix-loaded-or-search-disabled', 'unknown'] },
        errors: { type: 'array', items: { type: 'string' } },
        features: {
          type: 'object', additionalProperties: false,
          required: ['pluginListJson', 'pluginDetails', 'settingsOverlay', 'toolSearchExpected', 'workflows', 'agentTeams'],
          properties: {
            pluginListJson: { type: 'boolean' }, pluginDetails: { type: 'boolean' }, settingsOverlay: { type: 'boolean' },
            toolSearchExpected: { type: 'boolean' }, workflows: { type: 'boolean' }, agentTeams: { type: 'boolean' }
          }
        }
      }
    },
    baselineStateHash: { type: 'string' },
    plugins: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['canonicalId', 'name', 'sourceType', 'enabled'],
        properties: {
          canonicalId: { type: 'string' }, name: { type: 'string' }, version: { type: 'string' },
          sourceType: { type: 'string' }, enabled: { type: 'boolean' }, managed: { type: 'boolean' },
          scope: { type: 'string' }, lastUpdated: { type: 'string' }, installPath: { type: 'string' }
        }
      }
    },
    pluginDetails: {
      type: 'object',
      additionalProperties: {
        type: 'object', additionalProperties: false,
        required: ['source', 'dependencies', 'riskFlags', 'components'],
        properties: {
          alwaysOnTokens: { type: 'number', minimum: 0 }, source: { type: 'string' }, description: { type: 'string' },
          dependencies: { type: 'array', items: { type: 'string' } }, riskFlags: { type: 'array', items: { type: 'string' } },
          components: {
            type: 'array', items: {
              type: 'object', additionalProperties: false, required: ['type', 'id', 'name'],
              properties: { type: { type: 'string' }, id: { type: 'string' }, name: { type: 'string' } }
            }
          }
        }
      }
    },
    partial: { type: 'boolean' },
    missingSources: { type: 'array', items: { type: 'string' } }
  }
};

const profileDecisionSchema = {
  type: 'object',
  required: ['subjectId', 'action', 'reasonCodes', 'explanation', 'inputs', 'confidence'],
  additionalProperties: false,
  properties: {
    subjectId: { type: 'string' },
    action: { enum: ['keep', 'prune'] },
    reasonCodes: { type: 'array', items: { type: 'string' } },
    explanation: { type: 'string' },
    inputs: { type: 'object' },
    confidence: { type: 'number', minimum: 0, maximum: 1 }
  }
};

const profileSchema = {
  $schema: draft,
  $id: 'https://cco.dev/schemas/profile.schema.json',
  title: 'CompiledProfile',
  type: 'object',
  required: ['schemaVersion', 'ccoVersion', 'id', 'semanticsHash', 'createdAt', 'mode', 'inventoryId', 'repoFingerprintId', 'intentHash', 'baseline', 'selected', 'overlay', 'costProjection', 'quality', 'fallbackReasons', 'algorithmVersions', 'decisions', 'runtimeCapabilityIds', 'integrityHash'],
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'integer', const: 2 },
    ccoVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+' },
    id: { type: 'string', pattern: '^profile_' },
    semanticsHash: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    mode: { enum: ['observe', 'safe', 'aggressive', 'native'] },
    inventoryId: { type: 'string' },
    repoFingerprintId: { type: 'string' },
    intentHash: { type: ['string', 'null'] },
    baseline: {
      type: 'object',
      required: ['enabledPluginIds'],
      additionalProperties: false,
      properties: { enabledPluginIds: { type: 'array', items: { type: 'string' } } }
    },
    selected: {
      type: 'object',
      required: ['enabledPluginIds', 'prunedPluginIds'],
      additionalProperties: false,
      properties: {
        enabledPluginIds: { type: 'array', items: { type: 'string' } },
        prunedPluginIds: { type: 'array', items: { type: 'string' } }
      }
    },
    overlay: {
      type: 'object',
      required: ['enabledPlugins'],
      additionalProperties: false,
      properties: { enabledPlugins: { type: 'object', additionalProperties: { type: 'boolean' } } }
    },
    costProjection: {
      type: 'object',
      required: ['alwaysOnBefore', 'alwaysOnAfter', 'unknownBefore', 'unknownAfter'],
      additionalProperties: false,
      properties: {
        alwaysOnBefore: { type: 'number', minimum: 0 },
        alwaysOnAfter: { type: 'number', minimum: 0 },
        unknownBefore: { type: 'number', minimum: 0 },
        unknownAfter: { type: 'number', minimum: 0 }
      }
    },
    quality: {
      type: 'object',
      required: ['status', 'evidenceIds'],
      additionalProperties: false,
      properties: {
        status: { type: 'string' },
        evidenceIds: { type: 'array', items: { type: 'string' } }
      }
    },
    fallbackReasons: { type: 'array', items: { type: 'string' } },
    algorithmVersions: {
      type: 'object',
      required: ['optimizer', 'graph', 'classifier'],
      additionalProperties: false,
      properties: { optimizer: { type: 'string' }, graph: { type: 'string' }, classifier: { type: 'string' } }
    },
    decisions: { type: 'array', items: profileDecisionSchema },
    runtimeCapabilityIds: { type: 'array', items: { type: 'string' } },
    integrityHash: { type: 'string' }
  }
};

const telemetrySchema = {
  $schema: draft,
  $id: 'https://cco.dev/schemas/telemetry.schema.json',
  title: 'TelemetryEvent',
  type: 'object',
  required: ['schemaVersion', 'eventVersion', 'timestamp', 'type', 'ccoVersion', 'claudeVersion', 'projectId', 'sessionIdHash', 'payload'],
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'integer', const: 2 },
    eventVersion: { type: 'integer', minimum: 1 },
    timestamp: { type: 'string', format: 'date-time' },
    type: { enum: ['session_start', 'session_launch', 'route', 'session_end', 'inventory_refresh', 'benchmark'] },
    ccoVersion: { type: 'string' },
    claudeVersion: { type: ['string', 'null'] },
    projectId: { type: 'string', pattern: '^project_' },
    sessionIdHash: { type: 'string' },
    payload: { type: 'object' }
  }
};

const benchmarkSuiteSchema = {
  $schema: draft,
  $id: 'https://cco.dev/schemas/benchmark-suite.schema.json',
  title: 'BenchmarkSuite',
  type: 'object',
  required: ['schemaVersion', 'id', 'taskFamily', 'fixture', 'promptFile', 'claude', 'checks', 'trials'],
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'integer', minimum: 1 },
    id: { type: 'string' },
    taskFamily: { type: 'array', items: { type: 'string' }, minItems: 1 },
    fixture: {
      type: 'object', required: ['type', 'path'], additionalProperties: false,
      properties: { type: { const: 'local' }, path: { type: 'string' } }
    },
    promptFile: { type: 'string' },
    claude: {
      type: 'object', additionalProperties: false,
      properties: { model: { type: 'string' }, maxTurns: { type: 'integer', minimum: 1 }, maxBudgetUsd: { type: 'number', minimum: 0 } }
    },
    trials: { type: 'integer', minimum: 1 },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type'],
        additionalProperties: false,
        properties: {
          type: { enum: ['command', 'file-assertion'] }, commandId: { type: 'string' },
          command: { type: 'array', items: { type: 'string' } }, rule: { type: 'string' }
        }
      }
    }
  }
};

const evidenceSchema = {
  $schema: draft,
  $id: 'https://cco.dev/schemas/evidence.schema.json',
  title: 'EvidenceRecordV2',
  type: 'object',
  required: ['schemaVersion', 'id', 'suiteId', 'taskFamily', 'claudeVersionFamily', 'model', 'baselineProfileHash', 'candidateProfileHash', 'trials', 'quality', 'cost', 'createdAt', 'status', 'applicability', 'statistics', 'qualification'],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: 2 }, id: { type: 'string', pattern: '^evidence_' }, suiteId: { type: 'string' },
    taskFamily: { type: 'array', items: { type: 'string' } }, claudeVersionFamily: { type: 'string' }, model: { type: 'string' },
    baselineProfileHash: { type: 'string' }, candidateProfileHash: { type: 'string' }, trials: { type: 'integer', minimum: 1 },
    quality: {
      type: 'object',
      additionalProperties: false,
      required: ['baselineSuccess', 'candidateSuccess', 'difference', 'lowerBound', 'tolerance', 'nonInferior'],
      properties: {
        baselineSuccess: { type: 'number' }, candidateSuccess: { type: 'number' }, difference: { type: 'number' },
        lowerBound: { type: 'number' }, tolerance: { type: 'number' }, nonInferior: { type: 'boolean' }, deterministicRegression: { type: 'boolean' }
      }
    },
    cost: { type: 'object' }, createdAt: { type: 'string', format: 'date-time' }, status: { enum: ['active', 'quarantined'] },
    applicability: {
      type: 'object', additionalProperties: false,
      required: ['capabilityIds', 'taskFamilies', 'claudeVersionFamily', 'model', 'optimizerVersion', 'graphVersion', 'classifierVersion', 'candidateProfileId', 'candidateSemanticsHash'],
      properties: {
        capabilityIds: { type: 'array', items: { type: 'string' } }, taskFamilies: { type: 'array', items: { type: 'string' } },
        claudeVersionFamily: { type: 'string' }, model: { type: 'string' }, optimizerVersion: { type: 'string' }, graphVersion: { type: 'string' },
        classifierVersion: { type: 'string' }, candidateProfileId: { type: 'string' }, candidateSemanticsHash: { type: 'string' }
      }
    },
    statistics: {
      type: 'object', additionalProperties: false, required: ['method', 'tolerancePolicy', 'deterministicRegression'],
      properties: { method: { const: 'newcombe-wilson-v1' }, tolerancePolicy: { type: 'string' }, deterministicRegression: { type: 'boolean' } }
    },
    qualification: {
      type: 'object', additionalProperties: false, required: ['grade'],
      properties: { grade: { enum: ['smoke', 'exploratory', 'public-claim'] } }
    }
  }
};

const schemas = {
  'config.schema.json': configSchema,
  'inventory.schema.json': inventorySchema,
  'profile.schema.json': profileSchema,
  'telemetry.schema.json': telemetrySchema,
  'benchmark-suite.schema.json': benchmarkSuiteSchema,
  'evidence.schema.json': evidenceSchema
};

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  for (const [file, schema] of Object.entries(schemas)) {
    await fs.writeFile(path.join(outDir, file), JSON.stringify(schema, null, 2) + '\n', 'utf8');
  }
  console.log(`wrote ${Object.keys(schemas).length} schema files to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
