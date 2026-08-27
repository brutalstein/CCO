import { defaultConfig } from '@cco/core';
import { createContext, printJson } from '../context.js';
import type { ParsedArgs } from '../argv.js';
import { flagBool } from '../argv.js';
import { flagString } from '../argv.js';

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

  const existing = await ctx.store.readConfig().catch(() => defaultConfig());
  await ctx.store.writeConfig(existing);

  const install = await ctx.adapter.ensurePluginInstalled({
    cwd: ctx.cwd,
    env,
    marketplaceSource: flagString(parsed.flags, 'plugin-source') ?? 'brutalstein/cco',
    pluginName: 'cco',
    defaultMarketplaceName: 'cco'
  });
  if (!install.ok) {
    if (json) printJson(install, 'init', false, [], install.errors);
    else console.error(`CCO plugin installation failed: ${install.errors.join('; ')}`);
    return 1;
  }

  await ctx.inventoryService.loadOrRefresh({ cwd: ctx.cwd, forceRefresh: !install.alreadyInstalled });

  const pluginStatus = install.alreadyInstalled
    ? `CCO plugin already installed (${install.canonicalId})`
    : `CCO plugin installed and strictly validated (${install.canonicalId})`;

  if (json) {
    printJson({ claudeVersion: env.version, configDir: ctx.store.paths.configDir, pluginStatus }, 'init');
  } else {
    console.log(`Claude Code ${env.version ?? 'detected'} found.`);
    console.log(`CCO config: ${ctx.store.paths.configDir}`);
    console.log(pluginStatus);
    console.log('Next: cco run');
  }
  return 0;
}
