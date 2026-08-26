import { renderDoctorReport } from '@cco/report';
import { createContext, printJson } from '../context.js';
import type { ParsedArgs } from '../argv.js';
import { flagBool } from '../argv.js';

/** `cco doctor` (13_CLI_SPEC.md section 3). Read-only except stale temp cleanup. */
export async function cmdDoctor(parsed: ParsedArgs): Promise<number> {
  const json = flagBool(parsed.flags, 'json');
  const ctx = await createContext(process.cwd(), json);
  const env = await ctx.adapter.probe({ cwd: ctx.cwd });

  const cleanup = await ctx.store.cleanup({ eventRetentionDays: (await ctx.store.readConfig()).privacy.eventRetentionDays });

  const pluginStatus = env.found ? 'not checked (use `cco init`)' : 'unknown (Claude not found)';

  if (json) {
    printJson({ environment: env, staleFilesRemoved: cleanup.removedFiles.length }, 'doctor', env.found);
  } else {
    console.log(renderDoctorReport(env, pluginStatus));
    if (cleanup.removedFiles.length > 0) console.log(`cleaned up ${cleanup.removedFiles.length} stale temp file(s)`);
  }

  return env.found ? 0 : 1;
}
