// HOUP-84: native port of apps/web/src/components/multi-agent-selector.tsx —
// a multi-agent combobox (removable chips + inline "add new agent"
// creation). Same SearchablePicker-doesn't-fit reasoning as agent-selector.tsx
// (no multi-select support there either), same BottomSheet-for-popover swap.
import { useState } from 'react';
import { use$ } from '@legendapp/state/react';
import { Pressable, ScrollView, View } from 'react-native';
import { Plus, X } from 'lucide-react-native';
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

interface MultiAgentSelectorProps {
  value: string[];
  onChange: (agentIds: string[]) => void;
}

export function MultiAgentSelector({ value, onChange }: MultiAgentSelectorProps) {
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

  const selectedAgents = agents.filter((a) => value.includes(a.id));
  const unselected = agents.filter(
    (a) => !value.includes(a.id) && a.name.toLowerCase().includes(search.toLowerCase())
  );

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

  const handleAdd = (agent: Agent) => {
    onChange([...value, agent.id]);
    setSearch('');
  };

  const handleRemove = (agentId: string) => onChange(value.filter((id) => id !== agentId));

  const handleCreate = () => {
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
    onChange([...value, id]);
    resetAddForm();
  };

  return (
    <View>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        className="min-h-9 w-full flex-row flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2 py-1.5"
      >
        {selectedAgents.length > 0 ? (
          selectedAgents.map((agent) => (
            <View
              key={agent.id}
              className="flex-row items-center gap-1 rounded-full px-2 py-0.5"
              style={{ backgroundColor: agent.color }}
            >
              <Text className="text-xs font-medium text-white">{agent.name}</Text>
              <Pressable
                onPress={() => handleRemove(agent.id)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${agent.name}`}
              >
                <X size={11} className="text-white" />
              </Pressable>
            </View>
          ))
        ) : (
          <Text className="px-1 text-sm text-muted-foreground">Select agents...</Text>
        )}
      </Pressable>

      <BottomSheet open={open} onOpenChange={handleOpenChange} className="max-h-[75%]">
        <View className="gap-2 px-4 pb-2">
          <Input value={search} onChangeText={setSearch} placeholder="Search agents..." autoFocus />
        </View>

        <ScrollView className="max-h-72 px-2">
          {unselected.map((agent) => (
            <Pressable
              key={agent.id}
              onPress={() => handleAdd(agent)}
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
          {unselected.length === 0 && !adding && (
            <Text className="px-2 py-2 text-xs text-muted-foreground">
              {agents.length === value.length ? 'All agents selected' : 'No agents found'}
            </Text>
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
              <Button size="sm" onPress={handleCreate} disabled={!newName.trim()} className="flex-1">
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
