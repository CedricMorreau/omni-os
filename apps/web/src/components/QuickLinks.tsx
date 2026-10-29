import { useState, type FormEvent } from 'react';
import { api, errorText, type ChannelLink } from '../api.ts';
import { useApp } from '../store.tsx';
import { Button, ErrorNote, Icon, IconButton } from './ui.tsx';

const MAX_LINKS = 20;
const blank = (): ChannelLink => ({ label: '', url: '' });

export function QuickLinks({ channelId, links, editable, pillClassName }: { channelId: string; links: ChannelLink[]; editable: boolean; pillClassName: string }) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      {links.map((link, i) => (
        <a key={`${i}-${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer" className={pillClassName}>
          <Icon name="globe" size={13} className="text-fg-3" /> <span className="truncate">{link.label}</span>
        </a>
      ))}
      {editable && !editing && (
        <button
          type="button"
          className={pillClassName}
          onClick={() => setEditing(true)}
          title={links.length ? 'Edit quick links' : 'Add a quick link'}
          aria-label={links.length ? 'Edit quick links' : 'Add a quick link'}
        >
          <Icon name={links.length ? 'pencil' : 'plus'} size={12} className="text-fg-3" />
          {!links.length && <span className="text-fg-3">Add link</span>}
        </button>
      )}
      {editing && <QuickLinksEditor channelId={channelId} start={links} onDone={() => setEditing(false)} />}
    </>
  );
}

function QuickLinksEditor({ channelId, start, onDone }: { channelId: string; start: ChannelLink[]; onDone: () => void }) {
  const { reloadChannels } = useApp();
  const [rows, setRows] = useState<ChannelLink[]>(start.length ? start : [blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (i: number, key: keyof ChannelLink, value: string) => setRows((r) => r.map((row, j) => (j === i ? { ...row, [key]: value } : row)));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const links = rows.map((r) => ({ label: r.label.trim(), url: r.url.trim() })).filter((r) => r.label || r.url);
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/channels/${encodeURIComponent(channelId)}`, { links });
      await reloadChannels();
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="mt-1 flex basis-full flex-col gap-2 rounded-lg bg-surface p-3" aria-label="Quick links">
      <span className="text-[13px] font-medium text-fg">Quick links</span>
      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <input
            id={`ql-${channelId}-label-${i}`}
            className="field min-w-0 flex-[1_1_8rem]"
            value={row.label}
            onChange={(e) => set(i, 'label', e.target.value)}
            placeholder="Productive"
            aria-label={`Link ${i + 1} name`}
            autoFocus={i === rows.length - 1 && !row.label}
          />
          <input
            id={`ql-${channelId}-url-${i}`}
            className="field min-w-0 flex-[3_1_14rem] font-mono !text-[13px]"
            value={row.url}
            onChange={(e) => set(i, 'url', e.target.value)}
            placeholder="https://"
            inputMode="url"
            aria-label={`Link ${i + 1} address`}
          />
          <IconButton icon="trash" size={14} label={`Remove link ${i + 1}`} onClick={() => setRows((r) => r.filter((_, j) => j !== i))} />
        </div>
      ))}
      <div>
        <Button size="sm" variant="ghost" icon="plus" onClick={() => setRows((r) => [...r, blank()])} disabled={rows.length >= MAX_LINKS}>
          Add link
        </Button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={busy}>
          Save
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
