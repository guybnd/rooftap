import { toast } from 'sonner';

// FLUX-186: confirmation pill shown after adding an item from a surface that does
// NOT already show the new item in a list (the home hub, the "+" capture menu).
// Fades out after 5s; tapping "Edit" reopens the item so the user can tweak it.
// Section pages (Tasks/Groceries/Costs/Setup) skip this — the item appears in the
// list right there, so a toast would just be noise.
export function toastItemAdded(name: string, onEdit: () => void) {
  const label = name.trim() || 'Item';
  toast.success(`Added “${label}”`, {
    duration: 5000,
    action: { label: 'Edit', onClick: onEdit },
  });
}
