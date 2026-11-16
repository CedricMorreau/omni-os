import { expect, it } from 'vitest';
import { stealthArgs } from '../browser-page.ts';

const BLINK = '--disable-blink-features=AutomationControlled';

it('hides the automation flag and the headless user agent from bot checks', () => {
  expect(stealthArgs('Google Chrome 157.0.7512.44 \n', 'darwin', true)).toEqual([
    BLINK,
    '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  ]);
  expect(stealthArgs('Chromium 150.0.1.2', 'linux', true)[1]).toContain('(X11; Linux x86_64)');
});

it('keeps the real user agent of a visible window, and of a Chrome whose version it cannot read', () => {
  expect(stealthArgs('Google Chrome 157.0.7512.44', 'darwin', false)).toEqual([BLINK]);
  expect(stealthArgs('', 'darwin', true)).toEqual([BLINK]);
});
