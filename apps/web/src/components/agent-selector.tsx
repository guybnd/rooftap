"use client";

import { useState } from "react";
import { use$ } from "@legendapp/state/react";
import { useDataCache } from "@/lib/data-cache";
import { agents$, useReconnectSync, useStoreHelpers } from "@homeup/core";
import type { Agent } from '@homeup/core';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronDown, PlusIcon, XIcon } from "lucide-react";

const AGENT_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
  "#06b6d4", "#3b82f6", "#6366f1", "#a855f7", "#ec4899",
];

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
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  const selected = agents.find((a) => a.id === value);
  const filtered = agents.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (agent: Agent | null) => {
    onChange(agent?.id ?? null);
    setOpen(false);
    setSearch("");
  };

  const handleAdd = () => {
    if (!newName.trim() || !group) return;
    const used = new Set(agents.map((a) => a.color));
    const available = AGENT_COLORS.filter((c) => !used.has(c));
    const color = (available.length > 0 ? available : AGENT_COLORS)[
      Math.floor(Math.random() * (available.length > 0 ? available : AGENT_COLORS).length)
    ];
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
    onChange(id);
    setAdding(false);
    setNewName("");
    setNewPhone("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 rounded-lg border bg-transparent px-3 py-2 text-sm text-left hover:border-foreground/30 transition-colors"
      >
        {selected ? (
          <>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: selected.color }} />
            <span className="flex-1">{selected.name}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); handleSelect(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); handleSelect(null); } }}
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <XIcon className="h-3.5 w-3.5" />
            </span>
          </>
        ) : (
          <>
            <span className="flex-1 text-muted-foreground">Select agent...</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </>
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border bg-popover shadow-md">
          <div className="p-2">
            <Input
              placeholder="Search agents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm"
              autoFocus
            />
          </div>
          <div className="max-h-40 overflow-y-auto px-1 pb-1">
            {filtered.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => handleSelect(agent)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent text-left"
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: agent.color }} />
                <span className="flex-1">{agent.name}</span>
                {agent.phone && <span className="text-xs text-muted-foreground">{agent.phone}</span>}
              </button>
            ))}
            {filtered.length === 0 && !adding && (
              <p className="text-xs text-muted-foreground px-2 py-1.5">No agents found</p>
            )}
          </div>
          {!adding ? (
            <div className="border-t p-1">
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent text-left text-muted-foreground"
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
                className="h-8 text-sm"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
              <Input
                placeholder="Phone (optional)"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="h-8 text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={handleAdd} disabled={!newName.trim()}>
                  Add
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setAdding(false); setNewName(""); setNewPhone(""); }}>
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
