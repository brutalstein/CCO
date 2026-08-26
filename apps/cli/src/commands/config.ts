import { defaultConfig, validateConfig } from '@cco/core';
import { createContext, printJson } from '../context.js';
import type { ParsedArgs } from '../argv.js';
import { flagBool } from '../argv.js';

function getPath(obj: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

function setPath(obj: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (!next || typeof next !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/** `cco config` (13_CLI_SPEC.md section 14). Writes only CCO's own config; every write is re-validated. */
export async function cmdConfig(parsed: ParsedArgs): Promise<number> {
  const json = flagBool(parsed.flags, 'json');
  const ctx = await createContext(process.cwd(), json);
  const sub = parsed.args[0];

  if (sub === 'path') {
    console.log(ctx.store.paths.configDir);
    return 0;
  }

  if (sub === 'get') {
    const config = await ctx.store.readConfig();
    const key = parsed.args[1];
    const value = key ? getPath(config, key) : config;
    if (json) printJson(value, 'config-get');
    else console.log(JSON.stringify(value, null, 2));
    return 0;
  }

  if (sub === 'set') {
    const key = parsed.args[1];
    const rawValue = parsed.args[2];
    if (!key || rawValue === undefined) {
      console.error('usage: cco config set <key> <json-value>');
      return 2;
    }
    const config = (await ctx.store.readConfig()) as unknown as Record<string, unknown>;
    let value: unknown;
    try {
      value = JSON.parse(rawValue);
    } catch {
      value = rawValue;
    }
    setPath(config, key, value);
    try {
      await ctx.store.writeConfig(config as never);
    } catch (err) {
      console.error(String((err as Error).message));
      return 2;
    }
    console.log(`set ${key}`);
    return 0;
  }

  if (sub === 'reset') {
    const key = parsed.args[1];
    const config = (await ctx.store.readConfig()) as unknown as Record<string, unknown>;
    if (key) {
      setPath(config, key, getPath(defaultConfig(), key));
      await ctx.store.writeConfig(config as never);
      console.log(`reset ${key} to default`);
    } else {
      await ctx.store.writeConfig(defaultConfig());
      console.log('reset entire config to defaults');
    }
    return 0;
  }

  if (sub === 'validate') {
    const config = await ctx.store.readConfig();
    const result = validateConfig(config);
    if (json) printJson(result, 'config-validate', result.ok, result.errors);
    else console.log(result.ok ? 'valid' : result.errors.join('\n'));
    return result.ok ? 0 : 1;
  }

  console.error('usage: cco config <path|get|set|reset|validate>');
  return 2;
}
