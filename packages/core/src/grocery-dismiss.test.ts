import { describe, expect, it } from 'vitest';
import { groceryDismissSettingValue, resolveGroceryDismissAction } from './grocery-dismiss';

describe('grocery dismiss preference', () => {
  it('reads stored actions and treats anything else as "ask"', () => {
    expect(resolveGroceryDismissAction('not_now')).toBe('not_now');
    expect(resolveGroceryDismissAction('archive')).toBe('archive');
    expect(resolveGroceryDismissAction(null)).toBeNull();
    expect(resolveGroceryDismissAction(undefined)).toBeNull();
    expect(resolveGroceryDismissAction('delete')).toBeNull();
  });

  it('stores "ask" as null', () => {
    expect(groceryDismissSettingValue('ask')).toBeNull();
    expect(groceryDismissSettingValue('archive')).toBe('archive');
  });
});
