import { renderInventoryReport } from '@cco/report';
import { createContext, printJson } from '../context.js';
import type { ParsedArgs } from '../argv.js';
import { flagBool } from '../argv.js';

/** `cco inventory` (13_CLI_SPEC.md section 4, FR-002/FR-003). */
export async function cmdInventory(parsed: ParsedArgs): Promise<number> {
  const json = flagBool(parsed.flags, 'json');
  const refresh = flagBool(parsed.flags, 'refresh');
  const ctx = await createContext(process.cwd(), json);
  const inventory = await ctx.inventoryService.loadOrRefresh({ cwd: ctx.cwd, forceRefresh: refresh });

  if (json) {
    printJson(inventory, 'inventory', !inventory.partial, inventory.partial ? ['inventory is partial: ' + inventory.missingSources.join(', ')] : []);
  } else {
    console.log(renderInventoryReport(inventory));
  }
  return 0;
}
