// Human-oriented CLI rendering. Colors only on real TTYs; Unicode glyphs fall
// back to ASCII for dumb terminals or NEO_TRELLIS_ASCII=1. Machine consumers
// should use --json instead of parsing this output.
const env = process.env;
const color = process.stdout.isTTY && !env.NO_COLOR && env.TERM !== 'dumb';
const unicode = env.NEO_TRELLIS_ASCII !== '1' && env.TERM !== 'dumb';
const g = unicode
  ? { brand: '◆', ok: '✓', warn: '!', fail: '✗', bullet: '•', step: '›', rule: '─', dot: '·', more: '…' }
  : { brand: '*', ok: '+', warn: '!', fail: 'x', bullet: '-', step: '>', rule: '-', dot: '|', more: '...' };
const style = { dim: '2', bold: '1', accent: '1;36', cyan: '36', ok: '32', warn: '33', fail: '31', badge: '1;30;46' };
const paint = (name, text) => color ? `\x1b[${style[name]}m${text}\x1b[0m` : text;
const describe = value => value && typeof value === 'object' && 'message' in value
  ? (value.file ? `${value.file}: ${value.message}` : value.message) : value;
const clean = text => String(describe(text)).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
const out = (line = '') => console.log(line);
let stepCount = 0;

export function heading(command, root, mode) {
  stepCount = 0;
  const title = `${paint('accent', `${g.brand} neo-trellis`)} ${paint('dim', g.dot)} ${paint('bold', clean(command))}`;
  const badge = mode ? (color ? paint('badge', ` ${clean(mode).toUpperCase()} `) : `[${clean(mode).toUpperCase()}]`) : '';
  out();
  out(`  ${title}${badge ? '  ' + badge : ''}`);
  out(`  ${paint('dim', clean(root))}`);
  out(`  ${paint('dim', g.rule.repeat(56))}`);
}
export function section(title) { out(); out(`  ${paint('bold', clean(title).toUpperCase())}`); }
export function row(label, value, tone) {
  const text = clean(value);
  out(`    ${paint('dim', clean(label).padEnd(14))}${tone ? paint(tone, text) : text}`);
}
export function step(label, value) {
  stepCount += 1;
  out(`  ${paint('cyan', `${g.step}${String(stepCount).padStart(2)}`)}  ${paint('bold', clean(label).padEnd(9))} ${paint('dim', clean(value))}`);
}
export function list(label, values, verbose = false, tone) {
  if (!values?.length) return;
  const icon = tone === 'fail' ? g.fail : tone === 'warn' ? g.warn : null;
  out();
  out(`  ${icon ? paint(tone, icon) + ' ' : ''}${paint('bold', clean(label))} ${paint('dim', `(${values.length})`)}`);
  for (const value of values.slice(0, verbose ? undefined : 8)) out(`    ${paint('dim', g.bullet)} ${clean(value)}`);
  if (!verbose && values.length > 8) out(`    ${paint('dim', `${g.more} ${values.length - 8} more; use --verbose`)}`);
}
// tone: false/'ok' success, true/'warn' attention, 'fail' failure.
export function finish(text, tone = false) {
  const kind = tone === true ? 'warn' : tone || 'ok';
  out();
  out(`  ${paint(kind, `${g[kind]} ${clean(text)}`)}`);
  out();
}
export function showPlan(output, verbose) {
  heading(output.command, output.root, output.preview ? 'preview' : 'apply');
  section('Plan');
  row('Platforms', output.platforms.join(', '));
  row('Write', `${output.summary.filesToWrite} files ${g.dot} ${(output.summary.bytesToWrite / 1024).toFixed(1)} KiB`);
  row('Remove', `${output.remove.length} old integration paths`);
  if (output.command === 'migrate') {
    section('Migration');
    row('PRDs', `${output.summary.activePrds} active ${g.dot} ${output.summary.archivedPrds} archived`);
    row('Old refs', `${output.summary.currentKnowledgeReferences} current ${g.dot} ${output.summary.historicalReferences} historical`,
      output.summary.currentKnowledgeReferences ? 'warn' : undefined);
    const blocked = output.retirement?.blockers.length;
    row('Source', output.retirement
      ? (blocked ? 'archive, then retain (blocked)' : 'archive, verify, then remove .trellis')
      : output.sourceExists ? 'retain .trellis' : 'no .trellis directory', blocked ? 'warn' : undefined);
    if (output.retirement) row('Archive', `${output.retirement.entries} entries -> .neo-trellis-backups/<run>/trellis.zip`);
  }
  if (verbose) list('Files to write', output.write, true);
  list('Old integrations to remove', output.remove, verbose);
  list('Retirement blockers - source will be retained', output.retirement?.blockers, verbose, 'warn');
  list('Notes', output.notes, verbose);
}
export function note(text) { out(); out(`  ${paint('dim', clean(text))}`); out(); }
export function showError(message) {
  console.error(`\n  ${paint('fail', `${g.fail} neo-trellis`)}  ${clean(message)}\n`);
}
