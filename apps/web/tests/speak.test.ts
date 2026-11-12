import { expect, it } from 'vitest';
import { speakable } from '../src/speak.ts';

it('reads the words of a markdown message, not its marks or code', () => {
  const md = '## Done\n\nI fixed **the cart** in `cart.ts`. See [the PR](https://example.com/pr/1).\n\n```ts\nconst a = 1;\n```\n\n- one\n- two';
  expect(speakable(md)).toBe('Done\n\nI fixed the cart in cart.ts. See the PR.\n\nCode block.\n\none\ntwo');
});
