import fs from 'node:fs';
import path from 'node:path';
import { safePath, read, digest } from './storage.mjs';
import { filesIn, relocateLinks } from './migrate-prds.mjs';

const LEDGER = '.neo-trellis/migration/trellis-knowledge.json';
const REPORT = '.neo-trellis/migration/trellis-report.json';
const ROOTS = [
  ['.trellis/spec', '.neo-trellis/spec'],
  ['.trellis/research', '.neo-trellis/research'],
  ['.trellis/workspace', '.neo-trellis/history/workspace'],
];
const textual = file => /\.(md|json|jsonl|txt)$/i.test(file);
const oldReferences = text => [...new Set(text.match(/(?<![\w-])\.trellis[/\\][^\s`"'<>\]\[(){};,]+/g) ?? [])];

function exists(root, rel) { return fs.existsSync(safePath(root, rel)); }

// Upstream Trellis ships generic guides and unfilled spec templates. They are
// useful provenance but must not become project contracts just because they
// lived under .trellis/spec. Recognize whole directories by stable markers.
function boilerplateRoots(root) {
  const result = [];
  if (!exists(root, '.trellis/spec')) return result;
  const files = filesIn(root, '.trellis/spec');
  const dirs = new Set([...files.keys()].filter(name => name.endsWith('/index.md')).map(name => name.slice(0, -'/index.md'.length)));
  for (const dir of [...dirs].sort()) {
    const index = files.get(`${dir}/index.md`).toString('utf8');
    const members = [...files].filter(([name]) => name.startsWith(dir + '/'));
    const markdown = members.filter(([name]) => name.endsWith('.md'));
    const source = `.trellis/spec/${dir}`;
    if (dir.split('/').pop() === 'guides' && /^# Thinking Guides\b/m.test(index) &&
        index.includes('Expand your thinking to catch things you might not have considered')) {
      result.push([source, `.neo-trellis/history/trellis-guides${dir === 'guides' ? '' : '/' + dir.slice(0, -'/guides'.length).replace(/\//g, '-')}`]);
    } else if (index.includes("Fill in each file with your project's specific conventions") &&
        markdown.length === members.length &&
        markdown.every(([name, data]) => name === `${dir}/index.md` || data.toString('utf8').includes('(To be filled by the team)'))) {
      result.push([source, `.neo-trellis/history/trellis-spec-templates/${dir.replace(/\//g, '-')}`]);
    }
  }
  return result.filter(([source]) => !result.some(([other]) => other !== source && source.startsWith(other + '/')));
}

// This recognizes only the ordinary block-style packages/name/path subset.
// Unrecognized YAML is not executed or guessed; document references remain a
// conservative discovery fallback, explicitly labeled as references, not ownership.
function packagePaths(text) {
  const result = new Map();
  let inside = false, name;
  for (const line of text.split(/\r?\n/)) {
    if (/^packages:\s*(?:#.*)?$/.test(line)) { inside = true; continue; }
    if (!inside || /^\s*(?:#.*)?$/.test(line)) continue;
    if (/^\S/.test(line)) break;
    const heading = /^  ([\w-]+):\s*(?:#.*)?$/.exec(line);
    if (heading) { name = heading[1]; continue; }
    const field = /^    path:\s*["']?([\w./-]+)["']?\s*(?:#.*)?$/.exec(line);
    if (name && field) result.set(name, field[1]);
  }
  return result;
}

function buildNavigation(root, plan, mappings, fresh) {
  const routesPath = '.neo-trellis/routes.json';
  const raw = read(root, routesPath);
  const routes = raw ? JSON.parse(raw) : { version: 1, routes: [] };
  if (routes.version !== 1 || !Array.isArray(routes.routes)) throw new Error('Invalid existing routes.json');
  const packages = packagePaths(read(root, '.trellis/config.yaml') ?? '');
  const entries = [];
  let changed = false;
  for (const [source, destination] of mappings) {
    if (!source.startsWith('.trellis/spec/') || !source.endsWith('/index.md')) continue;
    // Historical guides/templates stay discoverable via legacy.md, not routes.
    if (destination.startsWith('.neo-trellis/history/')) continue;
    if (!plan.writes.has(destination) && !exists(root, destination)) continue;
    const scope = source.slice('.trellis/spec/'.length, -'/index.md'.length);
    const declared = packages.get(scope.split('/')[0]);
    const candidates = new Map();
    const add = (value, evidence, kind) => {
      const rel = value.replace(/^\.\//, '');
      if (!rel || rel.startsWith('.') || /(?:^|\/)\.\.(?:\/|$)/.test(rel) || !/^[\w/-]+(?:\.[\w-]+)?\/?$/.test(rel)) return;
      if (!exists(root, rel)) return;
      const isDir = fs.statSync(safePath(root, rel)).isDirectory();
      candidates.set(rel.replace(/\/$/, '') + (isDir ? '/' : ''), { evidence, kind });
    };
    if (declared) add(declared, '.trellis/config.yaml packages.' + scope.split('/')[0], 'declared package');
    if (!candidates.size) {
      for (const name of [source, path.posix.join(path.posix.dirname(source), 'directory-structure.md')]) {
        const body = read(root, name);
        if (!body) continue;
        for (const m of body.matchAll(/`([\w./-]+\/[^`\s]*)`/g)) add(m[1], name, 'existing path reference; scope needs review');
        for (const m of body.matchAll(/^([\w./-]+\/)\s*(?:#.*)?$/gm)) add(m[1], name, 'existing directory-tree reference; scope needs review');
      }
    }
    const paths = [...candidates.keys()].sort().filter(p => ![...candidates.keys()].some(other => other !== p && other.endsWith('/') && p.startsWith(other)));
    if (paths.length && (!raw || plan.writes.has(destination))) {
      const present = routes.routes.filter(r => r.knowledge?.includes(destination)).flatMap(r => r.paths ?? []);
      const missing = paths.filter(p => !present.includes(p));
      if (missing.length) { routes.routes.push({ paths: missing, knowledge: [destination] }); changed = true; }
    }
    entries.push({ source, destination, paths, evidence: paths.map(p => ({ path: p, ...candidates.get(p) })) });
  }
  if (!raw || changed) plan.writes.set(routesPath, JSON.stringify(routes, null, 2) + '\n');
  const mapPath = '.neo-trellis/map.md';
  const map = read(root, mapPath) ?? '# Project map\n';
  // Re-running migration must not re-add scopes a curated map deliberately
  // renamed or removed; only newly imported indexes are proposed.
  const rows = entries.filter(e => fresh.has(e.source) && !map.includes(`](${e.destination.slice('.neo-trellis/'.length)})`));
  if (rows.length || !exists(root, mapPath)) {
    const nav = ['## Knowledge scopes', '',
      'Contracts remain binding. Document references are initial discovery routes;',
      'verify scope during normal work. Unmapped entries remain available for inspection.', '',
      '| Knowledge | Code paths | Evidence |', '|---|---|---|',
      ...rows.map(e => `| [${e.destination.slice('.neo-trellis/'.length)}](${e.destination.slice('.neo-trellis/'.length)}) | ${e.paths.join(', ') || 'Needs scope mapping'} | ${[...new Set(e.evidence.map(v => v.kind))].join('; ') || 'Needs semantic review'} |`), '',
      'For migration-only cleanup, follow .neo-trellis/skills/migrate.md.', ''].join('\n');
    plan.writes.set(mapPath, map.trimEnd() + '\n\n' + nav);
  }
  return entries;
}

export function planKnowledgeImports(root, plan, prds) {
  const raw = read(root, LEDGER);
  const ledger = raw ? JSON.parse(raw) : { version: 1, records: [] };
  if (ledger.version !== 1 || !Array.isArray(ledger.records) || ledger.records.some(r =>
    !r || typeof r.source !== 'string' || typeof r.destination !== 'string' || typeof r.fingerprint !== 'string')) throw new Error('Invalid Trellis knowledge import ledger');
  const mappings = new Map(ledger.records.map(r => [r.source, r.destination]));
  const fresh = new Map(prds.importedFiles);
  const skippedUpdates = [];
  const copy = (source, destination, data) => {
    const previous = ledger.records.find(r => r.source === source);
    mappings.set(source, previous?.destination ?? destination);
    if (previous) {
      if (previous.fingerprint !== digest(data)) skippedUpdates.push(source);
      return;
    }
    if (exists(root, destination)) throw new Error(`Knowledge destination already exists without import record: ${destination}`);
    plan.writes.set(destination, data);
    fresh.set(source, destination);
    ledger.records.push({ source, destination, fingerprint: digest(data) });
  };
  const packages = packagePaths(read(root, '.trellis/config.yaml') ?? '');
  const boilerplate = boilerplateRoots(root);
  const specRoots = [...boilerplate];
  if (exists(root, '.trellis/spec')) for (const name of fs.readdirSync(safePath(root, '.trellis/spec'))) {
    const source = `.trellis/spec/${name}`;
    if (fs.statSync(safePath(root, source)).isDirectory() &&
        (['backend', 'frontend'].includes(name) || packages.has(name))) {
      specRoots.push([source, `.neo-trellis/modules/${name}`]);
    }
  }
  specRoots.sort((a, b) => b[0].length - a[0].length);
  for (const [sourceRoot, targetRoot] of ROOTS) {
    if (!exists(root, sourceRoot)) continue;
    for (const [name, data] of filesIn(root, sourceRoot)) {
      const source = `${sourceRoot}/${name}`;
      const moduleRoot = specRoots.find(([from]) => source.startsWith(from + '/'));
      copy(source, moduleRoot ? moduleRoot[1] + source.slice(moduleRoot[0].length) : `${targetRoot}/${name}`, data);
    }
  }
  // Preserve even task bundles without a PRD or a recognizable status, without
  // pretending they are active or completed requirements. Nothing is filtered
  // by extension or size: large logs and binary evidence travel intact.
  if (exists(root, '.trellis/tasks')) {
    for (const [name, data] of filesIn(root, '.trellis/tasks')) {
      const source = `.trellis/tasks/${name}`;
      const prd = prds.records.find(r => source.startsWith(r.source + '/'));
      if (prd) mappings.set(source, prd.destination + source.slice(prd.source.length));
      else copy(source, `.neo-trellis/history/tasks/${name}`, data);
    }
  }
  // Trellis archives tasks after they were referenced by their active path.
  // Resolve both spellings to the PRD destination; unknown task paths remain
  // unresolved instead of being rewritten to a guessed history location.
  const taskAliases = prds.records.flatMap(r => {
    const alias = `.trellis/tasks/${path.posix.basename(r.source)}`;
    return alias === r.source ? [] : [[alias, r.destination]];
  });
  const taskBundles = [...new Set(ledger.records.filter(r => r.source.startsWith('.trellis/tasks/'))
    .map(r => r.source.split('/').slice(0, 3).join('/')))].map(source => [source, `.neo-trellis/history/tasks/${source.slice('.trellis/tasks/'.length)}`]);
  const roots = [...specRoots, ...ROOTS, ...prds.records.map(r => [r.source, r.destination]), ...taskAliases, ...taskBundles]
    .sort((a, b) => b[0].length - a[0].length);
  const remap = value => {
    if (mappings.has(value)) return mappings.get(value);
    for (const [from, to] of roots) if (value === from || value.startsWith(from + '/')) return to + value.slice(from.length);
    return value;
  };
  const remaining = [];
  for (const [source, destination] of fresh) {
    const data = plan.writes.get(destination);
    if (!textual(source)) continue;
    let text = data.toString('utf8');
    if (source.endsWith('.md')) text = relocateLinks(text, source, destination, path.posix.dirname(source), plan.notes, remap);
    // Current knowledge gets literal paths rewritten to verified copies. History
    // and PRD evidence keep their original prose; links are still made usable.
    if (/^\.neo-trellis\/(?:modules|spec|research)\//.test(destination)) for (const reference of oldReferences(text).sort((a, b) => b.length - a.length)) {
      const target = remap(reference);
      if (target !== reference) text = text.split(reference).join(target);
    }
    plan.writes.set(destination, text);
  }
  // Include preserved destination edits in the audit; never rewrite them.
  for (const destination of [...new Set(mappings.values())].sort()) {
    if (!textual(destination)) continue;
    const data = plan.writes.get(destination) ?? read(root, destination);
    if (data === undefined) continue;
    const references = oldReferences(data.toString());
    if (references.length) remaining.push({ file: destination,
      category: /^\.neo-trellis\/(modules|spec)\//.test(destination) ? 'current-knowledge' : 'historical-record', references });
  }
  const scopes = buildNavigation(root, plan, mappings, fresh);
  let previousReport = {};
  try { previousReport = JSON.parse(read(root, REPORT) ?? '{}'); } catch { previousReport = {}; }
  const reviewed = typeof previousReport.semanticReview === 'string' && !previousReport.semanticReview.startsWith('pending');
  const report = { version: 1, scope: 'Copied knowledge and task documents; not a whole-repository deletion-safety proof',
    mappings: [...mappings].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([source, destination]) => ({ source, destination })), scopes,
    remainingReferences: remaining, changedSourcesNotOverwritten: skippedUpdates,
    missingDestinations: [...mappings].filter(([, destination]) => !plan.writes.has(destination) && !exists(root, destination))
      .map(([source, destination]) => ({ source, destination })),
    discardedWorkflow: ['.trellis/workflow.md', '.trellis/scripts/', '.trellis/agents/', '.trellis/config.yaml',
      '.trellis/delegation.md', '.trellis/validation.md', '.trellis/customization.md'],
    originalDirectoryDeleted: false,
    // A rerun must not discard the recorded human/agent semantic review.
    semanticReview: reviewed ? previousReport.semanticReview : 'pending: use neo-trellis-migrate to review scope, global contracts and obsolete references',
    next: reviewed && typeof previousReport.next === 'string' ? previousReport.next
      : 'Retire old platform integrations and review remaining references before deleting .trellis. Old workflow references are historical, not instructions to restore it.' };
  if (ledger.records.length) plan.writes.set(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
  plan.writes.set(REPORT, JSON.stringify(report, null, 2) + '\n');
  plan.writes.set('.neo-trellis/legacy.md', [
    '# Migrated Trellis knowledge', '',
    'Copied specs are still authoritative until a current spec explicitly supersedes them.',
    'Use the neo-trellis copies as the maintained source. The migration report records',
    'whether the original directory was retained or retired into a verified ZIP backup.', '',
    ...ROOTS.filter(([from]) => exists(root, from)).map(([, to]) => `- [${to.slice('.neo-trellis/'.length)}/](${to.slice('.neo-trellis/'.length)}/)`),
    ...boilerplate.map(([from, planned]) => [from, path.posix.dirname(mappings.get(`${from}/index.md`) ?? `${planned}/index.md`)]).map(([from, to]) => `- [${to.slice('.neo-trellis/'.length)}/](${to.slice('.neo-trellis/'.length)}/) — upstream Trellis ${to.includes('/trellis-guides') ? 'thinking guides' : 'unfilled spec templates'} from ${from}; not current contracts.`),
    '- [Project map](map.md)',
    '- [Migration report and source mappings](migration/trellis-report.json)',
    ...(exists(root, '.neo-trellis/migration/semantic-review.md') ? ['- [Semantic review](migration/semantic-review.md)'] : []),
    ...(prds.records.length ? ['- [PRD import ledger](prds/trellis-imports.json) — requirements and historical status; acceptance unverified.'] : []),
    ...(ledger.records.some(r => r.destination.startsWith('.neo-trellis/history/tasks/')) ? ['- [Unclassified task evidence](history/tasks/) — not automatically a PRD.'] : []), '',
    'The old workflow, agent delegation and validation policies are retired, not migrated',
    'as current rules. References to them in imported history do not reactivate them.',
    'Review remaining references in the report before removing the original directory.', ''].join('\n'));
  plan.notes.push(`Knowledge copied to neo-trellis; ${scopes.length} spec indexes mapped/listed, ${remaining.length} documents retain old references, ${skippedUpdates.length} changed sources require reconciliation. See ${REPORT}.`);
}
