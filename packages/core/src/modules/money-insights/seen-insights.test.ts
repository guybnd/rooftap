import { beforeEach, describe, expect, it } from 'vitest';
import { getSeenInsights, hasUnseenInsights, markInsightsSeen, resetSeenInsightsForTests } from './seen-insights';

describe('seen insights', () => {
  beforeEach(() => resetSeenInsightsForTests());

  it('counts an insight as new until it has been shown', () => {
    expect(hasUnseenInsights(['price:net'])).toBe(true);
    markInsightsSeen(['price:net']);
    expect(hasUnseenInsights(['price:net'])).toBe(false);
    expect(hasUnseenInsights(['price:net', 'ahead:outing'])).toBe(true);
    markInsightsSeen(['ahead:outing']);
    expect(getSeenInsights()).toEqual(['ahead:outing', 'price:net']);
    expect(hasUnseenInsights([])).toBe(false);
  });
});
