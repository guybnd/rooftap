// HOUP-84: native port of apps/web/src/components/agent-filter.tsx — a
// horizontal chip row for filtering apartment listings by assigned agent,
// sorted by listing count desc. Web's outside-click auto-collapse (a
// `document` mousedown listener) has no native equivalent and is dropped;
// tapping "Show less" on the expanded wrap view is the explicit replacement
// action. Standalone/exported (not used by AgentsManager itself — see that
// file's header comment) for a future apartment-listing filter bar.
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { Text, cn } from '@homeup/ui';
import type { Agent, ApartmentAgent } from '@homeup/core';

interface AgentFilterProps {
  agents: Agent[];
  apartmentAgents: ApartmentAgent[];
  value: string[];
  onChange: (ids: string[]) => void;
}

const VISIBLE_COUNT = 5;

export function AgentFilter({ agents, apartmentAgents, value, onChange }: AgentFilterProps) {
  const [expanded, setExpanded] = useState(false);

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
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  };

  const hiddenCount = sortedAgents.length - VISIBLE_COUNT;
  const visible = expanded ? sortedAgents : sortedAgents.slice(0, VISIBLE_COUNT);

  const chips = (
    <>
      {visible.map((agent) => {
        const active = value.includes(agent.id);
        return (
          <Pressable
            key={agent.id}
            onPress={() => toggle(agent.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={cn(
              'shrink-0 flex-row items-center gap-1.5 rounded-lg px-2.5 py-1.5',
              active ? 'shadow-sm' : 'bg-muted/50'
            )}
            style={active ? { backgroundColor: agent.color } : undefined}
          >
            {!active && <View className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: agent.color }} />}
            <Text className={cn('text-xs font-medium', active ? 'text-white' : 'text-muted-foreground')}>
              {agent.name}
            </Text>
            {agent.count > 0 && (
              <Text
                className={cn('text-xs', active ? 'text-white/70' : 'text-muted-foreground/60')}
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {agent.count}
              </Text>
            )}
          </Pressable>
        );
      })}

      {!expanded && hiddenCount > 0 && (
        <Pressable
          onPress={() => setExpanded(true)}
          accessibilityRole="button"
          className="shrink-0 flex-row items-center gap-1 rounded-lg px-2.5 py-1.5"
        >
          <Text className="text-xs font-medium text-muted-foreground">+{hiddenCount} more</Text>
          <ChevronDown size={12} className="text-muted-foreground" />
        </Pressable>
      )}

      {expanded && hiddenCount > 0 && (
        <Pressable
          onPress={() => setExpanded(false)}
          accessibilityRole="button"
          className="shrink-0 flex-row items-center gap-1 rounded-lg px-2.5 py-1.5"
        >
          <Text className="text-xs font-medium text-muted-foreground">Show less</Text>
          <ChevronUp size={12} className="text-muted-foreground" />
        </Pressable>
      )}

      {value.length > 0 && (
        <Pressable onPress={() => onChange([])} accessibilityRole="button" className="ml-1 shrink-0 px-2.5 py-1.5">
          <Text className="text-xs font-medium text-muted-foreground/60">Clear</Text>
        </Pressable>
      )}
    </>
  );

  return (
    <View className="mb-4">
      {expanded ? (
        <View className="flex-row flex-wrap gap-1.5">{chips}</View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="flex-row gap-1.5">
          {chips}
        </ScrollView>
      )}
    </View>
  );
}
