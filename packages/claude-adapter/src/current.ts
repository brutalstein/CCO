import { NodeProcessLauncher, type ProcessLauncher, atomicWriteJson } from '@cco/platform';
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
import { parseVersion, versionFamily, detectFeatures, detectToolSearchStatus } from './probes.js';
import { parsePluginListJson } from './plugin-list.js';
import { parsePluginDetailsText } from './plugin-details.js';
import { buildOverlayJson, validateOverlayMonotonic } from './settings-overlay.js';
import { normalizeHookInput as normalizeHookInputImpl, encodeHookContext as encodeHookContextImpl } from './hook-codec.js';

const PROBE_TIMEOUT_MS = 8000;
const DETAILS_TIMEOUT_MS = 8000;

/**
 * Adapter backed by the real `claude` executable (04_CLAUDE_CODE_INTEGRATION.md).
 * Every Claude-facing subprocess call is isolated here; everything else in the
 * product consumes normalized types only.
 */
export class CurrentClaudeAdapter implements ClaudeAdapter {
  constructor(private readonly launcher: ProcessLauncher = new NodeProcessLauncher()) {}

  async probe(ctx: ProbeContext): Promise<ClaudeEnvironment> {
    const binary = ctx.claudeBinaryHint ?? 'claude';
    const errors: string[] = [];

    let versionOut: string | null = null;
    try {
      const res = await this.launcher.runCapture({ command: binary, args: ['--version'], cwd: ctx.cwd }, PROBE_TIMEOUT_MS);
      if (res.code === 0) versionOut = res.stdout;
      else errors.push(`claude --version exited ${res.code}`);
    } catch (err) {
      errors.push(`claude binary not resolvable: ${(err as Error).message}`);
      return {
        found: false,
        resolvedBinaryPath: null,
        version: null,
        versionFamily: 'unknown',
        features: {
          pluginListJson: false,
          pluginDetails: false,
          settingsOverlay: false,
          toolSearchExpected: false,
          workflows: false,
          agentTeams: false
        },
        toolSearchStatus: 'unknown',
        errors
      };
    }

    let helpText = '';
    try {
      const res = await this.launcher.runCapture({ command: binary, args: ['--help'], cwd: ctx.cwd }, PROBE_TIMEOUT_MS);
      helpText = res.stdout + res.stderr;
    } catch {
      errors.push('claude --help unavailable; using conservative feature defaults');
    }

    const version = versionOut ? parseVersion(versionOut) : null;

    return {
      found: true,
      resolvedBinaryPath: binary,
      version,
      versionFamily: versionFamily(version),
      features: detectFeatures(helpText),
      toolSearchStatus: detectToolSearchStatus(helpText),
      errors
    };
  }

  async listPlugins(ctx: ClaudeContext): Promise<PluginInventorySource[]> {
    if (!ctx.env.found || !ctx.env.features.pluginListJson) return [];
    try {
      const res = await this.launcher.runCapture(
        { command: ctx.env.resolvedBinaryPath ?? 'claude', args: ['plugin', 'list', '--json'], cwd: ctx.cwd },
        DETAILS_TIMEOUT_MS
      );
      if (res.code !== 0) return [];
      return parsePluginListJson(res.stdout);
    } catch {
      return [];
    }
  }

  async pluginDetails(id: string, ctx: ClaudeContext): Promise<PluginDetailsSource | null> {
    if (!ctx.env.found || !ctx.env.features.pluginDetails) return null;
    try {
      const res = await this.launcher.runCapture(
        { command: ctx.env.resolvedBinaryPath ?? 'claude', args: ['plugin', 'details', id], cwd: ctx.cwd },
        DETAILS_TIMEOUT_MS
      );
      if (res.code !== 0) return null;
      return parsePluginDetailsText(id, res.stdout);
    } catch {
      return null;
    }
  }

  async buildSettingsOverlay(input: OverlayInput, outPath: string | null): Promise<ValidatedOverlay> {
    const json = buildOverlayJson(input);
    if (outPath) await atomicWriteJson(outPath, json);
    return { filePath: outPath, json };
  }

  validateOverlay(overlay: ValidatedOverlay, baseline: PluginInventorySource[]): ValidationResult {
    return validateOverlayMonotonic(overlay.json, baseline);
  }

  normalizeHookInput(event: HookEvent, raw: unknown): HookInput {
    return normalizeHookInputImpl(event, raw);
  }

  encodeHookContext(event: HookEvent, text: string): unknown {
    return encodeHookContextImpl(event, text);
  }

  benchmarkInvocation(spec: BenchmarkInvocationSpec): SpawnSpecLike {
    const args = ['-p', spec.prompt, '--output-format', spec.outputFormat];
    if (spec.outputFormat === 'stream-json') args.push('--verbose');
    if (spec.model) args.push('--model', spec.model);
    if (spec.maxTurns) args.push('--max-turns', String(spec.maxTurns));
    if (spec.settingsFile) args.push('--settings', spec.settingsFile);
    if (spec.mcpConfig) args.push('--mcp-config', spec.mcpConfig);
    if (spec.strictMcpConfig) args.push('--strict-mcp-config');
    if (spec.permissionMode) args.push('--permission-mode', spec.permissionMode);
    return { command: 'claude', args, cwd: spec.cwd };
  }
}
