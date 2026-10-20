// HOUP-68: placeholder content for each section route — proves the kit
// (Card/ListGroup/ListItem/Pill) renders real content end-to-end through the
// nav shell. Real Phase-2 screens replace this per-section as they're built;
// this file is deliberately generic (not itself Phase-2 scope).
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Text,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  Pill,
} from '@homeup/ui';
import type { Section } from '@homeup/core';

export function SectionPlaceholderScreen({ section }: { section: Section }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 96 }}
    >
      <Text className="text-display font-semibold text-foreground">{section.label}</Text>

      <Card>
        <CardHeader>
          <CardTitle>Phase 2 screen pending</CardTitle>
          <CardDescription>
            This placeholder proves navigation, tokens, and the kit render together. The real{' '}
            {section.label.toLowerCase()} screen ships with its own Phase-2 ticket.
          </CardDescription>
        </CardHeader>
      </Card>

      <ListGroup>
        <ListItem>
          <ListItemContent>
            <ListItemTitle>Route</ListItemTitle>
            <ListItemMeta>
              <Text className="text-caption text-muted-foreground">{section.basePath}</Text>
            </ListItemMeta>
          </ListItemContent>
          <ListItemTrailing>
            <Pill variant="muted">{section.id}</Pill>
          </ListItemTrailing>
        </ListItem>
      </ListGroup>
    </ScrollView>
  );
}
