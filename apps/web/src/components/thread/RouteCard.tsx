import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, errorText, type Thread } from '../../api.ts';
import { STAGES } from '../../roles.ts';
import { ALL_STAGES, canClose, draftLabel, initialTicks, phaseColor, routeMode, routeSummary, skipReason, stagePhase, stageState, toggleStage, type StageState, type TicketView } from '../../ticket-route.ts';
import { phaseStyle, StagePill } from '../StagePill.tsx';
import { Button, CopyButton, ErrorNote, StatusDot } from '../ui.tsx';

const ticketPath = (id: string) => `/tickets/${encodeURIComponent(id)}`;

export function useTicket(thread: Pick<Thread, 'id' | 'role' | 'status'> | null, version: number) {
  const [ticket, setTicket] = useState<TicketView | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const id = thread?.id ?? null;
  const enabled = !!thread && thread.role === 'ticket' && gone !== id;

  useEffect(() => setTicket(null), [id]);

  useEffect(() => {
    if (!enabled || !id) return;
    let alive = true;
    api
      .get<TicketView>(ticketPath(id))
      .then((t) => alive && setTicket(t))
      .catch((e) => {
        if (alive && e instanceof ApiError && e.status === 404) {
          setGone(id);
          setTicket(null);
        }
      });
    return () => {
      alive = false;
    };
  }, [enabled, id, thread?.status, version]);

  return [enabled ? ticket : null, setTicket] as const;
}

const CHIP: Record<StageState, string> = {
  done: 'bg-surface-2 text-fg-2',
  current: 'font-semibold',
  next: 'bg-bg text-fg-2 shadow-[inset_0_0_0_1px_var(--line-strong)]',
  off: 'text-fg-4 line-through decoration-fg-4',
};

const STATE_LABEL: Record<StageState, string> = { done: 'done', current: 'current stage', next: 'on the route', off: 'not on the route' };

function StageChips({ ticket }: { ticket: TicketView }) {
  return (
    <ol className="flex flex-wrap gap-1" aria-label="Route">
      {STAGES.map((name, i) => {
        const state = stageState(i + 1, ticket);
        const phase = stagePhase(i + 1);
        return (
          <li
            key={name}
            title={`${i + 1} ${name}: ${STATE_LABEL[state]}`}
            aria-current={state === 'current' ? 'step' : undefined}
            style={state === 'current' ? { ...phaseStyle(phase), boxShadow: `inset 0 0 0 1.5px ${phaseColor(phase)}` } : undefined}
            className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap ${CHIP[state]}`}
          >
            <span className="tabular-nums" style={state === 'off' ? undefined : { color: phaseColor(phase) }}>
              {i + 1}
            </span>
            {name}
            <span className="sr-only">, {STATE_LABEL[state]}</span>
          </li>
        );
      })}
    </ol>
  );
}

function RouteEditor({ ticket, proposal, onSaved, onCancel }: { ticket: TicketView; proposal: boolean; onSaved: (t: TicketView) => void; onCancel?: () => void }) {
  const [ticks, setTicks] = useState(() => initialTicks(ticket));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!ticks.length) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.post<TicketView>(`${ticketPath(ticket.thread_id)}/route`, { stages: ticks }));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <fieldset className="scroll-thin max-h-[45vh] overflow-y-auto">
        <legend className="sr-only">Stages on the route</legend>
        {ALL_STAGES.map((n) => {
          const id = `route-${ticket.thread_id}-stage-${n}`;
          const on = ticks.includes(n);
          const reason = !on ? skipReason(ticket, n) : null;
          return (
            <div key={n} className="flex items-start gap-2.5 py-1">
              <input id={id} type="checkbox" checked={on} disabled={busy} onChange={() => setTicks((t) => toggleStage(t, n))} className="mt-[3px] h-4 w-4 shrink-0 accent-[var(--fg)]" />
              <label htmlFor={id} className="min-w-0 flex-1 text-[13px] leading-[1.4]">
                <span className={on ? 'text-fg' : 'text-fg-3'}>
                  <span className="mr-1.5 tabular-nums text-fg-4">{n}</span>
                  {STAGES[n - 1]}
                </span>
                {reason && <span className="block text-[12px] text-fg-3 sm:ml-2 sm:inline">{reason}</span>}
              </label>
            </div>
          );
        })}
      </fieldset>
      {!ticks.length && <p className="text-[12px] text-fg-3">Tick at least one stage.</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" busy={busy} disabled={!ticks.length}>
          {proposal ? 'Confirm route' : 'Save route'}
        </Button>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <span className="ml-auto text-[12px] text-fg-3 tabular-nums">{routeSummary(ticks) ?? 'No stages'}</span>
      </div>
    </form>
  );
}

function DraftBox({ ticket }: { ticket: TicketView }) {
  if (!ticket.draft) return null;
  const id = `route-${ticket.thread_id}-draft`;
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-bg px-3 py-2 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex items-center gap-2">
        <span id={`${id}-label`} className="text-[12px] font-medium text-fg-2">
          {draftLabel(ticket.draft.kind)}
        </span>
        <CopyButton text={ticket.draft.text} className="-my-0.5 ml-auto" />
      </div>
      <div id={id} aria-labelledby={`${id}-label`} className="scroll-thin max-h-48 overflow-y-auto text-[13px] leading-[1.5] break-words whitespace-pre-wrap text-fg">
        {ticket.draft.text}
      </div>
    </div>
  );
}

function CloseTicket({ ticket, onClosed }: { ticket: TicketView; onClosed: (t: TicketView) => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = async () => {
    setBusy(true);
    setError(null);
    try {
      onClosed(await api.post<TicketView>(`${ticketPath(ticket.thread_id)}/close`, { by: 'user' }));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  if (!asking) {
    return (
      <div>
        <Button size="sm" variant="secondary" icon="archive" onClick={() => setAsking(true)}>
          Close ticket
        </Button>
      </div>
    );
  }
  return (
    <div role="group" aria-label="Close ticket" className="flex flex-col gap-2">
      <p className="text-[13px] text-fg">Close this ticket? Claude tidies its memory and archives the thread.</p>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="needs" busy={busy} onClick={() => void close()}>
          Close ticket
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsking(false)} autoFocus>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function RouteCard({ ticket, onTicket: setTicket, className = '' }: { ticket: TicketView | null; onTicket: (t: TicketView) => void; className?: string }) {
  const [editing, setEditing] = useState(false);

  useEffect(() => setEditing(false), [ticket?.thread_id]);

  if (!ticket) return null;
  const closed = !!ticket.closed_at;
  const mode = routeMode(ticket);
  const summary = routeSummary(ticket.route);
  const saved = (t: TicketView) => {
    setTicket(t);
    setEditing(false);
  };

  return (
    <section
      aria-label={`Ticket ${ticket.ref} route`}
      className={`flex flex-col gap-2 rounded-2xl px-3.5 py-2.5 ${mode === 'proposal' ? 'bg-surface shadow-[inset_0_0_0_1.5px_var(--needs)]' : 'bg-surface'} ${className}`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
        <span className="font-num font-medium text-fg">{ticket.ref}</span>
        {ticket.round > 1 && <span className="text-fg-3">Round {ticket.round}</span>}
        <StagePill ticket={ticket} />
        {summary && (
          <>
            <span className="text-fg-4">·</span>
            <span className="text-fg-3 tabular-nums">{summary}</span>
          </>
        )}
        {!closed && mode === 'route' && !editing && (
          <Button size="sm" variant="ghost" icon="pencil" className="ml-auto -my-1" onClick={() => setEditing(true)}>
            Edit route
          </Button>
        )}
      </div>
      <DraftBox ticket={ticket} />
      {!closed && mode === 'proposal' && (
        <>
          <div className="flex items-center gap-2 text-[13.5px] font-medium text-fg">
            <StatusDot status="needs" size={8} />
            Proposed route
          </div>
          <RouteEditor key={JSON.stringify(ticket.route_proposal)} ticket={ticket} proposal onSaved={saved} />
        </>
      )}
      {mode === 'route' && (editing && !closed ? <RouteEditor ticket={ticket} proposal={false} onSaved={saved} onCancel={() => setEditing(false)} /> : <StageChips ticket={ticket} />)}
      {!editing && canClose(ticket) && <CloseTicket key={ticket.thread_id} ticket={ticket} onClosed={setTicket} />}
      {!closed && mode === 'waiting' && <p className="text-[12.5px] text-fg-3">Claude is reading the ticket and will propose a route.</p>}
    </section>
  );
}
