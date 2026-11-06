// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../src/store.tsx', () => ({ useApp: () => ({ status: { maxUploadMb: 25 } }) }));
import { pastedLines, useAttachments } from '../src/components/composer/attachments.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class Vanishing extends File {
  gone = false;
  override arrayBuffer() {
    return this.gone ? Promise.reject(new DOMException('The file is gone', 'NotReadableError')) : super.arrayBuffer();
  }
}

function mount() {
  const ref: { current: ReturnType<typeof useAttachments> | null } = { current: null };
  const Probe = () => ((ref.current = useAttachments()), null);
  act(() => createRoot(document.createElement('div')).render(createElement(Probe)));
  return ref;
}

it('keeps a dropped file after macOS deletes its temporary copy', async () => {
  const a = mount();
  const shot = new Vanishing(['png bytes'], 'Screenshot.png', { type: 'image/png' });
  await act(async () => a.current!.add([shot]));
  shot.gone = true;
  const [staged] = a.current!.files;
  expect(staged.name).toBe('Screenshot.png');
  expect(staged.type).toBe('image/png');
  expect(await new Response(await staged.arrayBuffer()).text()).toBe('png bytes');
});

it('says so when it cannot read a dropped file', async () => {
  const a = mount();
  const shot = new Vanishing(['png bytes'], 'Screenshot.png', { type: 'image/png' });
  shot.gone = true;
  await act(async () => a.current!.add([shot]));
  expect(a.current!.files).toHaveLength(0);
  expect(a.current!.error).toBe('Omni could not read "Screenshot.png". Drag it in again, or paste it.');
});

const paste = (text: string) => {
  const e = { clipboardData: { files: [], getData: () => text }, preventDefault: vi.fn() };
  return e as unknown as Parameters<ReturnType<typeof useAttachments>['onPaste']>[0] & { preventDefault: ReturnType<typeof vi.fn> };
};

it('turns a long text paste into a numbered attachment', async () => {
  const a = mount();
  const code = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
  const first = paste(code);
  await act(async () => a.current!.onPaste(first));
  await act(async () => a.current!.onPaste(paste(code + '\nmore')));
  expect(first.preventDefault).toHaveBeenCalled();
  expect(a.current!.files.map((f) => f.name)).toEqual(['Pasted text 1.txt', 'Pasted text 2.txt']);
  expect(await a.current!.files[0].text()).toBe(code);
  expect(pastedLines(a.current!.files[0])).toBe(40);
});

it('leaves a short text paste in the text field', async () => {
  const a = mount();
  const e = paste('a short line');
  await act(async () => a.current!.onPaste(e));
  expect(e.preventDefault).not.toHaveBeenCalled();
  expect(a.current!.files).toHaveLength(0);
});
