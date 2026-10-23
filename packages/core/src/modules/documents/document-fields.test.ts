import { describe, expect, it } from 'vitest';
import { documentMetadataValue } from './document-fields';

describe('documentMetadataValue', () => {
  it('reads an ISO date as a short date and leaves other values alone', () => {
    expect(documentMetadataValue('2026-10-23')).toBe('Oct 23, 2026');
    expect(documentMetadataValue('ABC-123')).toBe('ABC-123');
  });
});
