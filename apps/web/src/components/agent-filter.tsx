"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Agent, ApartmentAgent } from '@homeup/core';

interface AgentFilterProps {
  agents: Agent[];
  apartmentAgents: ApartmentAgent[];
  value: string[];
  onChange: (ids: string[]) => void;
}

export function AgentFilter({ agents, apartmentAgents, value, onChange }: AgentFilterProps) {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const sortedAgents = useMemo(() => {
    const countMap: Record<string, number> = {};
    for (const aa of apartmentAgents) {
      countMap[aa.agent_id] = (countMap[aa.agent_id] || 0) + 1;
    }
    return [...agents]
      .map((a) => ({ ...a, count: countMap[a.id] || 0 }))
      .sort((a, b) => b.count - a.count);
  }, [agents, apartmentAgents]);

  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expanded]);

  const hiddenCount = sortedAgents.length - 5;

  return (
    <div ref={containerRef}>
      <div className={cn(
        "flex gap-1.5 pb-1",
        expanded ? "flex-wrap" : "overflow-x-auto scrollbar-none"
      )}>
        {(expanded ? sortedAgents : sortedAgents.slice(0, 5)).map((agent) => {
          const active = value.includes(agent.id);
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => toggle(agent.id)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 px-3 rounded-lg text-xs font-medium transition-all duration-150 whitespace-nowrap shrink-0",
                active
                  ? "text-white shadow-sm ring-1 ring-white/10"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              style={active ? { backgroundColor: agent.color } : undefined}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: agent.color, opacity: active ? 0 : 1 }}
              />
              {agent.name}
              {agent.count > 0 && (
                <span className={cn("tabular-nums", active ? "opacity-70" : "opacity-50")}>
                  {agent.count}
                </span>
              )}
            </button>
          );
        })}

        {!expanded && hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex h-9 items-center gap-1 px-2.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
          >
            +{hiddenCount} more
            <ChevronDown className="h-3 w-3" />
          </button>
        )}

        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="inline-flex h-9 items-center px-2.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-1"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
