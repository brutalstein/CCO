import os from 'node:os';
import path from 'node:path';

/**
 * OS-appropriate CCO config/state directories (03_SYSTEM_ARCHITECTURE.md section 6).
 * Never returns a path outside the user's own profile/home tree.
 */
export interface PlatformPaths {
  configDir: string;
  stateDir: string;
  tmpDir: string;
  inventoriesDir: string;
  graphsDir: string;
  profilesDir: string;
  evidenceDir: string;
  eventsDir: string;
  cacheDir: string;
}

function baseDir(): string {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support');
  }
  return process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
}

export function resolvePlatformPaths(overrideRoot?: string): PlatformPaths {
  const root = overrideRoot ?? path.join(baseDir(), 'cco');
  const stateDir = path.join(root, 'state');
  return {
    configDir: path.join(root, 'config'),
    stateDir,
    tmpDir: path.join(stateDir, 'tmp'),
    inventoriesDir: path.join(stateDir, 'inventories'),
    graphsDir: path.join(stateDir, 'graphs'),
    profilesDir: path.join(stateDir, 'profiles'),
    evidenceDir: path.join(stateDir, 'evidence'),
    eventsDir: path.join(stateDir, 'events'),
    cacheDir: path.join(stateDir, 'cache', 'plugin-details')
  };
}
