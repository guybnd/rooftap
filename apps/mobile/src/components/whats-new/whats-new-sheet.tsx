// The launch "What's new" (whats-new/README.md, Guy's pick Oct 21: the sheet,
// plus a full-screen card for big launches). On Home, once modules have
// loaded and nothing else is up, everything this device hasn't seen shows in
// one go: spotlight cards first, one per page, then a pull-up sheet with the
// rest. Closing either marks the whole batch seen.
import * as React from 'react';
import { Modal, Pressable, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sparkles } from 'lucide-react-native';
import {
  BottomSheet,
  BottomSheetScrollView,
  Button,
  LeadingTile,
  SectionGlow,
  SectionProvider,
  Text,
  haptics,
} from '@homeup/ui';
import {
  getModule,
  getSection,
  useModulePicker,
  useWhatsNew,
  whatsNewHeadline,
  type WhatsNewEntry,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { sectionIcons } from '@/lib/section-icons';
import { WhatsNewGroups } from './whats-new-list';

// Lets Home paint (and the launch toasts settle) before the sheet rises.
const SETTLE_MS = 900;
const HISTORY_HREF = '/settings/about';

function Spotlight({
  entry,
  index,
  count,
  onNext,
  onSkip,
  onTry,
}: {
  entry: WhatsNewEntry;
  index: number;
  count: number;
  onNext: () => void;
  onSkip: () => void;
  onTry?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const iconId = getSection(entry.module)?.iconId ?? getModule(entry.module)?.iconId;
  const Icon = (iconId && sectionIcons[iconId]) || Sparkles;
  const label = getSection(entry.module)?.label ?? getModule(entry.module)?.label;
  const last = index === count - 1;
  return (
    <SectionProvider sectionId={entry.module}>
      <View className="flex-1 bg-background">
        <SectionGlow sectionId={entry.module} />
        <View className="flex-1 gap-5 px-5" style={{ paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 }}>
          <View className="flex-row items-center justify-between">
            <Text className="text-micro-label uppercase text-muted-foreground">
              What&apos;s new{count > 1 ? ` · ${index + 1} of ${count}` : ''}
            </Text>
            <Pressable onPress={onSkip} accessibilityRole="button" hitSlop={12}>
              <Text className="text-body font-semibold text-muted-foreground">Skip</Text>
            </Pressable>
          </View>

          <View className="flex-1 gap-3.5 rounded-[28px] border border-border bg-card p-6">
            <LeadingTile sectionId={entry.module} Icon={Icon} size="xl" />
            {label && <Text className="text-micro-label uppercase text-muted-foreground">New in {label}</Text>}
            <Text accessibilityRole="header" className="text-display text-foreground">
              {entry.title}
            </Text>
            <Text className="text-body leading-relaxed text-foreground/85">{entry.body}</Text>
          </View>

          {count > 1 && (
            <View className="flex-row items-center justify-center gap-1.5" importantForAccessibility="no-hide-descendants">
              {Array.from({ length: count }, (_, i) => (
                <View key={i} className={i === index ? 'h-1.5 w-[18px] rounded-full bg-primary' : 'size-1.5 rounded-full bg-border'} />
              ))}
            </View>
          )}

          <View className="flex-row gap-2.5">
            {onTry && (
              <Button variant="secondary" size="lg" className="h-[50px] flex-1 rounded-2xl" onPress={onTry}>
                Try it
              </Button>
            )}
            <Button size="lg" className="h-[50px] flex-1 rounded-2xl" onPress={onNext}>
              {last ? 'Done' : 'Next'}
            </Button>
          </View>
        </View>
      </View>
    </SectionProvider>
  );
}

export function WhatsNewSheet() {
  const router = useRouter();
  const pathname = usePathname();
  const { group, userSettings, isGroupOwner, pendingInvitations } = useDataCache();
  const picker = useModulePicker({ isOwner: isGroupOwner, pendingInvitations: pendingInvitations.length });
  const onHome = pathname === '/home' || pathname === '/';
  const [settled, setSettled] = React.useState(false);
  React.useEffect(() => {
    if (!onHome || !group || picker.open) return;
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [onHome, group, picker.open]);

  const { open, view, dismiss } = useWhatsNew({
    platform: 'mobile',
    hidden: userSettings?.hidden_sections,
    ready: settled && onHome && !picker.open,
  });
  const [page, setPage] = React.useState(0);

  if (!open || !view) return null;
  const spotlight = view.spotlights[page];
  const hasList = view.groups.length > 0 || view.fixes.length > 0;

  const go = (href: string) => {
    dismiss();
    router.push(href as never);
  };
  const next = () => {
    haptics.select();
    if (page + 1 < view.spotlights.length || hasList) setPage((p) => p + 1);
    else dismiss();
  };

  if (spotlight) {
    return (
      <Modal visible onRequestClose={dismiss} animationType="fade" statusBarTranslucent navigationBarTranslucent>
        <Spotlight
          entry={spotlight}
          index={page}
          count={view.spotlights.length}
          onNext={next}
          onSkip={dismiss}
          onTry={spotlight.link ? () => go(spotlight.link as string) : undefined}
        />
      </Modal>
    );
  }

  return (
    <BottomSheet open onOpenChange={(o) => !o && dismiss()} className="pb-4">
      <View className="gap-1 px-5 pb-4">
        <Text className="text-micro-label uppercase text-muted-foreground">What&apos;s new</Text>
        <Text accessibilityRole="header" className="text-display text-foreground">
          {whatsNewHeadline(view)}
        </Text>
      </View>
      <BottomSheetScrollView>
        <View className="gap-4 px-4">
          <WhatsNewGroups view={view} onOpen={go} onMore={() => go(HISTORY_HREF)} />
          <Button size="lg" className="h-[50px] rounded-2xl" onPress={dismiss}>
            Got it
          </Button>
          <Text className="text-center text-caption text-muted-foreground">Every update is in Settings › About &amp; updates</Text>
        </View>
      </BottomSheetScrollView>
    </BottomSheet>
  );
}
