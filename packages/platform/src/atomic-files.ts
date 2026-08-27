import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Atomic file helpers (03_SYSTEM_ARCHITECTURE.md section 8, 11_SECURITY S6).
 * Write to a unique temp sibling then rename; owner-only mode where the OS supports it.
 */

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`refusing unsafe state directory: ${dir}`);
  await fs.chmod(dir, 0o700).catch(() => undefined);
}

async function assertNotSymlink(filePath: string): Promise<void> {
  const stat = await fs.lstat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (stat?.isSymbolicLink()) throw new Error(`refusing symbolic-link file target: ${filePath}`);
}

export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await assertNotSymlink(filePath);
  const tmp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  await fs.writeFile(tmp, content, { mode: 0o600 });
  await fs.rename(tmp, filePath);
  await fs.chmod(filePath, 0o600).catch(() => undefined);
}

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await atomicWriteFile(filePath, JSON.stringify(value, null, 2) + '\n');
}

// Fail-open for any read/parse error (missing file, corrupted JSON, permission denied) —
// callers treat null as "fall back to defaults", matching the project's native-fallback
// failure model (22_FAILURE_MODES_FALLBACKS.md), not just the ENOENT case.
export async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    await assertNotSymlink(filePath);
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function appendJsonl(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await assertNotSymlink(filePath);
  await fs.appendFile(filePath, JSON.stringify(value) + '\n', { mode: 0o600 });
  await fs.chmod(filePath, 0o600).catch(() => undefined);
}

export function canonicalHash(value: unknown): string {
  const json = canonicalStringify(value);
  return crypto.createHash('sha256').update(json).digest('hex');
}

/** Deterministic stringify: object keys sorted recursively so identical content hashes identically. */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
