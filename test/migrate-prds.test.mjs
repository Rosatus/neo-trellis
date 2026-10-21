import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planMigration } from '../src/migrate.mjs';
import { planInstall } from '../src/install.mjs';
import { applyPlan, read } from '../src/storage.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-prds-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function put(root, rel, data) {
  const dest = path.join(root, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, data);
}
function task(root, name, status, prd = '# Requirement') {
  put(root, `.trellis/tasks/${name}/prd.md`, prd);
  if (status !== undefined) put(root, `.trellis/tasks/${name}/task.json`, JSON.stringify({ status }));
}
const records = plan => JSON.parse(plan.writes.get('.neo-trellis/prds/trellis-imports.json')).records;

test('imports active and historical archives, preserves attachments and source, pure preview', t => {
  const root = fixture(t);
  task(root, 'pending', 'planning', '[asset](media/a.bin) [rule](../../spec/rule.md#scope)');
  put(root, '.trellis/tasks/pending/media/a.bin', Buffer.from([0, 255, 128, 1]));
  put(root, '.trellis/spec/rule.md', '# Rule');
  task(root, 'review', 'review');
  task(root, 'complete', 'completed');
  task(root, 'archive/2026-10/old', 'completed');
  task(root, 'archive/2026-09/unknown', undefined);
  const base = planMigration(root, { keepTrellis: true });
  assert.equal(fs.existsSync(path.join(root, '.neo-trellis')), false);
  const imported = records(base);
  assert.equal(imported.length, 5);
  assert.equal(imported.filter(r => r.destination.includes('/active/')).length, 2);
  const pending = imported.find(r => r.source.endsWith('/pending'));
  assert.equal(pending.acceptance, 'not verified by migration');
  const plan = planInstall(root, ['codex'], base);
  applyPlan(root, plan);
  assert.deepEqual(fs.readFileSync(path.join(root, pending.destination, 'media/a.bin')), Buffer.from([0, 255, 128, 1]));
  const prd = read(root, `${pending.destination}/prd.md`);
  assert.match(prd, /\[asset\]\(media\/a.bin\)/);
  const external = /\[rule\]\(([^#]+)#scope\)/.exec(prd)[1];
  assert.equal(path.resolve(root, pending.destination, external), path.resolve(root, '.neo-trellis/spec/rule.md'));
  assert.equal(read(root, '.trellis/tasks/pending/prd.md'), '[asset](media/a.bin) [rule](../../spec/rule.md#scope)');
  assert.equal(applyPlan(root, plan).changed, 0, 'binary writes are idempotent');
});

test('repeat migration preserves edited and moved destinations and reports changed sources', t => {
  const root = fixture(t);
  task(root, 'pending', 'in_progress');
  const base = planMigration(root, { keepTrellis: true });
  const entry = records(base)[0];
  applyPlan(root, planInstall(root, ['pi'], base));
  put(root, `${entry.destination}/prd.md`, 'User revision');
  const moved = entry.destination.replace('/active/', '/archive/');
  fs.mkdirSync(path.dirname(path.join(root, moved)), { recursive: true });
  fs.renameSync(path.join(root, entry.destination), path.join(root, moved));
  put(root, '.trellis/tasks/pending/prd.md', 'Changed original');
  const next = planMigration(root, { keepTrellis: true });
  assert.ok(next.notes.some(n => n.includes('source changed')));
  applyPlan(root, planInstall(root, ['pi'], next));
  assert.equal(read(root, `${moved}/prd.md`), 'User revision');
  assert.equal(fs.existsSync(path.join(root, entry.destination)), false);
});

test('ambiguous metadata and missing PRDs stay in legacy tree with explanations', t => {
  const root = fixture(t);
  task(root, 'missing', undefined);
  task(root, 'bad', 'planning');
  put(root, '.trellis/tasks/bad/task.json', '{bad');
  task(root, 'archive/2026-10/conflict', 'in_progress');
  put(root, '.trellis/tasks/no-prd/task.json', '{}');
  const plan = planMigration(root, { keepTrellis: true });
  assert.equal(plan.writes.has('.neo-trellis/prds/trellis-imports.json'), false);
  assert.ok(plan.notes.some(n => n.includes('ambiguous status')));
  assert.ok(plan.notes.some(n => n.includes('malformed task.json')));
  assert.ok(plan.notes.some(n => n.includes('no prd.md')));
});

test('same task names in different archive months have unique destinations', t => {
  const root = fixture(t);
  task(root, 'archive/2026-09/same', 'completed');
  task(root, 'archive/2026-10/same', 'completed');
  const imported = records(planMigration(root, { keepTrellis: true }));
  assert.equal(new Set(imported.map(r => r.destination)).size, 2);
  put(root, `${imported[0].destination}/prd.md`, 'Existing user data');
  assert.throws(() => planMigration(root, { keepTrellis: true }), /destination already exists/);
});

test('legacy completion aliases normalize without fabricating acceptance', t => {
  const root = fixture(t);
  for (const status of ['done', 'complete', 'cancelled', 'canceled', 'superseded']) task(root, status, status);
  const imported = records(planMigration(root, { keepTrellis: true }));
  assert.equal(imported.length, 5);
  for (const entry of imported) {
    assert.ok(entry.destination.includes('/archive/'));
    assert.equal(entry.acceptance, 'not verified by migration');
  }
  assert.equal(imported.find(r => r.originalStatus === 'done').normalizedStatus, 'completed');
  assert.equal(imported.find(r => r.originalStatus === 'canceled').normalizedStatus, 'cancelled');
});

test('link relocation preserves code examples and handles reference links', t => {
  const root = fixture(t);
  const example = '[rule](../../spec/rule.md)';
  const code = '```md\n' + example + '\n```\n`' + example + '`\n';
  task(root, 'pending', 'planning', code + '[rule]: ../../spec/rule.md\n');
  const plan = planMigration(root, { keepTrellis: true });
  const entry = records(plan)[0];
  const text = plan.writes.get(`${entry.destination}/prd.md`);
  assert.ok(text.startsWith(code));
  const target = /\[rule\]: (.+)/.exec(text)[1];
  assert.equal(path.resolve(root, entry.destination, target), path.resolve(root, '.neo-trellis/spec/rule.md'));
});

test('symlink attachments are rejected before any mutation', t => {
  const root = fixture(t);
  task(root, 'pending', 'planning');
  const outside = fixture(t);
  put(outside, 'secret', 'external');
  try { fs.symlinkSync(outside, path.join(root, '.trellis/tasks/pending/linked'), 'junction'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Symlink privilege unavailable'); return; } throw error; }
  assert.throws(() => planMigration(root, { keepTrellis: true }), /symlink/i);
  assert.equal(fs.existsSync(path.join(root, '.neo-trellis')), false);
});
