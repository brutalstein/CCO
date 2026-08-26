/**
 * Registers a cleanup callback that runs once on normal exit, SIGINT or SIGTERM.
 * Used by the launcher to remove ephemeral settings overlays (03_SYSTEM_ARCHITECTURE.md section 8).
 */
export function onExitOnce(cleanup: () => void): void {
  let ran = false;
  const run = () => {
    if (ran) return;
    ran = true;
    cleanup();
  };
  process.once('exit', run);
  process.once('SIGINT', run);
  process.once('SIGTERM', run);
}
