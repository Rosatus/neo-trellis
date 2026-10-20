import fs from 'node:fs';
import path from 'node:path';
import { safePath, read, digest } from './storage.mjs';

const INDEX = '.neo-trellis/prds/trellis-imports.json';
const TASKS = '.trellis/tasks';

function directories(root, rel) {
  const dir = safePath(root, rel);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().filter(name => fs.statSync(safePath(root, `${rel}/${name}`)).isDirectory());
}

function filesIn(root, rel) {
  const result = new Map();
  function visit(dir) {
    for (const name of fs.readdirSync(safePath(root, dir)).sort()) {
      const file = `${dir}/${name}`;
      const absolute = safePath(root, file);
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) result.set(file.slice(rel.length + 1), fs.readFileSync(absolute));
      else throw new Error(`Unsupported task file: ${file}`);
    }
  }
  visit(rel);
  return result;
}

// Adjust conventional Markdown links pointing outside the copied bundle back
// to the preserved originals. Internal attachments keep their relative paths.
function relocateLinks(text, sourceFile, targetFile, sourceDir, notes) {
  function relocate(url) {
    // Leave complex destinations to manual review instead of partially
    // rewriting nested parentheses or platform-specific path syntax.
    if (/[()\\]/.test(url)) return url;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) return url;
    const match = /^([^?#]+)(.*)$/.exec(url);
    if (!match) return url;
    let decoded;
    try { decoded = decodeURIComponent(match[1]); } catch { return url; }
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), decoded));
    if (resolved === sourceDir || resolved.startsWith(sourceDir + '/')) return url;
    if (resolved.startsWith('../')) {
      notes.push(`PRD link requires review: ${sourceFile} -> ${url}`);
      return url;
    }
    return path.posix.relative(path.posix.dirname(targetFile), resolved).split('/').map(encodeURIComponent).join('/') + match[2];
  }
  const rewrite = text => text.replace(/(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^\s)]+)([^)\n]*\))/g,
    (_, before, url, after) => before + (url.startsWith('<') ? `<${relocate(url.slice(1, -1))}>` : relocate(url)) + after)
    .replace(/^(\s{0,3}\[[^\]\n]+\]:\s*)(<[^>\n]+>|\S+)/gm,
      (_, before, url) => before + (url.startsWith('<') ? `<${relocate(url.slice(1, -1))}>` : relocate(url)));
  let fence;
  return text.split(/(?<=\n)/).map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length &&
          line.trim() === marker) fence = undefined;
      return line;
    }
    if (marker) { fence = marker; return line; }
    if (/^(?: {4}|\t)/.test(line)) return line;
    return line.split(/(`+[^`\n]*`+)/g).map(part => part.startsWith('`') ? part : rewrite(part)).join('');
  }).join('');
}

export function planPrdImports(root, plan) {
  const raw = read(root, INDEX);
  const index = raw ? JSON.parse(raw) : { version: 1, records: [] };
  if (index.version !== 1 || !Array.isArray(index.records) || index.records.some(r =>
    !r || typeof r.source !== 'string' || typeof r.destination !== 'string' || typeof r.fingerprint !== 'string')) {
    throw new Error(`Invalid PRD import index: ${INDEX}`);
  }
  const candidates = directories(root, TASKS).filter(name => name !== 'archive')
    .map(name => ({ source: `${TASKS}/${name}`, archived: false }));
  for (const month of directories(root, `${TASKS}/archive`)) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      plan.notes.push(`PRD skipped: unrecognized archive layout ${TASKS}/archive/${month}`);
      continue;
    }
    for (const name of directories(root, `${TASKS}/archive/${month}`)) {
      candidates.push({ source: `${TASKS}/archive/${month}/${name}`, archived: true });
    }
  }
  for (const { source, archived } of candidates) {
    if (!fs.existsSync(safePath(root, `${source}/prd.md`))) {
      plan.notes.push(`PRD skipped (no prd.md): ${source}`);
      continue;
    }
    const files = filesIn(root, source);
    const fingerprint = digest(JSON.stringify([...files].map(([name, data]) => [name, digest(data)])));
    const previous = index.records.find(r => r.source === source);
    if (previous) {
      plan.notes.push(`PRD already imported; destination edits/moves preserved: ${source}` +
        (previous.fingerprint !== fingerprint ? ' (source changed; reconcile manually)' : ''));
      continue;
    }
    let metadata;
    try { metadata = files.has('task.json') ? JSON.parse(files.get('task.json').toString('utf8')) : {}; }
    catch { plan.notes.push(`PRD skipped (malformed task.json): ${source}`); continue; }
    const status = metadata?.status;
    const active = ['planning', 'in_progress', 'review'];
    if ((!archived && ![...active, 'completed'].includes(status)) ||
        (archived && status !== undefined && !['completed', 'cancelled', 'canceled', 'superseded'].includes(status))) {
      plan.notes.push(`PRD skipped (ambiguous status ${JSON.stringify(status) ?? 'missing'}): ${source}`);
      continue;
    }
    const bucket = archived || status === 'completed' ? 'archive' : 'active';
    const slug = path.posix.basename(source).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 70);
    const destination = `.neo-trellis/prds/${bucket}/trellis-${slug}-${digest(source).slice(0, 12)}`;
    if (fs.existsSync(safePath(root, destination))) throw new Error(`PRD destination already exists without import record: ${destination}`);
    for (const [name, data] of files) {
      const target = `${destination}/${name}`;
      plan.writes.set(target, name.endsWith('.md')
        ? relocateLinks(data.toString('utf8'), `${source}/${name}`, target, source, plan.notes) : data);
    }
    index.records.push({ source, destination, fingerprint, originalStatus: status ?? null,
      originallyArchived: archived, confirmation: 'not verified by migration',
      acceptance: 'not verified by migration',
      context: 'Imported task metadata and execution files are historical evidence, not executable workflow instructions.' });
    plan.notes.push(`PRD import ${bucket}: ${source} -> ${destination}; historical status only, acceptance unverified. Review non-Markdown/path-text references against preserved source.`);
  }
  if (index.records.length) plan.writes.set(INDEX, JSON.stringify(index, null, 2) + '\n');
}
