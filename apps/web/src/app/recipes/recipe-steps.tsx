'use client';

// Recipes v2 R1: the recipe's Steps (mockup 3A). One card, a hairline row
// per step (H4): the step number, the text, the ingredients it uses as
// portal chips with amounts (tap opens the ingredient in place, PC), and its
// timers. "Show original" swaps the tidy text for the book's own wording.

import { useState } from 'react';
import { Thermometer, Timer } from 'lucide-react';
import {
  formatTimerDuration,
  hasOriginalWording,
  ingredientPillLabel,
  stepIngredients,
  type RecipeIngredient,
  type RecipeStep,
  type RecipeStepTimer,
} from '@homeup/core';
import { PortalChip } from '@/components/ui/portal-chip';
import { cn } from '@/lib/utils';

export interface RecipeStepsProps {
  steps: RecipeStep[];
  ingredients: RecipeIngredient[];
  onOpenIngredient?: (ing: RecipeIngredient) => void;
  /** Draws a step's timer; default is plain meta text. Running cooks pass a tappable chip. */
  renderTimer?: (timer: RecipeStepTimer, stepIndex: number, timerIndex: number) => React.ReactNode;
  /** The step a running cook is on, tinted so it is easy to find. */
  currentStep?: number | null;
}

export function RecipeSteps({ steps, ingredients, onOpenIngredient, renderTimer, currentStep }: RecipeStepsProps) {
  const [showOriginal, setShowOriginal] = useState(false);
  const canShowOriginal = hasOriginalWording(steps);

  if (steps.length === 0) {
    return <p className="px-1 text-sm text-muted-foreground">No steps yet. Edit the recipe to add some.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex min-h-6 items-center justify-between px-1">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Steps</h2>
        {canShowOriginal && (
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            className="-my-2 h-10 rounded-lg px-2 text-xs font-medium text-primary hover:bg-accent"
          >
            {showOriginal ? 'Show tidy steps' : 'Show original'}
          </button>
        )}
      </div>
      <ol className="divide-y divide-border/60 overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)]">
        {steps.map((step, i) => {
          const used = stepIngredients(step, ingredients);
          const text = showOriginal && step.original ? step.original : step.text;
          return (
            <li
              key={i}
              className={cn('flex gap-3 px-4 py-3.5', currentStep === i && 'bg-accent/50')}
              aria-current={currentStep === i ? 'step' : undefined}
            >
              <span
                className={cn(
                  'w-5 shrink-0 pt-px font-mono text-xs tabular-nums',
                  currentStep === i ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm leading-relaxed text-foreground">{text}</p>
                {(used.length > 0 || step.temp) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {step.temp && (
                      <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                        <Thermometer className="h-3.5 w-3.5" />
                        {step.temp}
                      </span>
                    )}
                    {used.map((ing) =>
                      onOpenIngredient ? (
                        <PortalChip key={ing.id} label={ingredientPillLabel(ing)} onOpen={() => onOpenIngredient(ing)} />
                      ) : (
                        <span key={ing.id} className="text-xs text-muted-foreground">
                          {ingredientPillLabel(ing)}
                        </span>
                      ),
                    )}
                  </div>
                )}
                {step.timers.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {step.timers.map((t, j) =>
                      renderTimer ? (
                        <span key={j}>{renderTimer(t, i, j)}</span>
                      ) : (
                        <span key={j} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Timer className="h-3.5 w-3.5" />
                          {t.label} · <span className="font-mono">{formatTimerDuration(t.seconds)}</span>
                        </span>
                      ),
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
