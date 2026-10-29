import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { relTime } from '../format.ts';
import { href } from '../router.ts';
import { useNow } from '../store.tsx';
import { groupByStage, phaseColor, type TicketView } from '../ticket-route.ts';
import { StagePill } from './StagePill.tsx';
import { Chip } from './ui.tsx';

export function useChannelTickets(channelId: string, enabled: boolean, version: unknown) {
  const [tickets, setTickets] = useState<TicketView[]>([]);

  useEffect(() => setTickets([]), [channelId]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api
      .get<TicketView[]>(`/tickets?channel=${encodeURIComponent(channelId)}`)
      .then((list) => alive && setTickets(list))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [channelId, enabled, version]);

  return enabled ? tickets : [];
}

export function TicketGroups({ tickets }: { tickets: TicketView[] }) {
  useNow(60_000);
  const sections = groupByStage(tickets);
  if (!sections.length) return null;
  return (
    <div className="space-y-4">
      {sections.map((s) => (
        <section key={s.stage} aria-labelledby={`tickets-stage-${s.stage}`}>
          <h3 id={`tickets-stage-${s.stage}`} className="caption sticky top-0 z-[2] flex items-center gap-2 bg-bg px-3.5 py-2" style={{ color: phaseColor(s.phase) }}>
            {s.label}
            <span className="text-fg-4/70">{s.items.length}</span>
          </h3>
          {s.items.map((t) => (
            <a key={t.thread_id} href={href.thread(t.thread_id)} className="hov group flex min-w-0 items-center gap-2 rounded-[18px] px-3 py-3 [--hov:var(--surface)] md:px-3.5">
              <span className="min-w-0 truncate text-[14px] text-fg-2 group-hover:text-fg">{t.title}</span>
              <Chip tone="outline" className="font-num">
                {t.ref}
              </Chip>
              <StagePill ticket={t} />
              <span className="ml-auto shrink-0 pl-2 font-num text-[11px] text-fg-4 tabular-nums">{relTime(t.updated_at)}</span>
            </a>
          ))}
        </section>
      ))}
    </div>
  );
}
