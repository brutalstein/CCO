import path from 'node:path';
import { promises as fs } from 'node:fs';
import { atomicWriteJson, readJsonIfExists } from '@cco/platform';
import type { NamedProfile } from '@cco/core';
import { createContext, printJson } from '../context.js';
import type { ParsedArgs } from '../argv.js';
import { flagBool, flagString } from '../argv.js';

function namedProfilesDir(configDir: string): string {
  return path.join(configDir, 'named-profiles');
}

function emptyProfile(name: string): NamedProfile {
  return { name, neverDisable: [], protectedIds: [], excluded: [] };
}

/** `cco profile` subcommands (13_CLI_SPEC.md section 9). Stored in CCO config, never in Claude settings. */
export async function cmdProfile(parsed: ParsedArgs): Promise<number> {
  const json = flagBool(parsed.flags, 'json');
  const ctx = await createContext(process.cwd(), json);
  const dir = namedProfilesDir(ctx.store.paths.configDir);
  const sub = parsed.args[0];
  const name = parsed.args[1];
  const filePath = (n: string) => path.join(dir, `${n}.json`);

  if (sub === 'list') {
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    const names = files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
    if (json) printJson(names, 'profile-list');
    else console.log(names.length ? names.join('\n') : '(no named profiles)');
    return 0;
  }

  if (!name) {
    console.error('usage: cco profile <list|show|create|pin|protect|unpin|delete|validate> <name>');
    return 2;
  }

  if (sub === 'show') {
    const p = await readJsonIfExists<NamedProfile>(filePath(name));
    if (!p) { console.error(`no such profile: ${name}`); return 1; }
    if (json) printJson(p, 'profile-show');
    else console.log(JSON.stringify(p, null, 2));
    return 0;
  }

  if (sub === 'create') {
    const p = (await readJsonIfExists<NamedProfile>(filePath(name))) ?? emptyProfile(name);
    await atomicWriteJson(filePath(name), p);
    console.log(`created profile: ${name}`);
    return 0;
  }

  if (sub === 'delete') {
    await fs.unlink(filePath(name)).catch(() => undefined);
    console.log(`deleted profile: ${name}`);
    return 0;
  }

  if (sub === 'pin' || sub === 'protect' || sub === 'unpin') {
    const pluginId = flagString(parsed.flags, 'plugin');
    if (!pluginId) { console.error('usage: cco profile ' + sub + ' <name> --plugin <id>'); return 2; }
    const p = (await readJsonIfExists<NamedProfile>(filePath(name))) ?? emptyProfile(name);
    if (sub === 'pin') p.neverDisable = [...new Set([...p.neverDisable, pluginId])];
    if (sub === 'protect') p.protectedIds = [...new Set([...p.protectedIds, pluginId])];
    if (sub === 'unpin') p.neverDisable = p.neverDisable.filter((id) => id !== pluginId);
    await atomicWriteJson(filePath(name), p);
    console.log(`${sub} applied to ${name}: ${pluginId}`);
    return 0;
  }

  if (sub === 'validate') {
    const p = await readJsonIfExists<NamedProfile>(filePath(name));
    if (!p) { console.error(`no such profile: ${name}`); return 1; }
    const inventory = await ctx.inventoryService.loadOrRefresh({ cwd: ctx.cwd });
    const baseline = new Set(inventory.plugins.filter((pl) => pl.enabled).map((pl) => pl.canonicalId));
    const warnings = [...p.neverDisable, ...p.protectedIds].filter((id) => !baseline.has(id)).map((id) => `not currently baseline-enabled: ${id}`);
    if (json) printJson(p, 'profile-validate', warnings.length === 0, warnings);
    else {
      console.log(warnings.length === 0 ? 'valid' : warnings.join('\n'));
    }
    return 0;
  }

  console.error(`unknown profile subcommand: ${sub}`);
  return 2;
}
