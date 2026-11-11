'use client';

import { useState, useRef, useEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus, Check } from 'lucide-react';
import type { GroupMember } from '@homeup/core';
import { cn } from '@/lib/utils';
import { memberLabel, memberAvatar, isFormerMember } from './member-label';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

export function Avatar({
  userId,
  profiles,
  size = 24,
}: {
  userId: string;
  profiles: MemberProfiles;
  size?: number;
}) {
  const avatar = memberAvatar(userId, profiles);
  const name = memberLabel(userId, profiles);
  if (avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatar}
        alt={name}
        referrerPolicy="no-referrer"
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="rounded-full bg-muted flex items-center justify-center font-bold text-muted-foreground uppercase"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {name.charAt(0)}
    </span>
  );
}

/** Several people's faces, overlapped, up to `max`, then "+N". One id renders a plain Avatar. */
export function AvatarStack({ ids, profiles, size = 22, max = 3 }: { ids: readonly string[]; profiles: MemberProfiles; size?: number; max?: number }) {
  if (ids.length === 0) return null;
  if (ids.length === 1) return <Avatar userId={ids[0]} profiles={profiles} size={size} />;
  const shown = ids.slice(0, max);
  const more = ids.length - shown.length;
  return (
    <span className="flex shrink-0 items-center" title={ids.map((id) => memberLabel(id, profiles)).join(', ')}>
      {shown.map((id, i) => (
        <span key={id} className="rounded-full bg-background p-px" style={{ marginLeft: i === 0 ? 0 : -size * 0.3 }}>
          <Avatar userId={id} profiles={profiles} size={size} />
        </span>
      ))}
      {more > 0 && (
        <span
          className="grid place-items-center rounded-full border border-background bg-muted font-medium text-muted-foreground tabular-nums"
          style={{ marginLeft: -size * 0.3, width: size + 2, height: size + 2, fontSize: size * 0.4 }}
        >
          +{more}
        </span>
      )}
    </span>
  );
}

interface AssigneePickerProps {
  value: string | null;
  groupMembers: GroupMember[];
  memberProfiles: MemberProfiles;
  disabled?: boolean;
  /** Hearth §6 — the viewing user; when it matches `value` the trailing avatar
   *  gets an accent ring (identity now lives here instead of a whole-row tint). */
  currentUserId?: string | null;
  onChange: (userId: string) => void;
  /** Everyone the item is for, first = value; more than one shows their faces stacked. A pick sets one person. */
  people?: readonly string[];
}

export function AssigneePicker({
  value,
  groupMembers,
  memberProfiles,
  disabled,
  currentUserId,
  onChange,
  people,
}: AssigneePickerProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // Position the portaled panel relative to the trigger, and keep it pinned
  // while the page scrolls/resizes (mirrors PopMenu's approach — FLUX-239).
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setCoords({
        position: 'fixed',
        top: r.bottom + 4,
        right: Math.max(8, window.innerWidth - r.right),
      });
    };
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [open]);

  const former = isFormerMember(value, memberProfiles);
  const name = memberLabel(value, memberProfiles);
  // Hearth §3/§6: identity moved entirely to the trailing avatar — no more
  // card-tint-by-owner. Yours = identity ring (`--axis`, falls back to
  // `--primary` under every theme but Axis Mundi — FLUX-1571); unassigned =
  // dashed amber slot.
  const mine = !!currentUserId && value === currentUserId;

  return (
    <div className="relative flex-shrink-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={name}
        className="flex items-center gap-1.5 rounded-full pl-1 pr-2 py-1 hover:bg-accent transition-colors disabled:opacity-50"
      >
        {people && people.length > 1 ? (
          <AvatarStack ids={people} profiles={memberProfiles} size={22} max={2} />
        ) : value ? (
          <span
            className={cn(
              'rounded-full',
              mine && 'ring-2 ring-axis ring-offset-1 ring-offset-background'
            )}
          >
            <Avatar userId={value} profiles={memberProfiles} size={22} />
          </span>
        ) : (
          <span className="h-[22px] w-[22px] rounded-full border border-dashed border-warning/70 bg-warning/10 flex items-center justify-center">
            <UserPlus className="h-3 w-3 text-warning" />
          </span>
        )}
        {value && <span data-assignee-name className="hidden sm:inline text-xs text-muted-foreground max-w-[6rem] truncate">{name}</span>}
      </button>

      {open && mounted && createPortal(
        <div ref={menuRef} style={coords} className="w-48 rounded-lg border border-border bg-popover shadow-lg z-[60] py-1">
          {/* Unassigned */}
          <button
            type="button"
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-accent"
          >
            <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center">
              <UserPlus className="h-3 w-3 text-muted-foreground" />
            </span>
            <span className="flex-1">Unassigned</span>
            {!value && <Check className="h-3.5 w-3.5 text-primary" />}
          </button>

          {/* Keep a former assignee selectable so it isn't silently dropped */}
          {former && value && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
            >
              <Avatar userId={value} profiles={memberProfiles} size={20} />
              <span className="flex-1 italic">{name}</span>
              <Check className="h-3.5 w-3.5 text-primary" />
            </button>
          )}

          {groupMembers.map((m) => (
            <button
              key={m.user_id}
              type="button"
              onClick={() => {
                onChange(m.user_id);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-accent"
            >
              <Avatar userId={m.user_id} profiles={memberProfiles} size={20} />
              <span className="flex-1 truncate">{memberLabel(m.user_id, memberProfiles)}</span>
              {value === m.user_id && <Check className="h-3.5 w-3.5 text-primary" />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
