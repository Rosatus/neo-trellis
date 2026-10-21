import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { snapshotTree, createArchive, verifyArchive } from '../src/archive.mjs';
import { planMigration } from '../src/migrate.mjs';
import { planInstall } from '../src/install.mjs';
import { applyPlan } from '../src/storage.mjs';
import { spawnSync } from 'node:child_process';

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-archive-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  put(root, '.trellis/workflow.md', 'original workflow');
  put(root, '.trellis/scripts/run.py', 'original runtime');
  put(root, '.trellis/spec/backend/index.md', 'Backend contract');
  put(root, '.trellis/.hidden', Buffer.from([0, 255, 128]));
  fs.mkdirSync(path.join(root, '.trellis/empty'));
  return root;
}
function put(root, file, text) { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); }
const plan = root => planInstall(root, ['codex'], planMigration(root));

test('ZIP roundtrip preserves Unicode, binary data, hidden files and empty directories; corruption rejected', t => {
  const root = setup(t);
  put(root, '.trellis/research/\u4e2d\u6587.md', 'evidence');
  const tree = path.join(root, '.trellis'), entries = snapshotTree(tree), zip = path.join(root, 'backup.zip');
  createArchive(tree, zip, entries);
  const restore = path.join(root, 'restore'); fs.mkdirSync(restore);
  verifyArchive(zip, entries, restore);
  for (const entry of entries) {
    const copy = path.join(restore, entry.name);
    assert.ok(fs.existsSync(copy));
    if (!entry.directory) assert.deepEqual(fs.readFileSync(copy), fs.readFileSync(path.join(root, entry.name)));
  }
  const data = fs.readFileSync(zip); data[0] = 0; fs.writeFileSync(zip, data);
  assert.throws(() => verifyArchive(zip, entries), /header/);
});

test('migration archives the original runtime and source before any writes', t => {
  const root = setup(t), original = snapshotTree(path.join(root, '.trellis'));
  const result = applyPlan(root, plan(root));
  assert.equal(result.retired, true);
  assert.equal(fs.existsSync(path.join(root, '.trellis')), false);
  verifyArchive(path.join(root, result.archive), original);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.neo-trellis/migration/trellis-report.json'))).originalDirectoryDeleted, true);
});

test('source mutation after planning blocks apply and leaves all source files intact', t => {
  const root = setup(t), pending = plan(root);
  put(root, '.trellis/new.txt', 'concurrent edit');
  assert.throws(() => applyPlan(root, pending), /source changed/);
  assert.equal(fs.existsSync(path.join(root, '.neo-trellis')), false);
  assert.equal(fs.readFileSync(path.join(root, '.trellis/scripts/run.py'), 'utf8'), 'original runtime');
});

test('unresolved external dependency retains full source but completes import', t => {
  const root = setup(t);
  put(root, 'tools/check.py', 'open(".trellis/spec/backend/index.md")');
  const result = applyPlan(root, plan(root));
  assert.equal(result.retired, false);
  assert.ok(result.blockers.some(x => x.includes('tools/check.py')));
  assert.ok(fs.existsSync(path.join(root, '.trellis/scripts/run.py')));
  assert.ok(fs.existsSync(path.join(root, '.neo-trellis/modules/backend/index.md')));
});

test('custom host instructions block deletion while generated migration skills do not', t => {
  const root = setup(t);
  put(root, '.agents/skills/custom/SKILL.md', 'Run python .trellis/scripts/run.py');
  const result = applyPlan(root, plan(root));
  assert.equal(result.retired, false);
  assert.ok(result.blockers.some(x => x.includes('custom/SKILL.md')));
  assert.ok(!result.blockers.some(x => x.includes('neo-trellis-migrate')));
});

test('dependency audit ignores private transcript stores and historical JSONL', t => {
  const root = setup(t);
  put(root, '.codex/sessions/session.json', '.trellis/scripts/run.py');
  put(root, 'transcript.jsonl', 'Historical mention of .trellis/workflow.md');
  const result = applyPlan(root, plan(root));
  assert.equal(result.retired, true);
});

test('archive write failure makes no integration changes and retains original directory', t => {
  const root = setup(t), pending = plan(root);
  t.mock.method(fs, 'writeSync', (fd, ...args) => { throw new Error('backup disk full'); });
  assert.throws(() => applyPlan(root, pending), /backup disk full/);
  assert.ok(fs.existsSync(path.join(root, '.trellis/workflow.md')));
  assert.equal(fs.existsSync(path.join(root, '.neo-trellis')), false);
});

test('source changes during apply are preserved and block retirement', t => {
  const root = setup(t);
  const result = applyPlan(root, plan(root), { onProgress(stage) {
    if (stage === 'Apply') put(root, '.trellis/new.txt', 'concurrent work');
  } });
  assert.equal(result.retired, false);
  assert.ok(result.blockers.some(x => x.includes('source changed')));
  assert.equal(fs.readFileSync(path.join(root, '.trellis/new.txt'), 'utf8'), 'concurrent work');
});

test('keep-trellis opts out of archival and deletion', t => {
  const root = setup(t);
  const result = applyPlan(root, planInstall(root, ['codex'], planMigration(root, { keepTrellis: true })));
  assert.equal(result.archive, null);
  assert.ok(fs.existsSync(path.join(root, '.trellis/scripts/run.py')));
});

test('write failure rolls back integrations and leaves original source untouched', t => {
  const root = setup(t), pending = plan(root), original = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => { if (to.endsWith('AGENTS.md')) throw new Error('disk failure'); return original(from, to); });
  assert.throws(() => applyPlan(root, pending), /restored/);
  assert.equal(fs.readFileSync(path.join(root, '.trellis/scripts/run.py'), 'utf8'), 'original runtime');
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);
});

test('partial source deletion failure restores missing files from verified archive', t => {
  const root = setup(t), pending = plan(root), original = fs.rmSync;
  t.mock.method(fs, 'rmSync', (target, opts) => {
    if (target === path.join(root, '.trellis')) { fs.unlinkSync(path.join(target, 'workflow.md')); throw new Error('file locked'); }
    return original(target, opts);
  });
  const result = applyPlan(root, pending);
  assert.equal(result.retired, false);
  assert.ok(result.blockers.some(x => x.includes('restored')));
  assert.equal(fs.readFileSync(path.join(root, '.trellis/workflow.md'), 'utf8'), 'original workflow');
});

test('retirement ignores Git-ignored output and nested repositories but not local host config', t => {
  const root = setup(t);
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (git('init', '-q').status !== 0) { t.skip('git unavailable'); return; }
  put(root, '.gitignore', 'artifacts/\n');
  put(root, 'artifacts/copied/.agents/skills/trellis-old/SKILL.md', 'python .trellis/scripts/run.py');
  put(root, 'vendor/lib/.git/HEAD', 'ref: refs/heads/main\n');
  put(root, 'vendor/lib/.agents/skills/neo-trellis-migrate/SKILL.md', 'mentions .trellis/');
  put(root, '.gitmodules', '[submodule "vendor/lib"]\n\tpath = vendor/lib\n');
  const pending = plan(root);
  assert.ok(pending.notes.some(n => n.includes('Nested repositories excluded') && n.includes('vendor/lib')));
  const result = applyPlan(root, pending);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.retired, true);
  const other = setup(t);
  if (spawnSync('git', ['init', '-q'], { cwd: other }).status !== 0) return;
  put(other, '.gitignore', '.codex/\n');
  put(other, '.codex/config.toml', 'command = "python .trellis/scripts/run.py"\n');
  const blocked = applyPlan(other, plan(other));
  assert.ok(blocked.blockers.some(x => x.includes('.codex/config.toml')));
});
