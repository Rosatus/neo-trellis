import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HOST_DIRS = ['.agents', '.claude', '.codex', '.pi', '.opencode', '.cursor', '.gemini'];
const isHostPath = name => /^(?:AGENTS|CLAUDE)\.md$/.test(name) || HOST_DIRS.some(dir => name === dir || name.startsWith(dir + '/'));

// Git already knows which paths are tracked or ordinary untracked work. Ignored
// build/evidence output is not an executable project dependency, except local
// host configuration, which is commonly ignored but still loaded by agents.
function gitVisibleFiles(root) {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
    if (!same(fs.realpathSync.native(top), fs.realpathSync.native(root))) return null;
    return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\0').filter(Boolean);
  } catch { return null; }
}

export function nestedRepositories(root) {
  const found = new Set();
  const modules = path.join(root, '.gitmodules');
  if (fs.existsSync(modules)) for (const match of fs.readFileSync(modules, 'utf8').matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)) found.add(match[1].replace(/\\/g, '/').replace(/\/$/, ''));
  function visit(dir, relative = '') {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!item.isDirectory() || ['.git', 'node_modules', '.trellis', '.neo-trellis-backups'].includes(item.name)) continue;
      const name = relative ? `${relative}/${item.name}` : item.name;
      if (fs.existsSync(path.join(dir, item.name, '.git'))) { found.add(name); continue; }
      visit(path.join(dir, item.name), name);
    }
  }
  visit(root);
  return [...found].sort();
}

// Inspect likely executable/configuration dependencies, not historical prose.
export function retirementBlockers(root, plan) {
  const blockers = [];
  const removed = name => plan.removals.some(p => name === p || name.startsWith(p + '/'));
  const ignored = new Set(['.git', '.trellis', '.neo-trellis', '.neo-trellis-backups', 'node_modules', '.venv', 'venv', '__pycache__']);
  const privateStores = ['.codex/sessions', '.codex/archived_sessions', '.claude/projects', '.pi/sessions'];
  const candidates = new Set();
  const manifest = JSON.parse(plan.writes.get('.neo-trellis/manifest.json') ?? '{}');
  const managed = new Set(Object.keys(manifest.managed ?? {}));
  const nested = nestedRepositories(root);
  const insideNested = name => nested.some(repo => name === repo || name.startsWith(repo + '/'));
  const eligible = name => /\.(?:json|toml|ya?ml|[cm]?js|tsx?|py|sh|ps1|bat|cmd|gd|cfg|ini|rs|go|rb|php|cs|cpp|c|h)$/i.test(name)
    || /(?:^|\/)(?:AGENTS|CLAUDE|SKILL)\.md$/.test(name)
    || /^\.(?:agents|claude|codex|pi|opencode|cursor|gemini)\/.*\.md$/i.test(name);
  const skip = name => name.split('/').some(part => ignored.has(part)) || privateStores.some(p => name === p || name.startsWith(p + '/'))
    || removed(name) || managed.has(name) || insideNested(name);
  function visit(dir, relative = '', onlyHost = false) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = relative ? `${relative}/${item.name}` : item.name;
      if (skip(name) || (onlyHost && !relative && !isHostPath(name))) continue;
      if (item.isSymbolicLink()) { blockers.push(`Uninspected symlink: ${name}`); continue; }
      if (item.isDirectory()) visit(path.join(dir, item.name), name, onlyHost);
      else if (eligible(name)) candidates.add(name);
    }
  }
  const visible = gitVisibleFiles(root);
  if (visible) {
    for (const name of visible) {
      if (skip(name) || !eligible(name)) continue;
      const target = path.join(root, name);
      let stat;
      try { stat = fs.lstatSync(target); } catch { continue; }
      if (stat.isSymbolicLink()) blockers.push(`Uninspected symlink: ${name}`);
      else if (stat.isFile()) candidates.add(name);
    }
    visit(root, '', true);
  } else visit(root);
  for (const name of plan.writes.keys()) if (!skip(name) && eligible(name)) candidates.add(name);
  for (const name of candidates) {
    const text = plan.writes.get(name) ?? fs.readFileSync(path.join(root, name), 'utf8');
    if (/(?:^|[^\w-])\.trellis(?:[\\/]|\b)/m.test(text)) blockers.push(`Current code/config references .trellis: ${name}`);
  }
  const report = JSON.parse(plan.writes.get('.neo-trellis/migration/trellis-report.json') ?? '{}');
  for (const ref of report.remainingReferences ?? []) if (ref.category === 'current-knowledge') blockers.push(`Current knowledge references .trellis: ${ref.file}`);
  for (const entry of report.missingDestinations ?? []) blockers.push(`Missing imported destination: ${JSON.stringify(entry)}`);
  for (const note of plan.notes ?? []) if (note.startsWith('unhandled platform integrations')) blockers.push(note);
  return [...new Set(blockers)];
}
