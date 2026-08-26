import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createContext, printJson } from '../context.js';
import type { ParsedArgs } from '../argv.js';
import { flagBool, flagString } from '../argv.js';

async function dirStats(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    const entries = await fs.readdir(cur, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else {
        files += 1;
        bytes += (await fs.stat(full).catch(() => ({ size: 0 }))).size;
      }
    }
  }
  return { files, bytes };
}

function parseDays(spec: string | undefined, fallback: number): number {
  if (!spec) return fallback;
  const m = spec.match(/^(\d+)d$/);
  return m ? Number(m[1]) : fallback;
}

/** `cco data` (13_CLI_SPEC.md section 15). Only ever touches CCO-owned state/config. */
export async function cmdData(parsed: ParsedArgs): Promise<number> {
  const json = flagBool(parsed.flags, 'json');
  const ctx = await createContext(process.cwd(), json);
  const sub = parsed.args[0];

  if (sub === 'stats') {
    const stats = await dirStats(ctx.store.paths.stateDir);
    if (json) printJson(stats, 'data-stats');
    else console.log(`files: ${stats.files}, bytes: ${stats.bytes}`);
    return 0;
  }

  if (sub === 'export') {
    const out = flagString(parsed.flags, 'out');
    if (!out) { console.error('usage: cco data export --out <dir>'); return 2; }
    await fs.cp(ctx.store.paths.stateDir, path.join(out, 'state'), { recursive: true }).catch(() => undefined);
    await fs.cp(ctx.store.paths.configDir, path.join(out, 'config'), { recursive: true }).catch(() => undefined);
    console.log(`exported to ${out}`);
    return 0;
  }

  if (sub === 'prune') {
    const days = parseDays(flagString(parsed.flags, 'older-than'), (await ctx.store.readConfig()).privacy.eventRetentionDays);
    const report = await ctx.store.cleanup({ eventRetentionDays: days });
    if (json) printJson(report, 'data-prune');
    else console.log(`removed ${report.removedFiles.length} file(s)`);
    return 0;
  }

  if (sub === 'reset') {
    if (!flagBool(parsed.flags, 'yes')) { console.error('refusing to reset without --yes'); return 2; }
    await fs.rm(ctx.store.paths.stateDir, { recursive: true, force: true });
    await fs.rm(ctx.store.paths.configDir, { recursive: true, force: true });
    console.log('CCO state and config removed. Claude settings and other plugins are untouched.');
    return 0;
  }

  console.error('usage: cco data <stats|export|prune|reset>');
  return 2;
}
