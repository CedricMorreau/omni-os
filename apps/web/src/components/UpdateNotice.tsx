import { useEffect, useState } from 'react';
import { api, errorText, useApi, type UpdateView } from '../api.ts';
import { useFeed } from '../store.tsx';
import { clearUpdateMark, markUpdateStarted, reloadAfterUpdate, updateNotice } from '../update-notice.ts';
import { Loader } from './brand.tsx';
import { Button, Icon } from './ui.tsx';

/** GET /api/update, fresh on every update and reconnect message. Reloads the page once an Update it started lands. */
function useUpdate() {
  const res = useApi<UpdateView>('/update');
  const { data, reload, setData } = res;
  useFeed((e) => {
    if (e.type === 'update' || e.type === 'reconnect') reload();
  });
  useEffect(() => {
    if (data && reloadAfterUpdate(sessionStorage, data)) window.location.reload();
  }, [data]);
  return { data, reload, setData };
}

/**
 * New commits on main, and the one Update button: it waits for running turns, updates the checkout, rebuilds and
 * restarts the server. Shown in the desktop sidebar and on the phone's Activity screen. Nothing when level.
 */
export function UpdateNotice({ className = '' }: { className?: string }) {
  const { data, setData } = useUpdate();
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const notice = updateNotice(data);
  if (!notice) return null;

  const act = async () => {
    if (!data || !notice.action) return;
    setError(null);
    setPosting(true);
    try {
      if (notice.action === 'update') {
        markUpdateStarted(sessionStorage, data.current);
        setData(await api.post<UpdateView>('/update'));
      } else if (notice.action === 'cancel') {
        clearUpdateMark(sessionStorage);
        await api.post('/update/cancel');
      } else {
        setData(await api.post<UpdateView>('/update/dismiss'));
      }
    } catch (e) {
      if (notice.action === 'update') clearUpdateMark(sessionStorage);
      setError(errorText(e));
    } finally {
      setPosting(false);
    }
  };

  const label = notice.action === 'update' ? 'Update' : notice.action === 'cancel' ? 'Cancel' : 'Dismiss';
  return (
    <div className={`rounded-[20px] bg-bg/70 px-3 py-2.5 shadow-[var(--shadow-card)] ${className}`} role="status">
      <div className="flex items-center gap-2">
        <span className={`shrink-0 text-fg-3`}>
          {notice.busy ? <Loader size={14} /> : <Icon name={notice.failed ? 'alert' : 'download'} size={14} />}
        </span>
        <span className="min-w-0 flex-1 text-[12px] leading-[1.35] text-fg" title={notice.detail ?? undefined}>
          {notice.text}
        </span>
        {notice.action && (
          <Button size="sm" variant={notice.action === 'update' ? 'primary' : 'ghost'} busy={posting} onClick={() => void act()}>
            {label}
          </Button>
        )}
      </div>
      {notice.detail && notice.action === 'update' && (
        <details className="mt-1.5 text-[11px] text-fg-3">
          <summary className="cursor-pointer select-none">What is new</summary>
          <ul className="mt-1 space-y-0.5 pl-1">
            {notice.detail.split('\n').map((line, i) => (
              <li key={i} className="truncate" title={line}>
                {line}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <div className="mt-1.5 text-[11px] text-fg-2">{error}</div>}
    </div>
  );
}
