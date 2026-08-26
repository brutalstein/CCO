import type { OptimizationMode } from '@cco/core';
import { createContext } from '../context.js';
import { runLaunch } from '../process-launch.js';
import type { ParsedArgs } from '../argv.js';
import { flagBool, flagString } from '../argv.js';

const VALID_MODES = new Set(['observe', 'safe', 'aggressive', 'native']);

/** `cco run` (13_CLI_SPEC.md section 6). Default mode `safe`. */
export async function cmdRun(parsed: ParsedArgs): Promise<number> {
  const modeFlag = flagString(parsed.flags, 'mode') ?? 'safe';
  if (!VALID_MODES.has(modeFlag)) {
    console.error(`invalid --mode: ${modeFlag}`);
    return 2;
  }
  const ctx = await createContext(process.cwd(), false);
  const result = await runLaunch(ctx, {
    mode: modeFlag as OptimizationMode,
    strict: flagBool(parsed.flags, 'strict'),
    intentPrompt: flagString(parsed.flags, 'intent'),
    claudeArgs: parsed.passthrough
  });

  if (result.reasons.length > 0) {
    for (const r of result.reasons) console.error('cco: ' + r);
  } else if (!result.usedNativeFallback) {
    const reduction = result.alwaysOnBefore > 0 ? Math.round((1 - result.alwaysOnAfter / result.alwaysOnBefore) * 100) : 0;
    console.error(`CCO profile applied: always-on ${result.alwaysOnBefore} -> ${result.alwaysOnAfter} tokens (${reduction >= 0 ? '-' : '+'}${Math.abs(reduction)}%)`);
  }

  return result.exitCode;
}
