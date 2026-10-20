import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps a Hero type step next to a text colour", () => {
    expect(cn("text-hero", "text-foreground")).toBe("text-hero text-foreground");
    expect(cn("text-hero-section", "text-destructive")).toBe("text-hero-section text-destructive");
  });

  it("still lets a later size win over an earlier one", () => {
    expect(cn("text-hero", "text-sm")).toBe("text-sm");
  });
});
