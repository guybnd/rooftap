import { beforeEach, describe, expect, it } from 'vitest';
import { finishedUnderGoal, resetUnderGoalCheerForTests, takeUnderGoalCheer } from './under-goal-cheer';

describe('under goal cheer', () => {
  beforeEach(() => resetUnderGoalCheerForTests());

  it('cheers only a finished month that stayed within its goal', () => {
    expect(finishedUnderGoal({ when: 'past', paidCents: 111_500 }, 140_000)).toBe(true);
    expect(finishedUnderGoal({ when: 'past', paidCents: 140_000 }, 140_000)).toBe(true);
    expect(finishedUnderGoal({ when: 'past', paidCents: 150_000 }, 140_000)).toBe(false);
    expect(finishedUnderGoal({ when: 'current', paidCents: 10_000 }, 140_000)).toBe(false);
    expect(finishedUnderGoal({ when: 'past', paidCents: 10_000 }, null)).toBe(false);
    expect(finishedUnderGoal({ when: 'past', paidCents: 0 }, 140_000)).toBe(false);
  });

  it('cheers each month once', () => {
    expect(takeUnderGoalCheer('2026-10')).toBe(true);
    expect(takeUnderGoalCheer('2026-10')).toBe(false);
    expect(takeUnderGoalCheer('2026-09')).toBe(true);
  });
});
