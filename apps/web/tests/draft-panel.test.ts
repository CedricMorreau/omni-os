// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { DraftPanel } from '../src/components/thread/DraftPanel.tsx';
import { draftLabel } from '../src/ticket-route.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div');
document.body.append(host);
const root = createRoot(host);
afterEach(() => act(() => root.render(null)));

it('labels a plain client message', () => {
  expect(draftLabel('message')).toBe('Message');
});

it('shows the draft of a thread without a ticket', () => {
  const noop = () => {};
  act(() => root.render(createElement(DraftPanel, { threadId: 't1', draft: { kind: 'message', text: 'Hi Acme' }, open: true, onToggle: noop, onClose: noop })));
  expect(host.querySelector('button[aria-label="Message"]')).not.toBeNull();
  expect(host.textContent).toContain('Hi Acme');
});
