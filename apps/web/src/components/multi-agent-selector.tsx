"use client";

import { useState } from "react";
import { use$ } from "@legendapp/state/react";
import { useDataCache } from "@/lib/data-cache";
import { agents$, useReconnectSync, useStoreHelpers } from "@homeup/core";
import type { Agent } from '@homeup/core';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PlusIcon, XIcon } from "lucide-react";

const AGENT_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
  "#06b6d4", "#3b82f6", "#6366f1", "#a855f7", "#ec4899",
];

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
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  const selectedAgents = agents.filter((a) => value.includes(a.id));
  const unselected = agents.filter(
    (a) => !value.includes(a.id) && a.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleAdd = (agent: Agent) => {
    onChange([...value, agent.id]);
    setSearch("");
  };

  const handleRemove = (agentId: string) => {
    onChange(value.filter((id) => id !== agentId));
  };

  const handleCreate = () => {
    if (!newName.trim() || !group) return;
    const used = new Set(agents.map((a) => a.color));
    const available = AGENT_COLORS.filter((c) => !used.has(c));
    const pool = available.length > 0 ? available : AGENT_COLORS;
    const color = pool[Math.floor(Math.random() * pool.length)];
    const id = crypto.randomUUID();
    writeRow({
      id,
      user_id: currentUserId ?? "",
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
    setAdding(false);
    setNewName("");
    setNewPhone("");
  };

  return (
    <div className="relative">
      <div
        className="min-h-11 w-full flex flex-wrap items-center gap-1.5 rounded-xl border border-border/60 bg-transparent px-2 py-1.5 text-sm cursor-pointer hover:border-foreground/30 transition-colors"
        onClick={() => setOpen(!open)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen(!open); }}
      >
        {selectedAgents.length > 0 ? (
          selectedAgents.map((agent) => (
            // Hearth v2: the agent's colour is identity, so it is a dot beside
            // a neutral chip, never a saturated fill (H2).
            <span
              key={agent.id}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted/60 pl-2.5 pr-1 text-xs font-medium text-foreground"
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: agent.color }} />
              {agent.name}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleRemove(agent.id); }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Remove ${agent.name}`}
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </span>
          ))
        ) : (
          <span className="text-muted-foreground px-1">Add agents</span>
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border bg-popover shadow-md">
          <div className="p-2">
            <Input
              placeholder="Search agents"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 text-sm"
              autoFocus
            />
          </div>
          <div className="max-h-40 overflow-y-auto px-1 pb-1">
            {unselected.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => handleAdd(agent)}
                className="w-full flex min-h-10 items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent text-left"
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: agent.color }} />
                <span className="flex-1">{agent.name}</span>
                {agent.phone && <span className="text-xs tabular-nums text-muted-foreground">{agent.phone}</span>}
              </button>
            ))}
            {unselected.length === 0 && !adding && (
              <p className="text-xs text-muted-foreground px-2 py-1.5">
                {agents.length === value.length ? "All agents selected" : "No agents found"}
              </p>
            )}
          </div>
          {!adding ? (
            <div className="border-t p-1">
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="w-full flex min-h-10 items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent text-left text-muted-foreground"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                Add new agent
              </button>
            </div>
          ) : (
            <div className="border-t p-2 space-y-2">
              <Input
                placeholder="Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-9 text-sm"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <Input
                placeholder="Phone (optional)"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="h-9 text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <div className="flex gap-2">
                <Button size="sm" className="h-9 px-3 text-xs" onClick={handleCreate} disabled={!newName.trim()}>
                  Add
                </Button>
                <Button size="sm" variant="ghost" className="h-9 px-3 text-xs" onClick={() => { setAdding(false); setNewName(""); setNewPhone(""); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
