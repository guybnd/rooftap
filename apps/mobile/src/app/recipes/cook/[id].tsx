// Recipes v2 R4: cook mode (mockup 4A), native twin of
// apps/web/src/app/recipes/cook/[id]/page.tsx. One step at a time in big
// type, the ingredients for that step, and the step's timers. Swipe
// sideways or Back / Next to move; the step meter is local (H3). The screen
// stays on (expo-keep-awake, already in the APK). Read-aloud on the phone
// comes with the R9 APK (expo-speech), so its control is hidden here.
//
// Opening cook mode starts the recipe's cook, so its step and timers match
// the head and the other device. Without running cooks it still steps
// through locally. With the Assistant on, the sparkle asks about the
// recipe (R7, features/cook/cook-ask.tsx).
import * as React from 'react';
import { PanResponder, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { use$ } from '@legendapp/state/react';
import { ArrowLeft, ChefHat, ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react-native';
import { Button, ScreenBackground, Text, cn, haptics } from '@homeup/ui';
import {
  recipes$,
  recipeIngredients$,
  formatCountdown,
  formatTimerDuration,
  ingredientPillLabel,
  meterSegments,
  recipeSteps,
  stepIngredients,
  stepTimerStates,
  useCookClock,
  useCooks,
  useReconnectSync,
  type Recipe,
  type RecipeIngredient,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { useOpenRoute } from '@/lib/tab-routes';
import { askTimerNotificationPermission } from '@/features/cook/cook-alarms';
import { CookAsk } from '@/features/cook/cook-ask';

const TABULAR = { fontVariant: ['tabular-nums' as const] };

export default function CookModeScreen() {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const openRoute = useOpenRoute();
  const { id: recipeId } = useLocalSearchParams<{ id: string }>();
  const { group, currentUserId } = useDataCache();
  const recs$ = recipes$(group?.id);
  const ings$ = recipeIngredients$(group?.id);
  useReconnectSync(recs$);
  useReconnectSync(ings$);
  const recipe = use$(() => {
    const r = ((recs$.get() ?? {}) as Record<string, Recipe>)[recipeId];
    return r && !r.deleted ? r : null;
  });
  const allIngredients = use$(() =>
    Object.values(ings$.get() ?? {}).filter((i): i is RecipeIngredient => !!i && !i.deleted && i.recipe_id === recipeId),
  );
  const steps = React.useMemo(() => (recipe ? recipeSteps(recipe) : []), [recipe]);

  const cooks = useCooks(group?.id, currentUserId);
  const cook = cooks.cookForRecipe(recipeId);
  const [localStep, setLocalStep] = React.useState(0);
  const step = cook ? cook.step : Math.min(localStep, Math.max(0, steps.length - 1));
  const now = useCookClock(!!cook && cook.session.timers.length > 0);

  const started = React.useRef(false);
  React.useEffect(() => {
    if (started.current || !cooks.enabled || !recipe || cook) return;
    started.current = true;
    cooks.start(recipeId);
  }, [cooks, recipe, cook, recipeId]);

  const go = React.useCallback(
    (delta: number) => {
      const next = Math.min(Math.max(0, step + delta), Math.max(0, steps.length - 1));
      if (next === step) return;
      haptics.select();
      if (cook) cooks.setStep(cook.session.id, next);
      else setLocalStep(next);
    },
    [cook, cooks, step, steps.length],
  );

  // A sideways swipe moves a step; the responder reads the latest `go`.
  const goRef = React.useRef(go);
  React.useEffect(() => {
    goRef.current = go;
  }, [go]);
  const [swipe] = React.useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dx) > 60) goRef.current(g.dx < 0 ? 1 : -1);
      },
    }),
  );

  const leave = () => {
    if (router.canGoBack()) router.back();
    else openRoute(`/recipes/${recipeId}`);
  };

  if (!group || !recipe) {
    return (
      <ScreenBackground className="items-center justify-center p-6">
        <Text className="text-body text-muted-foreground">{group ? 'Recipe not found.' : 'Loading…'}</Text>
      </ScreenBackground>
    );
  }

  const current = steps[step];
  const used = current ? stepIngredients(current, allIngredients) : [];
  const timerStates = current ? stepTimerStates(cook?.session ?? null, current, step, now) : [];
  const meter = meterSegments(step + 1, Math.max(1, steps.length));
  const last = step >= steps.length - 1;

  return (
    <ScreenBackground>
      <View className="flex-1" {...swipe.panHandlers}>
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-5 px-4"
          contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 16, flexGrow: 1 }}
        >
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={leave}
              accessibilityRole="button"
              accessibilityLabel="Leave cook mode"
              className="-ml-2 h-11 w-11 items-center justify-center rounded-lg"
            >
              <ArrowLeft size={20} className="text-muted-foreground" />
            </Pressable>
            <Text numberOfLines={1} className="min-w-0 flex-1 text-center text-micro-label uppercase text-muted-foreground">
              {recipe.title}
            </Text>
            <CookAsk recipeId={recipeId} step={step} />
          </View>

          {steps.length === 0 ? (
            <Text className="text-lg text-muted-foreground">This recipe has no steps yet. Edit it to add some.</Text>
          ) : (
            <>
              <View className="gap-2">
                <Text className="text-xs text-muted-foreground">
                  <Text className="font-mono text-xs text-muted-foreground" style={TABULAR}>
                    Step {step + 1}
                  </Text>{' '}
                  of {steps.length}
                </Text>
                <View className="flex-row gap-1.5">
                  {Array.from({ length: meter.count }, (_, i) => (
                    <View key={i} className={cn('h-[3px] flex-1 rounded-full', i < meter.filled ? 'bg-primary' : 'bg-foreground/10')} />
                  ))}
                </View>
              </View>

              <Text accessibilityLiveRegion="polite" className="font-heading text-[26px] font-semibold leading-snug text-foreground">
                {current?.text}
              </Text>

              {(used.length > 0 || !!current?.temp) && (
                <View className="gap-2 rounded-2xl bg-muted/60 p-3.5">
                  <Text className="text-micro-label uppercase text-muted-foreground">For this step</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {!!current?.temp && <Text className="font-mono text-sm text-foreground">{current.temp}</Text>}
                    {used.map((ing) => (
                      <View key={ing.id} className="rounded-full bg-background px-3 py-1">
                        <Text className="text-sm text-foreground">{ingredientPillLabel(ing)}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {cooks.enabled && timerStates.length > 0 && (
                <View className="items-start gap-2">
                  {timerStates.map((t) => {
                    const r = t.running;
                    const timerId = r?.timer.id;
                    if (!r) {
                      return (
                        <Pressable
                          key={t.index}
                          accessibilityRole="button"
                          onPress={() => {
                            haptics.commit();
                            askTimerNotificationPermission();
                            cooks.start(recipeId, { step, index: t.index });
                          }}
                          className="h-11 flex-row items-center gap-2 rounded-full bg-primary/15 px-4"
                        >
                          <Text className="text-sm font-semibold text-primary">
                            Start {formatTimerDuration(t.seconds)} timer
                            {t.label && t.label !== 'Timer' ? <Text className="text-sm text-primary"> · {t.label}</Text> : null}
                          </Text>
                        </Pressable>
                      );
                    }
                    const done = r.state === 'done';
                    return (
                      <View key={t.index} className="flex-row items-center gap-2">
                        <View className={cn('h-11 flex-row items-center gap-2 rounded-full px-4', done ? 'bg-destructive/15' : 'bg-primary/15')}>
                          <Text className={cn('font-mono text-sm font-semibold', done ? 'text-destructive' : 'text-primary')} style={TABULAR}>
                            {done ? 'Done' : formatCountdown(r.remainingMs)}
                          </Text>
                          <Text className={cn('text-sm font-semibold', done ? 'text-destructive' : 'text-primary')}>{t.label}</Text>
                        </View>
                        {cook && timerId && !done && (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={r.state === 'paused' ? 'Resume timer' : 'Pause timer'}
                            onPress={() => {
                              haptics.tick();
                              if (r.state === 'paused') cooks.resume(cook.session.id, timerId);
                              else cooks.pause(cook.session.id, timerId);
                            }}
                            className="h-11 w-11 items-center justify-center rounded-full"
                          >
                            {r.state === 'paused' ? (
                              <Play size={16} className="text-muted-foreground" />
                            ) : (
                              <Pause size={16} className="text-muted-foreground" />
                            )}
                          </Pressable>
                        )}
                        {cook && timerId && (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={done ? 'Dismiss timer' : 'Stop timer'}
                            onPress={() => {
                              haptics.remove();
                              cooks.stopTimer(cook.session.id, timerId);
                            }}
                            className="h-11 w-11 items-center justify-center rounded-full"
                          >
                            <X size={16} className="text-muted-foreground" />
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

              <Text className="mt-auto pt-2 text-center text-xs text-muted-foreground">
                Screen stays on · swipe sideways for the next step
              </Text>
            </>
          )}
        </ScrollView>

        <View className="flex-row items-center justify-between gap-4 px-6 pt-3" style={{ paddingBottom: insets.bottom + 20 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous step"
            disabled={step === 0}
            onPress={() => go(-1)}
            className={cn('h-14 w-14 items-center justify-center rounded-full border border-border bg-card', step === 0 && 'opacity-40')}
          >
            <ChevronLeft size={24} className="text-foreground" />
          </Pressable>
          {last && steps.length > 0 ? (
            <Button
              onPress={() => {
                haptics.success();
                if (cook) cooks.finish(cook.session.id);
                leave();
              }}
              className="h-14 flex-1 rounded-full"
            >
              <ChefHat size={18} className="text-primary-foreground" />
              <Text className="text-sm font-semibold text-primary-foreground">Finish cooking</Text>
            </Button>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next step"
              onPress={() => go(1)}
              className="h-14 w-14 items-center justify-center rounded-full bg-primary"
            >
              <ChevronRight size={24} className="text-primary-foreground" />
            </Pressable>
          )}
        </View>
      </View>
    </ScreenBackground>
  );
}
