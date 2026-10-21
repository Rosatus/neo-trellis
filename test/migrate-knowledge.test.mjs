import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { planMigration } from '../src/migrate.mjs';
import { planInstall } from '../src/install.mjs';
import { applyPlan, read, digest } from '../src/storage.mjs';
import { routeKnowledge, inspectKnowledge } from '../src/knowledge.mjs';
import { relocateLinks } from '../src/migrate-prds.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-knowledge-import-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function put(root, file, text) {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}
function setup(root) {
  put(root, '.trellis/workflow.md', 'Retired workflow');
  put(root, 'backend/app.py', '# backend');
  put(root, 'godot/client/main.gd', '# client');
  put(root, 'docs/design.md', '# Design');
  put(root, '.trellis/config.yaml', 'packages:\n  backend:\n    path: backend\n');
  put(root, '.trellis/spec/backend/index.md', '# Backend\n[Rules](rules.md) [Design](../../../docs/design.md)');
  put(root, '.trellis/spec/backend/rules.md', 'Contract. See `.trellis/spec/frontend/index.md`.');
  put(root, '.trellis/spec/frontend/index.md', '# Godot\nClient under `godot/client/`.');
  put(root, '.trellis/spec/guides/index.md', '# Guides\nNo implied code scope.');
  put(root, '.trellis/research/probe.md', '[spec](../spec/backend/index.md)');
  put(root, '.trellis/workspace/me/journal.md', 'Historical note');
  put(root, '.trellis/tasks/done/task.json', '{"status":"done"}');
  put(root, '.trellis/tasks/done/prd.md', '[spec](../../spec/backend/index.md) [other](../loose/implement.md)');
  put(root, '.trellis/tasks/loose/implement.md', 'Evidence only');
  put(root, '.trellis/tasks/done/big.log', Buffer.alloc(2 * 1024 * 1024, 255));
}
const importPlan = root => planInstall(root, ['codex'], planMigration(root, { keepTrellis: true }));

test('knowledge, cross-bundle links, all evidence and routes survive removal of legacy directory', t => {
  const root = fixture(t); setup(root);
  const plan = importPlan(root);
  assert.equal(fs.existsSync(path.join(root, '.neo-trellis')), false);
  applyPlan(root, plan);
  const records = JSON.parse(read(root, '.neo-trellis/prds/trellis-imports.json')).records;
  assert.equal(records[0].originalStatus, 'done');
  assert.equal(records[0].normalizedStatus, 'completed');
  assert.ok(records[0].destination.includes('/archive/'));
  assert.equal(read(root, '.neo-trellis/history/tasks/loose/implement.md'), 'Evidence only');
  assert.equal(read(root, '.neo-trellis/history/workspace/me/journal.md'), 'Historical note');
  assert.ok(fs.readFileSync(path.join(root, records[0].destination, 'big.log')).equals(Buffer.alloc(2 * 1024 * 1024, 255)));
  assert.deepEqual(routeKnowledge(root, ['backend/new.py']).knowledge, ['.neo-trellis/modules/backend/index.md']);
  assert.deepEqual(routeKnowledge(root, ['godot/client/main.gd']).knowledge, ['.neo-trellis/modules/frontend/index.md']);
  const report = JSON.parse(read(root, '.neo-trellis/migration/trellis-report.json'));
  assert.equal(report.mappings.some(r => /\/(spec|modules|research|history)\/trellis\//.test(r.destination)), false);
  assert.match(read(root, '.neo-trellis/map.md'), /\]\(modules\/backend\/index.md\)/);
  assert.equal(fs.existsSync(path.join(root, '.neo-trellis/migration/trellis-map.md')), false);
  assert.equal(report.remainingReferences.length, 0);
  assert.equal(report.scopes.find(s => s.source.includes('/guides/')).paths.length, 0);
  assert.match(read(root, '.neo-trellis/modules/backend/rules.md'), /\.neo-trellis\/modules\/frontend/);
  // Only the test removes the original tree, within its isolated fixture.
  fs.rmSync(path.join(root, '.trellis'), { recursive: true });
  const inspected = inspectKnowledge(root);
  assert.deepEqual(inspected.errors, []);
  assert.deepEqual(inspected.warnings, []);
  const prd = read(root, records[0].destination + '/prd.md');
  for (const [, link] of prd.matchAll(/\]\(([^)]+)\)/g)) assert.ok(fs.existsSync(path.resolve(root, records[0].destination, link)));
});

test('repeat import preserves knowledge edits, deleted routes and reports source changes', t => {
  const root = fixture(t); setup(root);
  applyPlan(root, importPlan(root));
  assert.equal(applyPlan(root, importPlan(root)).changed, 0);
  put(root, '.neo-trellis/modules/backend/rules.md', 'New contract');
  put(root, '.neo-trellis/routes.json', '{"version":1,"routes":[]}\n');
  put(root, '.trellis/spec/backend/rules.md', 'Changed source');
  applyPlan(root, importPlan(root));
  assert.equal(read(root, '.neo-trellis/modules/backend/rules.md'), 'New contract');
  assert.deepEqual(JSON.parse(read(root, '.neo-trellis/routes.json')).routes, []);
  const report = JSON.parse(read(root, '.neo-trellis/migration/trellis-report.json'));
  assert.ok(report.changedSourcesNotOverwritten.includes('.trellis/spec/backend/rules.md'));
});

test('old policies are not promoted; residual references are reported', t => {
  const root = fixture(t); setup(root);
  put(root, '.trellis/validation.md', 'Discard this old method');
  put(root, '.trellis/spec/backend/rules.md', 'See `.trellis/validation.md` and [workflow](../../workflow.md).');
  const plan = importPlan(root);
  const report = JSON.parse(plan.writes.get('.neo-trellis/migration/trellis-report.json'));
  assert.ok(report.remainingReferences.some(r => r.references.includes('.trellis/validation.md')));
  assert.ok(report.remainingReferences.some(r => r.references.includes('.trellis/workflow.md')));
  assert.equal([...plan.writes.keys()].some(k => k.endsWith('/validation.md')), false);
});

test('upgrades untouched 0.1.0 PRD links without overwriting user edits', t => {
  const root = fixture(t); setup(root);
  const source = '.trellis/tasks/done';
  const destination = '.neo-trellis/prds/archive/previous-import';
  const files = fs.readdirSync(path.join(root, source)).sort();
  const fingerprint = digest(JSON.stringify(files.map(name => [name, digest(fs.readFileSync(path.join(root, source, name)))])));
  put(root, '.neo-trellis/prds/trellis-imports.json', JSON.stringify({ version: 1, records: [{ source, destination, fingerprint }] }));
  const old = relocateLinks(read(root, `${source}/prd.md`), `${source}/prd.md`, `${destination}/prd.md`, source, []);
  put(root, `${destination}/prd.md`, old);
  put(root, `${destination}/task.json`, 'User edited metadata');
  applyPlan(root, importPlan(root));
  assert.doesNotMatch(read(root, `${destination}/prd.md`), /\.trellis\/spec/);
  assert.equal(read(root, `${destination}/task.json`), 'User edited metadata');
  assert.equal(read(root, `${destination}/big.log`), undefined, 'Deleted/unavailable evidence is not restored');
});

test('knowledge target collisions and symlink sources fail without writes', t => {
  const root = fixture(t); setup(root);
  put(root, '.neo-trellis/modules/backend/index.md', 'User owned');
  assert.throws(() => importPlan(root), /Knowledge destination already exists/);
  const other = fixture(t); setup(other);
  try { fs.symlinkSync(root, path.join(other, '.trellis/research/linked'), 'junction'); }
  catch (err) { if (err.code === 'EPERM') { t.skip('Symlink privilege unavailable'); return; } throw err; }
  assert.throws(() => importPlan(other), /symlink/i);
  assert.equal(fs.existsSync(path.join(other, '.neo-trellis')), false);
});
