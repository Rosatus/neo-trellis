import fs from 'node:fs';
import path from 'node:path';

// Inspect likely executable/configuration dependencies, not historical prose.
export function retirementBlockers(root, plan) {
  const blockers = [];
  const removed = name => plan.removals.some(p => name === p || name.startsWith(p + '/'));
  const ignored = new Set(['.git', '.trellis', '.neo-trellis', '.neo-trellis-backups', 'node_modules', '.venv', 'venv', '__pycache__']);
  const privateStores = ['.codex/sessions', '.codex/archived_sessions', '.claude/projects', '.pi/sessions'];
  const candidates = new Set();
  const manifest = JSON.parse(plan.writes.get('.neo-trellis/manifest.json') ?? '{}');
  const managed = new Set(Object.keys(manifest.managed ?? {}));
  function visit(dir, relative = '') {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = relative ? `${relative}/${item.name}` : item.name;
      if (ignored.has(item.name) || privateStores.includes(name) || removed(name) || managed.has(name)) continue;
      if (item.isSymbolicLink()) { blockers.push(`Uninspected symlink: ${name}`); continue; }
      if (item.isDirectory()) visit(path.join(dir, item.name), name);
      else if (/\.(?:json|toml|ya?ml|[cm]?js|tsx?|py|sh|ps1|bat|cmd|gd|cfg|ini|rs|go|rb|php|cs|cpp|c|h)$/i.test(name)
        || /(?:^|\/)(?:AGENTS|CLAUDE|SKILL)\.md$/.test(name)
        || /^\.(?:agents|claude|codex|pi|opencode|cursor|gemini)\/.*\.md$/i.test(name)) candidates.add(name);
    }
  }
  visit(root);
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
