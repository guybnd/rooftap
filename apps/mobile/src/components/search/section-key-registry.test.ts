import { describe, expect, it } from 'vitest';
import { sections } from '@homeup/core';
import { SECTION_KEY_TO_REGISTRY_ID } from './section-key-registry';

// HOUP-147: apps/mobile has no RN component-rendering test infra (see
// vitest.config.ts), so global-search-results.tsx's leading-icon resolution
// is covered here at the pure-logic layer instead — the part flagged by plan
// review as the trickiest bit (SectionKey doesn't map 1:1 onto registry ids).
describe('SECTION_KEY_TO_REGISTRY_ID', () => {
  const registryIds = new Set(sections.map((s) => s.id));

  it('maps every SectionKey to a real section registry id', () => {
    for (const registryId of Object.values(SECTION_KEY_TO_REGISTRY_ID)) {
      expect(registryIds.has(registryId)).toBe(true);
    }
  });

  it('maps "tasks" to the "household" section, not a "tasks" section (no such registry id exists)', () => {
    expect(SECTION_KEY_TO_REGISTRY_ID.tasks).toBe('household');
  });

  it('maps the calendar/checklist/apartment cluster onto "search" where GlobalHit gates them, except calendar which keeps its own registry section', () => {
    expect(SECTION_KEY_TO_REGISTRY_ID.checklist).toBe('search');
    expect(SECTION_KEY_TO_REGISTRY_ID.search).toBe('search');
    expect(SECTION_KEY_TO_REGISTRY_ID.calendar).toBe('calendar');
  });

  it('maps every other SectionKey 1:1 onto its like-named registry section', () => {
    expect(SECTION_KEY_TO_REGISTRY_ID.groceries).toBe('groceries');
    expect(SECTION_KEY_TO_REGISTRY_ID.costs).toBe('costs');
    expect(SECTION_KEY_TO_REGISTRY_ID.setup).toBe('setup');
    expect(SECTION_KEY_TO_REGISTRY_ID.documents).toBe('documents');
    expect(SECTION_KEY_TO_REGISTRY_ID.recipes).toBe('recipes');
    expect(SECTION_KEY_TO_REGISTRY_ID.checklists).toBe('checklists');
  });
});
