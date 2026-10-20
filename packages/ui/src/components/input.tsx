// HOUP-68: native port of apps/web/src/components/ui/input.tsx. `file:*`
// (file input styling) doesn't apply on native and is dropped; focus-ring
// classes become a `focus:` NativeWind variant instead of `focus-visible:`
// (RN has no hover/focus-visible distinction).
import * as React from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { cn } from '../lib/cn';

export interface InputProps extends TextInputProps {
  className?: string;
  /** React 19 ref-as-prop, handed to the underlying TextInput so screens can
   *  refocus the field imperatively (HOUP-329 keep-focus-after-add). */
  ref?: React.Ref<TextInput>;
}

function Input({ className, ref, ...props }: InputProps) {
  return (
    <TextInput
      ref={ref}
      className={cn(
        // NativeWind's `placeholder:` variant maps to the native
        // `placeholderTextColor` prop — no manual color resolution needed.
        'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-body text-foreground placeholder:text-muted-foreground focus:border-ring disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export { Input };
