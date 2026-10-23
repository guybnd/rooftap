// Recipes v2 R7: ask the Assistant from cook mode (mockup 4C), native twin
// of apps/web/src/components/cook/cook-ask.tsx. A sheet with one quick ask
// that knows the recipe and the step on screen; the server reads the recipe
// from the cook context each send carries, and a timer it starts rings on
// this phone. Typed for now: voice comes with R9.
import * as React from 'react';
import { AppState, Pressable, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { cookDeviceId, useAssistantThread, useModules } from '@homeup/core';
import { BottomSheet, BottomSheetScrollView, Text, haptics, toast } from '@homeup/ui';
import { useDataCache } from '@/lib/data-cache';
import { assistantApi } from '@/features/assistant/assistant-api';
import { ThreadFooter, ThreadMessages } from '@/features/assistant/thread-body';

const askToast = { error: (m: string) => toast.error(m), message: (m: string) => toast.message(m) };

/** Example asks for an empty sheet; tapping one sends it. */
const SUGGESTIONS = ['What can I use instead?', 'Make it for 2', 'Add what I am missing to the list'];

/** The header button and its sheet. While the Assistant module is off, a spacer keeps the header centred. */
export function CookAsk({ recipeId, step }: { recipeId: string; step: number }) {
  const on = useModules().isEnabled('assistant');
  const [open, setOpen] = React.useState(false);
  if (!on) return <View className="w-11" />;
  return (
    <>
      <Pressable
        onPress={() => {
          haptics.select();
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Ask about this recipe"
        className="-mr-2 h-11 w-11 items-center justify-center rounded-lg"
      >
        <Sparkles size={20} className="text-muted-foreground" />
      </Pressable>
      <CookAskSheet open={open} onOpenChange={setOpen} recipeId={recipeId} step={step} />
    </>
  );
}

function CookAskSheet({
  open,
  onOpenChange,
  recipeId,
  step,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipeId: string;
  step: number;
}) {
  const { isOnline } = useDataCache();
  const openRef = React.useRef(open);
  const stepRef = React.useRef(step);
  React.useEffect(() => {
    openRef.current = open;
    stepRef.current = step;
  }, [open, step]);
  // One quick ask for the whole cook: closing the sheet keeps it.
  const thread = useAssistantThread(
    { id: 'new', kind: 'quick' },
    {
      api: assistantApi,
      presence: () => (AppState.currentState !== 'active' ? 'background' : openRef.current ? 'here' : 'away'),
      toast: askToast,
      cook: () => ({ recipeId, step: stepRef.current, deviceId: cookDeviceId() }),
    },
  );
  const empty = thread.messages.length === 0 && !thread.sending;

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} className="pb-4">
      <Text className="px-5 pb-1 text-micro-label uppercase text-muted-foreground">Ask about this recipe</Text>
      <BottomSheetScrollView>
        <View className="px-4 py-2">
          {empty ? (
            <View className="flex-row flex-wrap gap-2 py-2">
              {SUGGESTIONS.map((s) => (
                <Pressable
                  key={s}
                  disabled={!isOnline}
                  onPress={() => void thread.send(s)}
                  accessibilityRole="button"
                  className="min-h-11 justify-center rounded-full bg-muted px-4 active:bg-accent disabled:opacity-50"
                >
                  <Text className="text-sm text-foreground">{s}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <ThreadMessages thread={thread} />
          )}
        </View>
      </BottomSheetScrollView>
      <View className="px-3 pt-2">
        <ThreadFooter thread={thread} offline={!isOnline} autoFocus={open} />
      </View>
    </BottomSheet>
  );
}
