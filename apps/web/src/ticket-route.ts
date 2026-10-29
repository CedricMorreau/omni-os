import type { TicketView } from '@omni/server/tickets.ts';
import { STAGES } from './roles.ts';

export type { TicketView };
export { toggleStage } from './roles.ts';

export type StageState = 'done' | 'current' | 'next' | 'off';

export const ALL_STAGES = STAGES.map((_, i) => i + 1);

export type RouteMode = 'proposal' | 'route' | 'waiting';

export function routeMode(t: Pick<TicketView, 'route' | 'route_proposal'>): RouteMode {
  if (t.route_proposal) return 'proposal';
  return t.route ? 'route' : 'waiting';
}

export function stageState(stage: number, t: Pick<TicketView, 'route' | 'stage'>): StageState {
  if (!t.route?.includes(stage)) return 'off';
  if (stage === t.stage) return 'current';
  return stage < t.stage ? 'done' : 'next';
}

export function routeSummary(route: number[] | null | undefined) {
  return route?.length ? `${route.length} of ${STAGES.length} stages` : null;
}

export function initialTicks(t: Pick<TicketView, 'route' | 'route_proposal'>) {
  return [...(t.route_proposal?.stages ?? t.route ?? ALL_STAGES)].sort((a, b) => a - b);
}

export function skipReason(t: Pick<TicketView, 'route_proposal'>, stage: number) {
  return t.route_proposal?.reasons[String(stage)]?.trim() || null;
}

const DRAFT_LABEL: Record<string, string> = { qa: 'QA note', answer: 'Client answer', closing: 'Closing comment' };

export const draftLabel = (kind: string | null | undefined) => (kind && DRAFT_LABEL[kind]) || 'Draft';

export function canClose(t: Pick<TicketView, 'closed_at' | 'route' | 'stage'>) {
  return !t.closed_at && !!t.route?.length && t.stage === t.route[t.route.length - 1];
}

export type Phase = 'intake' | 'plan' | 'build' | 'manual' | 'client' | 'deploy' | 'closing' | 'closed';

export function stagePhase(stage: number, closed = false): Phase {
  if (closed) return 'closed';
  if (stage === 1 || stage === 2) return 'plan';
  if (stage >= 3 && stage <= 5) return 'build';
  if (stage === 6) return 'manual';
  if (stage === 7 || stage === 8) return 'client';
  if (stage === 9) return 'deploy';
  if (stage === 10) return 'closing';
  return 'intake';
}

export const phaseColor = (phase: Phase) => `var(--phase-${phase})`;

export const stageLabel = (stage: number) => (stage >= 1 && stage <= STAGES.length ? `${stage} ${STAGES[stage - 1]}` : 'Intake');

export function stagePillText(t: Pick<TicketView, 'stage' | 'closed_at'>) {
  if (t.closed_at) return 'Closed';
  return t.stage >= 1 && t.stage <= STAGES.length ? `${t.stage} · ${STAGES[t.stage - 1]}` : 'Intake';
}

export type TicketRow = Pick<TicketView, 'thread_id' | 'ref' | 'title' | 'stage' | 'updated_at' | 'closed_at'>;

export interface StageSection<T extends TicketRow> {
  stage: number;
  label: string;
  phase: Phase;
  items: T[];
}

export function groupByStage<T extends TicketRow>(tickets: T[]): StageSection<T>[] {
  const open = tickets.filter((t) => !t.closed_at);
  return [0, ...ALL_STAGES].flatMap((stage) => {
    const items = open
      .filter((t) => (stage === 0 ? !(t.stage >= 1 && t.stage <= STAGES.length) : t.stage === stage))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return items.length ? [{ stage, label: stageLabel(stage), phase: stagePhase(stage), items }] : [];
  });
}

export function withoutTickets<T extends { id: string }>(threads: T[], tickets: Pick<TicketView, 'thread_id'>[]) {
  const ids = new Set(tickets.map((t) => t.thread_id));
  return threads.filter((t) => !ids.has(t.id));
}

export function defaultRoleFor(channel: { id: string; kind?: string } | undefined, roles: { id: string }[]) {
  const has = (id: string) => roles.some((r) => r.id === id);
  if (channel?.id === 'conductor') return has('conductor') ? 'conductor' : '';
  if (channel?.kind === 'client') return has('ticket') ? 'ticket' : '';
  return '';
}
