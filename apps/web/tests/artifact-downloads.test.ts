import { describe, expect, it } from 'vitest';
import { artifactForRun, namesInText, rehypeArtifactDownloads } from '../src/artifact-downloads.ts';

const files = [
  { id: 1, name: 'acme-review.csv', updated_at: '2026-11-02T10:00:00Z' },
  { id: 2, name: 'review.csv', updated_at: '2026-11-02T10:00:00Z' },
  { id: 3, name: 'report.html', updated_at: '2026-11-02T10:00:00Z' },
];

describe('artifactForRun', () => {
  it('matches a run that is exactly the name of a file', () => {
    expect(artifactForRun('acme-review.csv', files)?.id).toBe(1);
    expect(artifactForRun(' report.html ', files)?.id).toBe(3);
  });

  it('matches a path that ends in the name', () => {
    expect(artifactForRun('data/threads/x/artifacts/acme-review.csv', files)?.id).toBe(1);
    expect(artifactForRun('/tmp/review.csv', files)?.id).toBe(2);
  });

  it('does not match a longer name or other text', () => {
    expect(artifactForRun('old-acme-review.csv', files)).toBeUndefined();
    expect(artifactForRun('the acme-review.csv file', files)).toBeUndefined();
    expect(artifactForRun('', files)).toBeUndefined();
    expect(artifactForRun('acme-review.csv', [])).toBeUndefined();
  });
});

describe('namesInText', () => {
  it('finds each whole name in plain text, the longest name first', () => {
    const text = 'I wrote acme-review.csv and data/out/report.html. See review.csv, too.';
    expect(namesInText(text, files).map(({ end, file }) => [text.slice(0, end).split(/[\s/]/).pop(), file.id])).toEqual([
      ['acme-review.csv', 1],
      ['report.html', 3],
      ['review.csv', 2],
    ]);
  });

  it('skips a name inside another word', () => {
    expect(namesInText('preview.csvx and myreview.csv', files)).toEqual([]);
  });
});

describe('rehypeArtifactDownloads', () => {
  const tree = () => ({
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [
          { type: 'element', tagName: 'strong', properties: {}, children: [{ type: 'text', value: 'acme-review.csv' }] },
          { type: 'text', value: ' is ready.' },
        ],
      },
    ],
  });

  it('puts a download link right after the bold name', () => {
    const t = tree();
    rehypeArtifactDownloads(files)(t);
    const p = t.children[0] as { children: { tagName?: string; properties?: Record<string, unknown> }[] };
    expect(p.children.map((c) => c.tagName ?? 'text')).toEqual(['strong', 'a', 'text']);
    expect(p.children[1].properties).toMatchObject({ download: 'acme-review.csv', ariaLabel: 'Download acme-review.csv' });
    expect(String(p.children[1].properties?.href)).toMatch(/^\/api\/artifacts\/1\/raw\?.*download=1$/);
  });

  it('leaves the tree unchanged when the thread has no files', () => {
    const t = tree();
    rehypeArtifactDownloads([])(t);
    expect(t).toEqual(tree());
  });
});
