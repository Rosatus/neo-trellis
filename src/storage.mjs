import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createArchive, assertSnapshot, verifyArchive } from './archive.mjs';
import { retirementBlockers } from './retirement.mjs';

export const digest = text => createHash('sha256').update(text).digest('hex');
export function safePath(root, relative) {
  const base = path.resolve(root);
  const target = path.resolve(base, relative);
  if (target === base || !target.startsWith(base + path.sep)) throw new Error(`Path escapes project: ${relative}`);
  let cursor = base;
  if (fs.lstatSync(base).isSymbolicLink()) throw new Error(`Symlink project root: ${base}`);
  for (const part of path.relative(base, target).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) || (() => { try { fs.lstatSync(cursor); return true; } catch { return false; } })()) {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Refusing symlink: ${cursor}`);
    }
  }
  return target;
}
export function read(root, relative) {
  const target = safePath(root, relative);
  return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
}
export function contentMatches(root, relative, content) {
  const target = safePath(root, relative);
  if (!fs.existsSync(target)) return false;
  return fs.readFileSync(target).equals(Buffer.isBuffer(content) ? content : Buffer.from(content));
}
function assertTree(target) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error(`Refusing symlink in backup: ${target}`);
  if (stat.isDirectory()) for (const name of fs.readdirSync(target)) assertTree(path.join(target, name));
}
export function applyPlan(root, plan, { onProgress = () => {} } = {}) {
  const writes = [...plan.writes].filter(([name, text]) => !contentMatches(root, name, text));
  const removals = plan.removals.filter(name => fs.existsSync(safePath(root, name)));
  const names = [...new Set([...writes.map(([name]) => name), ...removals])];
  if (!names.length && !plan.retirement) return { backup: null, changed: 0 };
  for (const name of names) {
    const target = safePath(root, name);
    if (fs.existsSync(target)) assertTree(target);
  }
  const backupRel = `.neo-trellis-backups/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const backup = safePath(root, backupRel);
  fs.mkdirSync(backup, { recursive: true });
  let archive = null;
  if (plan.retirement) {
    onProgress('Archive', 'Compressing and verifying the complete .trellis source');
    archive = `${backupRel}/trellis.zip`;
    const partial = safePath(root, `${archive}.partial`);
    createArchive(safePath(root, '.trellis'), partial, plan.retirement.snapshot);
    fs.renameSync(partial, safePath(root, archive));
    fs.writeFileSync(path.join(backup, 'trellis-manifest.json'), JSON.stringify({ version: 1, source: '.trellis', entries: plan.retirement.snapshot }, null, 2) + '\n');
  }
  onProgress('Backup', 'Saving replaced integrations and configuration');
  const existing = [];
  for (const name of names) {
    const target = safePath(root, name);
    if (fs.existsSync(target)) {
      const destination = path.join(backup, 'files', name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.cpSync(target, destination, { recursive: true, dereference: false });
      existing.push(name);
    }
  }
  fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify({ version: 1, paths: names, existing }, null, 2) + '\n');
  try {
    if (plan.retirement) assertSnapshot(safePath(root, '.trellis'), plan.retirement.snapshot);
    onProgress('Apply', `Writing ${writes.length} files and retiring ${removals.length} old integrations`);
    for (const name of removals) fs.rmSync(safePath(root, name), { recursive: true, force: true });
    for (const [name, text] of writes) {
      const target = safePath(root, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try { fs.writeFileSync(temporary, text); fs.renameSync(temporary, target); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    for (const [name, data] of writes) if (!contentMatches(root, name, data)) throw new Error(`Write verification failed: ${name}`);
  } catch (error) {
    for (const name of names.toReversed()) fs.rmSync(safePath(root, name), { recursive: true, force: true });
    for (const name of existing) {
      const target = safePath(root, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(path.join(backup, 'files', name), target, { recursive: true });
    }
    throw new Error(`Apply failed; restored backed-up files: ${error.message}`);
  }
  let retired = false;
  const blockers = plan.retirement ? retirementBlockers(root, plan) : [];
  if (plan.retirement && !blockers.length) {
    onProgress('Verify', 'Checking imported files, archive integrity and unchanged source');
    try {
      verifyArchive(safePath(root, archive), plan.retirement.snapshot);
      assertSnapshot(safePath(root, '.trellis'), plan.retirement.snapshot);
      const source = safePath(root, '.trellis');
      onProgress('Retire', 'Removing the verified .trellis directory');
      try { fs.rmSync(source, { recursive: true }); retired = true; }
      catch (error) {
        verifyArchive(safePath(root, archive), plan.retirement.snapshot, root);
        throw new Error(`Removal failed; missing source entries restored: ${error.message}`);
      }
    } catch (error) { blockers.push(error.message); }
  }
  if (plan.retirement) {
    const reportPath = safePath(root, '.neo-trellis/migration/trellis-report.json');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const reviewed = typeof report.semanticReview === 'string' && !report.semanticReview.startsWith('pending');
    Object.assign(report, { originalDirectoryDeleted: retired, archive, retirementBlockers: blockers,
      next: reviewed
        ? (retired ? 'Semantic review already recorded; run neo-trellis doctor.' : report.next)
        : 'Review imported scopes with neo-trellis-migrate; run neo-trellis doctor.' });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  return { backup: backupRel, changed: names.length + (retired ? 1 : 0), archive, retired, blockers };
}
