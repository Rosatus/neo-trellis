const color = process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
const paint = (code, text) => color ? `\x1b[${code}m${text}\x1b[0m` : text;
const clean = text => String(text).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
export function heading(command, root) {
  console.log(`\n  ${paint('1;36', 'NEO-TRELLIS')}  ${clean(command)}\n  ${paint('2', clean(root))}\n`);
}
export function row(label, value) { console.log(`  ${paint('2', label.padEnd(14))}${clean(value)}`); }
export function step(label, value) { console.log(`  ${paint('36', '>')} ${clean(label)}  ${clean(value)}`); }
export function list(label, values, verbose = false) {
  if (!values?.length) return;
  console.log(`\n  ${paint('1', clean(label))}`);
  for (const value of values.slice(0, verbose ? undefined : 8)) console.log(`    - ${clean(value)}`);
  if (!verbose && values.length > 8) console.log(`    ... ${values.length - 8} more; use --verbose`);
}
export function finish(text, warning = false) { console.log(`\n  ${paint(warning ? '33' : '32', warning ? '!' : '+')} ${clean(text)}\n`); }
export function showPlan(output, verbose) {
  heading(`${output.command} / ${output.preview ? 'preview' : 'apply'}`, output.root);
  row('Platforms', output.platforms.join(', '));
  row('Write', `${output.summary.filesToWrite} files`);
  row('Payload', `${(output.summary.bytesToWrite / 1024).toFixed(1)} KiB`);
  row('Remove', `${output.remove.length} old integration paths`);
  if (output.command === 'migrate') {
    row('PRDs', `${output.summary.activePrds} active / ${output.summary.archivedPrds} archived`);
    row('Old references', `${output.summary.currentKnowledgeReferences} current / ${output.summary.historicalReferences} historical`);
    row('Source', output.retirement ? 'Archive full .trellis -> verify -> remove if checks pass' : output.sourceExists ? 'Retain .trellis' : 'No .trellis directory present');
    if (output.retirement) row('Archive', `${output.retirement.entries} entries -> .neo-trellis-backups/<run>/trellis.zip`);
  }
  if (verbose) list('Files to write', output.write, true);
  list('Old integrations to remove', output.remove, verbose);
  list('Retirement blockers (source will be retained)', output.retirement?.blockers, verbose);
  list('Notes', output.notes, verbose);
  console.log('');
}
