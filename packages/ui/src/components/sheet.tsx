// HOUP-68: native port of apps/web/src/components/ui/sheet.tsx. base-ui's
// headless Dialog (Root/Trigger/Close/Popup context) is replaced with a
// small React context carrying { open, onOpenChange } — RN has no portal
// primitive to lean on the way base-ui does, so `side="bottom"` delegates
// entirely to `BottomSheet` (which owns the Modal), and the other three
// sides render their own lightweight edge-anchored Modal panel.
import * as React from 'react';
import { Modal, Pressable, Text, View, type TextProps, type ViewProps } from 'react-native';
import { X } from 'lucide-react-native';
import { cn } from '../lib/cn';
import { useThemeMaterial } from '../theme/theme-provider';
import { Button } from './button';
import { BottomSheet } from './bottom-sheet';

interface SheetContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SheetContext = React.createContext<SheetContextValue | null>(null);

function useSheetContext(component: string): SheetContextValue {
  const ctx = React.useContext(SheetContext);
  if (!ctx) throw new Error(`<${component}> must be rendered inside <Sheet>`);
  return ctx;
}

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

function Sheet({ open, onOpenChange, children }: SheetProps) {
  const value = React.useMemo(() => ({ open, onOpenChange }), [open, onOpenChange]);
  return <SheetContext.Provider value={value}>{children}</SheetContext.Provider>;
}

interface CloneableProps {
  onPress?: () => void;
}

function SheetTrigger({ children }: { children: React.ReactElement<CloneableProps> }) {
  const { onOpenChange } = useSheetContext('SheetTrigger');
  return React.cloneElement(children, { onPress: () => onOpenChange(true) });
}

function SheetClose({ children }: { children: React.ReactElement<CloneableProps> }) {
  const { onOpenChange } = useSheetContext('SheetClose');
  return React.cloneElement(children, { onPress: () => onOpenChange(false) });
}

function CloseButton({ onPress, className }: { onPress: () => void; className?: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onPress={onPress}
      className={className}
      accessibilityLabel="Close"
    >
      <X size={16} className="text-foreground" />
    </Button>
  );
}

export interface SheetContentProps extends ViewProps {
  side?: 'top' | 'right' | 'bottom' | 'left';
  showCloseButton?: boolean;
  children?: React.ReactNode;
}

function SheetContent({ className, style, children, side = 'right', showCloseButton = true, ...props }: SheetContentProps) {
  const { open, onOpenChange } = useSheetContext('SheetContent');
  const material = useThemeMaterial();
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);

  if (side === 'bottom') {
    return (
      <BottomSheet open={open} onOpenChange={onOpenChange} className={className} {...props}>
        {children}
        {showCloseButton && <CloseButton onPress={close} className="absolute right-3 top-8 z-10" />}
      </BottomSheet>
    );
  }

  // HOUP-132: the border sits on the edge facing back toward the trigger
  // content (mirrors web's border-r/border-l/border-b), so its color comes
  // from the theme's glass border on whichever CSS side that ends up being.
  const borderColorKey =
    side === 'left' ? 'borderRightColor' : side === 'right' ? 'borderLeftColor' : 'borderBottomColor';

  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={close}>
      <Pressable accessibilityLabel="Close" onPress={close} className="absolute inset-0 bg-black/10" />
      <View
        className={cn(
          'absolute',
          side === 'left' && 'inset-y-0 left-0 h-full w-3/4 border-r',
          side === 'right' && 'inset-y-0 right-0 h-full w-3/4 border-l',
          side === 'top' && 'inset-x-0 top-0 border-b',
          className
        )}
        style={[
          {
            backgroundColor: material.glassBg,
            [borderColorKey]: material.glassBorder,
            boxShadow: material.cardShadow,
          },
          style,
        ]}
        {...props}
      >
        {children}
        {showCloseButton && <CloseButton onPress={close} className="absolute right-3 top-3 z-10" />}
      </View>
    </Modal>
  );
}

function SheetHeader({ className, ...props }: ViewProps) {
  return <View className={cn('flex flex-col gap-0.5 p-4', className)} {...props} />;
}

function SheetFooter({ className, ...props }: ViewProps) {
  return <View className={cn('mt-auto flex flex-col gap-2 p-4', className)} {...props} />;
}

function SheetTitle({ className, ...props }: TextProps) {
  return <Text className={cn('font-heading text-title font-medium text-foreground', className)} {...props} />;
}

function SheetDescription({ className, ...props }: TextProps) {
  return <Text className={cn('text-body text-muted-foreground', className)} {...props} />;
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription };
