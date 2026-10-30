import { useCallback, useEffect, useRef, useState } from 'react';
import { autoOpenProposal, proposalSeenKey, proposalStamp, togglePanel, type TicketPanel, type TicketView } from '../../ticket-route.ts';
import { StagePill } from '../StagePill.tsx';
import { useDismissable } from '../ui/use-dismissable.ts';
import { Icon, StatusDot } from '../ui.tsx';
import { RouteCard } from './RouteCard.tsx';

function readStamp(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStamp(key: string, stamp: string) {
  try {
    sessionStorage.setItem(key, stamp);
  } catch {
    return;
  }
}

export function useTicketPanels(ticket: TicketView | null) {
  const threadId = ticket?.thread_id ?? '';
  const proposal = ticket?.route_proposal ?? null;
  const stamp = proposal ? proposalStamp(proposal) : null;
  const latest = useRef(proposal);
  latest.current = proposal;
  const [open, setOpen] = useState<TicketPanel>(null);

  useEffect(() => setOpen(null), [threadId]);

  useEffect(() => {
    const key = proposalSeenKey(threadId);
    if (!threadId || !stamp || !autoOpenProposal(latest.current, readStamp(key))) return;
    writeStamp(key, stamp);
    setOpen('route');
  }, [threadId, stamp]);

  const toggle = useCallback((which: Exclude<TicketPanel, null>) => setOpen((o) => togglePanel(o, which)), []);
  const close = useCallback(() => setOpen(null), []);
  const closeDraft = useCallback(() => setOpen((o) => (o === 'draft' ? null : o)), []);
  const closeRoute = useCallback(() => setOpen((o) => (o === 'route' ? null : o)), []);
  return { open, toggle, close, closeDraft, closeRoute };
}

export function RoutePanel({
  ticket,
  onTicket,
  open,
  onToggle,
  onClose,
  mobile = false,
}: {
  ticket: TicketView | null;
  onTicket: (t: TicketView) => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  mobile?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useDismissable(open, onClose, { outside: false });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (box.current?.contains(el) || el?.closest('[data-route-toggle]')) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onClose]);

  if (!ticket) return null;
  const panelId = `route-panel-${ticket.thread_id}`;
  const waiting = !!ticket.route_proposal;

  return (
    <div className="pointer-events-none absolute inset-0 z-[7] overflow-hidden">
      <div
        ref={box}
        className={`absolute inset-x-0 top-0 max-h-[calc(100%-2.5rem)] transition-transform duration-300 [transition-timing-function:var(--ease-out)] motion-reduce:transition-none ${open ? 'translate-y-0' : '-translate-y-full'}`}
      >
        <div
          id={panelId}
          role={open ? 'dialog' : undefined}
          aria-label={`Ticket ${ticket.ref} route`}
          aria-hidden={!open}
          inert={!open}
          className={`scroll-thin pointer-events-auto max-h-full overflow-y-auto ${mobile ? 'px-3 pt-1 pb-2' : 'px-4 pt-1 pb-2 md:px-6'}`}
        >
          <RouteCard ticket={ticket} onTicket={onTicket} className="mx-auto max-w-4xl shadow-[var(--shadow-menu)]" />
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`Ticket ${ticket.ref} route${waiting ? ', a proposed route waits for you' : ''}`}
          className={`pointer-events-auto absolute top-full left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-b-xl border border-t-0 border-line bg-surface text-fg-2 shadow-[var(--shadow-card)] whitespace-nowrap hover:text-fg ${mobile ? 'h-7 px-2.5 text-[11.5px]' : 'h-8 px-3 text-[12px]'}`}
        >
          {waiting && <StatusDot status="needs" size={7} />}
          <span className="font-num font-medium text-fg">{ticket.ref}</span>
          <span className="text-fg-4">·</span>
          <StagePill ticket={ticket} />
          <Icon name="chevronDown" size={13} className={`text-fg-3 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </div>
  );
}
