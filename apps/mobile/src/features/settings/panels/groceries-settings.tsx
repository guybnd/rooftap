// HOUP-84: native port of apps/web's groceries-settings.tsx. Reorder aisles
// to set how they group on the shopping list, and set a default unit per
// aisle (both synced via user_settings.grocery_aisle_order/_units, same as
// web) — so preferences set on one device show up on the other.
//
// Deviations from the web version (see report):
//  - HOUP-175: aisle reorder now drags via packages/ui's `ReorderableList`
//    (the HOUP-129 primitive), same long-press-then-drag interaction as
//    web's dnd-kit. Move up/down chevrons stay as the Hearth M3 proof path.
//  - the web `datalist` autocomplete on the unit field becomes
//    `IngredientNameInput` (a generic single-value input with a suggestion
//    dropdown) — RN has no native datalist equivalent.
//  - the `localStorage` mirror of the aisle order (a same-tab web fallback
//    for pre-sync paint) is dropped — native has no localStorage and
//    `userSettings` already round-trips through the DataCacheProvider
//    snapshot for the equivalent cold-start behavior.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ChevronDown, ChevronUp, GripVertical, RotateCcw, ShoppingCart } from 'lucide-react-native';
import {
  Text,
  Button,
  IngredientNameInput,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  ReorderableList,
  SegmentedControl,
  GroceryGlyph,
} from '@homeup/ui';
import {
  AISLE_ORDER,
  GROCERY_DISMISS_SETTING_OPTIONS,
  getAisleMeta,
  groceryDismissSettingValue,
  resolveGroceryDismissAction,
  type GroceryCustomAisle,
  type GroceryDismissSetting,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { SettingsLabel, SettingsPanel } from './settings-panel';

const UNIT_SUGGESTIONS = ['kg', 'g', 'L', 'ml', 'pack', 'bunch', 'dozen', 'can', 'box', 'bottle'];

export function GroceriesSettings() {
  const { userSettings, group, refresh } = useDataCache();

  const [customAisles, setCustomAisles] = useState<GroceryCustomAisle[]>([]);
  const [order, setOrder] = useState<string[]>(AISLE_ORDER as string[]);
  const [units, setUnits] = useState<Record<string, string>>({});
  const [resetting, setResetting] = useState(false);
  const orderHydratedRef = useRef(false);
  const unitsHydratedRef = useRef(false);

  // Fetch custom aisles so they appear alongside the built-ins.
  useEffect(() => {
    if (!group?.id) return;
    const supabase = getCurrentSupabaseClient();
    void supabase
      .from('grocery_aisles')
      .select('*')
      .eq('group_id', group.id)
      .order('sort_order', { ascending: true })
      .then(({ data }) => setCustomAisles((data ?? []) as GroceryCustomAisle[]));
  }, [group?.id]);

  // Hydrate units once from synced settings (DB wins).
  useEffect(() => {
    if (unitsHydratedRef.current || !userSettings) return;
    unitsHydratedRef.current = true;
    setUnits(userSettings.grocery_aisle_units ?? {});
  }, [userSettings]);

  // Build the order: DB order on first hydration, preserved thereafter, always
  // re-merged with every built-in + custom aisle so late-loading aisles appear.
  useEffect(() => {
    const known = [...(AISLE_ORDER as string[]), ...customAisles.map((a) => a.name)];
    setOrder((prev) => {
      let base = prev;
      if (!orderHydratedRef.current) {
        const stored = userSettings?.grocery_aisle_order;
        base = Array.isArray(stored) && stored.length ? stored : (AISLE_ORDER as string[]);
        if (userSettings) orderHydratedRef.current = true;
      }
      const merged = [...base.filter((a) => known.includes(a)), ...known.filter((a) => !base.includes(a))];
      // Avoid churn when nothing actually changed.
      return merged.length === prev.length && merged.every((a, i) => a === prev[i]) ? prev : merged;
    });
  }, [userSettings, customAisles]);

  const isCustomOrder =
    Array.isArray(userSettings?.grocery_aisle_order) && (userSettings!.grocery_aisle_order!.length > 0);

  const persist = useCallback(
    async (payload: {
      grocery_aisle_order?: string[] | null;
      grocery_aisle_units?: Record<string, string>;
      grocery_suggest_dismiss?: string | null;
    }) => {
      const supabase = getCurrentSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, ...payload, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      await refresh();
    },
    [refresh]
  );

  const dismissSetting: GroceryDismissSetting =
    resolveGroceryDismissAction(userSettings?.grocery_suggest_dismiss) ?? 'ask';
  const changeDismiss = (setting: GroceryDismissSetting) =>
    void persist({ grocery_suggest_dismiss: groceryDismissSettingValue(setting) });

  const move = (aisle: string, dir: -1 | 1) => {
    const idx = order.indexOf(aisle);
    const swapIdx = idx + dir;
    if (idx === -1 || swapIdx < 0 || swapIdx >= order.length) return;
    const next = [...order];
    const tmp = next[idx];
    next[idx] = next[swapIdx];
    next[swapIdx] = tmp;
    setOrder(next);
    void persist({ grocery_aisle_order: next });
  };

  const reorderAisles = (nextOrder: string[]) => {
    setOrder(nextOrder);
    void persist({ grocery_aisle_order: nextOrder });
  };

  // Debounce unit edits so typing doesn't hammer the DB.
  const unitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setUnit = (aisle: string, value: string) => {
    setUnits((prev) => {
      const next = { ...prev };
      if (value.trim()) next[aisle] = value.trim();
      else delete next[aisle];
      if (unitTimer.current) clearTimeout(unitTimer.current);
      unitTimer.current = setTimeout(() => void persist({ grocery_aisle_units: next }), 600);
      return next;
    });
  };
  useEffect(
    () => () => {
      if (unitTimer.current) clearTimeout(unitTimer.current);
    },
    []
  );

  const resetOrder = async () => {
    setResetting(true);
    try {
      orderHydratedRef.current = true; // keep DB-null from re-applying a stale order
      setOrder([...(AISLE_ORDER as string[]), ...customAisles.map((a) => a.name)]);
      await persist({ grocery_aisle_order: null });
    } finally {
      setResetting(false);
    }
  };

  return (
    <SettingsPanel icon={ShoppingCart} title="Groceries">
      <View className="gap-1.5">
        <SettingsLabel>Running-low suggestions</SettingsLabel>
        <Text className="px-1 text-caption text-muted-foreground">
          What the X on a suggestion does. Not now hides it until you next buy it. Archive takes it off the list and
          keeps its details in your library.
        </Text>
        <SegmentedControl
          accessibilityLabel="What the X on a running-low suggestion does"
          options={GROCERY_DISMISS_SETTING_OPTIONS}
          value={dismissSetting}
          onChange={changeDismiss}
        />
      </View>

      <View className="gap-1.5">
        <View className="flex-row items-center justify-between gap-3">
          <SettingsLabel>Aisles</SettingsLabel>
          <Button
            variant="ghost"
            size="sm"
            onPress={resetOrder}
            disabled={!isCustomOrder || resetting}
            className="-my-1"
            textClassName="text-muted-foreground"
          >
            <RotateCcw size={14} className="text-muted-foreground" />
            <Text className="text-[0.8rem] font-medium text-muted-foreground">
              {resetting ? 'Resetting…' : 'Reset order'}
            </Text>
          </Button>
        </View>
        <Text className="px-1 text-caption text-muted-foreground">
          Hold and drag to set the order aisles take on your list. A unit prefills new items in that aisle. Syncs across
          your devices.
        </Text>

        {/* H4: one inset fill with hairlines, not a bordered card. */}
        <ReorderableList
          data={order}
          keyExtractor={(aisle) => aisle}
          onReorder={reorderAisles}
          bordered={false}
          className="overflow-hidden rounded-xl bg-muted/30"
          renderItem={(aisle) => {
            const idx = order.indexOf(aisle);
            const meta = getAisleMeta(aisle, customAisles);
            return (
              <ListItem className="min-h-[52px] gap-2 py-2 pl-2 pr-3">
                <ListItemLeading className="gap-1.5">
                  <GripVertical size={14} className="text-muted-foreground/50" />
                  <GroceryGlyph emoji={meta.icon} size={18} />
                </ListItemLeading>
                <ListItemContent>
                  <ListItemTitle>{meta.label}</ListItemTitle>
                  <ListItemMeta>
                    <IngredientNameInput
                      value={units[aisle] ?? ''}
                      onChange={(v) => setUnit(aisle, v)}
                      suggestions={UNIT_SUGGESTIONS}
                      placeholder="Default unit"
                      className="w-32"
                    />
                  </ListItemMeta>
                </ListItemContent>
                <ListItemTrailing className="gap-0.5">
                  {/* M3 non-gesture proof path for the long-press drag. */}
                  <Pressable
                    onPress={() => move(aisle, -1)}
                    disabled={idx === 0}
                    hitSlop={4}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${meta.label} up`}
                    className="size-9 items-center justify-center rounded-full active:bg-accent/40"
                  >
                    <ChevronUp size={16} className={idx === 0 ? 'text-muted-foreground/30' : 'text-muted-foreground'} />
                  </Pressable>
                  <Pressable
                    onPress={() => move(aisle, 1)}
                    disabled={idx === order.length - 1}
                    hitSlop={4}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${meta.label} down`}
                    className="size-9 items-center justify-center rounded-full active:bg-accent/40"
                  >
                    <ChevronDown
                      size={16}
                      className={idx === order.length - 1 ? 'text-muted-foreground/30' : 'text-muted-foreground'}
                    />
                  </Pressable>
                </ListItemTrailing>
              </ListItem>
            );
          }}
        />
      </View>
    </SettingsPanel>
  );
}
