import { describe, expect, it } from 'vitest';
import { ALL_STAGES, canClose, draftLabel, initialTicks, routeMode, routeSummary, skipReason, stageState, toggleStage } from '../src/ticket-route.ts';

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
