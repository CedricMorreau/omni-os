import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { autoOpenProposal, proposalSeenKey, proposalStamp, togglePanel, type TicketPanel, type TicketView } from '../../ticket-route.ts';
import { useDismissable } from '../ui/use-dismissable.ts';
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
  onClose,
  header,
  mobile = false,
}: {
  ticket: TicketView | null;
  onTicket: (t: TicketView) => void;
  open: boolean;
  onClose: () => void;
  header: RefObject<HTMLElement | null>;
  mobile?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const el = header.current;
    if (!el) return;
    setTop(el.offsetHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setTop(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [header, ticket?.thread_id]);
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

  return (
    <div className="pointer-events-none absolute inset-0 z-[7] overflow-hidden">
      <div
        ref={box}
        style={{ paddingTop: top }}
        className={`absolute inset-x-0 top-0 flex max-h-full flex-col transition-transform duration-300 [transition-timing-function:var(--ease-out)] motion-reduce:transition-none ${open ? 'translate-y-0' : '-translate-y-full'}`}
      >
        <div
          id={panelId}
          role={open ? 'dialog' : undefined}
          aria-label={`Ticket ${ticket.ref} route`}
          aria-hidden={!open}
          inert={!open}
          className={`scroll-thin min-h-0 overflow-y-auto ${mobile ? 'px-3 pt-2 pb-4' : 'px-4 pt-2.5 pb-5 md:px-6'}`}
        >
          <div className="pointer-events-auto mx-auto max-w-4xl rounded-[18px] shadow-[var(--shadow-panel)]">
            <RouteCard ticket={ticket} onTicket={onTicket} className="rounded-[18px]! border border-line-strong" />
          </div>
        </div>
      </div>
    </div>
  );
}
