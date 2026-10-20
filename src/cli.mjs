import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { planInstall, PLATFORMS } from './install.mjs';
import { planMigration, hasLegacyIntegration } from './migrate.mjs';
import { inspectKnowledge, routeKnowledge } from './knowledge.mjs';
import { applyPlan, read, digest, contentMatches } from './storage.mjs';

const HELP = `neo-trellis — scoped project knowledge

  init     --codex --claude --pi    Install selected integrations (choose one or more)
  migrate  --codex --claude --pi    Preserve Trellis knowledge and replace its workflow
  doctor                          Check installation, knowledge links and integration drift
  route [paths...]                 Find knowledge for project-relative source paths
  status                          Show changed Git paths and their knowledge routes

Options: --cwd <directory>  --dry-run  --yes  --verbose  --help  --version
Migration previews by default. Use --yes to apply after reviewing the plan.
Init never overwrites knowledge or locally modified managed integration files.
No automatic commits, task creation or transcript collection.
`;
export async function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true,
    options: Object.fromEntries(['codex', 'claude', 'pi', 'dry-run', 'yes', 'verbose', 'help', 'version'].map(key => [key, { type: 'boolean' }]).concat([['cwd', { type: 'string' }]])) });
  if (values.version) { console.log(JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version); return; }
  if (values.help || !positionals.length) { console.log(HELP); return; }
  const [command, ...args] = positionals;
  let root = path.resolve(values.cwd ?? process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Project directory does not exist: ${root}`);
  if (!['init', 'migrate'].includes(command)) {
    let candidate = root;
    while (!fs.existsSync(path.join(candidate, '.neo-trellis')) && path.dirname(candidate) !== candidate) candidate = path.dirname(candidate);
    if (fs.existsSync(path.join(candidate, '.neo-trellis'))) root = candidate;
    else throw new Error('No neo-trellis project found in this directory or its ancestors');
  }
  const selected = PLATFORMS.filter(p => values[p]);
  if (['init', 'migrate'].includes(command)) {
    if (args.length) throw new Error('Unexpected positional arguments');
    if (command === 'init' && !read(root, '.neo-trellis/manifest.json') && hasLegacyIntegration(root)) throw new Error('Existing Trellis or mini-trellis detected; use migrate --dry-run for Trellis (mini-trellis migration is not supported)');
    const base = command === 'migrate' ? planMigration(root) : undefined;
    const plan = planInstall(root, selected, base);
    const changed = [...plan.writes].filter(([name, text]) => !contentMatches(root, name, text));
    const report = command === 'migrate' ? JSON.parse(plan.writes.get('.neo-trellis/migration/trellis-report.json')) : null;
    const currentReferences = report?.remainingReferences.filter(r => r.category === 'current-knowledge') ?? [];
    const prds = JSON.parse(plan.writes.get('.neo-trellis/prds/trellis-imports.json') ?? '{"records":[]}').records;
    const output = command === 'migrate' && !values.verbose ? {
      command, root, summary: { filesToWrite: changed.length, bytesToWrite: changed.reduce((n, [, data]) => n + Buffer.byteLength(data), 0),
        activePrds: prds.filter(r => r.destination.includes('/active/')).length,
        archivedPrds: prds.filter(r => r.destination.includes('/archive/')).length,
        currentKnowledgeReferences: currentReferences.length,
        historicalReferences: report.remainingReferences.length - currentReferences.length },
      remove: plan.removals, currentReferences,
      notes: plan.notes.filter(n => !n.startsWith('PRD import ') && !n.startsWith('PRD already imported;')),
      details: 'Use --verbose for full file and note lists. Applying writes migration/trellis-report.json; preview writes nothing.'
    } : { command, root, write: changed.map(([name]) => name), remove: plan.removals, notes: plan.notes };
    console.log(JSON.stringify(output, null, 2));
    if (values['dry-run'] || (command === 'migrate' && !values.yes)) {
      console.log(command === 'migrate' ? 'Preview only. Re-run with --yes to apply; all replaced/removed files will be backed up.' : 'Preview only; no files written.');
      return;
    }
    const result = applyPlan(root, plan);
    console.log(`Applied ${result.changed} changes.${result.backup ? ` Backup: ${result.backup}` : ''}`);
    console.log(command === 'migrate'
      ? `Files migrated. ${currentReferences.length} current knowledge documents retain old references. Initial routes are available; use neo-trellis-migrate for pending semantic scope review. Original .trellis remains. Run neo-trellis doctor.`
      : 'Next: ask the agent to map the relevant module into .neo-trellis/map.md and routes.json. Restart the host; approve hooks if requested. Run neo-trellis doctor.');
    return;
  }
  if (command === 'doctor') {
    const result = inspectKnowledge(root);
    const raw = read(root, '.neo-trellis/manifest.json');
    if (!raw) result.errors.push('neo-trellis is not initialized');
    else {
      const manifest = JSON.parse(raw);
      if (!(read(root, 'AGENTS.md') ?? '').includes('<!-- NEO-TRELLIS:START -->')) result.errors.push('Missing AGENTS.md router');
      if (manifest.platforms.includes('claude') && !(read(root, 'CLAUDE.md') ?? '').includes('<!-- NEO-TRELLIS:START -->')) result.errors.push('Missing CLAUDE.md router');
      for (const [name, hash] of Object.entries(manifest.managed)) {
        const content = read(root, name);
        if (content === undefined) result.errors.push(`Missing integration: ${name}`);
        else if (digest(content) !== hash) result.warnings.push(`Modified integration: ${name}`);
      }
      for (const platform of manifest.platforms) {
        if (platform === 'pi') continue;
        const name = platform === 'claude' ? '.claude/settings.json' : '.codex/hooks.json';
        const text = read(root, name);
        const groups = text ? JSON.parse(text).hooks?.SessionStart : null;
        if (!Array.isArray(groups) || !groups.some(group => Array.isArray(group.hooks) && group.hooks.some(hook => hook.command === 'node .neo-trellis/runtime/session.mjs'))) result.errors.push(`Missing SessionStart integration: ${name}`);
      }
    }
    result.warnings.push('Static checks cannot confirm host trust, enabled hook features, or actual hook delivery.');
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length) process.exitCode = 1;
    return;
  }
  if (command === 'route' || command === 'status') {
    let paths = args;
    if (command === 'status') {
      const git = gitArgs => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean);
      try { paths = [...new Set([...git(['diff', '--name-only', '-z']), ...git(['diff', '--cached', '--name-only', '-z']), ...git(['ls-files', '--others', '--exclude-standard', '-z'])])]; }
      catch { throw new Error('status requires a Git working tree'); }
    }
    console.log(JSON.stringify({ paths, ...routeKnowledge(root, paths), note: 'Routes identify potentially relevant knowledge; changed code does not prove a contract is obsolete.' }, null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}. Use --help.`);
}
