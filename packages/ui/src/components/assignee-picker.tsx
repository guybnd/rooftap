// HOUP-120: native port of apps/web/src/app/setup/assignee-picker.tsx. Web
// anchor-positions a `createPortal`'d dropdown near the trigger (getBoundingClientRect
// + scroll/resize listeners + a document click-outside listener) because the
// DOM gives no portal-positioning primitive of its own; native has neither
// problem (no portal, no anchor math) so the picker opens as a `BottomSheet`
// list instead — same shape `SearchablePicker` already uses for this codebase.
import * as React from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { Check, Search, UserPlus } from 'lucide-react-native';
import type { GroupMember } from '@homeup/core';
import { cn } from '../lib/cn';
import { select } from '../lib/haptics';
import { BottomSheet } from './bottom-sheet';
import { Input } from './input';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

export function memberLabel(userId: string | null, profiles: MemberProfiles): string {
  if (!userId) return 'Unassigned';
  const profile = profiles[userId];
  if (!profile) return 'Former member';
  return profile.name || profile.email || 'Member';
}

function isFormerMember(userId: string | null, profiles: MemberProfiles): boolean {
  return !!userId && !profiles[userId];
}

function matchesQuery(member: GroupMember, profiles: MemberProfiles, q: string): boolean {
  const profile = profiles[member.user_id];
  const haystack = `${profile?.name ?? ''} ${profile?.email ?? ''}`.toLowerCase();
  return haystack.includes(q);
}

function memberAvatar(userId: string | null, profiles: MemberProfiles): string | null {
  if (!userId) return null;
  return profiles[userId]?.avatar ?? null;
}

export function Avatar({ userId, profiles, size = 24, ringed = false }: { userId: string | null; profiles: MemberProfiles; size?: number; ringed?: boolean }) {
  const avatarUrl = memberAvatar(userId, profiles);
  const label = memberLabel(userId, profiles);

  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        className={cn(ringed && 'border-2 border-axis')}
      />
    );
  }

  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className={cn('items-center justify-center bg-muted', ringed && 'border-2 border-axis')}
    >
      <Text
        style={{ fontSize: size * 0.42, lineHeight: size * 0.42, includeFontPadding: false, textAlignVertical: 'center' }}
        className="font-medium uppercase text-muted-foreground"
      >
        {label.charAt(0)}
      </Text>
    </View>
  );
}

export interface AssigneePickerProps {
  value: string | null;
  groupMembers: GroupMember[];
  memberProfiles: MemberProfiles;
  disabled?: boolean;
  /** When === value, the trigger avatar gets an accent ring ("mine"). */
  currentUserId?: string | null;
  /** Called with '' for Unassigned (not null) — matches the rest of the codebase's assignment plumbing. */
  onChange: (userId: string) => void;
  showLabel?: boolean;
  className?: string;
}

export function AssigneePicker({
  value,
  groupMembers,
  memberProfiles,
  disabled = false,
  currentUserId,
  onChange,
  showLabel = false,
  className,
}: AssigneePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const former = isFormerMember(value, memberProfiles);
  const mine = !!currentUserId && value === currentUserId;

  const q = query.trim().toLowerCase();
  const filteredMembers = q ? groupMembers.filter((m) => matchesQuery(m, memberProfiles, q)) : groupMembers;

  const choose = (userId: string) => {
    select();
    onChange(userId);
    setOpen(false);
    setQuery('');
  };

  return (
    <View className={className}>
      <Pressable
        disabled={disabled}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={value ? `Assigned to ${memberLabel(value, memberProfiles)}` : 'Unassigned'}
        className="flex-row items-center gap-1.5 disabled:opacity-50"
      >
        {value ? (
          <Avatar userId={value} profiles={memberProfiles} size={22} ringed={mine} />
        ) : (
          <View className="h-[22px] w-[22px] items-center justify-center rounded-full border border-dashed border-warning/60">
            <UserPlus size={11} className="text-warning" />
          </View>
        )}
        {showLabel && (
          <Text numberOfLines={1} className="max-w-[7rem] text-caption text-muted-foreground">
            {memberLabel(value, memberProfiles)}
          </Text>
        )}
      </Pressable>

      <BottomSheet
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery('');
        }}
        className="max-h-[70%]"
      >
        <View className="flex-row items-center gap-2 border-b border-border px-4 pb-3">
          <Search size={16} className="shrink-0 text-muted-foreground" />
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Search…"
            autoFocus
            className="h-8 flex-1 border-0 px-0"
          />
        </View>

        <ScrollView className="max-h-96 px-2 py-1" contentContainerClassName="gap-0.5">
          <Pressable
            accessibilityRole="menuitem"
            onPress={() => choose('')}
            className="flex-row items-center justify-between gap-2 rounded-lg px-3 py-2.5"
          >
            <View className="flex-row items-center gap-2.5">
              <View className="h-[22px] w-[22px] items-center justify-center rounded-full border border-dashed border-warning/60">
                <UserPlus size={11} className="text-warning" />
              </View>
              <Text className="text-body text-foreground">Unassigned</Text>
            </View>
            {!value && <Check size={16} className="text-primary" />}
          </Pressable>

          {former && value && (
            <View className="flex-row items-center justify-between gap-2 rounded-lg px-3 py-2.5">
              <View className="flex-row items-center gap-2.5">
                <Avatar userId={value} profiles={memberProfiles} size={22} />
                <Text className="text-body italic text-muted-foreground">{memberLabel(value, memberProfiles)}</Text>
              </View>
              <Check size={16} className="text-primary" />
            </View>
          )}

          {q && filteredMembers.length === 0 ? (
            <Text className="px-3 py-6 text-center text-sm text-muted-foreground">No matches</Text>
          ) : (
            filteredMembers.map((m) => {
              const selected = value === m.user_id;
              return (
                <Pressable
                  key={m.user_id}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected }}
                  onPress={() => choose(m.user_id)}
                  className="flex-row items-center justify-between gap-2 rounded-lg px-3 py-2.5"
                >
                  <View className="flex-row items-center gap-2.5">
                    <Avatar userId={m.user_id} profiles={memberProfiles} size={22} />
                    <Text numberOfLines={1} className="text-body text-foreground">
                      {memberLabel(m.user_id, memberProfiles)}
                    </Text>
                  </View>
                  {selected && <Check size={16} className="text-primary" />}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}
