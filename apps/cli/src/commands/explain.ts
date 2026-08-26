import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CompiledProfile } from '@cco/core';
import { renderExplainReport } from '@cco/report';
import { createContext, printJson } from '../context.js';
import type { ParsedArgs } from '../argv.js';
import { flagBool, flagString } from '../argv.js';

async function latestProfileId(profilesDir: string): Promise<string | null> {
  const files = await fs.readdir(profilesDir).catch(() => [] as string[]);
  let best: { id: string; mtime: number } | null = null;
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const stat = await fs.stat(path.join(profilesDir, file)).catch(() => null);
    if (stat && (!best || stat.mtimeMs > best.mtime)) best = { id: file.replace(/\.json$/, ''), mtime: stat.mtimeMs };
  }
  return best?.id ?? null;
}

/** `cco explain` (13_CLI_SPEC.md section 8). Shows the stored reason ledger, never a re-guessed narrative. */
export async function cmdExplain(parsed: ParsedArgs): Promise<number> {
  const json = flagBool(parsed.flags, 'json');
  const ctx = await createContext(process.cwd(), json);

  const explicitId = flagString(parsed.flags, 'profile');
  const id = explicitId ?? (await latestProfileId(ctx.store.paths.profilesDir));
  if (!id) {
    console.error('no profile found; run `cco run` or `cco analyze` first');
    return 1;
  }

  const profile = await ctx.store.getSnapshot<CompiledProfile>('profile', id);
  if (!profile) {
    console.error(`profile not found: ${id}`);
    return 1;
  }

  if (json) printJson(profile, 'explain');
  else console.log(renderExplainReport(profile));
  return 0;
}
