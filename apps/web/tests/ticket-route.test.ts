import { describe, expect, it } from 'vitest';
import { ALL_STAGES, canClose, defaultRoleFor, draftLabel, draftSeenKey, draftStamp, draftUnseen, groupByStage, initialTicks, phaseColor, stageLabel, stagePhase, stagePillText, withoutTickets, routeMode, routeSummary, skipReason, stageState, toggleStage } from '../src/ticket-route.ts';

const proposal = { stages: [3, 4, 9, 10], reasons: { '1': 'tiny copy fix', '2': ' no plan needed ' } };

describe('routeMode', () => {
  it('shows the proposal first, then the route, else waits for intake', () => {
    expect(routeMode({ route: null, route_proposal: proposal })).toBe('proposal');
    expect(routeMode({ route: [3, 4], route_proposal: proposal })).toBe('proposal');
    expect(routeMode({ route: [3, 4], route_proposal: null })).toBe('route');
    expect(routeMode({ route: null, route_proposal: null })).toBe('waiting');
  });
});

describe('stageState', () => {
  const t = { route: [3, 4, 5, 9, 10], stage: 5 };
  it('marks stages before the current one as done and later ones as next', () => {
    expect(stageState(3, t)).toBe('done');
    expect(stageState(4, t)).toBe('done');
    expect(stageState(5, t)).toBe('current');
    expect(stageState(9, t)).toBe('next');
  });

  it('marks stages off the route, before or after the current one', () => {
    expect(stageState(1, t)).toBe('off');
    expect(stageState(7, t)).toBe('off');
    expect(stageState(3, { route: null, stage: 0 })).toBe('off');
  });
});

describe('routeSummary', () => {
  it('counts the stages on the route', () => {
    expect(routeSummary([3, 4, 5, 9, 10])).toBe('5 of 10 stages');
    expect(routeSummary(ALL_STAGES)).toBe('10 of 10 stages');
    expect(routeSummary(null)).toBeNull();
    expect(routeSummary([])).toBeNull();
  });
});

describe('initialTicks', () => {
  it('starts from the proposal, then the route, then every stage', () => {
    expect(initialTicks({ route: [1, 2], route_proposal: { stages: [10, 3], reasons: {} } })).toEqual([3, 10]);
    expect(initialTicks({ route: [9, 3], route_proposal: null })).toEqual([3, 9]);
    expect(initialTicks({ route: null, route_proposal: null })).toEqual(ALL_STAGES);
  });

  it('does not change the ticket it reads', () => {
    const route = [9, 3];
    initialTicks({ route, route_proposal: null });
    expect(route).toEqual([9, 3]);
  });
});

describe('route edits', () => {
  it('ticks and unticks a stage and keeps the stages in order', () => {
    expect(toggleStage([3, 4, 9, 10], 5)).toEqual([3, 4, 5, 9, 10]);
    expect(toggleStage([3, 4, 5], 4)).toEqual([3, 5]);
  });

  it('reads the trimmed reason for a stage the proposal leaves out', () => {
    expect(skipReason({ route_proposal: proposal }, 1)).toBe('tiny copy fix');
    expect(skipReason({ route_proposal: proposal }, 2)).toBe('no plan needed');
    expect(skipReason({ route_proposal: proposal }, 5)).toBeNull();
    expect(skipReason({ route_proposal: null }, 1)).toBeNull();
  });
});

describe('draftLabel', () => {
  it('names each draft kind', () => {
    expect(draftLabel('qa')).toBe('QA note');
    expect(draftLabel('answer')).toBe('Client answer');
    expect(draftLabel('closing')).toBe('Closing comment');
    expect(draftLabel(null)).toBe('Draft');
    expect(draftLabel('other')).toBe('Draft');
  });
});

describe('canClose', () => {
  it('offers Close only at the last stage of the route of an open ticket', () => {
    expect(canClose({ closed_at: null, route: [3, 9, 10], stage: 10 })).toBe(true);
    expect(canClose({ closed_at: null, route: [10], stage: 10 })).toBe(true);
    expect(canClose({ closed_at: null, route: [3, 9], stage: 9 })).toBe(true);
    expect(canClose({ closed_at: null, route: [3, 9, 10], stage: 9 })).toBe(false);
    expect(canClose({ closed_at: '2026-10-29T12:00:00Z', route: [10], stage: 10 })).toBe(false);
    expect(canClose({ closed_at: null, route: null, stage: 0 })).toBe(false);
    expect(canClose({ closed_at: null, route: [], stage: 0 })).toBe(false);
  });
});

describe('stagePhase', () => {
  it('maps each stage to its phase', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => stagePhase(n))).toEqual([
      'intake', 'plan', 'plan', 'build', 'build', 'build', 'manual', 'client', 'client', 'deploy', 'closing',
    ]);
  });

  it('uses the closed phase for a closed ticket at any stage', () => {
    expect(stagePhase(10, true)).toBe('closed');
    expect(stagePhase(3, true)).toBe('closed');
  });

  it('names the colour token of a phase', () => {
    expect(phaseColor('deploy')).toBe('var(--phase-deploy)');
  });
});

describe('stage text', () => {
  it('writes the pill as number and name, or Intake, or Closed', () => {
    expect(stagePillText({ stage: 3, closed_at: null })).toBe('3 · Execute');
    expect(stagePillText({ stage: 0, closed_at: null })).toBe('Intake');
    expect(stagePillText({ stage: 10, closed_at: '2026-10-29T12:00:00Z' })).toBe('Closed');
  });

  it('writes the section label', () => {
    expect(stageLabel(0)).toBe('Intake');
    expect(stageLabel(1)).toBe('1 Research');
    expect(stageLabel(10)).toBe('10 Closing');
  });
});

describe('groupByStage', () => {
  const t = (thread_id: string, stage: number, updated_at: string, closed_at: string | null = null) => ({ thread_id, ref: thread_id, title: thread_id, stage, updated_at, closed_at });

  it('makes one section per stage in stage order, only for stages that hold tickets', () => {
    const sections = groupByStage([t('a', 3, '2026-10-01'), t('b', 0, '2026-10-02'), t('c', 9, '2026-10-03'), t('d', 3, '2026-10-04')]);
    expect(sections.map((s) => [s.stage, s.label, s.phase, s.items.map((i) => i.thread_id)])).toEqual([
      [0, 'Intake', 'intake', ['b']],
      [3, '3 Execute', 'build', ['d', 'a']],
      [9, '9 Deploy', 'deploy', ['c']],
    ]);
  });

  it('leaves out closed tickets and returns nothing for an empty list', () => {
    expect(groupByStage([t('a', 10, '2026-10-01', '2026-10-02')])).toEqual([]);
    expect(groupByStage([])).toEqual([]);
  });

  it('removes ticket threads from the other threads', () => {
    expect(withoutTickets([{ id: 'a' }, { id: 'x' }], [t('a', 3, '2026-10-01')])).toEqual([{ id: 'x' }]);
  });
});

describe('defaultRoleFor', () => {
  const crew = [{ id: 'conductor' }, { id: 'ticket' }, { id: 'builder' }];

  it('picks Ticket in a client channel and Conductor in the conductor channel', () => {
    expect(defaultRoleFor({ id: 'acme', kind: 'client' }, crew)).toBe('ticket');
    expect(defaultRoleFor({ id: 'conductor', kind: 'system' }, crew)).toBe('conductor');
  });

  it('picks no role in other channels or before the crew loads', () => {
    expect(defaultRoleFor({ id: 'inbox', kind: 'internal' }, crew)).toBe('');
    expect(defaultRoleFor({ id: 'me', kind: 'personal' }, crew)).toBe('');
    expect(defaultRoleFor(undefined, crew)).toBe('');
    expect(defaultRoleFor({ id: 'acme', kind: 'client' }, [])).toBe('');
  });
});

describe('draftUnseen', () => {
  const qa = { kind: 'qa', text: 'Check the cart on mobile.' };

  it('marks a draft the user has not opened yet', () => {
    expect(draftUnseen(qa, null)).toBe(true);
  });

  it('clears once the user opened this exact draft', () => {
    expect(draftUnseen(qa, draftStamp(qa))).toBe(false);
    expect(draftUnseen({ ...qa }, draftStamp(qa))).toBe(false);
  });

  it('marks the draft again when its text or kind changes', () => {
    const seen = draftStamp(qa);
    expect(draftUnseen({ ...qa, text: 'Check the cart on desktop.' }, seen)).toBe(true);
    expect(draftUnseen({ ...qa, kind: 'answer' }, seen)).toBe(true);
  });

  it('marks nothing when there is no draft', () => {
    expect(draftUnseen(null, null)).toBe(false);
    expect(draftUnseen(undefined, 'x')).toBe(false);
  });

  it('keeps one storage key per thread', () => {
    expect(draftSeenKey('t1')).toBe('omni:ticket-draft-seen:t1');
    expect(draftSeenKey('t1')).not.toBe(draftSeenKey('t2'));
  });
});
