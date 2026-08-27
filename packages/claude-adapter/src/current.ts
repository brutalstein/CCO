import { NodeProcessLauncher, type ProcessLauncher, atomicWriteJson } from '@cco/platform';
import path from 'node:path';
import type {
  BenchmarkInvocationSpec,
  ClaudeAdapter,
  ClaudeContext,
  ClaudeEnvironment,
  HookEvent,
  HookInput,
  OverlayInput,
  PluginDetailsSource,
  PluginInstallRequest,
  PluginInstallResult,
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
const INSTALL_TIMEOUT_MS = 60000;

interface MarketplaceEntry {
  name: string;
  repo?: string;
  url?: string;
  path?: string;
}

function parseMarketplaceList(raw: string): MarketplaceEntry[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is MarketplaceEntry => !!entry && typeof entry === 'object' && typeof (entry as MarketplaceEntry).name === 'string');
  } catch {
    return [];
  }
}

function marketplaceForSource(entries: MarketplaceEntry[], source: string, cwd: string): MarketplaceEntry | undefined {
  const github = source.replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '');
  const local = path.resolve(cwd, source);
  return entries.find((entry) =>
    entry.repo?.replace(/\.git$/i, '') === github ||
    entry.url === source ||
    (entry.path ? path.resolve(entry.path) === local : false)
  );
}

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

  async ensurePluginInstalled(request: PluginInstallRequest): Promise<PluginInstallResult> {
    const binary = request.env.resolvedBinaryPath ?? 'claude';
    const context = { cwd: request.cwd, env: request.env };
    const before = await this.listPlugins(context);
    const existing = before.find((plugin) => plugin.canonicalId === request.pluginName || plugin.canonicalId.startsWith(request.pluginName + '@'));
    if (existing) {
      if (!existing.enabled) {
        const enabled = await this.launcher.runCapture(
          { command: binary, args: ['plugin', 'enable', existing.canonicalId, '--scope', 'user'], cwd: request.cwd },
          INSTALL_TIMEOUT_MS
        );
        if (enabled.code !== 0) {
          return { ok: false, alreadyInstalled: true, canonicalId: existing.canonicalId, marketplaceName: existing.canonicalId.split('@')[1] ?? null, errors: [enabled.stderr.trim() || `plugin enable exited ${enabled.code}`] };
        }
        const refreshed = await this.listPlugins(context);
        if (!refreshed.find((plugin) => plugin.canonicalId === existing.canonicalId)?.enabled) {
          return { ok: false, alreadyInstalled: true, canonicalId: existing.canonicalId, marketplaceName: existing.canonicalId.split('@')[1] ?? null, errors: ['CCO plugin was not enabled after enable command'] };
        }
      }
      if (existing.installPath) {
        const validation = await this.launcher.runCapture(
          { command: binary, args: ['plugin', 'validate', existing.installPath, '--strict'], cwd: request.cwd },
          INSTALL_TIMEOUT_MS
        );
        if (validation.code !== 0) {
          return { ok: false, alreadyInstalled: true, canonicalId: existing.canonicalId, marketplaceName: existing.canonicalId.split('@')[1] ?? null, errors: [validation.stderr.trim() || 'installed CCO plugin failed strict validation'] };
        }
      }
      return { ok: true, alreadyInstalled: true, canonicalId: existing.canonicalId, marketplaceName: existing.canonicalId.split('@')[1] ?? null, errors: [] };
    }

    const listMarketplaces = async (): Promise<MarketplaceEntry[]> => {
      const result = await this.launcher.runCapture(
        { command: binary, args: ['plugin', 'marketplace', 'list', '--json'], cwd: request.cwd },
        DETAILS_TIMEOUT_MS
      );
      return result.code === 0 ? parseMarketplaceList(result.stdout) : [];
    };

    let marketplace = marketplaceForSource(await listMarketplaces(), request.marketplaceSource, request.cwd);
    if (!marketplace) {
      const added = await this.launcher.runCapture(
        { command: binary, args: ['plugin', 'marketplace', 'add', request.marketplaceSource], cwd: request.cwd },
        INSTALL_TIMEOUT_MS
      );
      if (added.code !== 0) {
        return { ok: false, alreadyInstalled: false, canonicalId: null, marketplaceName: null, errors: [added.stderr.trim() || `marketplace add exited ${added.code}`] };
      }
      marketplace = marketplaceForSource(await listMarketplaces(), request.marketplaceSource, request.cwd);
    }

    const marketplaceName = marketplace?.name ?? request.defaultMarketplaceName;
    const canonicalId = `${request.pluginName}@${marketplaceName}`;
    const installed = await this.launcher.runCapture(
      { command: binary, args: ['plugin', 'install', canonicalId, '--scope', 'user', '--yes'], cwd: request.cwd },
      INSTALL_TIMEOUT_MS
    );
    if (installed.code !== 0) {
      return { ok: false, alreadyInstalled: false, canonicalId: null, marketplaceName, errors: [installed.stderr.trim() || `plugin install exited ${installed.code}`] };
    }

    const after = await this.listPlugins(context);
    const plugin = after.find((item) => item.canonicalId === canonicalId || item.canonicalId.startsWith(request.pluginName + '@'));
    if (!plugin?.enabled) {
      return { ok: false, alreadyInstalled: false, canonicalId: plugin?.canonicalId ?? null, marketplaceName, errors: ['CCO plugin was not present and enabled after installation'] };
    }
    if (plugin.installPath) {
      const validation = await this.launcher.runCapture(
        { command: binary, args: ['plugin', 'validate', plugin.installPath, '--strict'], cwd: request.cwd },
        INSTALL_TIMEOUT_MS
      );
      if (validation.code !== 0) {
        return { ok: false, alreadyInstalled: false, canonicalId: plugin.canonicalId, marketplaceName, errors: [validation.stderr.trim() || 'installed CCO plugin failed strict validation'] };
      }
    }
    return { ok: true, alreadyInstalled: false, canonicalId: plugin.canonicalId, marketplaceName, errors: [] };
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
    if (spec.maxBudgetUsd !== undefined) args.push('--max-budget-usd', String(spec.maxBudgetUsd));
    if (spec.settingsFile) args.push('--settings', spec.settingsFile);
    if (spec.mcpConfig) args.push('--mcp-config', spec.mcpConfig);
    if (spec.strictMcpConfig) args.push('--strict-mcp-config');
    if (spec.permissionMode) args.push('--permission-mode', spec.permissionMode);
    return { command: 'claude', args, cwd: spec.cwd };
  }
}
