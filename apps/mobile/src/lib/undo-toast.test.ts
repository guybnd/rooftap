// HOUP-327 review follow-up: locks in the restoreAll branch added to fix the
// checklist screen's per-item-sync bug (a batched restore synced completion
// against a stale projection when `restore` fired once per item).
//
// `@homeup/ui`'s barrel can't be imported through vitest's pipeline here (it
// drags in react-native, whose untranspiled Flow source can't parse — same
// issue documented in icon-interop.test.ts), so the module is mocked outright
// rather than exercised for real.
import { describe, expect, it, vi } from 'vitest';

const { toastMessage } = vi.hoisted(() => ({
  toastMessage: vi.fn((_message: string, _options?: { action?: { onPress: () => void } }) => 'toast-1'),
}));
vi.mock('@homeup/ui', () => ({
  toast: { message: toastMessage },
  dismissToast: vi.fn(),
}));

import { createUndoPatchPresenter, createUndoToastPresenter } from './undo-toast';

function pressUndo(): void {
  const lastOptions = toastMessage.mock.calls.at(-1)![1];
  lastOptions!.action!.onPress();
}

describe('createUndoToastPresenter', () => {
  it('prefers restoreAll, calling it once with the whole batch', () => {
    const restore = vi.fn();
    const restoreAll = vi.fn();
    const presenter = createUndoToastPresenter<number>({
      message: (n) => `${n} items deleted`,
      restore,
      restoreAll,
    });

    presenter.addAndShow(1);
    presenter.addAndShow(2);
    presenter.addAndShow(3);

    pressUndo();

    expect(restoreAll).toHaveBeenCalledTimes(1);
    expect(restoreAll).toHaveBeenCalledWith([1, 2, 3]);
    expect(restore).not.toHaveBeenCalled();
  });

  it('falls back to restore called once per item when restoreAll is not supplied', () => {
    const restore = vi.fn();
    const presenter = createUndoToastPresenter<number>({
      message: (n) => `${n} items deleted`,
      restore,
    });

    presenter.addAndShow(1);
    presenter.addAndShow(2);

    pressUndo();

    expect(restore).toHaveBeenCalledTimes(2);
    expect(restore.mock.calls[0][0]).toBe(1);
    expect(restore.mock.calls[1][0]).toBe(2);
  });
});

describe('createUndoPatchPresenter', () => {
  type Row = { id: string; name: string; status: string };

  it('applies the patch now and writes the previous values back on Undo', () => {
    const apply = vi.fn();
    const presenter = createUndoPatchPresenter<Row>({
      message: (n, latest) => (n === 1 ? `${latest.name} added` : `${n} added`),
      apply,
    });

    presenter.run({ id: 'a', name: 'Milk', status: 'have' }, { status: 'needed' });
    expect(apply).toHaveBeenLastCalledWith('a', { status: 'needed' });
    expect(toastMessage.mock.calls.at(-1)![0]).toBe('Milk added');

    pressUndo();
    expect(apply).toHaveBeenLastCalledWith('a', { status: 'have' });
  });

  it('coalesces a batch into one pill and restores every row', () => {
    const apply = vi.fn();
    const presenter = createUndoPatchPresenter<Row>({ message: (n) => `${n} added`, apply });

    presenter.run(
      [
        { id: 'a', name: 'Milk', status: 'have' },
        { id: 'b', name: 'Eggs', status: 'bought' },
      ],
      { status: 'needed' },
    );
    expect(toastMessage.mock.calls.at(-1)![0]).toBe('2 added');

    apply.mockClear();
    pressUndo();
    expect(apply.mock.calls).toEqual([
      ['a', { status: 'have' }],
      ['b', { status: 'bought' }],
    ]);
  });
});
