import path from 'node:path';
import { promises as fs } from 'node:fs';
import { NodeProcessLauncher, type ProcessLauncher, canonicalHash } from '@cco/platform';
import { languagesFromExtensions } from './languages.js';
import { SCHEMA_VERSION, type RepoFingerprint } from '../types.js';

export interface RepoScanOptions {
  maxTrackedFiles: number;
  maxManifestBytes: number;
  maxTotalParsedBytes: number;
  deepScan: boolean;
}

export const DEFAULT_REPO_SCAN_OPTIONS: RepoScanOptions = {
  maxTrackedFiles: 50000,
  maxManifestBytes: 262144,
  maxTotalParsedBytes: 4194304,
  deepScan: false
};

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', '.venv', 'venv', 'vendor', 'coverage', '.next', '.cache', 'out', '.turbo'
]);

const KNOWN_MANIFESTS = [
  'package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod',
  'pom.xml', 'build.gradle', '*.csproj', 'CMakeLists.txt', 'package.xml',
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '*.tf'
];

export interface RepoAnalyzer {
  fingerprint(root: string, options?: RepoScanOptions): Promise<RepoFingerprint>;
}

/**
 * Bounded, non-secret repository fingerprinter (18_REPOSITORY_ANALYSIS.md).
 * Never reads .env content, source bodies, or files outside size caps.
 */
export class DefaultRepoAnalyzer implements RepoAnalyzer {
  constructor(private readonly launcher: ProcessLauncher = new NodeProcessLauncher()) {}

  async fingerprint(root: string, options: RepoScanOptions = DEFAULT_REPO_SCAN_OPTIONS): Promise<RepoFingerprint> {
    const git = await this.gitStatus(root);
    const tracked = await this.trackedFiles(root, git.isRepo, options);
    let files = tracked.files;
    let partial = tracked.partial;
    if (files.length > options.maxTrackedFiles) {
      files = files.slice(0, options.maxTrackedFiles);
      partial = true;
    }
    files = files.filter((f) => !isIgnored(f) && !isSecretLike(f));

    const languages = languagesFromExtensions(files);
    const manifestFiles = files.filter((f) => KNOWN_MANIFESTS.some((m) => matchManifest(f, m)));
    const inspected = await this.inspectManifests(root, manifestFiles, options);
    if (inspected.parsedBytes >= options.maxTotalParsedBytes) partial = true;

    const inputsHash = canonicalHash({ files: files.slice().sort(), manifestFiles: manifestFiles.slice().sort() });

    return {
      schemaVersion: SCHEMA_VERSION,
      id: "repo_" + canonicalHash({ inputsHash, git }),
      rootHash: canonicalHash(path.basename(root)),
      git,
      languages,
      frameworks: inspected.frameworks,
      domains: inspected.domains,
      manifests: manifestFiles.slice().sort(),
      workspaceKind: inspected.workspaceKind,
      partial,
      fingerprintInputsHash: inputsHash
    };
  }

  private async gitStatus(root: string): Promise<RepoFingerprint['git']> {
    try {
      const branchRes = await this.launcher.runCapture({ command: 'git', args: ['rev-parse', '--abbrev-ref', 'HEAD'], cwd: root }, 4000);
      if (branchRes.code !== 0) return { isRepo: false, branch: null, dirty: false };
      const statusRes = await this.launcher.runCapture({ command: 'git', args: ['status', '--porcelain'], cwd: root }, 4000);
      return { isRepo: true, branch: branchRes.stdout.trim() || null, dirty: statusRes.stdout.trim().length > 0 };
    } catch {
      return { isRepo: false, branch: null, dirty: false };
    }
  }

  private async trackedFiles(root: string, isRepo: boolean, options: RepoScanOptions): Promise<{ files: string[]; partial: boolean }> {
    if (isRepo) {
      try {
        const res = await this.launcher.runCapture({ command: 'git', args: ['ls-files'], cwd: root }, 8000);
        if (res.code === 0) return { files: res.stdout.split('\n').map((l) => l.trim()).filter(Boolean), partial: false };
      } catch {
        // fall through to bounded walk
      }
    }
    return this.boundedWalk(root, options.maxTrackedFiles);
  }

  private async boundedWalk(root: string, cap: number): Promise<{ files: string[]; partial: boolean }> {
    const out: string[] = [];
    const stack: string[] = [root];
    while (stack.length > 0 && out.length < cap) {
      const dir = stack.pop() as string;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else out.push(path.relative(root, full).split(path.sep).join('/'));
        if (out.length >= cap) break;
      }
    }
    return { files: out, partial: stack.length > 0 || out.length >= cap };
  }

  private async inspectManifests(
    root: string,
    manifestFiles: string[],
    options: RepoScanOptions
  ): Promise<{ frameworks: string[]; domains: string[]; workspaceKind: 'single-package' | 'monorepo'; parsedBytes: number }> {
    const frameworks = new Set<string>();
    const domains = new Set<string>();
    let parsedBytes = 0;
    let packageJsonCount = 0;

    for (const rel of manifestFiles) {
      if (parsedBytes >= options.maxTotalParsedBytes) break;
      const full = path.join(root, rel);
      let stat;
      try {
        stat = await fs.stat(full);
      } catch {
        continue;
      }
      if (stat.size > options.maxManifestBytes) continue;
      const base = path.basename(rel);

      if (base === 'package.json') {
        packageJsonCount += 1;
        try {
          const raw = await fs.readFile(full, 'utf8');
          parsedBytes += raw.length;
          const json = JSON.parse(raw) as Record<string, unknown>;
          const deps = { ...(json.dependencies as object), ...(json.devDependencies as object) } as Record<string, unknown>;
          if (json.workspaces) frameworks.add('npm-workspaces');
          if ('react' in deps) { frameworks.add('react'); domains.add('frontend-ui'); }
          if ('vite' in deps) frameworks.add('vite');
          if ('next' in deps) { frameworks.add('nextjs'); domains.add('frontend-ui'); }
          if ('express' in deps || 'fastify' in deps) domains.add('backend-api');
        } catch {
          // malformed manifest: ignore, do not crash fingerprinting
        }
      } else if (base === 'Cargo.toml') {
        frameworks.add('cargo');
        domains.add('backend-api');
      } else if (base === 'go.mod') {
        frameworks.add('go-modules');
        domains.add('backend-api');
      } else if (base === 'pyproject.toml' || base === 'requirements.txt') {
        frameworks.add('python-project');
      } else if (base === 'package.xml') {
        frameworks.add('ros2');
      } else if (base === 'CMakeLists.txt') {
        frameworks.add('cmake');
      } else if (base.startsWith('docker-compose') || base === 'Dockerfile') {
        frameworks.add('docker');
        domains.add('infrastructure');
      }
    }

    if (manifestFiles.some((f) => f.endsWith('.tf'))) { frameworks.add('terraform'); domains.add('infrastructure'); }

    return {
      frameworks: [...frameworks].sort(),
      domains: [...domains].sort(),
      workspaceKind: packageJsonCount > 1 || frameworks.has('npm-workspaces') ? 'monorepo' : 'single-package',
      parsedBytes
    };
  }
}

function matchManifest(file: string, pattern: string): boolean {
  const base = path.basename(file);
  if (pattern.startsWith('*')) return base.endsWith(pattern.slice(1));
  return base === pattern || file === pattern;
}

function isIgnored(file: string): boolean {
  return file.split('/').some((part) => IGNORE_DIRS.has(part));
}

function isSecretLike(file: string): boolean {
  const base = path.basename(file);
  return base === '.env' || base.startsWith('.env.') || base.endsWith('.pem') || base.endsWith('.key');
}
