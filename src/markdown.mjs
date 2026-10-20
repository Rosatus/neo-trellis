// Extract ordinary inline/reference destinations, excluding code examples.
export function markdownLinks(text) {
  let fence;
  const prose = text.split('\n').map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = undefined;
      return '';
    }
    if (marker) { fence = marker; return ''; }
    if (/^(?: {4}|\t)/.test(line)) return '';
    return line.replace(/(`+).*?\1/g, '');
  }).join('\n');
  return [...prose.matchAll(/\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))|^\s{0,3}\[[^\]\n]+\]:\s*(?:<([^>]+)>|(\S+))/gm)]
    .map(m => m[1] ?? m[2] ?? m[3] ?? m[4]);
}
