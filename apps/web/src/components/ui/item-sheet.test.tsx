// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemSheet, PropertyGroup, PropertyRow, PropertyRows } from "./item-sheet";

// The item sheet's flow (Hearth §13.14): an add opens on the quick line, a
// chip opens its tray, More grows the list, and an edit saves on Done.
describe("ItemSheet", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const button = (name: string) =>
    Array.from(document.querySelectorAll("button")).find((b) => (b.getAttribute("aria-label") ?? b.textContent) === name);

  async function render(mode: "add" | "edit", onSubmit = vi.fn(), onUndo = vi.fn()) {
    await act(async () => {
      root.render(
        <ItemSheet
          open
          onOpenChange={() => {}}
          mode={mode}
          heading="New to-do"
          title=""
          onTitleChange={() => {}}
          titleMatches={[{ id: "tomorrow", label: "Tomorrow", onPress: onUndo }, { id: "friday", label: "Fri", pending: true, onPress: onUndo }]}
          titlePlaceholder="What needs doing?"
          quickFields={[{ id: "due", label: "Today", trayLabel: "Due", editor: <p>due editor</p> }]}
          onSubmit={onSubmit}
          submitLabel="Add to-do"
        >
          <PropertyRows>
            <PropertyGroup>
              <PropertyRow id="due" leading={null} label="Due" value="Today">
                <p>row editor</p>
              </PropertyRow>
            </PropertyGroup>
          </PropertyRows>
        </ItemSheet>
      );
    });
    return onSubmit;
  }

  it("adds from the quick line and opens a chip's tray", async () => {
    const onSubmit = await render("add");
    expect(document.body.textContent).not.toContain("row editor");
    await act(async () => button("Today")!.click());
    expect(document.body.textContent).toContain("due editor");
    await act(async () => button("Add to-do")!.click());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("grows into the list with More, and a row opens in place", async () => {
    await render("add");
    await act(async () => button("More")!.click());
    await act(async () => new Promise<void>((r) => requestAnimationFrame(() => r())));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("New to-do");
    const row = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Due"))!;
    expect(row.getAttribute("aria-expanded")).toBe("false");
    await act(async () => row.click());
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.textContent).toContain("row editor");
  });

  it("opens an edit on the list and saves on Done", async () => {
    const onSubmit = await render("edit");
    expect(button("More")).toBeUndefined();
    await act(async () => button("Done")!.click());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows words the title set or is about to set", async () => {
    const onUndo = vi.fn();
    await render("add", vi.fn(), onUndo);
    await act(async () => button("Tomorrow, from the title. Put the words back")!.click());
    expect(onUndo).toHaveBeenCalledTimes(1);
    await act(async () => button("Set Fri")!.click());
    expect(onUndo).toHaveBeenCalledTimes(2);
  });
});
