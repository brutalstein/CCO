#!/usr/bin/env node
const args = process.argv.slice(2);

const HELP = `Usage: claude [options] [command]

A fake Claude Code CLI fixture for CCO integration tests.

Commands:
  plugin list [--json]         list installed plugins
  plugin details <id> [--json] show projected cost/components for a plugin

Options:
  --version         output version
  --settings <path> session settings overlay
  -p <prompt>        headless print mode
  --output-format <fmt>
  --mcp-config <path>
  --strict-mcp-config
  workflow, agent team support: enabled in this fixture
`;

const PLUGIN_LIST = {
  plugins: [
    { id: 'security-tools@example', name: 'security-tools', version: '1.4.0', source: 'marketplace', enabled: true, managed: false },
    { id: 'frontend-kit@example', name: 'frontend-kit', version: '2.0.1', source: 'marketplace', enabled: true, managed: false }
  ]
};

const PLUGIN_DETAILS = {
  'security-tools@example': {
    components: [{ type: 'skill', id: 'skill:plugin:security-tools/review-auth', name: 'review-auth' }],
    alwaysOnTokens: 420,
    dependencies: [],
    riskFlags: []
  },
  'frontend-kit@example': {
    components: [{ type: 'skill', id: 'skill:plugin:frontend-kit/component-scaffold', name: 'component-scaffold' }],
    alwaysOnTokens: 260,
    dependencies: [],
    riskFlags: []
  }
};

function main() {
  if (args.includes('--version')) {
    process.stdout.write('2.1.246 (Claude Code)\n');
    return 0;
  }

  if (args.includes('--help')) {
    process.stdout.write(HELP);
    return 0;
  }

  if (args[0] === 'plugin' && args[1] === 'list') {
    process.stdout.write(JSON.stringify(PLUGIN_LIST) + '\n');
    return 0;
  }

  if (args[0] === 'plugin' && args[1] === 'details') {
    const id = args[2];
    process.stdout.write(JSON.stringify(PLUGIN_DETAILS[id] ?? {}) + '\n');
    return 0;
  }

  if (args.includes('-p')) {
    const fmt = args[args.indexOf('--output-format') + 1] ?? 'text';
    if (fmt === 'stream-json' || fmt === 'json') {
      process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: 'fake response', is_error: false }) + '\n');
    } else {
      process.stdout.write('fake response\n');
    }
    return 0;
  }

  process.stderr.write(`fake-claude: unrecognized invocation: ${args.join(' ')}\n`);
  return 1;
}

process.exitCode = main();
