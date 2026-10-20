import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planInstall } from '../src/install.mjs';
import { applyPlan, read, safePath } from '../src/storage.mjs';
import { PRD_SKILL_MD, PRD_SKILL } from '../src/prd.mjs';
import { MIGRATION_SKILL_MD } from '../src/migration-skill.mjs';

function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-install-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
test('PRD skill installs on all hosts and reinit preserves user PRDs', t => {
  const root = fixture(t);
  applyPlan(root, planInstall(root, ['codex', 'claude', 'pi']));
  for (const dir of ['.agents', '.claude', '.pi']) {
    assert.equal(read(root, `${dir}/skills/neo-trellis-prd/SKILL.md`), PRD_SKILL_MD);
    assert.equal(read(root, `${dir}/skills/neo-trellis-migrate/SKILL.md`), MIGRATION_SKILL_MD);
  }
  assert.equal(read(root, '.neo-trellis/skills/prd.md'), PRD_SKILL);
  for (const state of ['drafts', 'active', 'archive']) {
    const dir = path.join(root, '.neo-trellis/prds', state, 'example');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'prd.md'), `User-owned ${state}`);
  }
  assert.equal(applyPlan(root, planInstall(root, ['codex'])).changed, 0);
  for (const state of ['drafts', 'active', 'archive']) {
    assert.equal(read(root, `.neo-trellis/prds/${state}/example/prd.md`), `User-owned ${state}`);
  }
  fs.appendFileSync(path.join(root, '.agents/skills/neo-trellis-prd/SKILL.md'), '\nUser customization');
  assert.throws(() => planInstall(root, ['codex']), /Locally modified integration/);
});
test('install preserves custom instructions and hooks, rerun is idempotent', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# User instructions\n');
  fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, '.claude/settings.json'), JSON.stringify({ env: { CUSTOM: '1' }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo custom' }] }] } }));
  applyPlan(root, planInstall(root, ['claude', 'codex', 'pi']));
  assert.match(read(root, 'AGENTS.md'), /User instructions/);
  const config = JSON.parse(read(root, '.claude/settings.json'));
  assert.equal(config.env.CUSTOM, '1');
  assert.equal(config.hooks.SessionStart[0].hooks[0].command, 'echo custom');
  assert.equal(applyPlan(root, planInstall(root, ['claude'])).changed, 0);
});
test('knowledge is preserved while modified managed code blocks refresh', t => {
  const root = fixture(t);
  applyPlan(root, planInstall(root, ['codex']));
  fs.writeFileSync(path.join(root, '.neo-trellis/map.md'), '# My project\n');
  applyPlan(root, planInstall(root, ['pi']));
  assert.equal(read(root, '.neo-trellis/map.md'), '# My project\n');
  fs.appendFileSync(path.join(root, '.neo-trellis/runtime/session.mjs'), '\n// custom\n');
  assert.throws(() => planInstall(root, ['codex']), /Locally modified/);
});
test('plan is read only and applying backs up exact replaced files', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'original');
  const plan = planInstall(root, ['codex']);
  assert.equal(fs.existsSync(path.join(root, '.neo-trellis')), false);
  const { backup } = applyPlan(root, plan);
  assert.equal(fs.readFileSync(path.join(root, backup, 'files/AGENTS.md'), 'utf8'), 'original');
  assert.throws(() => safePath(root, '../escape'), /escapes/);
});
test('apply failure restores removed directories and overwritten files', t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'old'));
  fs.writeFileSync(path.join(root, 'old/runtime'), 'legacy');
  fs.writeFileSync(path.join(root, 'existing'), 'original');
  const originalRename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (target.endsWith('second')) throw new Error('simulated disk error');
    return originalRename(source, target);
  });
  assert.throws(() => applyPlan(root, { writes: new Map([['existing', 'replacement'], ['second', 'new']]), removals: ['old'] }), /restored/);
  assert.equal(fs.readFileSync(path.join(root, 'existing'), 'utf8'), 'original');
  assert.equal(fs.readFileSync(path.join(root, 'old/runtime'), 'utf8'), 'legacy');
  assert.equal(fs.existsSync(path.join(root, 'second')), false);
});
