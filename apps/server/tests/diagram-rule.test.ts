import { expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

const r = await startRunner();
const { buildSystemPrompt } = await import('../runner/prompts.ts');

it('asks every harness for a mermaid diagram with a plan or a flow', async () => {
  const t = await r.start('THINK:1');
  await r.untilResults(t.id, 1);
  const channel = r.db.channels.get('scratch')!;
  for (const harness of ['claude-code', 'codex', 'hermes']) {
    const prompt = buildSystemPrompt({ ...r.thread(t.id), harness } as any, channel);
    expect(prompt).toContain('add one `mermaid` diagram');
  }
});
