import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

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
export function applyPlan(root, plan) {
  const writes = [...plan.writes].filter(([name, text]) => !contentMatches(root, name, text));
  const removals = plan.removals.filter(name => fs.existsSync(safePath(root, name)));
  const names = [...new Set([...writes.map(([name]) => name), ...removals])];
  if (!names.length) return { backup: null, changed: 0 };
  for (const name of names) {
    const target = safePath(root, name);
    if (fs.existsSync(target)) assertTree(target);
  }
  const backupRel = `.neo-trellis-backups/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const backup = safePath(root, backupRel);
  fs.mkdirSync(backup, { recursive: true });
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
    for (const name of removals) fs.rmSync(safePath(root, name), { recursive: true, force: true });
    for (const [name, text] of writes) {
      const target = safePath(root, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try { fs.writeFileSync(temporary, text); fs.renameSync(temporary, target); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
  } catch (error) {
    for (const name of names.toReversed()) fs.rmSync(safePath(root, name), { recursive: true, force: true });
    for (const name of existing) {
      const target = safePath(root, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(path.join(backup, 'files', name), target, { recursive: true });
    }
    throw new Error(`Apply failed; restored backed-up files: ${error.message}`);
  }
  return { backup: backupRel, changed: names.length };
}
