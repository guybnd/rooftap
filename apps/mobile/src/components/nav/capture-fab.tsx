// HOUP-68: native port of apps/web/src/components/capture/capture-buttons.tsx's
// `MobileCaptureFab` (Hearth M1: "the tab bar's raised capture '+' anchors the
// thumb zone"). `onPress` is a stub here — the real capture flow
// (CaptureProvider/`item-form-sheet`) is an explicitly deferred composite per
// this ticket's scope, not part of the nav shell itself.
import { Pressable } from 'react-native';
import { Plus } from 'lucide-react-native';
import { cn } from '@homeup/ui';

export interface CaptureFabProps {
  onPress?: () => void;
  className?: string;
}

export function CaptureFab({ onPress, className }: CaptureFabProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Add"
      className={cn(
        'absolute -top-5 left-1/2 z-30 h-12 w-12 -translate-x-1/2 items-center justify-center rounded-full bg-primary shadow-lg active:scale-95',
        className
      )}
    >
      <Plus size={24} className="text-primary-foreground" />
    </Pressable>
  );
}
