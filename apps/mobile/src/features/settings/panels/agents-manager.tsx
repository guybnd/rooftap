// HOUP-84: native port of apps/web/src/components/agents-manager.tsx — the
// zero-prop settings-registry entry for the "search" section (registered in
// settings-registry.ts, rendered as <Panel /> with no props per
// settings-content.tsx). Owns its own agents$/apartmentAgents$ Legend-State
// stores directly (same contract every other panel here follows) and
// composes AgentDetailPopup — this ticket's sibling port — for the
// tap-through detail view, exactly like web composes AgentDetailPopup inline.
//
// agent-selector.tsx/agent-filter.tsx/multi-agent-selector.tsx (also ported
// this ticket) are NOT used by this manager: on web they aren't either — the
// manager IS the CRUD surface agents are picked *from*, not a picker itself.
// They're ported standalone, fully working and independently exported, for
// future consumers (apartment/appointment forms, a listings filter bar) per
// the ticket's plan — see each file's own header comment.
import { useState } from 'react';
import { use$ } from '@legendapp/state/react';
import { Alert, View } from 'react-native';
import { Check, Contact, Pencil, Plus, Trash2, X } from 'lucide-react-native';
import {
  Text,
  Button,
  Input,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  haptics,
} from '@homeup/ui';
import { agents$, apartmentAgents$, useReconnectSync, useStoreHelpers } from '@homeup/core';
import type { Agent, ApartmentAgent } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { randomUUID } from '@/lib/uuid';
import { AgentDetailPopup } from './agent-detail-popup';
import { SettingsInset, SettingsPanel } from './settings-panel';

const AGENT_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
  '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
];

function randomColor(existing: Agent[]): string {
  const used = new Set(existing.map((a) => a.color));
  const available = AGENT_COLORS.filter((c) => !used.has(c));
  const pool = available.length > 0 ? available : AGENT_COLORS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function AgentsManager() {
  const { group, currentUserId } = useDataCache();
  const agentsStore$ = agents$(group?.id);
  const apartmentAgentsStore$ = apartmentAgents$(group?.id);
  useReconnectSync(agentsStore$);
  useReconnectSync(apartmentAgentsStore$);
  const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(agentsStore$, currentUserId);

  const agents = use$(() =>
    Object.values(agentsStore$.get() ?? {}).filter((a): a is Agent => !!a && !a.deleted)
  );
  const apartmentAgents = use$(() =>
    Object.values(apartmentAgentsStore$.get() ?? {}).filter((aa): aa is ApartmentAgent => !!aa && !aa.deleted)
  );

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [detailAgent, setDetailAgent] = useState<Agent | null>(null);

  const getListingCount = (agentId: string) => apartmentAgents.filter((aa) => aa.agent_id === agentId).length;

  const handleAdd = () => {
    if (!newName.trim() || !group) return;
    setError(null);
    writeRow({
      id: randomUUID(),
      user_id: currentUserId ?? '',
      group_id: group.id,
      name: newName.trim(),
      phone: newPhone.trim() || null,
      color: randomColor(agents),
      notes: null,
      deleted: false,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
    });
    setNewName('');
    setNewPhone('');
    setAdding(false);
  };

  const handleDelete = (agent: Agent) => {
    const count = getListingCount(agent.id);
    if (count > 0) {
      setError(`${agent.name} is on ${count} listing${count !== 1 ? 's' : ''}. Unassign them first.`);
      return;
    }
    setError(null);
    haptics.warn();
    Alert.alert(`Delete ${agent.name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          haptics.remove();
          softDeleteRow(agent.id);
        },
      },
    ]);
  };

  const startEdit = (agent: Agent) => {
    setEditingId(agent.id);
    setEditName(agent.name);
    setEditPhone(agent.phone || '');
    setEditNotes(agent.notes || '');
    setError(null);
  };

  const handleSaveEdit = () => {
    if (!editName.trim() || !editingId) return;
    setError(null);
    patchRow(editingId, { name: editName.trim(), phone: editPhone.trim() || null, notes: editNotes.trim() || null });
    setEditingId(null);
  };

  return (
    <>
      <SettingsPanel
        icon={Contact}
        title="Agents"
        action={
          !adding && (
            <Button size="sm" variant="outline" className="px-3" onPress={() => setAdding(true)}>
              <Plus size={14} className="text-foreground" />
              <Text className="text-[0.8rem] font-medium text-foreground">Add agent</Text>
            </Button>
          )
        }
      >
        {error && <Text className="px-1 text-sm text-destructive">{error}</Text>}

        {agents.length === 0 && !adding && (
          <Text className="px-1 text-body text-muted-foreground">No agents yet. Add one to assign them to listings.</Text>
        )}

        {(adding || agents.length > 0) && (
          <SettingsInset>
            {adding && (
              <View className="flex-row items-center gap-1.5 p-2.5">
                <Input
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Name"
                  accessibilityLabel="Agent name"
                  autoFocus
                  onSubmitEditing={handleAdd}
                  className="h-9 min-w-0 flex-1"
                />
                <Input
                  value={newPhone}
                  onChangeText={setNewPhone}
                  placeholder="Phone"
                  accessibilityLabel="Agent phone"
                  keyboardType="phone-pad"
                  onSubmitEditing={handleAdd}
                  className="h-9 w-28"
                />
                <Button size="icon-sm" variant="ghost" onPress={handleAdd} accessibilityLabel="Save agent">
                  <Check size={16} className="text-foreground" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onPress={() => {
                    setAdding(false);
                    setNewName('');
                    setNewPhone('');
                  }}
                  accessibilityLabel="Cancel"
                >
                  <X size={16} className="text-foreground" />
                </Button>
              </View>
            )}

            {agents.map((agent) => {
              const count = getListingCount(agent.id);
              if (editingId === agent.id) {
                return (
                  <View key={agent.id} className="gap-2 p-2.5">
                    <View className="flex-row items-center gap-1.5">
                      <Input
                        value={editName}
                        onChangeText={setEditName}
                        accessibilityLabel="Agent name"
                        autoFocus
                        className="h-9 min-w-0 flex-1"
                        onSubmitEditing={handleSaveEdit}
                      />
                      <Input
                        value={editPhone}
                        onChangeText={setEditPhone}
                        placeholder="Phone"
                        accessibilityLabel="Agent phone"
                        keyboardType="phone-pad"
                        className="h-9 w-28"
                        onSubmitEditing={handleSaveEdit}
                      />
                      <Button size="icon-sm" variant="ghost" onPress={handleSaveEdit} accessibilityLabel="Save agent">
                        <Check size={16} className="text-foreground" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onPress={() => setEditingId(null)}
                        accessibilityLabel="Cancel edit"
                      >
                        <X size={16} className="text-foreground" />
                      </Button>
                    </View>
                    <Input
                      value={editNotes}
                      onChangeText={setEditNotes}
                      placeholder="Notes (role, context)"
                      accessibilityLabel="Notes"
                      multiline
                      numberOfLines={2}
                      textAlignVertical="top"
                      className="h-auto min-h-16 py-2"
                    />
                  </View>
                );
              }
              const meta = [agent.phone, count > 0 ? `${count} listing${count !== 1 ? 's' : ''}` : null]
                .filter(Boolean)
                .join(' · ');
              return (
                // The row opens the agent's detail; edit and remove trail it.
                <ListItem
                  key={agent.id}
                  onPress={() => setDetailAgent(agent)}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${agent.name}`}
                  className="min-h-[52px] items-center py-2 pl-3.5 pr-1"
                >
                  <ListItemLeading className="mt-0">
                    <View className="size-2.5 rounded-full" style={{ backgroundColor: agent.color }} />
                  </ListItemLeading>
                  <ListItemContent>
                    <ListItemTitle>{agent.name}</ListItemTitle>
                    {meta ? (
                      <ListItemMeta>
                        <Text numberOfLines={1} className="text-caption tabular-nums text-muted-foreground">
                          {meta}
                        </Text>
                      </ListItemMeta>
                    ) : null}
                  </ListItemContent>
                  <ListItemTrailing className="mt-0 gap-0">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onPress={() => startEdit(agent)}
                      accessibilityLabel={`Edit ${agent.name}`}
                    >
                      <Pencil size={15} className="text-muted-foreground" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onPress={() => handleDelete(agent)}
                      accessibilityLabel={`Delete ${agent.name}`}
                    >
                      <Trash2 size={15} className="text-muted-foreground" />
                    </Button>
                  </ListItemTrailing>
                </ListItem>
              );
            })}
          </SettingsInset>
        )}
      </SettingsPanel>

      <AgentDetailPopup agent={detailAgent} onClose={() => setDetailAgent(null)} />
    </>
  );
}
