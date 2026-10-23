import type { ChecklistItem, ApartmentScore } from '../../types';

export function calculateScore(
  items: ChecklistItem[],
  responses: Record<string, boolean | null>
): ApartmentScore {
  const dealbreakers = items
    .filter((i) => i.is_dealbreaker && responses[i.id] === false)
    .map((i) => i.id);

  if (dealbreakers.length > 0) {
    return { total: 0, percentage: 0, dealbreakers };
  }

  const answered = items.filter((i) => responses[i.id] !== null && responses[i.id] !== undefined);
  if (answered.length === 0) return { total: 0, percentage: 0, dealbreakers: [] };

  // Bonus items only count toward the score when answered true.
  // Required items count toward maxScore whenever answered (true or false).
  const scored = answered.filter((i) => !i.is_bonus || responses[i.id] === true);

  const maxScore = scored.reduce((sum, i) => sum + i.weight, 0);
  const actualScore = scored
    .filter((i) => responses[i.id] === true)
    .reduce((sum, i) => sum + i.weight, 0);

  return {
    total: actualScore,
    percentage: maxScore > 0 ? Math.round((actualScore / maxScore) * 100) : 0,
    dealbreakers: [],
  };
}
