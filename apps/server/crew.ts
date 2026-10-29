import { readdirSync, readFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { memoryDir, paths } from './config.ts';
import { fillPlaceholders } from './user-config.ts';

export interface CrewRole {
  id: string;
  name: string;
  description: string;
  harness?: string;
  model?: string;
  effort?: string;
  channel?: string;
  /** Extra MCP servers this role gets. "omni" = the conductor tools. */
  mcp: string[];
  skills: string[];
  stages: number[];
  charter: string;
  source: 'shipped' | 'yours';
  error?: string;
}

export function parseCrewFile(id: string, src: string, source: CrewRole['source'] = 'shipped'): CrewRole {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  let meta: any = {};
  let error: string | undefined;
  try {
    meta = (m ? YAML.parse(m[1]) : {}) ?? {};
  } catch (err) {
    // A typo in one charter must not break every thread that uses a role.
    error = `bad frontmatter: ${(err as Error).message}`;
  }
  return {
    id,
    name: meta.name ?? id,
    description: meta.description ?? '',
    harness: meta.harness,
    model: meta.model,
    effort: meta.effort,
    channel: meta.channel,
    mcp: Array.isArray(meta.mcp) ? meta.mcp : [],
    skills: Array.isArray(meta.skills) ? meta.skills.map(String) : [],
    stages: Array.isArray(meta.stages) ? meta.stages.map(Number).filter(Number.isInteger) : [],
    source,
    charter: fillPlaceholders((m ? m[2] : src).trim()),
    error,
  };
}

// Read from disk each time: charters are meant to be edited while the server runs. The shared charters live in
// crew/; a file of the same name in data/crew/ is the user's own and replaces it, so a fork never edits crew/.
export const rolesDir = () => join(memoryDir(), 'roles');

export function listCrew(): CrewRole[] {
  const files = new Map<string, { file: string; source: CrewRole['source'] }>();
  for (const [dir, source] of [[paths.crew, 'shipped'], [paths.personalCrew, 'yours'], [rolesDir(), 'yours']] as const) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (f.endsWith('.md')) files.set(f.slice(0, -3), { file: join(dir, f), source });
  }
  return [...files]
    .map(([id, { file, source }]) => parseCrewFile(id, readFileSync(file, 'utf8'), source))
    .sort((a, b) => (a.id === 'conductor' ? -1 : b.id === 'conductor' ? 1 : a.id.localeCompare(b.id)));
}

export const getCrew = (id?: string | null) => (id ? listCrew().find((r) => r.id === id) : undefined);

export const PROTECTED_ROLES = ['conductor', 'ticket'];
export const ROLE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export interface RoleInput {
  name: string;
  description: string;
  model?: string;
  skills: string[];
  stages: number[];
  charter: string;
}

export function saveRole(id: string, input: RoleInput, keep?: CrewRole) {
  const meta: Record<string, unknown> = {
    name: input.name,
    description: input.description,
    model: input.model || keep?.model || 'auto',
    ...(keep?.harness && { harness: keep.harness }),
    ...(keep?.effort && { effort: keep.effort }),
    ...(keep?.channel && { channel: keep.channel }),
    ...(keep?.mcp.length && { mcp: keep.mcp }),
    skills: input.skills,
    stages: input.stages,
  };
  mkdirSync(rolesDir(), { recursive: true });
  writeFileSync(join(rolesDir(), `${id}.md`), `---\n${YAML.stringify(meta).trim()}\n---\n${input.charter.trim()}\n`);
  return getCrew(id)!;
}

export function deleteRole(id: string) {
  const file = join(rolesDir(), `${id}.md`);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}
