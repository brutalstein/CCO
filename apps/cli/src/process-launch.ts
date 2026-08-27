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

function makeIntent(prompt: string): TaskIntent {
  return new DefaultIntentClassifier().classify({ prompt });
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

  const config = await ctx.store.readConfig();
  const inventory = await ctx.inventoryService.loadOrRefresh({ cwd: ctx.cwd });
  const repo = await ctx.repoAnalyzer.fingerprint(ctx.cwd);
  const graph: CapabilityGraph = new DefaultCapabilityGraphBuilder().build(inventory, repo);
  const intent = options.intentPrompt ? makeIntent(options.intentPrompt) : undefined;
  const evidence = { records: await ctx.store.listEvidence() };

  let mode = options.mode;
  let reasons: string[] = [];
  let profile = new DefaultProfileCompiler().compile({ inventory, graph, repo, intent, config, evidence, environment: env, mode });

  const validator = new DefaultSafetyValidator();
  const profileIssues = validator.validateProfile(profile, inventory);
  if (profileIssues.length > 0) {
    if (options.strict) {
      return { exitCode: 3, usedNativeFallback: true, reasons: profileIssues.map((i) => i.message), alwaysOnBefore: profile.costProjection.alwaysOnBefore, alwaysOnAfter: profile.costProjection.alwaysOnBefore };
    }
    reasons = profileIssues.map((i) => 'fallback: ' + i.message);
    mode = 'native';
    profile = new DefaultProfileCompiler().compile({ inventory, graph, repo, intent, config, evidence, environment: env, mode });
  }

  const overlay = await ctx.adapter.buildSettingsOverlay({ enabledPluginDelta: profile.overlay.enabledPlugins, env: {} }, null);
  const overlayIssues = validator.validateOverlay(overlay, inventory);
  if (overlayIssues.length > 0) {
    if (options.strict) {
      return { exitCode: 3, usedNativeFallback: true, reasons: overlayIssues.map((i) => i.message), alwaysOnBefore: profile.costProjection.alwaysOnBefore, alwaysOnAfter: profile.costProjection.alwaysOnBefore };
    }
    reasons = [...reasons, ...overlayIssues.map((i) => 'fallback: ' + i.message)];
    mode = 'native';
    profile = new DefaultProfileCompiler().compile({ inventory, graph, repo, intent, config, evidence, environment: env, mode: 'native' });
  }

  const forcedFallback = reasons.length > 0;
  const projectId = projectIdFromRoot(ctx.cwd);
  let exitCode: number;

  if (forcedFallback) {
    const result = await ctx.launcher.spawnInteractive({ command: env.resolvedBinaryPath ?? 'claude', args: options.claudeArgs, cwd: ctx.cwd, env: process.env });
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
        command: env.resolvedBinaryPath ?? 'claude',
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
