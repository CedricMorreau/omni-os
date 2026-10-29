import type { CrewRole } from './api.ts';

export const STAGES = [
  'Research',
  'Build plan',
  'Execute',
  'Test',
  'Review',
  'Manual test',
  'Preview + QA note',
  'Client approval',
  'Deploy',
  'Closing',
] as const;

export const SYSTEM_ROLES = ['conductor', 'ticket'];

export const ROLE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const isSystemRole = (r: Pick<CrewRole, 'id'>) => SYSTEM_ROLES.includes(r.id);

export const canDeleteRole = (r: Pick<CrewRole, 'id' | 'source'>) => r.source === 'yours' && !isSystemRole(r);

export function roleSlug(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

export interface StageRow {
  stage: number;
  name: string;
  roles: CrewRole[];
}

export function rolesByStage(crew: CrewRole[]): { stages: StageRow[]; other: CrewRole[] } {
  const visible = crew.filter((r) => !isSystemRole(r)).sort((a, b) => a.name.localeCompare(b.name));
  return {
    stages: STAGES.map((name, i) => ({ stage: i + 1, name, roles: visible.filter((r) => r.stages.includes(i + 1)) })),
    other: visible.filter((r) => !r.stages.some((s) => s >= 1 && s <= STAGES.length)),
  };
}

export function addSkill(skills: string[], raw: string) {
  const skill = raw.trim().replace(/^\//, '');
  return !skill || skills.includes(skill) ? skills : [...skills, skill];
}

export const toggleStage = (stages: number[], stage: number) =>
  stages.includes(stage) ? stages.filter((s) => s !== stage) : [...stages, stage].sort((a, b) => a - b);
