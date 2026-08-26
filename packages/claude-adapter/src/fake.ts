import type {
  BenchmarkInvocationSpec,
  ClaudeAdapter,
  ClaudeContext,
  ClaudeEnvironment,
  HookEvent,
  HookInput,
  OverlayInput,
  PluginDetailsSource,
  PluginInventorySource,
  ProbeContext,
  SpawnSpecLike,
  ValidatedOverlay,
  ValidationResult
} from './interface.js';
import { buildOverlayJson, validateOverlayMonotonic } from './settings-overlay.js';
import { normalizeHookInput, encodeHookContext } from './hook-codec.js';

export interface FakeClaudeFixture {
  environment: ClaudeEnvironment;
  plugins: PluginInventorySource[];
  details: Record<string, PluginDetailsSource>;
}

/**
 * Deterministic in-memory adapter for unit/property tests (21_TESTING_STRATEGY.md section 4:
 * "every adapter parser must be testable without installed Claude"). No subprocess is spawned.
 */
export class FakeClaudeAdapter implements ClaudeAdapter {
  constructor(private readonly fixture: FakeClaudeFixture) {}

  async probe(_ctx: ProbeContext): Promise<ClaudeEnvironment> {
    return this.fixture.environment;
  }

  async listPlugins(_ctx: ClaudeContext): Promise<PluginInventorySource[]> {
    return this.fixture.plugins;
  }

  async pluginDetails(id: string, _ctx: ClaudeContext): Promise<PluginDetailsSource | null> {
    return this.fixture.details[id] ?? null;
  }

  async buildSettingsOverlay(input: OverlayInput, outPath: string | null): Promise<ValidatedOverlay> {
    return { filePath: outPath, json: buildOverlayJson(input) };
  }

  validateOverlay(overlay: ValidatedOverlay, baseline: PluginInventorySource[]): ValidationResult {
    return validateOverlayMonotonic(overlay.json, baseline);
  }

  normalizeHookInput(event: HookEvent, raw: unknown): HookInput {
    return normalizeHookInput(event, raw);
  }

  encodeHookContext(event: HookEvent, text: string): unknown {
    return encodeHookContext(event, text);
  }

  benchmarkInvocation(spec: BenchmarkInvocationSpec): SpawnSpecLike {
    return { command: 'claude', args: ['-p', spec.prompt, '--output-format', spec.outputFormat], cwd: spec.cwd };
  }
}

export function minimalFixture(overrides: Partial<FakeClaudeFixture> = {}): FakeClaudeFixture {
  return {
    environment: {
      found: true,
      resolvedBinaryPath: 'claude',
      version: '2.1.246',
      versionFamily: '2.1-current',
      features: {
        pluginListJson: true,
        pluginDetails: true,
        settingsOverlay: true,
        toolSearchExpected: true,
        workflows: true,
        agentTeams: false
      },
      toolSearchStatus: 'deferred-supported',
      errors: []
    },
    plugins: [],
    details: {},
    ...overrides
  };
}
