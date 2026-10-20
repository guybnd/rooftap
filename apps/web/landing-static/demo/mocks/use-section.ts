// @/lib/use-section for the screen demo: default section settings.
export * from "../../../src/lib/use-section";

export function useSectionSettings() {
  return {
    settings: { defaultSection: null, lastUsedSection: "home", hiddenSections: [] as string[], sectionOrder: ["home", "groceries", "calendar", "costs", "recipes", "documents", "checklists", "household"] },
    loading: false,
    updateLastUsedSection: () => {},
    updateDefaultSection: () => {},
    updateHiddenSections: () => {},
    updateSectionOrder: () => {},
  };
}
