import { describe, expect, it } from 'vitest';
import { handoverNote, switchText, type RunName, type SwitchP } from '../run-switch.ts';

const opus: RunName = { harness: 'claude-code', model: 'opus', effort: '', harnessName: 'Claude Code', modelLabel: 'Opus 4.7' };
const codex: RunName = { harness: 'codex', model: 'gpt-5.5', effort: '', harnessName: 'Codex', modelLabel: 'GPT-5.5' };
const sw = (from: RunName, to: RunName, mode: SwitchP['mode']): SwitchP => ({ from, to, mode });

describe('switch rows', () => {
  it('names only what changed on the same harness', () => {
    expect(switchText(sw(opus, { ...opus, effort: 'high' }, 'settings'))).toBe('Switched to effort high');
    expect(switchText(sw(opus, { ...opus, model: 'sonnet', modelLabel: 'Sonnet 4.6' }, 'settings'))).toBe('Switched to Sonnet 4.6, default effort');
  });

  it('names the harness when a thread that never ran moves to another one', () => {
    expect(switchText(sw(opus, codex, 'settings'))).toBe('Switched to Codex (GPT-5.5), default effort');
  });

  it('says a handover is waiting, then how much it carried', () => {
    const p = sw(opus, codex, 'handover');
    expect(switchText(p)).toBe('Handing over from Claude Code (Opus 4.7) to Codex (GPT-5.5)');
    expect(handoverNote(p, null, false)).toBe('Codex reads the thread so far with your next message.');
    expect(handoverNote(p, { to: codex, session: 'fresh', entries: 12, omitted: 3, chars: 9000 }, false)).toBe(
      'Handover complete. Codex read 12 entries into a new session, 3 older left out.',
    );
    expect(handoverNote(p, null, true)).toBe('Replaced by a later switch.');
    expect(handoverNote(sw(opus, codex, 'back'), null, false)).toBeNull();
  });
});
