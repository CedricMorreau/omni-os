// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../src/store.tsx', () => ({ useApp: () => ({ status: { maxUploadMb: 25 } }) }));
import { useAttachments } from '../src/components/composer/attachments.tsx';

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
