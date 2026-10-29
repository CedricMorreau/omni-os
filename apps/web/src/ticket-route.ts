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
