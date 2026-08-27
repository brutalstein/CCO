#!/usr/bin/env node
import path from 'node:path';
import { readJsonIfExists } from '@cco/platform';
import { normalizeHookInput, encodeHookContext } from '@cco/claude-adapter';
import {
  JsonStateStore,
  validateConfig,
  defaultConfig,
  buildEvent,
  projectIdFromRoot,
  sessionStartDigest,
  userPromptSubmitRoute,
  graphSnapshotId
} from '@cco/core';

const EVENT_MAP = {
  'session-start': 'SessionStart',
  'user-prompt-submit': 'UserPromptSubmit',
  'session-end': 'SessionEnd'
};

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function loadHookConfig(store) {
  const override = process.env.CCO_CONFIG_PATH;
  if (!override) return store.readConfig();
  const raw = await readJsonIfExists(override);
  if (raw === null) return defaultConfig();
  return validateConfig(raw).config;
}

async function main() {
  const event = EVENT_MAP[process.argv[2] ?? ''];
  if (!event) return 0;
  if (process.env.CCO_ACTIVE !== '1') return 0;

  let raw;
  try {
    raw = await readStdin();
  } catch {
    return 0;
  }

  try {
    const hookInput = normalizeHookInput(event, JSON.parse(raw));
    const stateDirEnv = process.env.CCO_STATE_DIR;
    const profilePathEnv = process.env.CCO_PROFILE_PATH;
    if (!stateDirEnv || !profilePathEnv) return 0;

    const root = path.dirname(stateDirEnv);
    const store = new JsonStateStore(root);
    const config = await loadHookConfig(store);
    const profile = await readJsonIfExists(profilePathEnv);
    if (!profile) return 0;

    const graph = await store.getSnapshot(
      'graph',
      graphSnapshotId(profile.inventoryId, profile.repoFingerprintId)
    );

    const claudeVersion = null;
    const projectId = projectIdFromRoot(hookInput.cwd);
    const evidence = { records: await store.listEvidence() };

    if (event === 'SessionStart') {
      const digest = sessionStartDigest({
        profile,
        graph,
        config,
        evidence,
        agentTeamsEnabled: config.experimental.agentTeams
      });
      await store.appendEvent(
        buildEvent('session_start', claudeVersion, projectId, hookInput.sessionId, { profileId: profile.id })
      );
      if (digest) process.stdout.write(JSON.stringify(encodeHookContext('SessionStart', digest)) + '\n');
      return 0;
    }

    if (event === 'UserPromptSubmit') {
      if (!graph || !config.routing.enabled) return 0;
      const prompt = hookInput.prompt ?? '';
      const { hintText, reasonCode } = userPromptSubmitRoute(
        { profile, graph, config, evidence, agentTeamsEnabled: config.experimental.agentTeams },
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
      if (hintText) process.stdout.write(JSON.stringify(encodeHookContext('UserPromptSubmit', hintText)) + '\n');
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

main().then((code) => {
  process.exitCode = code;
});
