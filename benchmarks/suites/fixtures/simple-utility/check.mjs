import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const mod = require('./src/math.js');
if (typeof mod.add !== 'function') {
  console.error('math.js does not export a function named add');
  process.exit(1);
}
if (mod.add(2, 3) !== 5) {
  console.error(`add(2, 3) returned ${mod.add(2, 3)}, expected 5`);
  process.exit(1);
}
process.exit(0);
