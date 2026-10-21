#!/usr/bin/env node
import { main } from '../src/cli.mjs';
import { showError } from '../src/terminal.mjs';
try { await main(process.argv.slice(2)); }
catch (error) {
  if (process.argv.includes('--json')) console.log(JSON.stringify({ error: error.message }));
  else showError(error.message);
  process.exitCode = 1;
}
