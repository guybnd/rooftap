// Recipes v2 R3: the cooking heads over every screen (mockups 1C, 1D). Maps
// the running cooks onto @homeup/ui's CookHeads, keeps where the pile rests
// on this phone, and draws the opened head's card in its own window over a
// light scrim, with the other heads in a row above it to switch between
// cooks. Stopping a cook (the drop target or the card's Stop) shows Undo.
import * as React from 'react';
import { Modal, Pressable, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CookHeadFace, CookHeads, cn, toast, type CookHead } from '@homeup/ui';
import {
  DEFAULT_HEAD_DOCK,
  cookBadge,
  cookInitials,
  isCookModePath,
  getStoreEnvironment,
  nearestTimer,
  parseHeadDock,
  timerProgress,
  useCookClock,
  useCooks,
  type HeadDock,
  type RunningCook,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { useOpenRoute } from '@/lib/tab-routes';
import { CookCard } from './cook-card';

const DOCK_KEY = 'rooftap.cook-heads';

function readDock(): HeadDock {
  try {
    return parseHeadDock(getStoreEnvironment().keyValue.getItem(DOCK_KEY));
  } catch {
    return DEFAULT_HEAD_DOCK;
  }
}

function toHead(cook: RunningCook, now: number): CookHead {
  const badge = cookBadge(cook.session, cook.steps.length, now);
  const near = nearestTimer(cook.session, now);
  const tone: CookHead['tone'] =
    badge.tone === 'running' && near && near.remainingMs < 60_000 ? 'soon' : badge.tone;
  return {
    id: cook.session.id,
    initials: cookInitials(cook.recipe.title),
    badge: badge.tone === 'done' ? 'Done' : badge.text,
    tone,
    progress: near ? timerProgress(near.timer, now) : null,
    label: `${cook.recipe.title}, ${badge.tone === 'step' ? `step ${badge.text}` : `timer ${badge.text}`}`,
  };
}

export function CookHeadsHost({ bottomInset }: { bottomInset: number }) {
  const { group, currentUserId } = useDataCache();
  const cooks = useCooks(group?.id, currentUserId);
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const openRoute = useOpenRoute();
  const list = cooks.cooks;
  const now = useCookClock(list.length > 0);
  const [dock, setDock] = React.useState<HeadDock>(readDock);
  const [openId, setOpenId] = React.useState<string | null>(null);

  // A card whose cook ended just stops showing (`open` below is null).

  const changeDock = React.useCallback((next: HeadDock) => {
    setDock(next);
    try {
      getStoreEnvironment().keyValue.setItem(DOCK_KEY, JSON.stringify(next));
    } catch {
      // Keeps the spot for this run only.
    }
  }, []);

  const stop = React.useCallback(
    (id: string) => {
      const cook = list.find((c) => c.session.id === id);
      if (!cook) return;
      cooks.finish(id);
      toast.message(`Stopped cooking ${cook.recipe.title}`, {
        action: { label: 'Undo', onPress: () => cooks.restore(id) },
      });
    },
    [list, cooks],
  );

  // Cook mode (R4) is the cook in full; the heads step aside there.
  if (!cooks.enabled || list.length === 0 || isCookModePath(pathname)) return null;

  const heads = list.map((c) => toHead(c, now));
  const open = openId ? list.find((c) => c.session.id === openId) ?? null : null;

  return (
    <>
      {!open && (
        <CookHeads
          heads={heads}
          dock={dock}
          onDockChange={changeDock}
          onOpen={setOpenId}
          onStop={stop}
          bottomInset={bottomInset + insets.bottom}
          topInset={insets.top}
        />
      )}
      {/* The open card is its own window: Back closes it, a tap outside
          closes it, and touches never reach the screen underneath. A light
          scrim keeps the screen readable behind the card. */}
      <Modal
        transparent
        visible={!!open}
        animationType="fade"
        onRequestClose={() => setOpenId(null)}
        statusBarTranslucent
        navigationBarTranslucent
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => setOpenId(null)}
            className="absolute inset-0 bg-black/30"
          />
          {open && (
            <View className="gap-4 px-3" style={{ paddingTop: insets.top + 16 }} pointerEvents="box-none">
              <View className="flex-row justify-end gap-3.5 px-1" pointerEvents="box-none">
                {list.map((cook, i) => (
                  <Pressable
                    key={cook.session.id}
                    accessibilityRole="button"
                    accessibilityLabel={cook.recipe.title}
                    accessibilityState={{ selected: cook.session.id === open.session.id }}
                    onPress={() => setOpenId(cook.session.id)}
                    className={cn('rounded-full p-0.5', cook.session.id === open.session.id && 'border-[3px] border-primary')}
                  >
                    <CookHeadFace head={heads[i]} size={52} />
                  </Pressable>
                ))}
              </View>
              <CookCard
                cook={open}
                cooks={cooks}
                now={now}
                onOpen={() => {
                  setOpenId(null);
                  openRoute(`/recipes/${open.recipe.id}`);
                }}
                onStop={() => {
                  setOpenId(null);
                  stop(open.session.id);
                }}
              />
            </View>
          )}
        </GestureHandlerRootView>
      </Modal>
    </>
  );
}
