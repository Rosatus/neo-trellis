import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { planInstall, PLATFORMS } from './install.mjs';
import { planMigration, hasLegacyIntegration } from './migrate.mjs';
import { inspectKnowledge, routeKnowledge } from './knowledge.mjs';
import { applyPlan, read, digest, contentMatches } from './storage.mjs';
import { retirementBlockers } from './retirement.mjs';
import { heading, section, row, list, step, finish, note, showPlan } from './terminal.mjs';

const HELP = `
  neo-trellis - scoped project knowledge for Codex, Claude Code and Pi

  Usage
    neo-trellis <command> [options]

  Commands
    init      --codex --claude --pi   Install selected integrations
    migrate   --codex --claude --pi   Import Trellis knowledge, retire its workflow
    doctor                            Check installation, links and drift
    route     [paths...]              Find knowledge for project-relative paths
    status                            Route changed Git paths to knowledge

  Options
    --cwd <dir>      Project directory (default: current)
    --dry-run        Preview without writing (migrate previews by default)
    --yes            Apply a migration after reviewing its preview
    --keep-trellis   Keep the original .trellis after migration
    --verbose        Show full file and note lists
    --json           Emit one machine-readable result object
    --help, --version

  Migration archives the complete .trellis into a verified ZIP before changes
  and removes it only after dependency checks pass. Init never overwrites
  knowledge or locally modified managed files. No automatic commits, task
  creation or transcript collection.
`;
export async function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true,
    options: Object.fromEntries(['codex', 'claude', 'pi', 'dry-run', 'yes', 'verbose', 'json', 'keep-trellis', 'help', 'version'].map(key => [key, { type: 'boolean' }]).concat([['cwd', { type: 'string' }]])) });
  if (values.version) { console.log(JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version); return; }
  if (values.help || !positionals.length) { console.log(HELP); return; }
  const [command, ...args] = positionals;
  if (values['keep-trellis'] && command !== 'migrate') throw new Error('--keep-trellis only applies to migrate');
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
    const base = command === 'migrate' ? planMigration(root, { keepTrellis: values['keep-trellis'] }) : undefined;
    const plan = planInstall(root, selected, base);
    const changed = [...plan.writes].filter(([name, text]) => !contentMatches(root, name, text));
    const report = command === 'migrate' ? JSON.parse(plan.writes.get('.neo-trellis/migration/trellis-report.json')) : null;
    const currentReferences = report?.remainingReferences.filter(r => r.category === 'current-knowledge') ?? [];
    const prds = JSON.parse(plan.writes.get('.neo-trellis/prds/trellis-imports.json') ?? '{"records":[]}').records;
    const preview = Boolean(values['dry-run'] || (command === 'migrate' && !values.yes));
    const output = {
      preview, sourceExists: fs.existsSync(path.join(root, '.trellis')), platforms: JSON.parse(plan.writes.get('.neo-trellis/manifest.json')).platforms,
      command, root, summary: { filesToWrite: changed.length, bytesToWrite: changed.reduce((n, [, data]) => n + Buffer.byteLength(data), 0),
        activePrds: prds.filter(r => r.destination.includes('/active/')).length,
        archivedPrds: prds.filter(r => r.destination.includes('/archive/')).length,
        currentKnowledgeReferences: currentReferences.length,
        historicalReferences: (report?.remainingReferences.length ?? 0) - currentReferences.length },
      write: changed.map(([name]) => name),
      remove: plan.removals, currentReferences,
      retirement: plan.retirement ? { entries: plan.retirement.snapshot.length, blockers: retirementBlockers(root, plan) } : null,
      notes: values.verbose ? plan.notes : plan.notes.filter(n => !n.startsWith('PRD import ') && !n.startsWith('PRD already imported;')),
      details: command === 'migrate'
        ? 'Use --verbose for full file and note lists. Applying writes migration/trellis-report.json; preview writes nothing.'
        : 'Use --verbose for full file and note lists. Preview writes nothing.'
    };
    if (!values.json) showPlan(output, values.verbose);
    if (preview) {
      if (values.json) console.log(JSON.stringify(output, null, 2));
      else finish(command === 'migrate' ? 'Preview only - nothing changed. Re-run with --yes to apply.' : 'Preview only - nothing changed.', 'warn');
      return;
    }
    if (!values.json) section('Progress');
    const result = applyPlan(root, plan, { onProgress: values.json ? undefined : step });
    const finalReport = command === 'migrate' ? JSON.parse(read(root, '.neo-trellis/migration/trellis-report.json') ?? '{}') : {};
    const next = command === 'migrate'
      ? finalReport.next ?? 'Review imported scopes with neo-trellis-migrate, then run neo-trellis doctor.'
      : 'Map relevant modules; restart your host and run neo-trellis doctor.';
    if (values.json) console.log(JSON.stringify({ ...output, result, next }, null, 2));
    else {
      section('Result');
      row('Changed', result.changed ? `${result.changed} paths` : 'nothing; already up to date');
      if (result.backup) row('Backup', result.backup);
      if (result.archive) row('Archive', result.archive);
      if (command === 'migrate') row('Old source', result.retired ? '.trellis removed; verified ZIP retained' : output.sourceExists ? '.trellis retained' : 'no .trellis directory was present', result.retired || !output.sourceExists ? 'ok' : 'warn');
      list('Retirement blocked', result.blockers, values.verbose, 'warn');
      row('Next', next);
      finish(result.blockers?.length ? 'Files migrated; source retirement needs attention.' : result.changed ? 'Done.' : 'Already up to date.', Boolean(result.blockers?.length));
    }
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
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else { heading('doctor', root); section('Checks');
      row('Errors', result.errors.length, result.errors.length ? 'fail' : 'ok');
      row('Warnings', result.warnings.length, result.warnings.length ? 'warn' : 'ok');
      list('Needs attention', result.errors, true, 'fail'); list('Warnings', result.warnings, true, 'warn');
      finish(result.errors.length ? 'Checks failed.' : 'Static checks passed.', result.errors.length ? 'fail' : 'ok'); }
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
    const result = { paths, ...routeKnowledge(root, paths), note: 'Routes identify potentially relevant knowledge; changed code does not prove a contract is obsolete.' };
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else { heading(command, root); section('Scope');
      row('Paths', paths.length); row('Knowledge', result.knowledge.length); row('Unmapped', result.unmatched.length, result.unmatched.length ? 'warn' : undefined);
      list('Relevant knowledge', result.knowledge, values.verbose);
      list('Unmapped paths', result.unmatched, values.verbose, 'warn');
      if (!paths.length) finish('No paths to inspect.');
      else note(result.note); }
    return;
  }
  throw new Error(`Unknown command: ${command}. Use --help.`);
}
