// HOUP-446: Settings > Assistant > Telegram. A member links their Telegram
// account with a one-time code (sent to the bot as /start CODE, or by
// opening the t.me link), after which the bot answers as them. While a code
// is showing, the panel checks every few seconds so it flips to "Linked" by
// itself. One primary action (PC).
// Web twin: apps/web/src/components/assistant-telegram.tsx.
import { useCallback, useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { Send } from 'lucide-react-native';
import { Button, Text, toast } from '@homeup/ui';
import type { AssistantTelegramCode, AssistantTelegramStatus } from '@homeup/core';
import { assistantApi } from '@/features/assistant/assistant-api';
import { SettingsInset, SettingsPanel } from './settings-panel';

export function AssistantTelegram() {
  const [status, setStatus] = useState<AssistantTelegramStatus | null>(null);
  const [code, setCode] = useState<AssistantTelegramCode | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    assistantApi
      .telegramStatus()
      .then((s) => {
        setStatus(s);
        if (s.linked) setCode(null);
      })
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => {
      if (Date.parse(code.expiresAt) < Date.now()) setCode(null);
      else load();
    }, 4000);
    return () => clearInterval(timer);
  }, [code, load]);

  const makeCode = async () => {
    setBusy(true);
    try {
      setCode(await assistantApi.telegramLinkCode());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not make a code.');
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setBusy(true);
    try {
      await assistantApi.telegramUnlink();
      setStatus((s) => (s ? { ...s, linked: null } : s));
      toast.message('Telegram disconnected.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  };

  // A server with no bot has nothing here anyone can use, so the panel stays out of the way.
  if (!status?.configured) return null;
  const bot = status.botUsername ? `@${status.botUsername}` : 'the bot';

  return (
    <SettingsPanel
      icon={Send}
      title="Telegram"
      description='Talk to the assistant from Telegram. It answers as you, and the chat shows here in Rooftap too.'
    >
      {(status.linked ? (
          <SettingsInset>
            <View className="min-h-[52px] flex-row items-center gap-3 px-3.5 py-2.5">
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-medium text-foreground">
                  {status.linked.username ? `Linked as @${status.linked.username}` : 'Linked'}
                </Text>
                <Text className="mt-0.5 text-xs text-muted-foreground">Message {bot}, or add it to a group and mention it.</Text>
              </View>
              <Button variant="ghost" size="sm" disabled={busy} onPress={() => void unlink()} className="h-11">
                <Text className="text-sm font-medium text-foreground">Disconnect</Text>
              </Button>
            </View>
          </SettingsInset>
        ) : code ? (
          <View className="gap-3">
            <SettingsInset>
              <View className="px-3.5 py-3">
                <Text selectable className="font-mono text-2xl font-semibold tracking-[0.2em] text-foreground">
                  {code.code}
                </Text>
                <Text className="mt-1 text-xs text-muted-foreground">
                  Send /start {code.code} to {bot}. The code works for 10 minutes.
                </Text>
              </View>
            </SettingsInset>
            {code.link && (
              <Button onPress={() => void Linking.openURL(code.link!)} className="h-11 self-start px-3.5">
                <Text className="text-sm font-medium text-primary-foreground">Open Telegram</Text>
              </Button>
            )}
          </View>
        ) : (
          <Button disabled={busy} onPress={() => void makeCode()} className="h-11 self-start px-3.5">
            <Text className="text-sm font-medium text-primary-foreground">Link Telegram</Text>
          </Button>
        ))}
    </SettingsPanel>
  );
}
