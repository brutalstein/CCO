import { defaultConfig } from '@cco/core';
import { createContext, printJson } from '../context.js';
import type { ParsedArgs } from '../argv.js';
import { flagBool } from '../argv.js';

/** `cco init` (13_CLI_SPEC.md section 2, 25_INSTALLATION_DISTRIBUTION_RELEASE.md section 3). */
export async function cmdInit(parsed: ParsedArgs): Promise<number> {
  const json = flagBool(parsed.flags, 'json');
  const ctx = await createContext(process.cwd(), json);
  const env = await ctx.adapter.probe({ cwd: ctx.cwd });

  if (!env.found) {
    if (json) printJson({ found: false }, 'init', false, [], ['claude binary not found']);
    else console.error('Claude Code not found. Install Claude Code first, then re-run `cco init`.');
    return 1;
  }

  const existing = await ctx.store.readConfig().catch(() => null);
  if (!existing) await ctx.store.writeConfig(defaultConfig());

  await ctx.inventoryService.loadOrRefresh({ cwd: ctx.cwd });

  const pluginGuidance =
    'CCO plugin not auto-installed (no pinned marketplace source configured). ' +
    'For development, run: claude plugin install --plugin-dir ./plugin/cco';

  if (json) {
    printJson({ claudeVersion: env.version, configDir: ctx.store.paths.configDir, pluginGuidance }, 'init');
  } else {
    console.log(`Claude Code ${env.version ?? 'detected'} found.`);
    console.log(`CCO config: ${ctx.store.paths.configDir}`);
    console.log(pluginGuidance);
    console.log('Next: cco run');
  }
  return 0;
}
