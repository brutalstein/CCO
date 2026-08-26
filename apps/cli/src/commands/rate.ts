import crypto from 'node:crypto';
import { buildEvent, projectIdFromRoot } from '@cco/core';
import { createContext } from '../context.js';
import type { ParsedArgs } from '../argv.js';
import { flagBool, flagString } from '../argv.js';

/** `cco rate` (13_CLI_SPEC.md section 13, 09_QUALITY_MODEL_AND_EVALS.md section 11). Stores rating + reason tag only. */
export async function cmdRate(parsed: ParsedArgs): Promise<number> {
  if (!flagBool(parsed.flags, 'last')) {
    console.error('usage: cco rate --last good|bad [--reason <tag>]');
    return 2;
  }
  const rating = parsed.args[0];
  if (rating !== 'good' && rating !== 'bad') {
    console.error('rating must be good|bad, e.g. cco rate --last good');
    return 2;
  }
  const reason = flagString(parsed.flags, 'reason') ?? null;
  const ctx = await createContext(process.cwd(), false);
  const env = await ctx.adapter.probe({ cwd: ctx.cwd });
  await ctx.store.appendEvent(buildEvent('rating', env.version, projectIdFromRoot(ctx.cwd), crypto.randomBytes(8).toString('hex'), { rating, reason }));
  console.log(`recorded rating: ${rating}${reason ? ' (' + reason + ')' : ''}`);
  return 0;
}
