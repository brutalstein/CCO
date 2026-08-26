import type { OptimizationMode } from '@cco/core';
import { createContext } from '../context.js';
import { runLaunch } from '../process-launch.js';
import type { ParsedArgs } from '../argv.js';
import { flagString } from '../argv.js';

const VALID_MODES = new Set(['observe', 'safe', 'aggressive']);

/** `cco task <prompt>` (13_CLI_SPEC.md section 7). Narrow, intent-aware envelope. */
export async function cmdTask(parsed: ParsedArgs): Promise<number> {
  const prompt = parsed.args.join(' ').trim();
  if (!prompt) {
    console.error('usage: cco task "<prompt>"');
    return 2;
  }
  const modeFlag = flagString(parsed.flags, 'mode') ?? 'safe';
  if (!VALID_MODES.has(modeFlag)) {
    console.error(`invalid --mode: ${modeFlag}`);
    return 2;
  }
  const ctx = await createContext(process.cwd(), false);
  const result = await runLaunch(ctx, {
    mode: modeFlag as OptimizationMode,
    strict: false,
    intentPrompt: prompt,
    claudeArgs: parsed.passthrough
  });
  for (const r of result.reasons) console.error('cco: ' + r);
  return result.exitCode;
}
