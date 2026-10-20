// HOUP-78: native port of apps/web/src/app/apartment/bulk/page.tsx —
// bulk-import apartments by pasting one listing URL per line. Each URL is
// parsed sequentially (not parallel — mirrors the web original, likely
// intentional for rate-limiting the AI parser) via the same
// features/homesearch/parse-listing-api.ts helper Task 1 (apartment/new.tsx)
// uses, and saved through the same features/homesearch/
// create-apartment-from-parsed.ts helper so agent-matching/creation and the
// apartment-row write sequencing stay identical between the two screens.
//
// One deliberate simplification vs. the web original: web's progress is
// persisted via useBulkUploadSession (localStorage), so a page reload
// mid-run can resume. That survives-a-reload guarantee matters far less for
// a native bulk-paste screen than for a web tab that might get refreshed —
// killing the app mid-run here is a much rarer/more deliberate act — so
// progress here is plain in-memory React state, resumable only within the
// same screen session (survives navigating away and back while the app
// stays alive, not an app kill/relaunch).
//
// Hearth v2 pass (mirrors web): Back on its own row, Display-step title, a
// fragment caption, the queue as one Card of divided rows (H4) where a saved
// row opens its apartment, and one status line ("Processing 3 of 10",
// "2 saved · 1 failed").
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
// HOUP-318: keyboard-aware scroll container (same swap as Home/Costs) so an
// inline field low on the page scrolls above the on-screen keyboard.
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { ArrowLeft, CheckCircle2, ExternalLink, Play, Square, XCircle } from 'lucide-react-native';
import { use$ } from '@legendapp/state/react';
import { Text, Button, Card, Input, ScreenBackground } from '@homeup/ui';
import { agents$, apartmentAgents$, apartments$, useReconnectSync, useStoreHelpers, type Agent } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { createApartmentFromParsed, resolveParsedAgents } from '@/features/homesearch/create-apartment-from-parsed';
import { parseListing } from '@/features/homesearch/parse-listing-api';
import { useOpenRoute } from '@/lib/tab-routes';

type UrlStatus = 'queued' | 'parsing' | 'saving' | 'done' | 'failed';

interface UrlEntry {
  url: string;
  status: UrlStatus;
  address?: string;
  apartmentId?: string;
  error?: string;
}

function StatusIcon({ status }: { status: UrlStatus }) {
  switch (status) {
    case 'queued':
      return <View className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />;
    case 'parsing':
    case 'saving':
      return <ActivityIndicator size="small" />;
    case 'done':
      return <CheckCircle2 size={20} className="text-success" />;
    case 'failed':
      return <XCircle size={20} className="text-destructive" />;
  }
}

export default function BulkUploadScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const openRoute = useOpenRoute();
  const { group, currentUserId, loading: cacheLoading } = useDataCache();

  const agentsStore$ = agents$(group?.id);
  const apts$ = apartments$(group?.id);
  const apartmentAgentsStore$ = apartmentAgents$(group?.id);
  useReconnectSync(agentsStore$);
  useReconnectSync(apts$);
  useReconnectSync(apartmentAgentsStore$);
  const { writeRow: writeAgent } = useStoreHelpers(agentsStore$, currentUserId);
  const { writeRow: writeApartment, patchRow: patchApartment } = useStoreHelpers(apts$, currentUserId);
  const { writeRow: writeApartmentAgent } = useStoreHelpers(apartmentAgentsStore$, currentUserId);
  const agents = use$(() =>
    Object.values(agentsStore$.get() ?? {}).filter((a): a is Agent => !!a && !a.deleted)
  );

  const [urls, setUrls] = React.useState('');
  const [entries, setEntries] = React.useState<UrlEntry[]>([]);
  const [running, setRunning] = React.useState(false);
  const stopRef = React.useRef(false);

  const updateEntry = React.useCallback((index: number, patch: Partial<UrlEntry>) => {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }, []);

  const processUrls = async () => {
    if (!group) return;
    const lines = urls
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && l.startsWith('http'));
    if (!lines.length) return;

    const initial: UrlEntry[] = lines.map((url) => ({ url, status: 'queued' }));
    setEntries(initial);
    setRunning(true);
    stopRef.current = false;

    for (let i = 0; i < initial.length; i++) {
      if (stopRef.current) break;
      updateEntry(i, { status: 'parsing' });

      try {
        const data = await parseListing({ url: initial[i].url });

        if (!data.address) {
          updateEntry(i, { status: 'failed', error: 'No address extracted' });
          continue;
        }

        updateEntry(i, { status: 'saving', address: data.address });
        if (stopRef.current) break;

        const parsedAgents = data.agents?.length
          ? data.agents
          : data.agent_name
            ? [{ name: data.agent_name, phone: data.agent_phone }]
            : [];
        const resolvedAgentIds = resolveParsedAgents(parsedAgents, agents, writeAgent, group.id, currentUserId);

        const apartmentId = await createApartmentFromParsed({
          groupId: group.id,
          currentUserId,
          address: data.address,
          suburb: data.suburb || null,
          rentPerWeek: data.rent_per_week ?? null,
          bedrooms: data.bedrooms ?? null,
          bathrooms: data.bathrooms ?? null,
          parking: data.parking ?? false,
          listingUrl: initial[i].url,
          notes: data.notes || null,
          agentIds: resolvedAgentIds,
          imageUrls: data.image_urls ?? [],
          writeApartment,
          writeApartmentAgent,
          patchApartment,
        });

        updateEntry(i, { status: 'done', apartmentId });
      } catch (err) {
        updateEntry(i, { status: 'failed', error: err instanceof Error ? err.message : 'Network error' });
      }
    }

    setRunning(false);
  };

  const stop = () => {
    stopRef.current = true;
  };

  const startOver = () => {
    setEntries([]);
    setUrls('');
  };

  const doneCount = entries.filter((e) => e.status === 'done').length;
  const failedCount = entries.filter((e) => e.status === 'failed').length;

  if (cacheLoading) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

  if (!group) {
    return <NoGroupScreen />;
  }

  return (
    <ScreenBackground>
    <KeyboardAwareScrollView
      className="flex-1"
      contentContainerClassName="gap-4 p-4"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 96 }}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable
        onPress={() => router.back()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Back"
        className="-ml-1 min-h-[44px] flex-row items-center gap-1 self-start px-1"
      >
        <ArrowLeft size={16} className="text-muted-foreground" />
        <Text className="text-sm text-muted-foreground">Back</Text>
      </Pressable>
      <View className="gap-1">
        <Text className="text-display text-foreground">Bulk upload</Text>
        <Text className="text-sm text-muted-foreground">One listing URL per line, each saved as an apartment</Text>
      </View>

      {entries.length === 0 ? (
        <View className="gap-3">
          <Input
            value={urls}
            onChangeText={setUrls}
            placeholder={'https://www.domain.com.au/...\nhttps://www.realestate.com.au/...'}
            multiline
            numberOfLines={8}
            className="h-40 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-body text-foreground"
            style={{ textAlignVertical: 'top' }}
          />
          <Button className="h-11" onPress={processUrls} disabled={!urls.trim()}>
            <Play size={14} className="text-primary-foreground" />
            <Text className="text-sm font-medium text-primary-foreground">Start processing</Text>
          </Button>
        </View>
      ) : (
        <View className="gap-4">
          <View className="flex-row items-center justify-between gap-3">
            {running ? (
              <Text className="text-sm text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                Processing {doneCount + failedCount} of {entries.length}
              </Text>
            ) : (
              <Text className="text-sm text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                {doneCount} saved
                {failedCount > 0 ? (
                  <>
                    <Text className="text-sm text-muted-foreground">{' · '}</Text>
                    <Text className="text-sm text-destructive">{failedCount} failed</Text>
                  </>
                ) : null}
              </Text>
            )}
            {running ? (
              <Button variant="outline" size="sm" onPress={stop}>
                <Square size={14} className="text-muted-foreground" />
                <Text className="text-sm font-medium text-foreground">Stop</Text>
              </Button>
            ) : (
              <Button variant="outline" size="sm" onPress={startOver}>
                <Text className="text-sm font-medium text-foreground">Start over</Text>
              </Button>
            )}
          </View>

          <Card className="gap-0 rounded-3xl py-0">
            {entries.map((entry, i) => {
              const content = (
                <>
                  <StatusIcon status={entry.status} />
                  <View className="min-w-0 flex-1">
                    {entry.address ? (
                      <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                        {entry.address}
                      </Text>
                    ) : (
                      <Text numberOfLines={1} className="text-sm text-muted-foreground">
                        {entry.url}
                      </Text>
                    )}
                    {entry.error && <Text className="mt-0.5 text-xs text-destructive">{entry.error}</Text>}
                  </View>
                  {entry.apartmentId && <ExternalLink size={16} className="text-muted-foreground" />}
                </>
              );
              const rowClass = `min-h-[56px] flex-row items-center gap-3 px-4 py-2.5${i > 0 ? ' border-t border-border/60' : ''}`;
              return entry.apartmentId ? (
                <Pressable
                  key={i}
                  onPress={() => router.push(`/apartment/${entry.apartmentId}` as Href)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${entry.address ?? 'apartment'}`}
                  className={`${rowClass} active:bg-muted/40`}
                >
                  {content}
                </Pressable>
              ) : (
                <View key={i} className={rowClass}>
                  {content}
                </View>
              );
            })}
          </Card>

          {!running && (
            <Button variant="outline" className="h-11" onPress={() => openRoute('/homesearch')}>
              <Text className="text-sm font-medium text-foreground">Done</Text>
            </Button>
          )}
        </View>
      )}
    </KeyboardAwareScrollView>
    </ScreenBackground>
  );
}
