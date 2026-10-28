import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getSection } from "@homeup/core";

const LAST_USED_SECTION_KEY = "homeup_last_used_section";
const HIDDEN_SECTIONS_KEY = "homeup_hidden_sections";
// FLUX-165: per-user section order (array of section ids) for the switcher.
const SECTION_ORDER_KEY = "homeup_section_order";
// Same-tab broadcast so every useSectionSettings() instance (notably the sidebar,
// which lives outside DataCacheProvider) reflects a visibility change immediately.
const HIDDEN_SECTIONS_EVENT = "homeup:hidden-sections-changed";
// FLUX-165: same-tab broadcast for order changes (Settings list → sidebar switcher).
const SECTION_ORDER_EVENT = "homeup:section-order-changed";

interface SectionSettings {
  defaultSection: string | null;
  lastUsedSection: string;
  hiddenSections: string[];
  sectionOrder: string[];
}

function readStringArrayMirror(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function readHiddenMirror(): string[] {
  return readStringArrayMirror(HIDDEN_SECTIONS_KEY);
}

function readOrderMirror(): string[] {
  return readStringArrayMirror(SECTION_ORDER_KEY);
}

export function useSectionSettings() {
  const [settings, setSettings] = useState<SectionSettings>({
    defaultSection: null,
    lastUsedSection: "household",
    // Must match the server (which has no localStorage) for the first client
    // render, or the section switcher hydrates with a different tile order and
    // React throws a hydration mismatch. The localStorage mirror is applied in
    // an effect below, right after mount.
    hiddenSections: [],
    // Same SSR constraint: default to declaration order (empty) on first render;
    // the saved order mirror is applied post-mount by the effect below.
    sectionOrder: [],
  });
  const [loading, setLoading] = useState(true);

  // Apply the localStorage mirrors after mount (not during the initial render) so
  // a hidden section / stale order doesn't flash before the DB row loads — without
  // diverging from the server-rendered HTML.
  useEffect(() => {
    const hidden = readHiddenMirror();
    const order = readOrderMirror();
    if (hidden.length || order.length) {
      setSettings((prev) => ({
        ...prev,
        ...(hidden.length ? { hiddenSections: hidden } : {}),
        ...(order.length ? { sectionOrder: order } : {}),
      }));
    }
  }, []);

  useEffect(() => {
    loadSectionSettings();
  }, []);

  // Same-tab: react to a sibling hook instance changing visibility.
  useEffect(() => {
    const onChange = (e: Event) => {
      const ids = (e as CustomEvent<string[]>).detail;
      if (Array.isArray(ids)) {
        setSettings((prev) => ({ ...prev, hiddenSections: ids }));
      }
    };
    window.addEventListener(HIDDEN_SECTIONS_EVENT, onChange);
    return () => window.removeEventListener(HIDDEN_SECTIONS_EVENT, onChange);
  }, []);

  // Same-tab: react to a sibling hook instance changing the order (Settings → sidebar).
  useEffect(() => {
    const onChange = (e: Event) => {
      const ids = (e as CustomEvent<string[]>).detail;
      if (Array.isArray(ids)) {
        setSettings((prev) => ({ ...prev, sectionOrder: ids }));
      }
    };
    window.addEventListener(SECTION_ORDER_EVENT, onChange);
    return () => window.removeEventListener(SECTION_ORDER_EVENT, onChange);
  }, []);

  // Cross-device: re-read hidden_sections + section_order when this user's settings row changes.
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      channel = supabase
        .channel(`user-settings-sections-${user.id}-${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "user_settings", filter: `user_id=eq.${user.id}` },
          async () => {
            const { data } = await supabase
              .from("user_settings")
              .select("hidden_sections, section_order")
              .eq("user_id", user.id)
              .maybeSingle();
            if (!data) return;
            if (Array.isArray(data.hidden_sections)) {
              const ids = data.hidden_sections.filter((x: unknown) => typeof x === "string") as string[];
              try { localStorage.setItem(HIDDEN_SECTIONS_KEY, JSON.stringify(ids)); } catch { /* noop */ }
              setSettings((prev) => ({ ...prev, hiddenSections: ids }));
            }
            if (Array.isArray(data.section_order)) {
              const order = data.section_order.filter((x: unknown) => typeof x === "string") as string[];
              try { localStorage.setItem(SECTION_ORDER_KEY, JSON.stringify(order)); } catch { /* noop */ }
              setSettings((prev) => ({ ...prev, sectionOrder: order }));
            }
          }
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  async function loadSectionSettings() {
    try {
      const supabase = createClient();

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      // Try to load from user_settings (may fail if columns don't exist yet)
      const { data: settings, error } = await supabase
        .from("user_settings")
        .select("default_section, last_used_section, hidden_sections, section_order")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error && (error.code === "PGRST200" || error.message?.includes("400"))) {
        // Columns don't exist yet, fall back to localStorage
        const lastUsed = localStorage.getItem(LAST_USED_SECTION_KEY) || "household";
        setSettings({
          defaultSection: null,
          lastUsedSection: lastUsed,
          hiddenSections: readHiddenMirror(),
          sectionOrder: readOrderMirror(),
        });
      } else if (settings) {
        const hidden = Array.isArray(settings.hidden_sections)
          ? (settings.hidden_sections.filter((x: unknown) => typeof x === "string") as string[])
          : [];
        const order = Array.isArray(settings.section_order)
          ? (settings.section_order.filter((x: unknown) => typeof x === "string") as string[])
          : [];
        setSettings({
          defaultSection: settings.default_section,
          lastUsedSection: settings.last_used_section || "household",
          hiddenSections: hidden,
          sectionOrder: order,
        });
        // Sync with localStorage mirrors
        localStorage.setItem(LAST_USED_SECTION_KEY, settings.last_used_section || "household");
        try { localStorage.setItem(HIDDEN_SECTIONS_KEY, JSON.stringify(hidden)); } catch { /* noop */ }
        try { localStorage.setItem(SECTION_ORDER_KEY, JSON.stringify(order)); } catch { /* noop */ }
      } else {
        // Initialize settings for new user
        const lastUsed = localStorage.getItem(LAST_USED_SECTION_KEY) || "household";
        setSettings({
          defaultSection: null,
          lastUsedSection: lastUsed,
          hiddenSections: readHiddenMirror(),
          sectionOrder: readOrderMirror(),
        });
      }
    } catch (error) {
      console.error("Failed to load section settings:", error);
      // Fall back to localStorage
      const lastUsed = localStorage.getItem(LAST_USED_SECTION_KEY) || "household";
      setSettings({
        defaultSection: null,
        lastUsedSection: lastUsed,
        hiddenSections: readHiddenMirror(),
        sectionOrder: readOrderMirror(),
      });
    } finally {
      setLoading(false);
    }
  }

  const updateLastUsedSection = useCallback(async (sectionId: string) => {
    if (!getSection(sectionId)) return;

    // Update localStorage immediately
    localStorage.setItem(LAST_USED_SECTION_KEY, sectionId);
    setSettings((prev) => ({ ...prev, lastUsedSection: sectionId }));

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("user_settings")
          .upsert(
            { user_id: user.id, last_used_section: sectionId, updated_at: new Date().toISOString() },
            { onConflict: "user_id" }
          );
      }
    } catch {
      // Silently fail
    }
  }, []);

  const updateDefaultSection = useCallback(async (sectionId: string | null) => {
    if (sectionId && !getSection(sectionId)) return;

    setSettings((prev) => ({ ...prev, defaultSection: sectionId }));

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("user_settings")
          .upsert(
            { user_id: user.id, default_section: sectionId, updated_at: new Date().toISOString() },
            { onConflict: "user_id" }
          );
      }
    } catch {
      // Silently fail
    }
  }, []);

  const updateHiddenSections = useCallback(async (ids: string[]) => {
    const next = ids.filter((id) => !!getSection(id));

    // Optimistic: update this instance, mirror to localStorage, and broadcast to
    // sibling instances (sidebar) so the switcher reflects the change with no reload.
    setSettings((prev) => ({ ...prev, hiddenSections: next }));
    try { localStorage.setItem(HIDDEN_SECTIONS_KEY, JSON.stringify(next)); } catch { /* noop */ }
    window.dispatchEvent(new CustomEvent(HIDDEN_SECTIONS_EVENT, { detail: next }));

    // Persist (upsert: the settings row may not exist yet for a new user).
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("user_settings")
          .upsert(
            { user_id: user.id, hidden_sections: next, updated_at: new Date().toISOString() },
            { onConflict: "user_id" }
          );
      }
    } catch (error) {
      // Silently fail if persistence fails (columns may not exist yet)
    }
  }, []);

  const updateSectionOrder = useCallback(async (ids: string[]) => {
    // Keep only real sections (drops stale ids); the sidebar appends any section
    // missing from this list in declaration order, so a shorter list is safe.
    const next = ids.filter((id) => !!getSection(id));

    // Optimistic: update this instance, mirror to localStorage, and broadcast to
    // sibling instances (sidebar) so the switcher reflects the change with no reload.
    setSettings((prev) => ({ ...prev, sectionOrder: next }));
    try { localStorage.setItem(SECTION_ORDER_KEY, JSON.stringify(next)); } catch { /* noop */ }
    window.dispatchEvent(new CustomEvent(SECTION_ORDER_EVENT, { detail: next }));

    // Persist (upsert: the settings row may not exist yet for a new user).
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("user_settings")
          .upsert(
            { user_id: user.id, section_order: next, updated_at: new Date().toISOString() },
            { onConflict: "user_id" }
          );
      }
    } catch (error) {
      // Silently fail if persistence fails (columns may not exist yet)
    }
  }, []);

  return {
    settings,
    loading,
    updateLastUsedSection,
    updateDefaultSection,
    updateHiddenSections,
    updateSectionOrder,
  };
}
