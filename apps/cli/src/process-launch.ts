import path from 'node:path';
import crypto from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { onExitOnce, atomicWriteJson } from '@cco/platform';
import {
  DefaultCapabilityGraphBuilder,
  DefaultIntentClassifier,
  DefaultProfileCompiler,
  DefaultSafetyValidator,
  buildEvent,
  projectIdFromRoot,
  graphSnapshotId,
  taskFamiliesFromIntent,
  type CapabilityGraph,
  type OptimizationMode,
  type TaskIntent
} from '@cco/core';
import type { CliContext } from './context.js';

export interface LaunchOptions {
  mode: OptimizationMode;
  strict: boolean;
  intentPrompt?: string;
  claudeArgs: string[];
}

export interface LaunchResult {
  exitCode: number;
  usedNativeFallback: boolean;
  reasons: string[];
  alwaysOnBefore: number;
  alwaysOnAfter: number;
}

export function conflictingSettingsArg(args: string[]): string | null {
  const index = args.findIndex((arg) => arg === '--settings' || arg.startsWith('--settings='));
  return index >= 0 ? args[index] : null;
}

export function isRecursiveClaudeBinary(binary: string): boolean {
  const base = path.basename(binary.replaceAll('\\', '/')).toLowerCase();
  if (/^cco(?:\.(?:cmd|exe|ps1))?$/.test(base)) return true;
  const entry = process.argv[1];
  return path.isAbsolute(binary) && !!entry && path.resolve(binary) === path.resolve(entry);
}

function makeIntent(prompt: string): TaskIntent {
  return new DefaultIntentClassifier().classify({ prompt });
}

export function modelFromClaudeArgs(args: string[]): string {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--model' && args[index + 1]) return args[index + 1];
    if (arg.startsWith('--model=')) return arg.slice('--model='.length) || 'default';
  }
  return 'default';
}

function unlinkQuiet(filePath: string): void {
  fsp.unlink(filePath).catch(() => undefined);
}

/**
 * Shared `cco run` / `cco task` lifecycle (03_SYSTEM_ARCHITECTURE.md section 4.1,
 * 22_FAILURE_MODES_FALLBACKS.md). Any compatibility/validation failure degrades to a
 * native launch (or exit 3 under --strict) rather than blocking or weakening Claude.
 */
export async function runLaunch(ctx: CliContext, options: LaunchOptions): Promise<LaunchResult> {
  const env = await ctx.adapter.probe({ cwd: ctx.cwd });
  if (!env.found) {
    return { exitCode: 1, usedNativeFallback: true, reasons: ['claude binary not found: install Claude Code first'], alwaysOnBefore: 0, alwaysOnAfter: 0 };
  }

  const binary = env.resolvedBinaryPath ?? 'claude';
  if (isRecursiveClaudeBinary(binary)) {
    return { exitCode: 1, usedNativeFallback: true, reasons: ['refusing recursive launch: resolved Claude binary points to CCO'], alwaysOnBefore: 0, alwaysOnAfter: 0 };
  }

  const settingsConflict = conflictingSettingsArg(options.claudeArgs);
  if (settingsConflict) {
    const reason = `user supplied ${settingsConflict}; CCO will not guess how to merge settings overlays`;
    if (options.strict) {
      return { exitCode: 3, usedNativeFallback: true, reasons: [reason], alwaysOnBefore: 0, alwaysOnAfter: 0 };
    }
    const result = await ctx.launcher.spawnInteractive({ command: binary, args: options.claudeArgs, cwd: ctx.cwd, env: process.env });
    return { exitCode: result.code, usedNativeFallback: true, reasons: [`fallback: ${reason}`], alwaysOnBefore: 0, alwaysOnAfter: 0 };
  }

  if (!env.features.settingsOverlay) {
    const reason = 'installed Claude Code does not advertise --settings overlay support';
    if (options.strict) {
      return { exitCode: 3, usedNativeFallback: true, reasons: [reason], alwaysOnBefore: 0, alwaysOnAfter: 0 };
    }
    const result = await ctx.launcher.spawnInteractive({ command: binary, args: options.claudeArgs, cwd: ctx.cwd, env: process.env });
    return { exitCode: result.code, usedNativeFallback: true, reasons: [`fallback: ${reason}`], alwaysOnBefore: 0, alwaysOnAfter: 0 };
  }

  const config = await ctx.store.readConfig();
  const inventory = await ctx.inventoryService.loadOrRefresh({ cwd: ctx.cwd });
  const repo = await ctx.repoAnalyzer.fingerprint(ctx.cwd, config.repository);
  const graph: CapabilityGraph = new DefaultCapabilityGraphBuilder().build(inventory, repo);
  const intent = options.intentPrompt ? makeIntent(options.intentPrompt) : undefined;
  const evidence = { records: await ctx.store.listEvidence() };

  let mode = options.mode;
  let reasons: string[] = [];
  const compilationScope = { taskFamilies: taskFamiliesFromIntent(intent), model: modelFromClaudeArgs(options.claudeArgs) };
  let profile = new DefaultProfileCompiler().compile({ inventory, graph, repo, intent, config, evidence, environment: env, mode, ...compilationScope });

  if (mode !== 'native' && profile.mode === 'native') {
    const fallback = profile.fallbackReasons.length > 0 ? profile.fallbackReasons : ['optimizer preflight rejected current inputs'];
    if (options.strict) {
      return { exitCode: 3, usedNativeFallback: true, reasons: fallback, alwaysOnBefore: profile.costProjection.alwaysOnBefore, alwaysOnAfter: profile.costProjection.alwaysOnBefore };
    }
    reasons = fallback.map((reason) => 'fallback: ' + reason);
    mode = 'native';
  }

  const validator = new DefaultSafetyValidator();
  const profileIssues = validator.validateProfile(profile, inventory);
  if (profileIssues.length > 0) {
    if (options.strict) {
      return { exitCode: 3, usedNativeFallback: true, reasons: profileIssues.map((i) => i.message), alwaysOnBefore: profile.costProjection.alwaysOnBefore, alwaysOnAfter: profile.costProjection.alwaysOnBefore };
    }
    reasons = profileIssues.map((i) => 'fallback: ' + i.message);
    mode = 'native';
    profile = new DefaultProfileCompiler().compile({ inventory, graph, repo, intent, config, evidence, environment: env, mode, ...compilationScope });
  }

  const overlay = await ctx.adapter.buildSettingsOverlay({ enabledPluginDelta: profile.overlay.enabledPlugins, env: {} }, null);
  const overlayIssues = validator.validateOverlay(overlay, inventory);
  if (overlayIssues.length > 0) {
    if (options.strict) {
      return { exitCode: 3, usedNativeFallback: true, reasons: overlayIssues.map((i) => i.message), alwaysOnBefore: profile.costProjection.alwaysOnBefore, alwaysOnAfter: profile.costProjection.alwaysOnBefore };
    }
    reasons = [...reasons, ...overlayIssues.map((i) => 'fallback: ' + i.message)];
    mode = 'native';
    profile = new DefaultProfileCompiler().compile({ inventory, graph, repo, intent, config, evidence, environment: env, mode: 'native', ...compilationScope });
  }

  const forcedFallback = reasons.length > 0;
  const projectId = projectIdFromRoot(ctx.cwd);
  let exitCode: number;

  if (forcedFallback) {
    const result = await ctx.launcher.spawnInteractive({ command: binary, args: options.claudeArgs, cwd: ctx.cwd, env: process.env });
    exitCode = result.code;
  } else {
    const profileId = await ctx.store.putSnapshot('profile', profile);
    await ctx.store.putSnapshot('graph', { ...graph, id: graphSnapshotId(profile.inventoryId, profile.repoFingerprintId) });

    const overlayPath = path.join(ctx.store.paths.tmpDir, `overlay-${crypto.randomBytes(6).toString('hex')}.json`);
    await atomicWriteJson(overlayPath, overlay.json);
    onExitOnce(() => unlinkQuiet(overlayPath));

    const launchEnv: NodeJS.ProcessEnv = {
      ...process.env,
      CCO_ACTIVE: '1',
      CCO_PROFILE_PATH: path.join(ctx.store.paths.profilesDir, `${profileId}.json`),
      CCO_STATE_DIR: ctx.store.paths.stateDir
    };

    try {
      const result = await ctx.launcher.spawnInteractive({
        command: binary,
        args: [...options.claudeArgs, '--settings', overlayPath],
        cwd: ctx.cwd,
        env: launchEnv
      });
      exitCode = result.code;
    } finally {
      await fsp.unlink(overlayPath).catch(() => undefined);
    }
  }

  await ctx.store
    .appendEvent(
      buildEvent('session_launch', env.version, projectId, crypto.randomBytes(8).toString('hex'), {
        mode,
        forcedFallback,
        alwaysOnBefore: profile.costProjection.alwaysOnBefore,
        alwaysOnAfter: profile.costProjection.alwaysOnAfter,
        prunedCount: profile.selected.prunedPluginIds.length
      })
    )
    .catch(() => undefined);

  return {
    exitCode,
    usedNativeFallback: forcedFallback || mode === 'native',
    reasons,
    alwaysOnBefore: profile.costProjection.alwaysOnBefore,
    alwaysOnAfter: profile.costProjection.alwaysOnAfter
  };
}
