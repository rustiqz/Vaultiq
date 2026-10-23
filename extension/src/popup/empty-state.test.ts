/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from "vitest";
import { emptyState } from "./empty-state.js";

describe("emptyState", () => {
  it("says what is missing and what to do", () => {
    const view = emptyState({ icon: "login", title: "No logins yet", hint: "Add one to see it here." });

    expect(view.querySelector(".empty-title")?.textContent).toBe("No logins yet");
    expect(view.querySelector(".empty-hint")?.textContent).toBe("Add one to see it here.");
    expect(view.querySelector(".empty-art svg")).not.toBeNull();
  });

  it("is announced to assistive tech as a status, not buried", () => {
    expect(emptyState({ icon: "trash", title: "t", hint: "h" }).getAttribute("role")).toBe("status");
  });

  it("has no action row when there is nothing to do", () => {
    expect(emptyState({ icon: "trash", title: "t", hint: "h" }).querySelector(".empty-actions")).toBeNull();
  });

  it("runs an action when its button is clicked", () => {
    const add = vi.fn();
    const view = emptyState({
      icon: "login",
      title: "t",
      hint: "h",
      actions: [{ label: "Add item", onClick: add, primary: true }],
    });

    const button = view.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe("Add item");
    expect(button?.classList.contains("primary")).toBe(true);
    button?.click();

    expect(add).toHaveBeenCalledOnce();
  });

  it("marks only the primary action as primary", () => {
    const view = emptyState({
      icon: "login",
      title: "t",
      hint: "h",
      actions: [
        { label: "Add item", onClick: vi.fn(), primary: true },
        { label: "Import", onClick: vi.fn() },
      ],
    });

    const [first, second] = [...view.querySelectorAll("button")];
    expect(first?.classList.contains("primary")).toBe(true);
    expect(second?.classList.contains("primary")).toBe(false);
  });

  it("can be compact, for a list pane", () => {
    expect(emptyState({ icon: "search", title: "t", hint: "h", compact: true }).classList.contains("compact")).toBe(true);
    expect(emptyState({ icon: "search", title: "t", hint: "h" }).classList.contains("compact")).toBe(false);
  });

  it("shows what a person typed as text, never as markup", () => {
    const view = emptyState({
      icon: "search",
      title: "No matches",
      hint: "Nothing matches “<img src=x onerror=alert(1)>”.",
    });

    expect(view.querySelector("img")).toBeNull();
    expect(view.querySelector(".empty-hint")?.textContent).toContain("<img src=x");
  });
});
