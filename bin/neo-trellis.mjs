#!/usr/bin/env node
import { main } from '../src/cli.mjs';
try { await main(process.argv.slice(2)); }
catch (error) {
  if (process.argv.includes('--json')) console.log(JSON.stringify({ error: error.message }));
  else console.error(`\n  ! neo-trellis: ${error.message}\n`);
  process.exitCode = 1;
}
