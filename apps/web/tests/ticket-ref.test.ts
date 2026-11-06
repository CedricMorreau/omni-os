// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { TicketRef } from '../src/components/StagePill.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div');
document.body.append(host);
const root = createRoot(host);
afterEach(() => act(() => root.render(null)));

const LINK = 'https://app.productive.io/1/projects/2/tasks/task/20706074';

it('opens a Productive ticket in Productive and leaves the row alone', () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const row = vi.fn();
  act(() => root.render(createElement('div', { onClick: row }, createElement(TicketRef, { ticket: { ref: '#20706074', source: 'productive', link: LINK } }))));
  const pill = host.querySelector('[role="link"]') as HTMLElement;
  expect(pill.getAttribute('aria-label')).toBe('Open #20706074 in Productive');
  act(() => pill.click());
  act(() => pill.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(open).toHaveBeenCalledTimes(2);
  expect(open).toHaveBeenCalledWith(LINK, '_blank', 'noopener,noreferrer');
  expect(row).not.toHaveBeenCalled();
});

it('keeps a plain pill for a local ticket', () => {
  act(() => root.render(createElement(TicketRef, { ticket: { ref: 'L-005', source: 'local', link: null } })));
  expect(host.querySelector('[role="link"]')).toBeNull();
  expect(host.textContent).toBe('L-005');
});
