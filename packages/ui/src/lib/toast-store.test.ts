import { afterEach, describe, expect, it } from 'vitest';
import { dismissToast, getToasts, toast } from './toast-store';

afterEach(() => {
  getToasts().forEach((t) => dismissToast(t.id));
});

describe('toast placement', () => {
  it('defaults to the bottom stack', () => {
    toast.message('Item deleted');
    expect(getToasts()[0]?.placement).toBe('bottom');
  });

  it('keeps an explicit top placement', () => {
    toast.message('Update ready', { placement: 'top' });
    expect(getToasts()[0]?.placement).toBe('top');
  });
});
