// Settings > Integrations & keys > Feedback (server operators only): what
// people sent the Rooftap team through the Assistant. New first; marking one
// done moves it under Done. Web twin: apps/web/src/components/feedback-inbox.tsx.
import * as React from 'react';
import { Linking, Pressable, View } from 'react-native';
import { MessageSquareText } from 'lucide-react-native';
import { Button, Text, toast } from '@homeup/ui';
import { timeAgo, type FeedbackInbox as Inbox, type FeedbackItem } from '@homeup/core';
import { feedbackInbox, setFeedbackDone } from '../ai-keys-api';
import { SettingsInset, SettingsLabel, SettingsPanel } from './settings-panel';

function Row({ item, busy, onToggle }: { item: FeedbackItem; busy: boolean; onToggle: () => void }) {
  return (
    <View className="gap-1.5 px-3.5 py-3">
      <Text selectable className="text-sm text-foreground">
        {item.message}
      </Text>
      <View className="flex-row items-center justify-between gap-2">
        <View className="min-w-0 flex-1 flex-row items-center">
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {[item.from ?? 'A deleted account', timeAgo(item.createdAt)].filter(Boolean).join(' · ')}
            {item.issueUrl ? ' · ' : ''}
          </Text>
          {item.issueUrl ? (
            <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(item.issueUrl!)}>
              <Text className="text-xs text-muted-foreground underline">Issue</Text>
            </Pressable>
          ) : null}
        </View>
        <Button size="sm" variant="ghost" disabled={busy} onPress={onToggle}>
          {item.done ? 'Reopen' : 'Done'}
        </Button>
      </View>
    </View>
  );
}

export function FeedbackInbox() {
  const [inbox, setInbox] = React.useState<Inbox | null>(null);
  const [hidden, setHidden] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    feedbackInbox()
      .then(setInbox)
      .catch((err: { status?: number }) => {
        // 403: not an operator. 404: a server from before this panel.
        if (err.status === 403 || err.status === 404) setHidden(true);
      });
  }, []);

  const toggle = async (item: FeedbackItem) => {
    setBusy(item.id);
    try {
      setInbox(await setFeedbackDone(item.id, !item.done));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that.');
    } finally {
      setBusy(null);
    }
  };

  // Operators only: nothing shows until the server says this person is one.
  if (hidden || !inbox) return null;
  const open = inbox.items.filter((i) => !i.done);
  const done = inbox.items.filter((i) => i.done);

  return (
    <SettingsPanel
      icon={MessageSquareText}
      title="Feedback"
      description={
        inbox.github
          ? 'What people sent through the Assistant, from every household on this server. Each one also opened a GitHub issue.'
          : 'What people sent through the Assistant, from every household on this server.'
      }
    >
      {inbox.items.length === 0 ? (
        <Text className="px-1 text-sm text-muted-foreground">No feedback yet.</Text>
      ) : (
        <View className="gap-4">
          {open.length > 0 && (
            <View className="gap-2">
              <SettingsLabel>New</SettingsLabel>
              <SettingsInset>
                {open.map((item) => (
                  <Row key={item.id} item={item} busy={busy === item.id} onToggle={() => void toggle(item)} />
                ))}
              </SettingsInset>
            </View>
          )}
          {done.length > 0 && (
            <View className="gap-2">
              <SettingsLabel>Done</SettingsLabel>
              <SettingsInset>
                {done.map((item) => (
                  <Row key={item.id} item={item} busy={busy === item.id} onToggle={() => void toggle(item)} />
                ))}
              </SettingsInset>
            </View>
          )}
        </View>
      )}
    </SettingsPanel>
  );
}
