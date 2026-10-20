// HOUP-225: select-mode bulk "Assign to" sheet — mirrors bulk-actions-sheet.tsx's
// (aisle) pattern, ported from web page.tsx:1293-1311's PopMenu.
import { BottomSheet, ListGroup, ListItem, ListItemTitle } from '@homeup/ui';

interface BulkAssignSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberProfiles?: Record<string, { email: string; name: string | null; avatar: string | null }>;
  onAssign: (userId: string | null) => void;
}

export function BulkAssignSheet({ open, onOpenChange, memberProfiles, onAssign }: BulkAssignSheetProps) {
  const members = Object.entries(memberProfiles ?? {});
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} className="max-h-[70%] pb-2">
      <ListGroup className="mx-1.5 mt-1.5 border-0 bg-transparent">
        <ListItem onPress={() => onAssign(null)}>
          <ListItemTitle>Unassigned</ListItemTitle>
        </ListItem>
        {members.map(([id, p]) => (
          <ListItem key={id} onPress={() => onAssign(id)}>
            <ListItemTitle>{p.name || p.email || 'Member'}</ListItemTitle>
          </ListItem>
        ))}
      </ListGroup>
    </BottomSheet>
  );
}
