import { describe, expect, it } from "vitest";
import { pickOfflineSummary, type OfflineSummary } from "./offline-summary";

// FLUX-1546: the offline shell resolves the wrong-URL detected section to a
// per-section local-data summary, falling back to the cross-section overview
// for anything without its own Legend store (Home hub, Documents, Settings,
// or an unrecognized id).
describe("pickOfflineSummary", () => {
  const bySection: Record<string, OfflineSummary> = {
    groceries: { label: "Shopping list", rows: [{ id: "1", title: "Milk" }], emptyLabel: "Nothing on your list." },
    overview: { label: "Your household, offline", rows: [], emptyLabel: "No local data synced yet." },
  };

  it("returns the matching section's summary", () => {
    expect(pickOfflineSummary("groceries", bySection)).toBe(bySection.groceries);
  });

  it("falls back to the overview for a section with no dedicated summary", () => {
    expect(pickOfflineSummary("home", bySection)).toBe(bySection.overview);
    expect(pickOfflineSummary("documents", bySection)).toBe(bySection.overview);
    expect(pickOfflineSummary("unknown-section-id", bySection)).toBe(bySection.overview);
  });
});
