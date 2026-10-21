// @/lib/use-section for the screen demo: default section settings. Bar order
// and hidden spaces keep what the visitor changes (the More sheet's
// rearrange, a held tab) for the visit, like the demo's other stores.
import { useState } from "react";

export * from "../../../src/lib/use-section";

const DEFAULT_ORDER = ["home", "groceries", "calendar", "costs", "recipes", "documents", "checklists", "household"];

export function useSectionSettings() {
  const [sectionOrder, setSectionOrder] = useState<string[]>(DEFAULT_ORDER);
  const [hiddenSections, setHiddenSections] = useState<string[]>([]);
  return {
    settings: { defaultSection: null, lastUsedSection: "home", hiddenSections, sectionOrder },
    loading: false,
    updateLastUsedSection: () => {},
    updateDefaultSection: () => {},
    updateHiddenSections: setHiddenSections,
    updateSectionOrder: setSectionOrder,
  };
}
