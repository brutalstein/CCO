import path from 'node:path';
import { readJsonIfExists } from '@cco/platform';
import {
  JsonStateStore,
  validateConfig,
  defaultConfig,
  buildEvent,
  projectIdFromRoot,
  sessionStartDigest,
  userPromptSubmitRoute,
  graphSnapshotId,
  type CapabilityGraph,
  type CCOConfig,
  type CompiledProfile
} from '@cco/core';
import { createContext } from '../context.js';
import type { ParsedArgs } from '../argv.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const EVENT_MAP: Record<string, 'SessionStart' | 'UserPromptSubmit' | 'SessionEnd'> = {
  'session-start': 'SessionStart',
  'user-prompt-submit': 'UserPromptSubmit',
  'session-end': 'SessionEnd'
};

async function loadHookConfig(root: string, store: JsonStateStore): Promise<CCOConfig> {
  const override = process.env.CCO_CONFIG_PATH;
  if (!override) return store.readConfig();
  const raw = await readJsonIfExists<unknown>(override);
  if (raw === null) return defaultConfig();
  return validateConfig(raw).config;
}

export async function runHook(parsed: ParsedArgs): Promise<number> {
  const event = EVENT_MAP[parsed.args[0] ?? ''];
  if (!event) return 0;
  if (process.env.CCO_ACTIVE !== '1') return 0;

  const ctx = await createContext(process.cwd(), false);

  let raw: string;
  try {
    raw = await readStdin();
  } catch {
    return 0;
  }

  try {
    const hookInput = ctx.adapter.normalizeHookInput(event, JSON.parse(raw));
    const stateDirEnv = process.env.CCO_STATE_DIR;
    const profilePathEnv = process.env.CCO_PROFILE_PATH;
    if (!stateDirEnv || !profilePathEnv) return 0;

    const root = path.dirname(stateDirEnv);
    const store = new JsonStateStore(root);
    const config = await loadHookConfig(root, store);
    const profile = await readJsonIfExists<CompiledProfile>(profilePathEnv);
    if (!profile) return 0;

    const graph = await store.getSnapshot<CapabilityGraph>(
      'graph',
      graphSnapshotId(profile.inventoryId, profile.repoFingerprintId)
    );

    const claudeVersion = null;
    const projectId = projectIdFromRoot(hookInput.cwd);

    if (event === 'SessionStart') {
      const digest = sessionStartDigest({
        profile,
        graph,
        config,
        evidence: { records: [] },
        agentTeamsEnabled: config.experimental.agentTeams
      });
      await store.appendEvent(
        buildEvent('session_start', claudeVersion, projectId, hookInput.sessionId, { profileId: profile.id })
      );
      if (digest) process.stdout.write(JSON.stringify(ctx.adapter.encodeHookContext('SessionStart', digest)) + '\n');
      return 0;
    }

    if (event === 'UserPromptSubmit') {
      if (!graph || !config.routing.enabled) return 0;
      const prompt = hookInput.prompt ?? '';
      const { hintText, reasonCode } = userPromptSubmitRoute(
        { profile, graph, config, evidence: { records: [] }, agentTeamsEnabled: config.experimental.agentTeams },
        prompt,
        hookInput.cwd,
        hookInput.sessionId
      );
      await store.appendEvent(
        buildEvent('route', claudeVersion, projectId, hookInput.sessionId, {
          profileId: profile.id,
          reasonCode,
          injected: hintText !== null
        })
      );
      if (hintText) process.stdout.write(JSON.stringify(ctx.adapter.encodeHookContext('UserPromptSubmit', hintText)) + '\n');
      return 0;
    }

    if (event === 'SessionEnd') {
      await store.appendEvent(
        buildEvent('session_end', claudeVersion, projectId, hookInput.sessionId, { profileId: profile.id })
      );
      return 0;
    }

    return 0;
  } catch {
    return 0;
  }
}
