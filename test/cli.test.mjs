import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/neo-trellis.mjs', import.meta.url));
test('CLI version comes from package metadata', () => {
  const expected = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  assert.equal(spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).stdout.trim(), expected);
});
function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-cli-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
function run(root, ...args) { return spawnSync(process.execPath, [cli, ...args, '--cwd', root], { encoding: 'utf8' }); }
function put(root, name, text) { const dest = path.join(root, name); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); }
test('CLI fresh init, doctor and route work in a directory with spaces', t => {
  const parent = fixture(t); const root = path.join(parent, 'project with spaces'); fs.mkdirSync(root);
  assert.equal(run(root, 'init', '--codex', '--claude', '--pi', '--dry-run').status, 0);
  assert.equal(fs.readdirSync(root).length, 0);
  const installed = run(root, 'init', '--codex', '--claude', '--pi');
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(run(root, 'doctor').status, 0);
  put(root, '.neo-trellis/routes.json', JSON.stringify({ version: 1, routes: [{ paths: ['src/'], knowledge: ['.neo-trellis/spec/index.md'] }] }));
  const routed = run(root, 'route', 'src/foo.mjs', '--json');
  assert.deepEqual(JSON.parse(routed.stdout).knowledge, ['.neo-trellis/spec/index.md']);
  assert.equal(run(root, 'init', '--codex').status, 0);
  const nested = path.join(root, 'src'); fs.mkdirSync(nested);
  assert.equal(run(nested, 'doctor').status, 0);
  assert.deepEqual(JSON.parse(run(nested, 'route', 'src/foo.mjs', '--json').stdout).knowledge, ['.neo-trellis/spec/index.md']);
});
test('migration previews without mutation; apply archives complete source and retires it', t => {
  const root = fixture(t);
  put(root, 'AGENTS.md', '<!-- TRELLIS:START -->\n# Trellis Instructions\nManaged by Trellis.\n<!-- TRELLIS:END -->\n');
  put(root, '.trellis/workflow.md', 'Old phases');
  put(root, '.trellis/scripts/task.py', 'legacy runtime');
  put(root, '.trellis/spec/backend/index.md', 'Contract');
  put(root, '.trellis/tasks/old/prd.md', 'Historical requirements');
  put(root, '.trellis/tasks/old/task.json', '{"status":"planning"}');
  put(root, '.trellis/tasks/old/attachment.bin', Buffer.from([255, 0, 128]));
  put(root, '.claude/settings.json', JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'python3 .claude/hooks/session-start.py' }, { type: 'command', command: 'echo user' }] }] } }));
  assert.equal(run(root, 'init', '--claude').status, 1);
  const preview = run(root, 'migrate', '--claude');
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /preview/);
  assert.doesNotMatch(preview.stdout, /attachment\.bin/);
  assert.match(run(root, 'migrate', '--claude', '--verbose').stdout, /attachment\.bin/);
  assert.equal(fs.existsSync(path.join(root, '.neo-trellis')), false);
  const applied = run(root, 'migrate', '--claude', '--yes');
  assert.equal(applied.status, 0, applied.stderr);
  const imported = JSON.parse(fs.readFileSync(path.join(root, '.neo-trellis/prds/trellis-imports.json'), 'utf8')).records[0];
  assert.deepEqual(fs.readFileSync(path.join(root, imported.destination, 'attachment.bin')), Buffer.from([255, 0, 128]));
  assert.equal(fs.existsSync(path.join(root, '.trellis')), false);
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.equal(agents.includes('TRELLIS:START -->\n# Trellis Instructions'), false);
  assert.match(agents, /NEO-TRELLIS:START/);
  const settings = fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8');
  assert.match(settings, /echo user/);
  assert.doesNotMatch(settings, /session-start\.py/);
  const backup = fs.readdirSync(path.join(root, '.neo-trellis-backups'))[0];
  assert.ok(fs.existsSync(path.join(root, '.neo-trellis-backups', backup, 'trellis.zip')));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.neo-trellis-backups', backup, 'trellis-manifest.json')));
  assert.ok(manifest.entries.some(e => e.name === '.trellis/scripts/task.py'));
  assert.equal(run(root, 'doctor').status, 0);
});

test('human output is readable without ANSI, JSON emits one object, errors are structured', t => {
  const root = fixture(t);
  const preview = run(root, 'init', '--codex', '--dry-run');
  assert.match(preview.stdout, /NEO-TRELLIS/);
  assert.doesNotMatch(preview.stdout, /\x1b|"write":/);
  const result = JSON.parse(run(root, 'init', '--codex', '--json').stdout);
  assert.ok(result.result.changed > 0);
  assert.equal(JSON.parse(run(root, 'init', '--codex', '--json').stdout).result.changed, 0);
  assert.deepEqual(JSON.parse(run(root, 'doctor', '--json').stdout).errors, []);
  const error = run(root, 'unknown', '--json');
  assert.equal(error.status, 1);
  assert.match(JSON.parse(error.stdout).error, /Unknown command/);
});
test('init refuses hook-only Trellis residue in Claude local settings', t => {
  const root = fixture(t);
  put(root, '.claude/settings.local.json', JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'python3 .claude/hooks/session-start.py' }] }] } }));
  assert.equal(run(root, 'init', '--claude').status, 1);
  assert.equal(fs.existsSync(path.join(root, '.neo-trellis')), false);
  assert.equal(run(root, 'migrate', '--claude', '--yes').status, 0);
  const settings = path.join(root, '.claude/settings.local.json');
  assert.ok(!fs.existsSync(settings) || !fs.readFileSync(settings, 'utf8').includes('session-start.py'));
});
