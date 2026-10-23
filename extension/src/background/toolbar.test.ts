import { describe, expect, it } from "vitest";
import { toolbarView } from "./toolbar.js";

describe("toolbarView", () => {
  it("shows a plain icon and no badge before a vault exists", () => {
    expect(toolbarView("empty", 0, false)).toMatchObject({ icon: "none", badge: "" });
  });

  it("shows the locked icon for both locked and quick-unlock states", () => {
    expect(toolbarView("locked", 0, false).icon).toBe("locked");
    expect(toolbarView("quick", 0, false).icon).toBe("locked");
  });

  it("never shows a count while locked, even if one is passed", () => {
    // The count takes the vault key to know; a locked toolbar must not leak it.
    expect(toolbarView("locked", 5, false).badge).toBe("");
  });

  it("shows the unlocked icon and the number of logins for the site", () => {
    expect(toolbarView("unlocked", 3, false)).toMatchObject({ icon: "unlocked", badge: "3" });
    expect(toolbarView("unlocked", 3, false).title).toContain("3 logins for this site");
    expect(toolbarView("unlocked", 1, false).title).toContain("1 login for this site");
  });

  it("shows no badge when the site has no logins", () => {
    expect(toolbarView("unlocked", 0, false).badge).toBe("");
  });

  it("caps the count so it fits", () => {
    expect(toolbarView("unlocked", 250, false).badge).toBe("99+");
  });

  it("marks a login waiting to be saved, over the count, and says so when locked", () => {
    expect(toolbarView("unlocked", 3, true).badge).toBe("!");
    expect(toolbarView("locked", 0, true)).toMatchObject({ icon: "locked", badge: "!" });
    expect(toolbarView("locked", 0, true).title).toContain("waiting to be saved");
  });
});
