"use client";

import { useState } from "react";
import { use$ } from "@legendapp/state/react";
import { useDataCache } from "@/lib/data-cache";
import { agents$, apartmentAgents$, useReconnectSync, useStoreHelpers } from "@homeup/core";
import { dialog } from "@homeup/core";
import type { Agent, ApartmentAgent } from '@homeup/core';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsInset, SettingsPanel } from "@/components/settings-panel";
import { Contact, PlusIcon, TrashIcon, PencilIcon, CheckIcon, XIcon } from "lucide-react";
import { AgentDetailPopup } from "@/components/agent-detail-popup";

const AGENT_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
  "#06b6d4", "#3b82f6", "#6366f1", "#a855f7", "#ec4899",
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
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [detailAgent, setDetailAgent] = useState<Agent | null>(null);

  const getListingCount = (agentId: string) =>
    apartmentAgents.filter((aa) => aa.agent_id === agentId).length;

  const handleAdd = () => {
    if (!newName.trim() || !group) return;
    setError(null);
    writeRow({
      id: crypto.randomUUID(),
      user_id: currentUserId ?? "",
      group_id: group.id,
      name: newName.trim(),
      phone: newPhone.trim() || null,
      color: randomColor(agents),
      notes: null,
      deleted: false,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
    });
    setNewName("");
    setNewPhone("");
    setAdding(false);
  };

  const handleDelete = async (agent: Agent) => {
    const count = getListingCount(agent.id);
    if (count > 0) {
      setError(`${agent.name} is on ${count} listing${count !== 1 ? "s" : ""}. Unassign them first.`);
      return;
    }
    if (!(await dialog.confirm({ title: `Delete agent "${agent.name}"?`, destructive: true }))) return;
    setError(null);
    softDeleteRow(agent.id);
  };

  const startEdit = (agent: Agent) => {
    setEditingId(agent.id);
    setEditName(agent.name);
    setEditPhone(agent.phone || "");
    setEditNotes(agent.notes || "");
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
            <Button size="lg" variant="outline" className="px-3" onClick={() => setAdding(true)}>
              <PlusIcon className="h-4 w-4" />
              Add agent
            </Button>
          )
        }
      >
        {error && <p className="text-sm text-destructive">{error}</p>}

        {agents.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">
            No agents yet. Add one to assign them to listings.
          </p>
        )}

        {(adding || agents.length > 0) && (
          <SettingsInset>
            {adding && (
              <div className="flex items-center gap-2 p-2.5">
                <Input
                  placeholder="Name"
                  aria-label="Agent name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="h-9 min-w-0 flex-1"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                />
                <Input
                  placeholder="Phone"
                  aria-label="Agent phone"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="h-9 w-28"
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                />
                <Button size="icon" variant="ghost" onClick={handleAdd} aria-label="Save agent">
                  <CheckIcon className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => { setAdding(false); setNewName(""); setNewPhone(""); }}
                  aria-label="Cancel"
                >
                  <XIcon className="h-4 w-4" />
                </Button>
              </div>
            )}

            {agents.map((agent) => {
              const count = getListingCount(agent.id);
              if (editingId === agent.id) {
                return (
                  <div key={agent.id} className="space-y-2 p-2.5">
                    <div className="flex items-center gap-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        aria-label="Agent name"
                        className="h-9 min-w-0 flex-1"
                        autoFocus
                        onKeyDown={(e) => e.key === "Enter" && handleSaveEdit()}
                      />
                      <Input
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        aria-label="Agent phone"
                        className="h-9 w-28"
                        placeholder="Phone"
                        onKeyDown={(e) => e.key === "Enter" && handleSaveEdit()}
                      />
                      <Button size="icon" variant="ghost" onClick={handleSaveEdit} aria-label="Save agent">
                        <CheckIcon className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setEditingId(null)} aria-label="Cancel edit">
                        <XIcon className="h-4 w-4" />
                      </Button>
                    </div>
                    <textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Notes (role, context)"
                      aria-label="Notes"
                      rows={2}
                      className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                    />
                  </div>
                );
              }
              const meta = [agent.phone, count > 0 ? `${count} listing${count !== 1 ? "s" : ""}` : null]
                .filter(Boolean)
                .join(" · ");
              return (
                <div key={agent.id} className="flex min-h-[52px] items-center gap-1 pr-2">
                  {/* The row opens the agent's detail; edit and remove trail it. */}
                  <button
                    type="button"
                    onClick={() => setDetailAgent(agent)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    aria-label={`View ${agent.name}`}
                  >
                    <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: agent.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{agent.name}</span>
                      {meta && <span className="mt-0.5 block truncate text-xs text-muted-foreground tabular-nums">{meta}</span>}
                    </span>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => startEdit(agent)}
                    aria-label={`Edit ${agent.name}`}
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(agent)}
                    aria-label={`Delete ${agent.name}`}
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </SettingsInset>
        )}
      </SettingsPanel>

      {detailAgent && (
        <AgentDetailPopup agent={detailAgent} onClose={() => setDetailAgent(null)} />
      )}
    </>
  );
}
