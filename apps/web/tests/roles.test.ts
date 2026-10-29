import { describe, expect, it } from 'vitest';
import type { CrewRole } from '../src/api.ts';
import { addSkill, canDeleteRole, roleSlug, rolesByStage, STAGES, toggleStage } from '../src/roles.ts';

const role = (id: string, stages: number[], source: CrewRole['source'] = 'yours', name = id): CrewRole => ({
  id,
  name,
  description: '',
  mcp: [],
  skills: [],
  stages,
  source,
  charter: '',
});

describe('roleSlug', () => {
  it('makes a valid role id from a name', () => {
    expect(roleSlug('Reviewer')).toBe('reviewer');
    expect(roleSlug('  QA & Preview note! ')).toBe('qa-preview-note');
    expect(roleSlug('Débogueur')).toBe('debogueur');
    expect(roleSlug('---')).toBe('');
  });

  it('keeps the id at 40 characters with no dash at the end', () => {
    const slug = roleSlug(`${'a'.repeat(39)} b`);
    expect(slug).toBe('a'.repeat(39));
    expect(roleSlug('x'.repeat(60))).toHaveLength(40);
  });
});

describe('rolesByStage', () => {
  it('puts each role under every stage it fits and leaves out the system roles', () => {
    const crew = [role('builder', [3]), role('debugger', [3]), role('reviewer', [5, 7], 'shipped'), role('conductor', [1]), role('ticket', [])];
    const { stages, other } = rolesByStage(crew);
    expect(stages).toHaveLength(STAGES.length);
    expect(stages[2]).toMatchObject({ stage: 3, name: 'Execute' });
    expect(stages[2].roles.map((r) => r.id)).toEqual(['builder', 'debugger']);
    expect(stages[4].roles.map((r) => r.id)).toEqual(['reviewer']);
    expect(stages[6].roles.map((r) => r.id)).toEqual(['reviewer']);
    expect(stages[0].roles).toEqual([]);
    expect(other).toEqual([]);
  });

  it('lists roles with no stage under the other roles', () => {
    const { other } = rolesByStage([role('inbox', []), role('builder', [3]), role('ticket', [])]);
    expect(other.map((r) => r.id)).toEqual(['inbox']);
  });
});

describe('role edits', () => {
  it('adds a skill once, trimmed and without a leading slash', () => {
    expect(addSkill(['code-review'], ' /ponytail:ponytail-review ')).toEqual(['code-review', 'ponytail:ponytail-review']);
    expect(addSkill(['code-review'], 'code-review')).toEqual(['code-review']);
    expect(addSkill(['code-review'], '  ')).toEqual(['code-review']);
  });

  it('toggles a stage and keeps the stages in order', () => {
    expect(toggleStage([5], 3)).toEqual([3, 5]);
    expect(toggleStage([3, 5], 3)).toEqual([5]);
  });

  it('offers Delete only for your own roles that are not system roles', () => {
    expect(canDeleteRole(role('builder', [3]))).toBe(true);
    expect(canDeleteRole(role('reviewer', [5], 'shipped'))).toBe(false);
    expect(canDeleteRole(role('conductor', [], 'yours'))).toBe(false);
  });
});
