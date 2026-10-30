import type { CSSProperties } from 'react';
import { Icon } from './ui.tsx';
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

export function StagePillButton({ ticket, expanded, onClick }: { ticket: Pick<TicketView, 'stage' | 'closed_at'>; expanded: boolean; onClick: () => void }) {
  const text = stagePillText(ticket);
  return (
    <button
      type="button"
      data-route-toggle
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={`${text}. ${expanded ? 'Hide stages' : 'Show stages'}`}
      title={expanded ? 'Hide stages' : 'Show stages'}
      style={phaseStyle(stagePhase(ticket.stage, !!ticket.closed_at))}
      className="press inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full pr-1.5 pl-2 text-[11px] leading-none font-medium whitespace-nowrap tabular-nums transition-[filter,box-shadow] hover:shadow-[inset_0_0_0_1px_currentColor] hover:brightness-110 focus-visible:shadow-[inset_0_0_0_1.5px_currentColor]"
    >
      {text}
      <Icon name="chevronDown" size={11} className={`transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
    </button>
  );
}
