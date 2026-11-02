export const THREAD_SCHEME = 'omni-thread:';

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Code the text must not touch: a fenced block, then an inline span. */
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/;

/**
 * Turns a bare thread id in markdown into a link to that thread, as phone web does, and leaves code, existing links and
 * ids inside a path or address alone.
 */
export function linkThreads(markdown: string): string {
  if (!markdown.match(UUID)) return markdown;
  return markdown
    .split(CODE)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(UUID, (id, at: number) => (isBare(part, at) ? `[${id}](${THREAD_SCHEME}${id})` : id))))
    .join('');
}

/** Not the target of a link, a path segment, a query value or inside link text. */
function isBare(text: string, at: number): boolean {
  const before = text[at - 1];
  const after = text[at + 36];
  if ((before && '/=#<(:@'.includes(before)) || (after && '/>)]'.includes(after))) return false;
  const open = text.lastIndexOf('[', at);
  return open === -1 || text.indexOf(']', open) < at;
}

export type LinkTarget = { kind: 'thread'; id: string } | { kind: 'external'; url: string } | { kind: 'ignore' };

/** What a tapped link does: open a thread in the app, hand a web or mail address to the system, or nothing. */
export function linkTarget(url: string): LinkTarget {
  if (url.startsWith(THREAD_SCHEME)) return { kind: 'thread', id: url.slice(THREAD_SCHEME.length) };
  return /^(https?:|mailto:)/i.test(url) ? { kind: 'external', url } : { kind: 'ignore' };
}
