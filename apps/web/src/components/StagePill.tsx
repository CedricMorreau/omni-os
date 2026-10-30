import type { CSSProperties } from 'react';
import { Icon, StatusDot } from './ui.tsx';
import { phaseColor, stagePhase, stagePillText, type Phase, type TicketView } from '../ticket-route.ts';

export const phaseStyle = (phase: Phase): CSSProperties => ({
  color: phaseColor(phase),
  backgroundColor: `color-mix(in srgb, ${phaseColor(phase)} 14%, transparent)`,
});

export function StagePill({ ticket, className = '' }: { ticket: Pick<TicketView, 'stage' | 'closed_at'>; className?: string }) {
  return (
    <span
      style={phaseStyle(stagePhase(ticket.stage, !!ticket.closed_at))}
      className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] leading-none font-medium whitespace-nowrap tabular-nums ${className}`}
    >
      {stagePillText(ticket)}
    </span>
  );
}

export function StagePillButton({ ticket, expanded, onClick }: { ticket: Pick<TicketView, 'thread_id' | 'stage' | 'closed_at' | 'route_proposal'>; expanded: boolean; onClick: () => void }) {
  const text = stagePillText(ticket);
  const waiting = !!ticket.route_proposal;
  return (
    <button
      type="button"
      data-route-toggle
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={`route-panel-${ticket.thread_id}`}
      aria-label={`${text}. ${expanded ? 'Hide stages' : 'Show stages'}${waiting ? '. A proposed route waits for you.' : ''}`}
      title={expanded ? 'Hide stages' : 'Show stages'}
      style={phaseStyle(stagePhase(ticket.stage, !!ticket.closed_at))}
      className="press inline-flex h-6 shrink-0 items-center gap-1 rounded-full pr-2 pl-2.5 text-[11.5px] leading-none font-medium whitespace-nowrap tabular-nums transition-[filter,box-shadow] hover:shadow-[inset_0_0_0_1px_currentColor] hover:brightness-110 focus-visible:shadow-[inset_0_0_0_1.5px_currentColor]"
    >
      {waiting && <StatusDot status="needs" size={7} />}
      {text}
      <Icon name="chevronDown" size={12} className={`transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
    </button>
  );
}
