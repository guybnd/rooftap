// HOUP-84: native port of apps/web/src/components/agent-selector.tsx — a
// single-agent combobox with inline "add new agent" creation. Not built on
// @homeup/ui's SearchablePicker (checked packages/ui/src/components/
// searchable-picker.tsx first, per the ticket): that primitive only supports
// a flat string value with grouped section headers, no per-row color-dot/
// phone slot and no inline-create affordance, both load-bearing here to
// mirror the web popover's compact contents. Web's absolutely-positioned
// popover becomes a `BottomSheet` (native's Modal already owns the portal +
// backdrop + dismiss web hand-rolled).
import { useState } from 'react';
import { use$ } from '@legendapp/state/react';
import { Pressable, ScrollView, View } from 'react-native';
import { ChevronDown, Plus, X } from 'lucide-react-native';
import { Text, BottomSheet, Button, Input } from '@homeup/ui';
import { agents$, useReconnectSync, useStoreHelpers } from '@homeup/core';
import type { Agent } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { randomUUID } from '@/lib/uuid';

const AGENT_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
  '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
];

// Module-level (not a render-scoped closure) so react-hooks/purity doesn't
// flag the Math.random() call as an impure call reachable during render.
function pickAgentColor(existing: Agent[]): string {
  const used = new Set(existing.map((a) => a.color));
  const available = AGENT_COLORS.filter((c) => !used.has(c));
  const pool = available.length > 0 ? available : AGENT_COLORS;
  return pool[Math.floor(Math.random() * pool.length)];
}

interface AgentSelectorProps {
  value: string | null;
  onChange: (agentId: string | null) => void;
}

export function AgentSelector({ value, onChange }: AgentSelectorProps) {
  const { group, currentUserId } = useDataCache();
  const agentsStore$ = agents$(group?.id);
  useReconnectSync(agentsStore$);
  const { writeRow } = useStoreHelpers(agentsStore$, currentUserId);
  const agents = use$(() =>
    Object.values(agentsStore$.get() ?? {}).filter((a): a is Agent => !!a && !a.deleted)
  );

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  const selected = agents.find((a) => a.id === value) ?? null;
  const filtered = agents.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()));

  const resetAddForm = () => {
    setAdding(false);
    setNewName('');
    setNewPhone('');
  };

  const handleOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) {
      setSearch('');
      resetAddForm();
    }
  };

  const handleSelect = (agent: Agent | null) => {
    onChange(agent?.id ?? null);
    handleOpenChange(false);
  };

  const handleAdd = () => {
    if (!newName.trim() || !group) return;
    const color = pickAgentColor(agents);
    const id = randomUUID();
    writeRow({
      id,
      user_id: currentUserId ?? '',
      group_id: group.id,
      name: newName.trim(),
      phone: newPhone.trim() || null,
      color,
      notes: null,
      deleted: false,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
    });
    onChange(id);
    handleOpenChange(false);
  };

  return (
    <View>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        className="h-9 w-full flex-row items-center gap-2 rounded-lg border border-input bg-transparent px-3"
      >
        {selected ? (
          <>
            <View className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: selected.color }} />
            <Text numberOfLines={1} className="flex-1 text-sm text-foreground">
              {selected.name}
            </Text>
            <Pressable
              onPress={() => handleSelect(null)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear selected agent"
            >
              <X size={14} className="text-muted-foreground" />
            </Pressable>
          </>
        ) : (
          <>
            <Text className="flex-1 text-sm text-muted-foreground">Select agent...</Text>
            <ChevronDown size={14} className="text-muted-foreground" />
          </>
        )}
      </Pressable>

      <BottomSheet open={open} onOpenChange={handleOpenChange} className="max-h-[75%]">
        <View className="gap-2 px-4 pb-2">
          <Input value={search} onChangeText={setSearch} placeholder="Search agents..." autoFocus />
        </View>

        <ScrollView className="max-h-72 px-2">
          {filtered.map((agent) => (
            <Pressable
              key={agent.id}
              onPress={() => handleSelect(agent)}
              accessibilityRole="button"
              className="flex-row items-center gap-2 rounded-lg px-2 py-2"
            >
              <View className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: agent.color }} />
              <Text numberOfLines={1} className="flex-1 text-sm text-foreground">
                {agent.name}
              </Text>
              {agent.phone && <Text className="text-xs text-muted-foreground">{agent.phone}</Text>}
            </Pressable>
          ))}
          {filtered.length === 0 && !adding && (
            <Text className="px-2 py-2 text-xs text-muted-foreground">No agents found</Text>
          )}
        </ScrollView>

        {!adding ? (
          <Pressable
            onPress={() => setAdding(true)}
            accessibilityRole="button"
            className="flex-row items-center gap-2 border-t border-border px-4 py-3"
          >
            <Plus size={14} className="text-muted-foreground" />
            <Text className="text-sm text-muted-foreground">Add new agent</Text>
          </Pressable>
        ) : (
          <View className="gap-2 border-t border-border px-4 py-3">
            <Input value={newName} onChangeText={setNewName} placeholder="Name" autoFocus />
            <Input value={newPhone} onChangeText={setNewPhone} placeholder="Phone (optional)" />
            <View className="flex-row gap-2">
              <Button size="sm" onPress={handleAdd} disabled={!newName.trim()} className="flex-1">
                Add
              </Button>
              <Button size="sm" variant="ghost" onPress={resetAddForm} className="flex-1">
                Cancel
              </Button>
            </View>
          </View>
        )}
      </BottomSheet>
    </View>
  );
}
