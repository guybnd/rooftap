import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('keeps a Hearth type step next to a text colour', () => {
    expect(cn('text-hero', 'text-foreground')).toBe('text-hero text-foreground');
    expect(cn('text-title text-muted-foreground')).toBe('text-title text-muted-foreground');
    expect(cn('text-micro-label', 'text-destructive')).toBe('text-micro-label text-destructive');
  });

  it('still lets a later size win over an earlier one', () => {
    expect(cn('text-display', 'text-sm')).toBe('text-sm');
  });
});
