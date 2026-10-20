"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSectionSettings } from "@/lib/use-section";
import { getSection, sections, useModules } from "@homeup/core";

export default function Home() {
  const router = useRouter();
  const { settings, loading } = useSectionSettings();
  const modules = useModules();

  useEffect(() => {
    // Wait for the authoritative settings load (Supabase, with the localStorage
    // mirrors as its fallback) before redirecting. Firing this before `loading`
    // settles risks racing AppSidebar's own useSectionSettings() instance on a
    // cold boot, when the hidden-sections mirror hasn't hydrated yet — see FLUX-226.
    if (loading) return;

    const lastUsed = settings.lastUsedSection;
    const sectionId =
      lastUsed &&
      lastUsed !== "home" &&
      getSection(lastUsed) &&
      modules.isSectionEnabled(lastUsed) &&
      !settings.hiddenSections.includes(lastUsed)
        ? lastUsed
        : "home";
    const targetSection = sections.find((s) => s.id === sectionId);
    const basePath = targetSection?.basePath || "/home";
    router.replace(basePath);
  }, [loading, settings, router, modules]);

  // Return nothing — the redirect fires once settings have loaded.
  return null;
}
