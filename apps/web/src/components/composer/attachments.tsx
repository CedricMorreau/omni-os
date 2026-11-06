import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent } from 'react';
import { bytes } from '@omni/shared/format.ts';
import { useApp } from '../../store.tsx';
import { Icon, IconButton } from '../ui.tsx';



// ---------- attachments ----------

const MAX_ATTACHMENTS = 10;
const isImage = (f: File) => f.type.startsWith('image/');
const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
const PASTE_LINES = 10;
const PASTE_CHARS = 1000;
const pasted = new WeakMap<File, number>();
export const pastedLines = (f: File) => pasted.get(f);

/** Files staged for the next message: paperclip, drag-and-drop and paste all land here. */
export function useAttachments() {
  const { status } = useApp();
  const maxMb = status?.maxUploadMb ?? 25;
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0); // dragenter/leave also fire for children, so count them
  const pastes = useRef(0);

  const add = useCallback(
    async (incoming: File[]) => {
      if (!incoming.length) return;
      const limit = maxMb * 1024 * 1024;
      // macOS deletes the temporary file of a dragged screenshot thumbnail soon after the drop. Read the file now.
      const read = await Promise.all(
        incoming.map((f) => (f.size > limit || pasted.has(f) ? f : f.arrayBuffer().then((b) => new File([b], f.name, { type: f.type, lastModified: f.lastModified }), () => null))),
      );
      const unread = incoming.filter((_, i) => !read[i]);
      const kept = read.filter((f): f is File => !!f);
      const tooBig = kept.filter((f) => f.size > limit);
      const ok = kept.filter((f) => f.size <= limit && f.size > 0);
      setFiles((prev) => {
        const next = [...prev];
        for (const f of ok) if (!next.some((x) => sameFile(x, f))) next.push(f);
        if (next.length > MAX_ATTACHMENTS) {
          setError(`At most ${MAX_ATTACHMENTS} files per message.`);
          return next.slice(0, MAX_ATTACHMENTS);
        }
        return next;
      });
      const names = (fs: File[]) => fs.map((f) => `"${f.name}"`).join(', ');
      const problems = [
        unread.length ? `Omni could not read ${names(unread)}. Drag it in again, or paste it.` : '',
        tooBig.length ? `${names(tooBig)} ${tooBig.length > 1 ? 'are' : 'is'} over the ${maxMb} MB limit.` : '',
      ].filter(Boolean);
      setError(problems.length ? problems.join(' ') : null);
    },
    [maxMb],
  );

  const remove = (f: File) => setFiles((prev) => prev.filter((x) => x !== f));
  const clear = () => {
    pastes.current = 0;
    setFiles([]);
    setError(null);
  };

  const onPaste = (e: ReactClipboardEvent) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      void add(files);
      return;
    }
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const lines = text.split('\n').length;
    if (lines <= PASTE_LINES && text.length <= PASTE_CHARS) return;
    e.preventDefault();
    const file = new File([text], `Pasted text ${++pastes.current}.txt`, { type: 'text/plain' });
    pasted.set(file, lines);
    void add([file]);
  };

  const dropZone = {
    onDragEnter: (e: ReactDragEvent) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    },
    onDragOver: (e: ReactDragEvent) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: ReactDragEvent) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      if (--depth.current <= 0) {
        depth.current = 0;
        setOver(false);
      }
    },
    onDrop: (e: ReactDragEvent) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      void add([...e.dataTransfer.files]);
    },
  };

  return { files, error, setError, add, remove, clear, over, onPaste, dropZone };
}

const DROP_EVENTS = { dragenter: 'onDragEnter', dragover: 'onDragOver', dragleave: 'onDragLeave', drop: 'onDrop' } as const;

export function useWindowDrop(zone: ReturnType<typeof useAttachments>['dropZone']) {
  const latest = useRef(zone);
  latest.current = zone;
  useEffect(() => {
    const handlers = Object.entries(DROP_EVENTS).map(([type, name]) => [type, (e: Event) => latest.current[name](e as unknown as ReactDragEvent)] as const);
    for (const [type, h] of handlers) window.addEventListener(type, h);
    return () => {
      for (const [type, h] of handlers) window.removeEventListener(type, h);
    };
  }, []);
}

function Thumb({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover shadow-[inset_0_0_0_1px_var(--line)]" />;
}

/** Staged attachments, above the input, each removable until the message is sent. */
export function AttachmentStrip({ files, onRemove }: { files: File[]; onRemove: (f: File) => void }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-3 pb-0.5">
      {files.map((f, i) => (
        <span key={`${f.name}:${f.size}:${i}`} className="flex h-11 max-w-[15rem] items-center gap-2 rounded-2xl bg-surface-2 pr-1 pl-1 text-[12.5px]">
          {isImage(f) ? (
            <Thumb file={f} />
          ) : (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-bg text-fg-3">
              <Icon name="file" size={15} />
            </span>
          )}
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate font-medium text-fg-2">{pasted.has(f) ? f.name.replace(/\.txt$/, '') : f.name}</span>
            <span className="block font-num text-[10.5px] text-fg-4">{pasted.has(f) ? `${pasted.get(f)} lines` : bytes(f.size)}</span>
          </span>
          <IconButton icon="x" label={`Remove ${f.name}`} size={13} className="h-6 w-6" onClick={() => onRemove(f)} />
        </span>
      ))}
    </div>
  );
}

export function AttachButton({ onPick, disabled }: { onPick: (files: File[]) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onPick([...(e.target.files ?? [])]);
          e.target.value = ''; // so picking the same file twice still fires
        }}
      />
      <IconButton icon="paperclip" label="Attach files" size={15} disabled={disabled} onClick={() => ref.current?.click()} />
    </>
  );
}
