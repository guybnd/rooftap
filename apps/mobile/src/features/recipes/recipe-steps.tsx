// Recipes v2 R1: the recipe's Steps (mockup 3A), native twin of
// apps/web/src/app/recipes/recipe-steps.tsx. One card, a hairline row per
// step (H4): the step number, the text, the ingredients it uses as portal
// chips with amounts (tap opens the ingredient in place, PC), and its
// timers. "Show original" swaps the tidy text for the book's own wording.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Thermometer, Timer } from 'lucide-react-native';
import { Text, PortalChip, cn } from '@homeup/ui';
import {
  formatTimerDuration,
  hasOriginalWording,
  ingredientPillLabel,
  stepIngredients,
  type RecipeIngredient,
  type RecipeStep,
  type RecipeStepTimer,
} from '@homeup/core';

export interface RecipeStepsProps {
  steps: RecipeStep[];
  ingredients: RecipeIngredient[];
  onOpenIngredient?: (ing: RecipeIngredient) => void;
  /** Draws a step's timer; default is plain meta text. Running cooks pass a tappable chip. */
  renderTimer?: (timer: RecipeStepTimer, stepIndex: number, timerIndex: number) => React.ReactNode;
  /** The step a running cook is on, tinted so it is easy to find. */
  currentStep?: number | null;
}

const TABULAR = { fontVariant: ['tabular-nums' as const] };

export function RecipeSteps({ steps, ingredients, onOpenIngredient, renderTimer, currentStep }: RecipeStepsProps) {
  const [showOriginal, setShowOriginal] = React.useState(false);
  const canShowOriginal = hasOriginalWording(steps);

  if (steps.length === 0) {
    return <Text className="px-1 text-sm text-muted-foreground">No steps yet. Edit the recipe to add some.</Text>;
  }

  return (
    <View className="gap-2">
      <View className="min-h-6 flex-row items-center justify-between px-1">
        <Text className="text-micro-label uppercase text-muted-foreground">Steps</Text>
        {canShowOriginal && (
          <Pressable
            onPress={() => setShowOriginal((v) => !v)}
            accessibilityRole="button"
            hitSlop={{ top: 10, bottom: 10 }}
            className="-my-2 h-10 justify-center rounded-lg px-2"
          >
            <Text className="text-xs font-medium text-primary">{showOriginal ? 'Show tidy steps' : 'Show original'}</Text>
          </Pressable>
        )}
      </View>
      <View className="overflow-hidden rounded-3xl border border-border/60 bg-card">
        {steps.map((step, i) => {
          const used = stepIngredients(step, ingredients);
          const text = showOriginal && step.original ? step.original : step.text;
          const current = currentStep === i;
          return (
            <View
              key={i}
              className={cn('flex-row gap-3 px-4 py-3.5', i > 0 && 'border-t border-border/60', current && 'bg-accent/50')}
            >
              <Text
                className={cn('w-5 pt-px font-mono text-xs', current ? 'text-primary' : 'text-muted-foreground')}
                style={TABULAR}
              >
                {i + 1}
              </Text>
              <View className="min-w-0 flex-1 gap-2">
                <Text className="text-sm leading-relaxed text-foreground">{text}</Text>
                {(used.length > 0 || !!step.temp) && (
                  <View className="flex-row flex-wrap items-center gap-2">
                    {!!step.temp && (
                      <View className="flex-row items-center gap-1">
                        <Thermometer size={13} className="text-muted-foreground" />
                        <Text className="font-mono text-xs text-muted-foreground">{step.temp}</Text>
                      </View>
                    )}
                    {used.map((ing) =>
                      onOpenIngredient ? (
                        <PortalChip key={ing.id} label={ingredientPillLabel(ing)} onOpen={() => onOpenIngredient(ing)} />
                      ) : (
                        <Text key={ing.id} className="text-xs text-muted-foreground">
                          {ingredientPillLabel(ing)}
                        </Text>
                      ),
                    )}
                  </View>
                )}
                {step.timers.length > 0 && (
                  <View className="flex-row flex-wrap items-center gap-2">
                    {step.timers.map((t, j) =>
                      renderTimer ? (
                        <React.Fragment key={j}>{renderTimer(t, i, j)}</React.Fragment>
                      ) : (
                        <View key={j} className="flex-row items-center gap-1">
                          <Timer size={13} className="text-muted-foreground" />
                          <Text className="text-xs text-muted-foreground">
                            {t.label} · <Text className="font-mono text-xs text-muted-foreground">{formatTimerDuration(t.seconds)}</Text>
                          </Text>
                        </View>
                      ),
                    )}
                  </View>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
