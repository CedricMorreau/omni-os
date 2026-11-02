import { artifactUrl, type Artifact } from './api.ts';

export type FileRef = Pick<Artifact, 'id' | 'name' | 'updated_at'>;

const BEFORE = /[\s/("'[]/;
const AFTER = /[\s.,;:!?)"'\]]/;

const longestFirst = <T extends FileRef>(files: T[]) => [...files].filter((f) => f.name).sort((a, b) => b.name.length - a.name.length);

export function artifactForRun<T extends FileRef>(text: string, files: T[]): T | undefined {
  const run = text.trim();
  if (!run) return undefined;
  return longestFirst(files).find((f) => run === f.name || run.endsWith(`/${f.name}`));
}

export function namesInText<T extends FileRef>(text: string, files: T[]): { end: number; file: T }[] {
  const hits: { start: number; end: number; file: T }[] = [];
  for (const file of longestFirst(files)) {
    let at = text.indexOf(file.name);
    while (at !== -1) {
      const end = at + file.name.length;
      const before = at === 0 || BEFORE.test(text[at - 1]);
      const after = end === text.length || AFTER.test(text[end]);
      const free = hits.every((h) => end <= h.start || at >= h.end);
      if (before && after && free) hits.push({ start: at, end, file });
      at = text.indexOf(file.name, at + 1);
    }
  }
  return hits.sort((a, b) => a.end - b.end).map(({ end, file }) => ({ end, file }));
}

interface HastText {
  type: 'text';
  value: string;
}
interface HastElement {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}
type HastNode = HastText | HastElement | { type: string; children?: HastNode[] };

const RUNS = new Set(['strong', 'b', 'em', 'code']);
const SKIP = new Set(['a', 'pre']);

const textOf = (n: HastNode): string => (n.type === 'text' ? (n as HastText).value : 'children' in n && n.children ? n.children.map(textOf).join('') : '');

export const downloadLabel = (name: string) => `Download ${name}`;

function marker(file: FileRef): HastElement {
  return {
    type: 'element',
    tagName: 'a',
    properties: { href: artifactUrl(file, true), download: file.name, dataArtifactDownload: file.name, ariaLabel: downloadLabel(file.name), title: downloadLabel(file.name) },
    children: [],
  };
}

function mark(node: HastNode, files: FileRef[]) {
  if (!('children' in node) || !node.children) return;
  const out: HastNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text') {
      const value = (child as HastText).value;
      let from = 0;
      for (const { end, file } of namesInText(value, files)) {
        out.push({ type: 'text', value: value.slice(from, end) }, marker(file));
        from = end;
      }
      if (from < value.length || from === 0) out.push({ type: 'text', value: value.slice(from) });
      continue;
    }
    out.push(child);
    if (child.type !== 'element') continue;
    const el = child as HastElement;
    if (SKIP.has(el.tagName)) continue;
    if (RUNS.has(el.tagName)) {
      const file = artifactForRun(textOf(el), files);
      if (file) out.push(marker(file));
      else if (el.tagName !== 'code') mark(el, files);
      continue;
    }
    mark(el, files);
  }
  node.children = out;
}

export function rehypeArtifactDownloads(files: FileRef[]) {
  return (tree: HastNode) => {
    if (files.length) mark(tree, files);
  };
}
