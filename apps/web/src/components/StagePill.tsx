import type { CSSProperties } from 'react';
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
