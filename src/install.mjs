import { scaffoldKnowledge, ROUTER } from './knowledge.mjs';
import { platformFiles, integrationEdits } from './platforms.mjs';
import { read, digest } from './storage.mjs';

export const PLATFORMS = ['codex', 'claude', 'pi'];
export function mergeRouter(existing = '') {
  const start = '<!-- NEO-TRELLIS:START -->';
  const end = '<!-- NEO-TRELLIS:END -->';
  const block = `${start}\n${ROUTER.trim()}\n${end}`;
  if (existing.includes(start) !== existing.includes(end)) throw new Error('Malformed neo-trellis managed block');
  if (existing.includes(start)) {
    if (existing.indexOf(end) < existing.indexOf(start) || existing.split(start).length !== 2 || existing.split(end).length !== 2) throw new Error('Ambiguous neo-trellis managed block');
    return existing.slice(0, existing.indexOf(start)) + block + existing.slice(existing.indexOf(end) + end.length);
  }
  return existing + (existing && !existing.endsWith('\n') ? '\n' : '') + (existing ? '\n' : '') + block + '\n';
}
export function planInstall(root, selected, base = { writes: new Map(), removals: [], notes: [] }) {
  const writes = new Map(base.writes);
  const current = name => writes.has(name) ? writes.get(name) : base.removals.includes(name) ? undefined : read(root, name);
  const oldText = read(root, '.neo-trellis/manifest.json');
  const previous = oldText ? JSON.parse(oldText) : { platforms: [], managed: {} };
  const platforms = [...new Set([...previous.platforms, ...selected])].sort();
  if (!platforms.length || platforms.some(p => !PLATFORMS.includes(p))) throw new Error('Select supported platforms: --codex --claude --pi');
  const managed = { ...previous.managed };
  for (const [name, text] of Object.entries(scaffoldKnowledge())) if (!['AGENTS.md', '.neo-trellis/skills/knowledge.md'].includes(name) && current(name) === undefined) writes.set(name, text);
  for (const platform of platforms) {
    for (const [name, text] of Object.entries(platformFiles(platform))) {
      const existing = current(name);
      if (existing !== undefined && existing !== text && (!managed[name] || digest(existing) !== managed[name])) throw new Error(`Locally modified integration; preserve or reconcile it before installing: ${name}`);
      writes.set(name, text);
      managed[name] = digest(text);
    }
    for (const edit of integrationEdits(platform)) {
      const raw = current(edit.path);
      const config = raw ? JSON.parse(raw) : {};
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`Invalid configuration: ${edit.path}`);
      config.hooks ??= {};
      if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) throw new Error(`Invalid hooks: ${edit.path}`);
      const groups = config.hooks.SessionStart ?? [];
      if (!Array.isArray(groups)) throw new Error(`Invalid SessionStart hooks: ${edit.path}`);
      config.hooks.SessionStart = groups.flatMap(group => {
        if (!Array.isArray(group?.hooks)) return [group];
        const hooks = group.hooks.filter(hook => hook.command !== 'node .neo-trellis/runtime/session.mjs');
        if (hooks.length === group.hooks.length) return [group];
        return hooks.length ? [{ ...group, hooks }] : [];
      });
      config.hooks.SessionStart.push(edit.hook);
      writes.set(edit.path, JSON.stringify(config, null, 2) + '\n');
    }
  }
  writes.set('AGENTS.md', mergeRouter(current('AGENTS.md')));
  if (platforms.includes('claude')) writes.set('CLAUDE.md', mergeRouter(current('CLAUDE.md')));
  writes.set('.neo-trellis/manifest.json', JSON.stringify({ version: 1, platforms, managed }, null, 2) + '\n');
  const ignore = current('.gitignore') ?? '';
  const additions = ['.neo-trellis-backups/', '.neo-trellis/runtime-state/'].filter(line => !ignore.split(/\r?\n/).includes(line));
  if (additions.length) writes.set('.gitignore', ignore + (ignore && !ignore.endsWith('\n') ? '\n' : '') + additions.join('\n') + '\n');
  if (writes.has('.neo-trellis/legacy.md')) {
    const map = current('.neo-trellis/map.md');
    if (map && !map.includes('(legacy.md)')) writes.set('.neo-trellis/map.md', map + '\n## Migrated knowledge\n\nRead [legacy sources](legacy.md) when mapping existing modules. Historical task plans are not current contracts.\n');
  }
  return { writes, removals: base.removals.filter(name => !writes.has(name)), notes: base.notes };
}
