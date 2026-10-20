// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemFormSheet } from "./item-form-sheet";

// HOUP-191: the footer Delete button centralizes a confirm-before-onDelete
// step (Alert.alert on mobile, window.confirm here) so callers can't forget
// it — three real screens (grocery archive, checklist delete, task quick-menu
// delete) shipped with NO confirmation before this. Regression-guards that
// contract: confirming calls onDelete, dismissing does not.
describe("ItemFormSheet delete confirmation (HOUP-191)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    confirmSpy = vi.spyOn(window, "confirm");
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    confirmSpy.mockRestore();
  });

  function findButtonByText(text: string) {
    return Array.from(document.querySelectorAll("button")).find(
      (btn) => btn.textContent === text
    );
  }

  async function renderSheet(onDelete?: () => void) {
    await act(async () => {
      root.render(
        <ItemFormSheet
          isOpen
          onClose={() => {}}
          title="Test item"
          onSubmit={() => {}}
          onDelete={onDelete}
        >
          <div>body</div>
        </ItemFormSheet>
      );
    });
  }

  it("does not render a Delete button when onDelete is omitted", async () => {
    await renderSheet(undefined);
    expect(findButtonByText("Delete")).toBeUndefined();
  });

  it("shows the Delete button and calls onDelete only after confirming", async () => {
    confirmSpy.mockReturnValue(true);
    const onDelete = vi.fn();
    await renderSheet(onDelete);

    const deleteButton = findButtonByText("Delete");
    expect(deleteButton).toBeTruthy();

    await act(async () => {
      deleteButton!.click();
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("does not call onDelete when the confirmation is dismissed", async () => {
    confirmSpy.mockReturnValue(false);
    const onDelete = vi.fn();
    await renderSheet(onDelete);

    await act(async () => {
      findButtonByText("Delete")!.click();
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });
});
