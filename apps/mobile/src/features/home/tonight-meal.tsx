// Meal plan on Home (hub.meals): one feed-style row for tonight's dinner,
// "Tonight: Thai green curry" with its time as the row's one trailing fact.
// Nothing shows while tonight isn't planned. Tapping opens Recipes' week.
// Web twin: apps/web/src/app/home/tonight-meal.tsx.
import type { StyleProp, ViewStyle } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { LeadingTile, ListGroup, ListItem, ListItemContent, ListItemTitle, ListItemTrailing, Text } from '@homeup/ui';
import { todayISO, useModules, useTonightMeal } from '@homeup/core';
import { sectionIconFor } from '@/lib/section-icons';

export function TonightMeal({ groupId, style }: { groupId: string | null | undefined; style?: StyleProp<ViewStyle> }) {
  const modules = useModules();
  const on = modules.feature('hub.meals');
  const tonight = useTonightMeal(groupId, on, todayISO(), modules.server('meals.multi-dish'));
  const router = useRouter();
  if (!tonight) return null;
  return (
    <ListGroup style={style}>
      <ListItem
        className="items-center"
        onPress={() => router.push('/recipes?tab=week' as Href)}
        accessibilityRole="button"
        accessibilityLabel={tonight.time ? `${tonight.title}, ${tonight.time}` : tonight.title}
      >
        <LeadingTile sectionId="recipes" Icon={sectionIconFor('recipes')} />
        <ListItemContent>
          <ListItemTitle>{tonight.title}</ListItemTitle>
        </ListItemContent>
        {tonight.time && (
          <ListItemTrailing>
            <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {tonight.time}
            </Text>
          </ListItemTrailing>
        )}
      </ListItem>
    </ListGroup>
  );
}
