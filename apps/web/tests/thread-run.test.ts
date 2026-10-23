import { describe, expect, it } from 'vitest';
import { pickedRun, threadChoice, threadRunLabels, type RunCatalogHarness } from '../src/thread-run.ts';

const catalog: RunCatalogHarness[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    models: [
      { id: 'opus', label: 'Opus', efforts: ['low', 'high'], defaultEffort: 'high' },
      { id: 'sonnet', label: 'Sonnet', default: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
      { id: 'haiku', label: 'Haiku', efforts: [], defaultEffort: '' },
    ],
  },
];

describe('threadRunLabels', () => {
  it('names the chosen model and effort', () => {
    expect(threadRunLabels({ harness: 'claude-code', model: 'opus', effort: 'high' }, catalog)).toEqual({
      model: 'Opus',
      harnessName: 'Claude Code',
      effort: 'high',
    });
  });

  it('names an empty effort as the model default', () => {
    expect(threadRunLabels({ harness: 'claude-code', model: 'opus', effort: '' }, catalog).effort).toBe('Default (high)');
    expect(threadRunLabels({ harness: 'claude-code', model: 'haiku', effort: '' }, catalog).effort).toBe('Auto effort');
  });

  it('names an empty model as the harness default', () => {
    expect(threadRunLabels({ harness: 'claude-code', model: null, effort: '' }, catalog)).toMatchObject({
      model: 'Sonnet',
      effort: 'Default (medium)',
    });
  });

  it('keeps the stored id and effort when the catalog has not arrived', () => {
    expect(threadRunLabels({ harness: 'claude-code', model: 'opus', effort: 'high' }, null)).toEqual({
      model: 'opus',
      harnessName: '',
      effort: 'high',
    });
    expect(threadRunLabels({ harness: 'claude-code', model: null, effort: '' }, null)).toEqual({
      model: 'default',
      harnessName: '',
      effort: 'default',
    });
  });

  it('marks a model Auto picked, keeping its name', () => {
    expect(threadRunLabels({ harness: 'claude-code', model: 'opus', effort: 'high', auto_reason: 'Hard code task: Opus, high effort' }, catalog)).toEqual({
      model: 'Auto · Opus',
      harnessName: 'Claude Code',
      effort: 'high',
    });
  });
});

describe('pickedRun', () => {
  const codex: RunCatalogHarness = { id: 'codex', name: 'Codex', models: [{ id: 'gpt', label: 'GPT', default: true, efforts: ['low', 'high'], defaultEffort: 'low' }] };
  const both = [...catalog, codex];
  const opusHigh = { harness: 'claude-code', model: 'opus', effort: 'high' };

  it('starts a new model at its default effort', () => {
    expect(pickedRun(opusHigh, both, { harness: 'claude-code', model: 'sonnet' })).toEqual({ harness: 'claude-code', model: 'sonnet', effort: '' });
    expect(pickedRun(opusHigh, both, { harness: 'codex', model: 'gpt' })).toEqual({ harness: 'codex', model: 'gpt', effort: '' });
  });

  it('keeps the model when only the effort changes', () => {
    expect(pickedRun(opusHigh, both, { effort: 'low' })).toEqual({ harness: 'claude-code', model: 'opus', effort: 'low' });
    expect(pickedRun({ harness: 'claude-code', model: null, effort: '' }, both, { effort: 'low' })).toEqual({ harness: 'claude-code', model: '', effort: 'low' });
  });

  it('changes nothing when the pick is what the thread runs', () => {
    expect(pickedRun(opusHigh, both, { harness: 'claude-code', model: 'opus' })).toBeNull();
    expect(pickedRun(opusHigh, both, { effort: 'high' })).toBeNull();
    // No stored model runs the harness default, so picking that default is no switch.
    const byDefault = { harness: 'claude-code', model: null, effort: '' };
    expect(threadChoice(byDefault, both)).toEqual({ harness: 'claude-code', model: 'sonnet' });
    expect(pickedRun(byDefault, both, { harness: 'claude-code', model: 'sonnet' })).toBeNull();
  });
});
