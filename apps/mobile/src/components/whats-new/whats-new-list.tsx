// What's new rows (whats-new/README.md), shared by the launch sheet and the
// history in Settings > About & updates. Each entry is a line item led by its
// section's tile (Hearth H2), title and one caption, with an optional "Show me"
// link trailing (the only coral, M3). Release headers are micro labels.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react-native';
import { LeadingTile, ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemMeta, ListItemTitle, ListItemTrailing, Text } from '@homeup/ui';
import {
  changesLabel,
  fixesLabel,
  getModule,
  getSection,
  initialOpenGroups,
  todayISO,
  whatsNewDayLabel,
  whatsNewGroupKey,
  type WhatsNewEntry,
  type WhatsNewView,
} from '@homeup/core';
import { sectionIcons } from '@/lib/section-icons';

/** The tile's section: the entry's own, or Home for app-wide changes. */
function tileFor(entry: WhatsNewEntry) {
  if (entry.module === 'app') return { sectionId: 'home', Icon: Sparkles };
  const iconId = getSection(entry.module)?.iconId ?? getModule(entry.module)?.iconId;
  return { sectionId: entry.module, Icon: (iconId && sectionIcons[iconId]) || Sparkles };
}

function actionLabel(entry: WhatsNewEntry): string {
  return entry.kind === 'feature' ? 'Try it' : 'Show me';
}

export function WhatsNewRow({ entry, onOpen }: { entry: WhatsNewEntry; onOpen?: (link: string) => void }) {
  const { sectionId, Icon } = tileFor(entry);
  const link = onOpen && entry.link;
  return (
    <ListItem
      onPress={link ? () => onOpen(link) : undefined}
      accessibilityRole={link ? 'link' : undefined}
      accessibilityHint={link ? actionLabel(entry) : undefined}
    >
      <ListItemLeading>
        <LeadingTile sectionId={sectionId} Icon={Icon} size="md" />
      </ListItemLeading>
      <ListItemContent>
        <ListItemTitle>{entry.title}</ListItemTitle>
        <ListItemMeta>{entry.body}</ListItemMeta>
      </ListItemContent>
      {link && (
        <ListItemTrailing>
          <Text className="text-caption font-semibold text-primary">{actionLabel(entry)}</Text>
        </ListItemTrailing>
      )}
    </ListItem>
  );
}

function FixesRow({ fixes }: { fixes: WhatsNewEntry[] }) {
  const [open, setOpen] = React.useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="min-h-12 flex-row items-center justify-between px-3.5 py-3"
      >
        <Text className="text-caption text-muted-foreground">{fixesLabel(fixes.length)}</Text>
        <Chevron size={16} className="text-muted-foreground" />
      </Pressable>
      {open && (
        <View className="gap-2 px-3.5 pb-3">
          {fixes.map((f) => (
            <Text key={f.id} className="text-caption text-muted-foreground">
              {f.title}. {f.body}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const MICRO_LABEL = 'px-1 pb-1.5 text-micro-label uppercase text-muted-foreground';

export interface WhatsNewGroupsProps {
  view: WhatsNewView;
  /** Opens an entry's link; rows have no link without it. */
  onOpen?: (link: string) => void;
  /** "14 more" row under the groups. */
  onMore?: () => void;
  /** Header every group, even a single one. */
  alwaysHeaders?: boolean;
  /** The history: only the newest release starts open, the rest fold to their header (rows aren't rendered while folded). */
  collapsible?: boolean;
}

export function WhatsNewGroups({ view, onOpen, onMore, alwaysHeaders, collapsible }: WhatsNewGroupsProps) {
  const today = todayISO();
  const headers = alwaysHeaders || collapsible || view.showVersions;
  const footer = view.moreCount > 0 || view.fixes.length > 0;
  const [openKeys, setOpenKeys] = React.useState(() => initialOpenGroups(view));
  const toggle = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <View className="gap-4">
      {view.groups.map((g) => {
        const key = whatsNewGroupKey(g);
        const label = `${g.version ?? 'Latest'} · ${whatsNewDayLabel(g.date, today)}`;
        const open = !collapsible || openKeys.has(key);
        const Chevron = open ? ChevronDown : ChevronRight;
        return (
          <View key={key}>
            {collapsible ? (
              <Pressable
                onPress={() => toggle(key)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${label}, ${changesLabel(g.entries.length)}`}
                className="min-h-11 flex-row items-center gap-1.5 px-1 pb-1.5"
              >
                <Chevron size={14} className="text-muted-foreground" />
                <Text className="flex-1 text-micro-label uppercase text-muted-foreground">{label}</Text>
                <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>{changesLabel(g.entries.length)}</Text>
              </Pressable>
            ) : (
              headers && <Text className={MICRO_LABEL}>{label}</Text>
            )}
            {open && (
              <ListGroup bordered={false} className="overflow-hidden rounded-[20px] bg-muted">
                {g.entries.map((e) => (
                  <WhatsNewRow key={e.id} entry={e} onOpen={onOpen} />
                ))}
              </ListGroup>
            )}
          </View>
        );
      })}
      {footer && (
        <ListGroup bordered={false} className="overflow-hidden rounded-[20px] bg-muted">
          {view.moreCount > 0 && (
            <ListItem onPress={onMore} accessibilityRole="link">
              <ListItemContent>
                <ListItemTitle>{view.moreCount === 1 ? '1 more change' : `${view.moreCount} more changes`}</ListItemTitle>
              </ListItemContent>
              <ListItemTrailing>
                <ChevronRight size={16} className="text-muted-foreground" />
              </ListItemTrailing>
            </ListItem>
          )}
          {view.fixes.length > 0 && <FixesRow fixes={view.fixes} />}
        </ListGroup>
      )}
    </View>
  );
}
