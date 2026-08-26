// ponytail: minimal flat config; no plugin dependency, catches obvious mistakes only via tsc instead.
export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'plugin/cco/bin/cco-hook.bundle.mjs']
  }
];
