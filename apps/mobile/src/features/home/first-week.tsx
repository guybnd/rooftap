// The "First week" card on Home (core first-week.ts, Guy's pick on
// 2026-11-10): a new household's first steps under the lede, each with one
// link. A step whose tile is off is left out; the card goes once every step is
// done, the person hides it, or the household is two weeks old.
// Web twin: apps/web/src/app/home/first-week.tsx.
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import { LeadingTile, ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing, Text } from '@homeup/ui';
import { dialog, firstWeekWidgetHelp, todayISO, useFirstWeek, useModules, useTonightMeal } from '@homeup/core';
import { sectionIconFor } from '@/lib/section-icons';

export function FirstWeek({
  groupId,
  groupCreatedAt,
  memberCount,
  hasCost,
  style,
}: {
  groupId: string | null | undefined;
  groupCreatedAt: string | null | undefined;
  memberCount: number;
  hasCost: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const router = useRouter();
  const modules = useModules();
  const dinnerOn = modules.feature('hub.meals');
  const tonight = useTonightMeal(groupId, dinnerOn, todayISO(), modules.server('meals.multi-dish'));
  const week = useFirstWeek({
    groupId,
    groupCreatedAt,
    platform: 'phone',
    dinnerOn,
    billOn: modules.feature('capture.cost'),
    dinnerPlanned: !!tonight,
    hasCost,
    memberCount,
  });
  if (!week.visible) return null;
  const total = week.steps.length;

  return (
    <ListGroup style={style} accessibilityLabel="First week">
      <View className="flex-row items-center gap-3 p-3">
        <LeadingTile sectionId="home" Icon={sectionIconFor('home')} size="md" />
        <View className="min-w-0 flex-1">
          <Text className="font-heading text-title text-foreground">First week</Text>
          <View className="mt-1.5 flex-row items-center gap-2">
            {/* H3: a local segmented meter, one segment per step, in the checklist green. */}
            <View className="w-24 flex-row gap-1">
              {week.steps.map((s) => (
                <View key={s.id} className={s.done ? 'h-[3px] flex-1 rounded-full bg-success' : 'h-[3px] flex-1 rounded-full bg-foreground/15'} />
              ))}
            </View>
            <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {week.done} of {total}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={week.dismiss}
          accessibilityRole="button"
          accessibilityLabel="Hide First week"
          hitSlop={8}
          className="size-11 items-center justify-center rounded-full active:bg-accent/30"
        >
          <X size={16} className="text-muted-foreground" />
        </Pressable>
      </View>
      {week.steps.map((step) => {
        const open = () => {
          week.tap(step.id);
          if (step.href) {
            router.push(step.href as Href);
          } else {
            const help = firstWeekWidgetHelp('phone');
            dialog.alert(help.title, help.message);
          }
        };
        return (
          <ListItem
            key={step.id}
            className="items-center"
            onPress={step.done ? undefined : open}
            accessibilityRole={step.done ? undefined : 'button'}
            accessibilityLabel={step.done ? `${step.title}, done` : `${step.title}. ${step.meta}`}
          >
            <View
              className={
                step.done
                  ? 'size-5 items-center justify-center rounded-full border-2 border-success bg-success'
                  : 'size-5 items-center justify-center rounded-full border-2 border-border'
              }
            >
              {step.done && <Check size={12} strokeWidth={3} className="text-background" />}
            </View>
            <ListItemContent>
              <ListItemTitle className={step.done ? 'text-muted-foreground line-through' : undefined}>{step.title}</ListItemTitle>
              <ListItemMeta>
                <Text className="text-caption text-muted-foreground">{step.meta}</Text>
              </ListItemMeta>
            </ListItemContent>
            {!step.done && (
              <ListItemTrailing>
                <Text className="text-caption font-semibold text-primary">{step.action}</Text>
              </ListItemTrailing>
            )}
          </ListItem>
        );
      })}
    </ListGroup>
  );
}
