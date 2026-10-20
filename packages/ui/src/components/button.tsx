// HOUP-68: native port of apps/web/src/components/ui/button.tsx. Web-only
// mechanisms with no RN/NativeWind equivalent (`[&_svg]` descendant
// selectors, `aria-invalid`/`aria-expanded` attribute variants, `in-data-*`
// button-group context) are dropped rather than blindly ported — re-expressed
// below as plain size/variant-driven className switches instead.
import * as React from 'react';
import { Pressable, Text, type PressableProps } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const buttonVariants = cva(
  'flex-row shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent active:translate-y-px disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary active:bg-primary/80',
        outline: 'border-border bg-background active:bg-muted',
        secondary: 'bg-secondary active:bg-secondary/80',
        ghost: 'active:bg-muted',
        destructive: 'bg-destructive/10 active:bg-destructive/20',
        link: '',
      },
      size: {
        default: 'h-8 px-2.5',
        xs: 'h-6 px-2',
        // M2 44px floor: sm was h-7 (28dp), the app default and under every
        // touch floor. Raised to h-9 (36dp); callers that need the old
        // visual footprint should add hitSlop rather than go smaller.
        sm: 'h-9 px-2.5',
        lg: 'h-9 px-2.5',
        icon: 'size-8',
        'icon-xs': 'size-6',
        'icon-sm': 'size-9',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

const buttonTextVariants = cva('text-sm font-medium', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      outline: 'text-foreground',
      secondary: 'text-secondary-foreground',
      ghost: 'text-foreground',
      destructive: 'text-destructive',
      link: 'text-primary underline',
    },
    size: {
      default: '',
      xs: 'text-xs',
      sm: 'text-[0.8rem]',
      lg: '',
      icon: '',
      'icon-xs': '',
      'icon-sm': '',
      'icon-lg': '',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

export interface ButtonProps extends PressableProps, VariantProps<typeof buttonVariants> {
  className?: string;
  textClassName?: string;
  children?: React.ReactNode;
}

function Button({
  className,
  textClassName,
  variant = 'default',
  size = 'default',
  hitSlop,
  children,
  ...props
}: ButtonProps) {
  // M2 44px floor: `xs`/`icon-xs` are 24dp visual and `sm`/`icon-sm` are 36dp
  // visual (deliberately, to stay compact in header rows/quick-add controls)
  // - hitSlop closes the remaining gap to a >=44px touch target without
  // growing the visual footprint further.
  const compactHitSlop =
    size === 'xs' || size === 'icon-xs' ? 10 : size === 'sm' || size === 'icon-sm' ? 4 : undefined;
  return (
    <Pressable
      className={cn(buttonVariants({ variant, size }), className)}
      accessibilityRole="button"
      hitSlop={hitSlop ?? compactHitSlop}
      {...props}
    >
      {(() => {
        // Wrap bare string/number children — RN throws "Text strings must be
        // rendered within a <Text> component" for raw text in a Pressable.
        // Interpolated labels like `{cond ? 'Hide' : 'Show'} completed ({n})`
        // arrive as an ARRAY of strings, so the old lone-string check missed
        // them. All-text children coalesce into ONE Text (separate wrappers
        // would put the Pressable's gap between words); mixed children (icon +
        // label) wrap only their text parts.
        const kids = React.Children.toArray(children);
        const textCls = cn(buttonTextVariants({ variant, size }), textClassName);
        if (kids.length > 0 && kids.every((k) => typeof k === 'string' || typeof k === 'number')) {
          return <Text className={textCls}>{kids.join('')}</Text>;
        }
        return kids.map((child, i) =>
          typeof child === 'string' || typeof child === 'number' ? (
            <Text key={i} className={textCls}>{child}</Text>
          ) : (
            child
          )
        );
      })()}
    </Pressable>
  );
}

export { Button, buttonVariants, buttonTextVariants };
