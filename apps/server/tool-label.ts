// A tool call in a few words, for the context panel (context.ts) and the handover (runner/handover.ts). Pure.

/** What a tool call was about, in a few words: the path, command, pattern or URL it was given. */
export function toolLabel(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  for (const k of ['file_path', 'path', 'command', 'pattern', 'url', 'query', 'notebook_path', 'description', 'prompt', 'skill']) {
    if (typeof o[k] !== 'string' || !o[k]) continue;
    const v = (o[k] as string).replace(/\s+/g, ' ');
    // A path stays whole, so the panel can show it from the thread's folder; a long one keeps its file name.
    if (k.endsWith('path')) return v.length > 1000 ? `…${v.slice(-999)}` : v;
    return v.slice(0, 140);
  }
  const first = Object.values(o).find((v) => typeof v === 'string' && v);
  return typeof first === 'string' ? first.replace(/\s+/g, ' ').slice(0, 140) : '';
}
