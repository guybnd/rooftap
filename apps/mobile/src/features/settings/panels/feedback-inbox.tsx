// Settings > Integrations & keys > Feedback (server operators only): what
// people sent the Rooftap team through the Assistant, and crash reports from
// the error screen. New first; marking one done moves it under Done. On a
// self-hosted server the operator also decides here, once, whether crash
// reports go on to the Rooftap team. Web twin:
// apps/web/src/components/feedback-inbox.tsx.
import * as React from 'react';
import { Linking, Pressable, View } from 'react-native';
import { MessageSquareText } from 'lucide-react-native';
import { Button, Text, toast } from '@homeup/ui';
import {
  CRASH_SHARE_QUESTION,
  crashUpstreamIssueUrl,
  feedbackInboxDescription,
  feedbackItemMeta,
  offersUpstreamReport,
  type FeedbackInbox as Inbox,
  type FeedbackItem,
} from '@homeup/core';
import { feedbackInbox, setCrashSharing, setFeedbackDone } from '../ai-keys-api';
import { SettingsInset, SettingsLabel, SettingsPanel, SettingsSwitchRow } from './settings-panel';

function Row({
  item,
  upstream,
  busy,
  onToggle,
}: {
  item: FeedbackItem;
  upstream: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const links = [
    item.issueUrl ? { label: 'Issue', url: item.issueUrl } : null,
    upstream ? { label: 'Report upstream', url: crashUpstreamIssueUrl(item.message) } : null,
  ].filter((l): l is { label: string; url: string } => !!l);
  return (
    <View className="gap-1.5 px-3.5 py-3">
      <Text selectable className={item.kind === 'crash' ? 'font-mono text-xs text-foreground' : 'text-sm text-foreground'}>
        {item.message}
      </Text>
      <View className="flex-row items-center justify-between gap-2">
        <View className="min-w-0 flex-1 flex-row items-center">
          <Text className="shrink text-xs text-muted-foreground" numberOfLines={1}>
            {feedbackItemMeta(item)}
          </Text>
          {links.map((link) => (
            <Pressable key={link.label} accessibilityRole="link" onPress={() => void Linking.openURL(link.url)}>
              <Text className="text-xs text-muted-foreground">
                {' · '}
                <Text className="text-xs text-muted-foreground underline">{link.label}</Text>
              </Text>
            </Pressable>
          ))}
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

  const share = async (crashSharing: 'share' | 'off') => {
    setBusy('sharing');
    try {
      setInbox(await setCrashSharing(crashSharing));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that.');
    } finally {
      setBusy(null);
    }
  };

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
      description={feedbackInboxDescription(inbox)}
    >
      {inbox.crashSharing === 'ask' && (
        <SettingsInset className="mb-4 gap-2 p-3.5">
          <Text className="text-sm font-medium text-foreground">{CRASH_SHARE_QUESTION.title}</Text>
          <Text className="text-xs text-muted-foreground">{CRASH_SHARE_QUESTION.body}</Text>
          <View className="flex-row gap-2 pt-1">
            <Button size="sm" disabled={busy === 'sharing'} onPress={() => void share('share')}>
              {CRASH_SHARE_QUESTION.share}
            </Button>
            <Button size="sm" variant="outline" disabled={busy === 'sharing'} onPress={() => void share('off')}>
              {CRASH_SHARE_QUESTION.keep}
            </Button>
          </View>
        </SettingsInset>
      )}
      {(inbox.crashSharing === 'share' || inbox.crashSharing === 'off') && !inbox.crashSharingFixed && (
        <SettingsInset className="mb-4">
          <SettingsSwitchRow
            title="Share crash reports with the Rooftap team"
            description="Without names, households or items."
            checked={inbox.crashSharing === 'share'}
            disabled={busy === 'sharing'}
            onChange={(on) => void share(on ? 'share' : 'off')}
          />
        </SettingsInset>
      )}
      {inbox.items.length === 0 ? (
        <Text className="px-1 text-sm text-muted-foreground">No feedback yet.</Text>
      ) : (
        <View className="gap-4">
          {open.length > 0 && (
            <View className="gap-2">
              <SettingsLabel>New</SettingsLabel>
              <SettingsInset>
                {open.map((item) => (
                  <Row
                    key={item.id}
                    item={item}
                    upstream={offersUpstreamReport(inbox, item)}
                    busy={busy === item.id}
                    onToggle={() => void toggle(item)}
                  />
                ))}
              </SettingsInset>
            </View>
          )}
          {done.length > 0 && (
            <View className="gap-2">
              <SettingsLabel>Done</SettingsLabel>
              <SettingsInset>
                {done.map((item) => (
                  <Row
                    key={item.id}
                    item={item}
                    upstream={offersUpstreamReport(inbox, item)}
                    busy={busy === item.id}
                    onToggle={() => void toggle(item)}
                  />
                ))}
              </SettingsInset>
            </View>
          )}
        </View>
      )}
    </SettingsPanel>
  );
}
