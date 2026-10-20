// HOUP-84: native port of apps/web/src/components/agent-detail-popup.tsx.
// Web renders this as a centered modal card with Links out to the apartment
// detail page and a `?agents=`-filtered dashboard view. Neither destination
// exists as a native route yet (no apps/mobile/src/app/apartment/[id].tsx,
// and homesearch/index.tsx doesn't parse an agent-filter query param on
// mobile) — both navigation affordances are deferred here (named, not
// silently dropped) and the linked apartments render as plain informational
// rows instead. Built on `BottomSheet` per the no-Dialog rule (@homeup/ui
// has no Dialog primitive) — Modal already owns portal/backdrop/dismiss so
// this needs no extra chrome beyond a manual header + close button (mirrors
// web's popup header exactly).
import { use$ } from '@legendapp/state/react';
import { Pressable, View } from 'react-native';
import { Home, Phone, StickyNote, X } from 'lucide-react-native';
import { Text, BottomSheet, BottomSheetScrollView } from '@homeup/ui';
import { apartments$, apartmentAgents$, useReconnectSync, currencySymbol } from '@homeup/core';
import type { Agent, Apartment, ApartmentAgent } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';

interface AgentDetailPopupProps {
  agent: Agent | null;
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

  const agentApartments = agent
    ? apartments.filter((a) => apartmentAgents.some((aa) => aa.agent_id === agent.id && aa.apartment_id === a.id))
    : [];

  return (
    <BottomSheet open={!!agent} onOpenChange={(open) => { if (!open) onClose(); }} className="max-h-[80%]">
      {agent && (
        <BottomSheetScrollView className="px-4">
          <View className="flex-row items-center gap-3 border-b border-border pb-3">
            <View className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: agent.color }} />
            <View className="min-w-0 flex-1">
              <Text numberOfLines={1} className="font-heading text-title font-semibold text-foreground">
                {agent.name}
              </Text>
              {agent.phone && (
                <View className="mt-0.5 flex-row items-center gap-1">
                  <Phone size={12} className="text-muted-foreground" />
                  <Text className="text-sm text-muted-foreground">{agent.phone}</Text>
                </View>
              )}
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
              <X size={18} className="text-muted-foreground" />
            </Pressable>
          </View>

          <View className="gap-4 py-4">
            {agent.notes && (
              <View className="gap-1">
                <View className="flex-row items-center gap-1">
                  <StickyNote size={12} className="text-muted-foreground" />
                  <Text className="text-xs font-medium text-muted-foreground">Notes</Text>
                </View>
                <Text className="text-sm text-foreground">{agent.notes}</Text>
              </View>
            )}

            <View className="gap-2">
              <View className="flex-row items-center gap-1">
                <Home size={12} className="text-muted-foreground" />
                <Text className="text-xs font-medium text-muted-foreground">
                  Listings ({agentApartments.length})
                </Text>
              </View>
              {agentApartments.length === 0 ? (
                <Text className="text-sm text-muted-foreground">No apartments linked.</Text>
              ) : (
                <View className="gap-1.5">
                  {agentApartments.map((apt) => (
                    <View key={apt.id} className="rounded-lg border border-border p-2">
                      <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                        {apt.address}
                      </Text>
                      <View className="mt-0.5 flex-row gap-3">
                        {apt.suburb && <Text className="text-xs text-muted-foreground">{apt.suburb}</Text>}
                        {apt.rent_per_week != null && (
                          <Text className="text-xs text-muted-foreground">{currencySymbol()}{apt.rent_per_week}/wk</Text>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        </BottomSheetScrollView>
      )}
    </BottomSheet>
  );
}
