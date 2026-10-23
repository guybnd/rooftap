// The files scripts/new-module.mjs writes for a new module. Each one follows
// the conventions the module conformance test (apps/web/src/lib/
// module-conformance.test.ts) checks: logic in core, thin screens on both
// apps, the shared line item and row menu, Assistant tools, a migration with
// grants and RLS. The starter is a plain list of items; reshape it into the
// module, keeping the split.

export function coreModule(n) {
  return `// ${n.label} module: ${n.description}
//
// The pure part of the module: its row type and the view helpers both apps'
// screens and the Assistant's tools use. Sorting, grouping, labels, the Hero
// and each row's menu live here, never in a screen, so web and the phone
// can't drift. Hooks that read and write the store are in use-${n.id}.ts.
import type { RowMenu } from '../../row-actions';

export interface ${n.Pascal}Item {
  id: string;
  group_id: string;
  title: string;
  notes: string | null;
  /** When it was marked done; null while open. */
  done_at: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

/** Open items first in their order, then done ones, most recently done first. */
export function sort${n.Pascal}Items(items: readonly ${n.Pascal}Item[]): ${n.Pascal}Item[] {
  return items.slice().sort((a, b) => {
    if (!a.done_at !== !b.done_at) return a.done_at ? 1 : -1;
    if (a.done_at && b.done_at) return b.done_at.localeCompare(a.done_at);
    return a.sort_order - b.sort_order || a.title.localeCompare(b.title);
  });
}

/** The Hero (Hearth H1): how many are still open. */
export function ${n.camel}Lede(items: readonly ${n.Pascal}Item[]): { value: number; label: string; caption: string } {
  const open = items.filter((i) => !i.done_at).length;
  const done = items.length - open;
  return {
    value: open,
    label: 'open',
    caption: done ? \`\${done} done\` : items.length ? 'Nothing done yet' : 'Nothing here yet',
  };
}

/** The row's second line, or null for none. */
export function ${n.camel}ItemMeta(item: ${n.Pascal}Item): string | null {
  const note = item.notes?.split('\\n')[0]?.trim();
  return note || null;
}

export interface ${n.Pascal}RowHandlers {
  onToggleDone?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}

/**
 * The row's menu (Hearth §13.7): web draws it on a right-click
 * (useRowContextMenu), the phone on a long press (useRowMenuSheet).
 */
export function ${n.camel}RowMenu(item: ${n.Pascal}Item, h: ${n.Pascal}RowHandlers): RowMenu {
  return {
    title: item.title,
    kind: '${n.itemKind}',
    actions: [
      h.onToggleDone && {
        id: 'done',
        label: item.done_at ? 'Mark not done' : 'Mark done',
        group: 'state',
        icon: item.done_at ? 'undo' : 'done',
        run: h.onToggleDone,
      },
      h.onRename && { id: 'rename', label: 'Rename', group: 'edit', icon: 'edit', run: h.onRename },
      h.onDelete && { id: 'delete', label: 'Delete', group: 'danger', icon: 'delete', run: h.onDelete },
    ],
  };
}
`;
}

export function coreHook(n) {
  return `'use client';

// ${n.label} module: the household's items with the writes both apps'
// screens make. Screens call this and render; they hold no data logic.

import { useCallback, useMemo } from 'react';
import { use$ } from '@legendapp/state/react';
import { ${n.camel}Items$ } from '../../data/stores';
import { useReconnectSync, useStoreHelpers } from '../../data/create-group-store';
import { useStoreLoaded } from '../../data/use-store-loaded';
import { envRandomUUID } from '../../data/store-environment';
import { dialog } from '../../dialog-store';
import { sort${n.Pascal}Items, type ${n.Pascal}Item } from './${n.id}';

/** \`groupId\` undefined opens the inert store (the module is off). */
export function use${n.Pascal}(groupId: string | undefined, currentUserId: string | null | undefined) {
  const items$ = ${n.camel}Items$(groupId);
  useReconnectSync(items$);
  const loaded = useStoreLoaded(items$);
  const rows = use$(() => Object.values(items$.get() ?? {}).filter((r): r is ${n.Pascal}Item => !!r && !r.deleted));
  const items = useMemo(() => sort${n.Pascal}Items(rows), [rows]);
  const helpers = useStoreHelpers(items$, currentUserId);

  const add = useCallback(
    (title: string) => {
      const name = title.trim();
      if (!groupId || !name) return null;
      const id = envRandomUUID();
      helpers.writeRow({
        id,
        group_id: groupId,
        title: name,
        notes: null,
        done_at: null,
        sort_order: items.length,
        created_by: currentUserId ?? null,
        created_at: '',
        updated_at: '',
        deleted: false,
      });
      return id;
    },
    [groupId, currentUserId, helpers, items.length],
  );

  const toggleDone = useCallback(
    (item: ${n.Pascal}Item) => helpers.patchRow(item.id, { done_at: item.done_at ? null : new Date().toISOString() }),
    [helpers],
  );

  /** Deletes the item and returns its undo. */
  const remove = useCallback(
    (id: string) => {
      helpers.softDeleteRow(id);
      return () => helpers.patchRow(id, { deleted: false });
    },
    [helpers],
  );

  /** Asks for a name (the app's own dialog, Hearth M4), then adds it. */
  const promptAdd = useCallback(async () => {
    const title = await dialog.prompt({ title: 'Add ${n.itemKind.toLowerCase()}', placeholder: 'Name', confirmLabel: 'Add' });
    if (title) add(title);
  }, [add]);

  const promptRename = useCallback(
    async (item: ${n.Pascal}Item) => {
      const title = await dialog.prompt({ title: 'Rename', defaultValue: item.title });
      if (title?.trim() && title.trim() !== item.title) helpers.patchRow(item.id, { title: title.trim() });
    },
    [helpers],
  );

  return { loaded, items, add, toggleDone, remove, promptAdd, promptRename };
}

export type ${n.Pascal}Api = ReturnType<typeof use${n.Pascal}>;
`;
}

export function coreTest(n) {
  return `import { describe, expect, it } from 'vitest';
import { arrangeRowActions } from '../../row-actions';
import { ${n.camel}ItemMeta, ${n.camel}Lede, ${n.camel}RowMenu, sort${n.Pascal}Items, type ${n.Pascal}Item } from './${n.id}';

function item(over: Partial<${n.Pascal}Item>): ${n.Pascal}Item {
  return {
    id: 'i',
    group_id: 'g',
    title: 'Item',
    notes: null,
    done_at: null,
    sort_order: 0,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted: false,
    ...over,
  };
}

describe('${n.id}', () => {
  it('puts open items first, in order, then the newest done', () => {
    const sorted = sort${n.Pascal}Items([
      item({ id: 'old-done', done_at: '2026-01-01T00:00:00Z' }),
      item({ id: 'b', sort_order: 2 }),
      item({ id: 'new-done', done_at: '2026-02-01T00:00:00Z' }),
      item({ id: 'a', sort_order: 1 }),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(['a', 'b', 'new-done', 'old-done']);
  });

  it('leads with the open count', () => {
    expect(${n.camel}Lede([item({}), item({ done_at: '2026-01-01T00:00:00Z' })])).toMatchObject({ value: 1, caption: '1 done' });
    expect(${n.camel}Lede([]).caption).toBe('Nothing here yet');
  });

  it('shows the first line of the notes', () => {
    expect(${n.camel}ItemMeta(item({ notes: 'first\\nsecond' }))).toBe('first');
    expect(${n.camel}ItemMeta(item({}))).toBeNull();
  });

  it('builds the row menu in the shared order, delete last', () => {
    const noop = () => {};
    const menu = ${n.camel}RowMenu(item({}), { onDelete: noop, onRename: noop, onToggleDone: noop });
    expect(arrangeRowActions(menu.actions).map((g) => g.map((a) => a.id))).toEqual([['done'], ['rename'], ['delete']]);
    expect(${n.camel}RowMenu(item({}), {}).actions.filter(Boolean)).toEqual([]);
  });
});
`;
}

export function coreStores(n) {
  return `'use client';

// ${n.label} module: the household's items. Local-first like every group
// store, so the screen works with no signal.

import { createGroupStore } from '../create-group-store';
import type { ${n.Pascal}Item } from '../../modules/${n.id}/${n.id}';

export const ${n.camel}Items$ = createGroupStore<${n.Pascal}Item>({
  collection: '${n.table}',
  storageName: '${n.table}',
});
`;
}

export function webPage(n) {
  return `'use client';

// ${n.label}: ${n.description} The Hero is how many are still open (H1);
// under it, the items as shared line items. A tap marks one done, a
// right-click opens its row menu (Hearth §13.7). What the screen shows and
// changes comes from core (packages/core/src/modules/${n.id}/), so this file
// only binds it.
// Native twin: apps/mobile/src/app/(tabs)/${n.id}/index.tsx.
import { Check, Plus, ${n.Icon} } from 'lucide-react';
import { ${n.camel}ItemMeta, ${n.camel}Lede, ${n.camel}RowMenu, use${n.Pascal}, type ${n.Pascal}Api, type ${n.Pascal}Item } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { HeroLede } from '@/components/ui/hero-lede';
import { ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemMeta, ListItemTitle } from '@/components/ui/list-item';
import { EmptyState } from '@/components/ui/empty-state';
import { OfflineHint } from '@/components/offline-hint';
import { useRowContextMenu } from '@/components/ui/row-context-menu';
import { toastUndoAction } from '@/lib/undo-toast';
import { useWideLayout } from '@/lib/desktop-layout';
import { cn } from '@/lib/utils';

export default function ${n.Pascal}Page() {
  const { group, currentUserId, isOnline, loading } = useDataCache();
  const api = use${n.Pascal}(group?.id, currentUserId);
  const wide = useWideLayout();

  if (loading || (!api.loaded && api.items.length === 0)) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!group) return <div className="p-6 text-muted-foreground">No group selected</div>;

  const lede = ${n.camel}Lede(api.items);

  return (
    <div className={cn('mx-auto space-y-4 p-4 md:p-6 pb-24', wide ? 'max-w-[1400px] lg:px-8' : 'max-w-3xl')}>
      <HeroLede
        layout="inline"
        value={lede.value}
        label={lede.label}
        caption={lede.caption}
        trailing={
          <>
            {!isOnline && <OfflineHint />}
            <button
              type="button"
              onClick={() => void api.promptAdd()}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </>
        }
      />

      {api.items.length === 0 ? (
        <EmptyState
          icon={${n.Icon}}
          title="Nothing here yet"
          description="${n.emptyDescription}"
          action={{ label: 'Add the first one', onClick: () => void api.promptAdd(), icon: <Plus className="h-4 w-4" /> }}
        />
      ) : (
        <ListGroup>
          {api.items.map((item) => (
            <${n.Pascal}Row key={item.id} item={item} api={api} />
          ))}
        </ListGroup>
      )}
    </div>
  );
}

function ${n.Pascal}Row({ item, api }: { item: ${n.Pascal}Item; api: ${n.Pascal}Api }) {
  const remove = () => toastUndoAction(\`Deleted \${item.title}\`, api.remove(item.id));
  const rowMenu = useRowContextMenu(() =>
    ${n.camel}RowMenu(item, {
      onToggleDone: () => api.toggleDone(item),
      onRename: () => void api.promptRename(item),
      onDelete: remove,
    }),
  );
  const meta = ${n.camel}ItemMeta(item);
  return (
    <ListItem asChild className="cursor-pointer">
      <button type="button" onClick={() => api.toggleDone(item)} onContextMenu={rowMenu.onContextMenu}>
        <ListItemLeading>
          <span
            className={cn(
              'flex size-5 items-center justify-center rounded-full border',
              item.done_at ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50',
            )}
          >
            {item.done_at && <Check className="h-3 w-3" />}
          </span>
        </ListItemLeading>
        <ListItemContent>
          <ListItemTitle className={cn(item.done_at && 'text-muted-foreground line-through')}>{item.title}</ListItemTitle>
          {meta && <ListItemMeta>{meta}</ListItemMeta>}
        </ListItemContent>
        {rowMenu.menu}
      </button>
    </ListItem>
  );
}
`;
}

export function webLoading(n) {
  return `export default function ${n.Pascal}Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6 pb-24">
      <div className="flex items-center justify-between gap-3">
        <div className="h-16 w-56 rounded-lg bg-muted animate-pulse" />
        <div className="h-11 w-20 rounded-xl bg-muted animate-pulse" />
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-3xl border border-border/60 bg-card">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <div className="size-5 rounded-full bg-muted animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
              <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
`;
}

export function mobileScreen(n) {
  return `// ${n.label}: ${n.description} The Hero is how many are still open (H1);
// under it, the items as shared line items. A tap marks one done, a long
// press opens its row menu (Hearth §13.7). What the screen shows and changes
// comes from core (packages/core/src/modules/${n.id}/), so this file only
// binds it.
// Web twin: apps/web/src/app/${n.id}/page.tsx.
import * as React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Plus, ${n.Icon}, WifiOff } from 'lucide-react-native';
import {
  Button,
  EmptyState,
  HeroLede,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  ScreenBackground,
  Text,
  cn,
  toast,
  useRowMenuSheet,
} from '@homeup/ui';
import { ${n.camel}ItemMeta, ${n.camel}Lede, ${n.camel}RowMenu, use${n.Pascal}, type ${n.Pascal}Item } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';

export default function ${n.Pascal}Screen() {
  const insets = useSafeAreaInsets();
  const { group, currentUserId, isOnline, loading } = useDataCache();
  const api = use${n.Pascal}(group?.id, currentUserId);
  const rowMenu = useRowMenuSheet();

  if (loading || (!api.loaded && api.items.length === 0)) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }
  if (!group) return <NoGroupScreen />;

  const lede = ${n.camel}Lede(api.items);
  const openMenu = (item: ${n.Pascal}Item) =>
    rowMenu.open(
      ${n.camel}RowMenu(item, {
        onToggleDone: () => api.toggleDone(item),
        onRename: () => void api.promptRename(item),
        onDelete: () => {
          const undo = api.remove(item.id);
          toast.message(\`Deleted \${item.title}\`, { duration: 4000, action: { label: 'Undo', onPress: undo } });
        },
      }),
    );

  return (
    <ScreenBackground>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 16, paddingBottom: 32, gap: 16 }}
      >
        <View className="flex-row items-center justify-between gap-3">
          <Text numberOfLines={1} className="shrink text-micro-label uppercase text-muted-foreground">
            ${n.label}
          </Text>
          <View className="shrink-0 flex-row items-center gap-1.5">
            {!isOnline && (
              <View className="flex-row items-center gap-1 pr-0.5">
                <WifiOff size={12} className="shrink-0 text-muted-foreground" />
                <Text className="text-xs text-muted-foreground">Offline</Text>
              </View>
            )}
            <Button size="sm" onPress={() => void api.promptAdd()}>
              <Plus size={14} className="text-primary-foreground" />
              <Text className="text-sm font-medium text-primary-foreground">Add</Text>
            </Button>
          </View>
        </View>
        <HeroLede value={lede.value} label={lede.label} caption={lede.caption} />

        {api.items.length === 0 ? (
          <EmptyState
            icon={${n.Icon}}
            title="Nothing here yet"
            description="${n.emptyDescription}"
            action={{ label: 'Add the first one', onPress: () => void api.promptAdd(), icon: <Plus size={14} className="text-primary-foreground" /> }}
          />
        ) : (
          <ListGroup>
            {api.items.map((item) => {
              const meta = ${n.camel}ItemMeta(item);
              return (
                <ListItem
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityState={{ checked: !!item.done_at }}
                  onPress={() => api.toggleDone(item)}
                  onLongPress={() => openMenu(item)}
                >
                  <ListItemLeading>
                    <View
                      className={cn(
                        'h-5 w-5 items-center justify-center rounded-full border',
                        item.done_at ? 'border-primary bg-primary' : 'border-muted-foreground/50',
                      )}
                    >
                      {item.done_at ? <Check size={12} className="text-primary-foreground" /> : null}
                    </View>
                  </ListItemLeading>
                  <ListItemContent>
                    <ListItemTitle numberOfLines={1} className={cn(item.done_at && 'text-muted-foreground line-through')}>
                      {item.title}
                    </ListItemTitle>
                    {meta ? (
                      <ListItemMeta>
                        <Text numberOfLines={1} className="text-caption text-muted-foreground">
                          {meta}
                        </Text>
                      </ListItemMeta>
                    ) : null}
                  </ListItemContent>
                </ListItem>
              );
            })}
          </ListGroup>
        )}
      </ScrollView>
      {rowMenu.sheet}
    </ScreenBackground>
  );
}
`;
}

export function webTools(n) {
  return `import { z } from "zod";
import { sort${n.Pascal}Items, ${n.camel}ItemMeta, type ${n.Pascal}Item } from "@homeup/core";
import type { HouseholdTool, HouseholdToolContext } from "../household-tools";
import { compact, fail, liveRows, ok, toolRegistrar } from "../tool-kit";

// ${n.label}: the Assistant's household tools (.docs/modules.md section 14).
// Each name is in MCP_TOOLS (core mcp-tools.ts), which gates it on the
// module. The admin client skips RLS, so every read is scoped to the group by
// hand. A module with private rows repeats its privacy rule here as well.

export function ${n.camel}Tools({ admin, userId, groupId }: HouseholdToolContext): HouseholdTool[] {
  const { tools, tool } = toolRegistrar(groupId);

  tool(
    "get_${n.snake}",
    {
      description:
        "${n.label}: the household's items, open ones first. Each has an id (for add_${n.snake}_item and later tools), a title, notes and whether it is done.",
    },
    async (_args, gid) => {
      const items = sort${n.Pascal}Items(await liveRows<${n.Pascal}Item>(admin, "${n.table}", gid));
      return ok({
        items: items.map((i) => compact({ id: i.id, title: i.title, notes: ${n.camel}ItemMeta(i), done: !!i.done_at || undefined })),
      });
    },
    { items: [] },
  );

  tool(
    "add_${n.snake}_item",
    {
      description: "${n.label}: add an item to the household's list.",
      inputSchema: {
        title: z.string().min(1).max(200),
        notes: z.string().max(2000).optional(),
      },
    },
    async ({ title, notes }, gid) => {
      const row = {
        id: crypto.randomUUID(),
        group_id: gid,
        title: title.trim(),
        notes: notes?.trim() || null,
        created_by: userId,
        deleted: false,
      };
      const { error } = await admin.from("${n.table}").insert(row);
      if (error) return fail(error.message);
      return ok({ ok: true, id: row.id, title: row.title });
    },
    null,
  );

  return tools;
}
`;
}

export function webToolsTest(n) {
  return `import { describe, expect, it } from "vitest";
import { MCP_TOOL_BY_NAME } from "@homeup/core";
import { ${n.camel}Tools } from "./${n.id}-tools";

describe("${n.id} tools", () => {
  it("registers every tool under the ${n.id} module", () => {
    const tools = ${n.camel}Tools({ admin: {} as never, userId: "u", groupId: null, enabled: new Set() });
    expect(tools.map((t) => t.name).sort()).toEqual(["add_${n.snake}_item", "get_${n.snake}"]);
    for (const t of tools) expect(MCP_TOOL_BY_NAME[t.name]?.module).toBe("${n.id}");
  });

  it("answers an empty list with no household", async () => {
    const [get] = ${n.camel}Tools({ admin: {} as never, userId: "u", groupId: null, enabled: new Set() });
    const result = await get.handler({});
    expect(JSON.parse(result.content[0].text)).toEqual({ items: [] });
  });
});
`;
}

export function migration(n) {
  return `-- ${n.label} module (packages/core/src/modules/${n.id}): the household's items.
--
-- One new group-scoped table with the full Legend-State sync contract
-- (created_at/updated_at + handle_times(), (group_id, updated_at) index,
-- deleted tombstone, replica identity full + realtime publication), granted
-- to the Data API roles (apps/web/src/lib/migration-grants.test.ts).
--
-- Additive and safe ahead of code: a new table only. The module is gated on
-- this migration with minSchema.

create table if not exists ${n.table} (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  title text not null,
  notes text,
  done_at timestamptz,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

grant select, insert, update, delete on public.${n.table} to anon, authenticated, service_role;

create index if not exists idx_${n.table}_group_updated_at on ${n.table}(group_id, updated_at);

alter table ${n.table} enable row level security;

drop policy if exists "Group members can manage ${n.label.toLowerCase()} items" on ${n.table};
create policy "Group members can manage ${n.label.toLowerCase()} items"
  on ${n.table} for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- Sync-ready: handle_times() keeps updated_at honest for changesSince pulls.
drop trigger if exists trg_${n.table}_handle_times on ${n.table};
create trigger trg_${n.table}_handle_times
  before insert or update on ${n.table}
  for each row execute function public.handle_times();

alter table ${n.table} replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = '${n.table}'
    ) then
    alter publication supabase_realtime add table ${n.table};
  end if;
end $$;
`;
}

export function whatsNew(n) {
  return `---
title: ${n.label} is here
module: ${n.id}
kind: feature
link: /${n.id}
spotlight: true
---
${n.description} Switch it on in Settings > Modules.
`;
}
