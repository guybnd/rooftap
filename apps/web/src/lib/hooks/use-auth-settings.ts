"use client";

import { useEffect, useState } from "react";
import { fetchAuthSettings, type AuthSettings } from "@homeup/core";

/**
 * What this server's auth allows (sign-up, email). undefined while asking,
 * null when it could not say; sign-up and reset links stay hidden then.
 */
export function useAuthSettings(): AuthSettings | null | undefined {
  const [settings, setSettings] = useState<AuthSettings | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetchAuthSettings(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!).then((s) => {
      if (live) setSettings(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return settings;
}
