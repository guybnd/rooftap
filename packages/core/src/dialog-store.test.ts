import { afterEach, describe, expect, it, vi } from 'vitest';
import { dialog, getDialogs, isDestructiveDialog, resolveDialog } from './dialog-store';

afterEach(() => {
  getDialogs().forEach((d) => resolveDialog(d.id, null));
});

describe('dialog store', () => {
  it('shows a single OK when alert gets no buttons', () => {
    dialog.alert('Could not save');
    expect(getDialogs()[0]?.buttons).toEqual([{ text: 'OK' }]);
  });

  it('runs the chosen button and closes the dialog', () => {
    const onDelete = vi.fn();
    const id = dialog.alert('Delete "Milk"?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
    expect(isDestructiveDialog(getDialogs()[0]!)).toBe(true);
    resolveDialog(id, 1);
    expect(onDelete).toHaveBeenCalledOnce();
    expect(getDialogs()).toHaveLength(0);
  });

  it('answers a dismiss with the cancel button', async () => {
    const answer = dialog.confirm({ title: 'Sign out?' });
    resolveDialog(getDialogs()[0]!.id, null);
    await expect(answer).resolves.toBe(false);
  });

  it('resolves confirm true on the confirm button', async () => {
    const answer = dialog.confirm({ title: 'Delete?', destructive: true });
    const entry = getDialogs()[0]!;
    expect(entry.buttons[1]).toMatchObject({ text: 'Delete', style: 'destructive' });
    resolveDialog(entry.id, 1);
    await expect(answer).resolves.toBe(true);
  });

  it('resolves a prompt with the entered text, or null', async () => {
    const named = dialog.prompt({ title: 'Rename folder', defaultValue: 'Bills' });
    expect(getDialogs()[0]?.input).toEqual({ defaultValue: 'Bills', placeholder: undefined });
    resolveDialog(getDialogs()[0]!.id, 1, 'Utilities');
    await expect(named).resolves.toBe('Utilities');

    const cancelled = dialog.prompt({ title: 'Folder name' });
    resolveDialog(getDialogs()[0]!.id, null);
    await expect(cancelled).resolves.toBeNull();
  });

  it('ignores a second resolve of the same dialog', () => {
    const onPress = vi.fn();
    const id = dialog.alert('Done', undefined, [{ text: 'OK', onPress }]);
    resolveDialog(id, 0);
    resolveDialog(id, 0);
    expect(onPress).toHaveBeenCalledOnce();
  });
});
