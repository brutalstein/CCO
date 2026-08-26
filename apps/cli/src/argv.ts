export interface ParsedArgs {
  command: string | null;
  args: string[];
  flags: Record<string, string | boolean>;
  passthrough: string[];
}

/** Minimal, dependency-free CLI argument parser (13_CLI_SPEC.md). */
export function parseArgv(argv: string[]): ParsedArgs {
  const dashIndex = argv.indexOf('--');
  const own = dashIndex >= 0 ? argv.slice(0, dashIndex) : argv;
  const passthrough = dashIndex >= 0 ? argv.slice(dashIndex + 1) : [];

  const command = own[0] ?? null;
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < own.length; i++) {
    const tok = own[i];
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      if (eq >= 0) {
        flags[tok.slice(2, eq)] = tok.slice(eq + 1);
      } else {
        const next = own[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[tok.slice(2)] = next;
          i += 1;
        } else {
          flags[tok.slice(2)] = true;
        }
      }
    } else {
      args.push(tok);
    }
  }

  return { command, args, flags, passthrough };
}

export function flagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === 'string' ? v : undefined;
}

export function flagBool(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true || flags[key] === 'true';
}
