"use client";

import Link from "next/link";
import { XIcon, Phone, StickyNote, Home } from "lucide-react";
import { use$ } from "@legendapp/state/react";
import { useDataCache } from "@/lib/data-cache";
import { apartments$, apartmentAgents$, useReconnectSync, currencySymbol } from "@homeup/core";
import type { Agent, Apartment, ApartmentAgent } from '@homeup/core';

interface AgentDetailPopupProps {
  agent: Agent;
  onClose: () => void;
}

export function AgentDetailPopup({ agent, onClose }: AgentDetailPopupProps) {
  const { group } = useDataCache();
  const apts$ = apartments$(group?.id);
  const apartmentAgentsStore$ = apartmentAgents$(group?.id);
  useReconnectSync(apts$);
  useReconnectSync(apartmentAgentsStore$);
  const apartments = use$(() =>
    Object.values(apts$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted)
  );
  const apartmentAgents = use$(() =>
    Object.values(apartmentAgentsStore$.get() ?? {}).filter((aa): aa is ApartmentAgent => !!aa && !aa.deleted)
  );

  const agentApartmentIds = apartmentAgents
    .filter((aa) => aa.agent_id === agent.id)
    .map((aa) => aa.apartment_id);
  const agentApartments = apartments.filter((a) => agentApartmentIds.includes(a.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border bg-popover shadow-xl max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center gap-3 p-4 border-b">
          <span
            className="w-4 h-4 rounded-full shrink-0"
            style={{ backgroundColor: agent.color }}
          />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold truncate">{agent.name}</h2>
            {agent.phone && (
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {agent.phone}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {agent.notes && (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
                <StickyNote className="h-3 w-3" />
                Notes
              </h3>
              <p className="text-sm whitespace-pre-wrap">{agent.notes}</p>
            </div>
          )}

          <div>
            <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-2">
              <Home className="h-3 w-3" />
              Listings ({agentApartments.length})
            </h3>
            {agentApartments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No apartments linked.</p>
            ) : (
              <div className="space-y-1.5">
                {agentApartments.map((apt) => (
                  <Link
                    key={apt.id}
                    href={`/apartment/${apt.id}`}
                    onClick={onClose}
                    className="block rounded-lg border p-2 hover:bg-accent transition-colors"
                  >
                    <p className="text-sm font-medium truncate">{apt.address}</p>
                    <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                      {apt.suburb && <span>{apt.suburb}</span>}
                      {apt.rent_per_week != null && <span>{currencySymbol()}{apt.rent_per_week}/wk</span>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="pt-2 border-t">
            <Link
              href={`/homesearch?agents=${agent.id}`}
              onClick={onClose}
              className="text-sm text-primary hover:underline"
            >
              Filter dashboard by this agent
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
