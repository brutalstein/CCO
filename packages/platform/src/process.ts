import { spawn } from 'node:child_process';

/**
 * Process launch abstraction (31_API_INTERNAL_INTERFACES.md section 15).
 * Arguments are always arrays; shell mode is never used for prompt/plugin-derived values
 * (11_SECURITY_PRIVACY_THREAT_MODEL.md S9 / hook command-injection threat).
 */

export interface SpawnSpec {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ExitResult {
  code: number;
  signal: NodeJS.Signals | null;
}

export interface CapturedProcessResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ProcessLauncher {
  spawnInteractive(spec: SpawnSpec): Promise<ExitResult>;
  runCapture(spec: SpawnSpec, timeoutMs: number): Promise<CapturedProcessResult>;
}

export class NodeProcessLauncher implements ProcessLauncher {
  spawnInteractive(spec: SpawnSpec): Promise<ExitResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env ?? process.env,
        stdio: 'inherit',
        shell: false
      });

      const forward = (signal: NodeJS.Signals) => {
        if (!child.killed) child.kill(signal);
      };
      process.once('SIGINT', () => forward('SIGINT'));
      process.once('SIGTERM', () => forward('SIGTERM'));

      child.once('error', reject);
      child.once('exit', (code, signal) => {
        resolve({ code: code ?? (signal ? 1 : 0), signal });
      });
    });
  }

  runCapture(spec: SpawnSpec, timeoutMs: number): Promise<CapturedProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout?.on('data', (d) => (stdout += d.toString('utf8')));
      child.stderr?.on('data', (d) => (stderr += d.toString('utf8')));
      child.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? (timedOut ? 124 : 1), stdout, stderr, timedOut });
      });
    });
  }
}
