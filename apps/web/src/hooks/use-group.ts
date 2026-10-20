"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Group, GroupMember } from '@homeup/core';

interface GroupContext {
  group: Group | null;
  members: GroupMember[];
  isOwner: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useGroup(): GroupContext {
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchGroup = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: membership } = await supabase
      .from("group_members")
      .select("group_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (!membership) {
      setLoading(false);
      return;
    }

    const [groupRes, membersRes] = await Promise.all([
      supabase.from("groups").select("*").eq("id", membership.group_id).single(),
      supabase.from("group_members").select("*").eq("group_id", membership.group_id),
    ]);

    setGroup(groupRes.data as Group | null);
    setMembers((membersRes.data as GroupMember[]) ?? []);
    setIsOwner(membership.role === "owner");
    setLoading(false);
  };

  useEffect(() => {
    fetchGroup();
  }, []);

  return { group, members, isOwner, loading, refresh: fetchGroup };
}
