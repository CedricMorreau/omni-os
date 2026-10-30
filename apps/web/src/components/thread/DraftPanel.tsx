import { useEffect, useState } from 'react';
import { draftLabel, draftSeenKey, draftStamp, draftUnseen, type TicketView } from '../../ticket-route.ts';
import { useDismissable } from '../ui/use-dismissable.ts';
import { CopyButton, Icon, IconButton } from '../ui.tsx';

function readSeen(threadId: string) {
  try {
    return sessionStorage.getItem(draftSeenKey(threadId));
  } catch {
    return null;
  }
}

function writeSeen(threadId: string, stamp: string) {
  try {
    sessionStorage.setItem(draftSeenKey(threadId), stamp);
  } catch {
    return;
  }
}

export function DraftPanel({ ticket, open, onToggle, onClose, mobile = false }: { ticket: TicketView | null; open: boolean; onToggle: () => void; onClose: () => void; mobile?: boolean }) {
  const threadId = ticket?.thread_id ?? '';
  const draft = ticket?.draft ?? null;
  const [seen, setSeen] = useState<string | null>(null);

  useEffect(() => {
    setSeen(threadId ? readSeen(threadId) : null);
  }, [threadId]);

  useEffect(() => {
    if (!open || !draft) return;
    const stamp = draftStamp(draft);
    writeSeen(threadId, stamp);
    setSeen(stamp);
  }, [open, draft, threadId]);

  useEffect(() => {
    if (!draft && open) onClose();
  }, [draft, open, onClose]);

  useDismissable(open, onClose, { outside: false });

  if (!ticket || !draft) return null;
  const label = draftLabel(draft.kind);
  const unseen = !open && draftUnseen(draft, seen);
  const panelId = `draft-panel-${threadId}`;

  const tab = (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={unseen ? `${label}, changed` : label}
      title={label}
      className={`pointer-events-auto absolute top-1/2 right-full flex -translate-y-1/2 flex-col items-center gap-2 rounded-l-lg border border-r-0 border-line-strong bg-surface text-fg-2 shadow-[var(--shadow-panel)] hover:text-fg ${mobile ? 'w-7 px-1 py-2.5' : 'w-9 px-1.5 py-3'}`}
    >
      <Icon name="file" size={mobile ? 13 : 15} />
      <span className={`font-medium whitespace-nowrap [writing-mode:vertical-rl] rotate-180 ${mobile ? 'text-[11px]' : 'text-[12px]'}`}>{label}</span>
      {unseen && <span data-testid="draft-unseen" className="h-2 w-2 shrink-0 rounded-full bg-live" />}
    </button>
  );

  return (
    <div
      className={
        mobile
          ? 'pointer-events-none fixed inset-0 z-40 overflow-hidden'
          : 'pointer-events-none absolute inset-y-0 right-0 z-[6] w-[min(436px,100%)] overflow-hidden'
      }
    >
      <div
        className={`absolute inset-y-0 right-0 transition-transform duration-300 [transition-timing-function:var(--ease-out)] motion-reduce:transition-none ${
          mobile ? 'w-full' : 'w-[calc(100%-3.5rem)]'
        } ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {!(mobile && open) && tab}
        <section
          id={panelId}
          role={open ? 'dialog' : undefined}
          aria-label={label}
          aria-hidden={!open}
          inert={!open}
          className={`pointer-events-auto flex h-full flex-col bg-bg ${mobile ? '' : 'rounded-l-[18px] border border-r-0 border-line-strong shadow-[var(--shadow-panel)]'}`}
          style={
            mobile
              ? {
                  paddingTop: 'env(safe-area-inset-top)',
                  paddingRight: 'env(safe-area-inset-right)',
                  paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
                  paddingLeft: 'env(safe-area-inset-left)',
                }
              : undefined
          }
        >
          <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-2">
            <Icon name="file" size={15} className="text-fg-3" />
            <h2 className="min-w-0 flex-1 truncate text-[14px] font-medium text-fg">{label}</h2>
            <span className="text-[12px] text-fg-4 font-num">{ticket.ref}</span>
            <IconButton icon="x" label={`Close ${label.toLowerCase()}`} onClick={onClose} />
          </div>
          <div id={`${panelId}-text`} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-3 text-[14px] leading-[1.55] break-words whitespace-pre-wrap text-fg">
            {draft.text}
          </div>
          <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 pt-3 pb-1">
            <CopyButton text={draft.text} />
          </div>
        </section>
      </div>
    </div>
  );
}
