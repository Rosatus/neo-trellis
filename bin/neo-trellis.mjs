#!/usr/bin/env node
import { main } from '../src/cli.mjs';
try { await main(process.argv.slice(2)); }
catch (error) { console.error(`neo-trellis: ${error.message}`); process.exitCode = 1; }
