import { describe, expect, it } from "vitest";
import { getCaptureLauncherCurrentKey } from "./launcher-current";

describe("getCaptureLauncherCurrentKey", () => {
  it("maps single-action sections to their launcher tile", () => {
    expect(getCaptureLauncherCurrentKey("/tasks", "household")).toBe("todo");
    expect(getCaptureLauncherCurrentKey("/costs", "costs")).toBe("cost");
    expect(getCaptureLauncherCurrentKey("/documents", "documents")).toBe("doc");
    expect(getCaptureLauncherCurrentKey("/groceries", "groceries")).toBe("grocery");
    expect(getCaptureLauncherCurrentKey("/calendar", "calendar")).toBe("calendar");
    expect(getCaptureLauncherCurrentKey("/recipes", "recipes")).toBe("recipe");
    expect(getCaptureLauncherCurrentKey("/checklists", "checklists")).toBe("new-checklist");
  });

  it("picks one Home Search launcher action from the concrete route", () => {
    expect(getCaptureLauncherCurrentKey("/checklist", "search")).toBe("checklist");
    expect(getCaptureLauncherCurrentKey("/checklist/foo", "search")).toBe("checklist");
    expect(getCaptureLauncherCurrentKey("/apartment/new", "search")).toBe("apartment");
    expect(getCaptureLauncherCurrentKey("/appointments", "search")).toBe("apartment");
    expect(getCaptureLauncherCurrentKey("/map", "search")).toBe("apartment");
    expect(getCaptureLauncherCurrentKey("/homesearch", "search")).toBe("apartment");
  });

  it("does not invent a launcher highlight for pages without a matching action", () => {
    expect(getCaptureLauncherCurrentKey("/home", "home")).toBeNull();
    expect(getCaptureLauncherCurrentKey("/settings", "profile")).toBeNull();
  });
});
