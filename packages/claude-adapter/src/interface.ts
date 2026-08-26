/**
 * Claude-facing contract (31_API_INTERNAL_INTERFACES.md section 1, 04_CLAUDE_CODE_INTEGRATION.md).
 * No other package may parse Claude CLI output directly.
 */

export interface ProbeContext {
  claudeBinaryHint?: string;
  cwd: string;
}

export interface ClaudeFeatures {
  pluginListJson: boolean;
  pluginDetails: boolean;
  settingsOverlay: boolean;
  toolSearchExpected: boolean;
  workflows: boolean;
  agentTeams: boolean;
}

export type ToolSearchStatus = 'deferred-supported' | 'prefix-loaded-or-search-disabled' | 'unknown';

export interface ClaudeEnvironment {
  found: boolean;
  resolvedBinaryPath: string | null;
  version: string | null;
  versionFamily: string;
  features: ClaudeFeatures;
  toolSearchStatus: ToolSearchStatus;
  errors: string[];
}

export interface ClaudeContext {
  cwd: string;
  env: ClaudeEnvironment;
}

export interface PluginInventorySource {
  canonicalId: string;
  name: string;
  version?: string;
  sourceType: string;
  enabled: boolean;
  managed?: boolean;
}

export interface PluginDetailComponent {
  type: string;
  id: string;
  name: string;
}

export interface PluginDetailsSource {
  canonicalId: string;
  components: PluginDetailComponent[];
  alwaysOnTokens?: number;
  tokenSource: 'anthropic_projected' | 'unknown';
  dependencies: string[];
  riskFlags: string[];
}

export interface OverlayInput {
  /** Only plugin states that differ from baseline (06_SESSION_PROFILE_COMPILER.md section 13). */
  enabledPluginDelta: Record<string, boolean>;
  env: Record<string, string>;
  /** Plugin IDs the user explicitly authorized to flip baseline-disabled -> enabled (S2). */
  authorizedEnableIds?: string[];
}

export interface ValidatedOverlay {
  filePath: string | null;
  json: {
    enabledPlugins?: Record<string, boolean>;
    env?: Record<string, string>;
  };
}

export interface ValidationResult {
  ok: boolean;
  issues: string[];
}

export type HookEvent = 'SessionStart' | 'UserPromptSubmit' | 'SessionEnd';

export interface HookInput {
  event: HookEvent;
  sessionId: string;
  cwd: string;
  transcriptPath?: string;
  permissionMode?: string;
  source?: string;
  prompt?: string;
}

export interface BenchmarkInvocationSpec {
  prompt: string;
  model?: string;
  maxTurns?: number;
  outputFormat: 'json' | 'stream-json' | 'text';
  cwd: string;
  settingsFile?: string;
  mcpConfig?: string;
  strictMcpConfig?: boolean;
}

export interface SpawnSpecLike {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ClaudeAdapter {
  probe(ctx: ProbeContext): Promise<ClaudeEnvironment>;
  listPlugins(ctx: ClaudeContext): Promise<PluginInventorySource[]>;
  pluginDetails(id: string, ctx: ClaudeContext): Promise<PluginDetailsSource | null>;
  buildSettingsOverlay(input: OverlayInput, outPath: string | null): Promise<ValidatedOverlay>;
  validateOverlay(overlay: ValidatedOverlay, baseline: PluginInventorySource[]): ValidationResult;
  normalizeHookInput(event: HookEvent, raw: unknown): HookInput;
  encodeHookContext(event: HookEvent, text: string): unknown;
  benchmarkInvocation(spec: BenchmarkInvocationSpec): SpawnSpecLike;
}
