// The version endpoint is one line of behaviour and one property that
// matters: it is not public.

import "reflect-metadata";

import { describe, expect, it } from "vitest";
import { DeviceGuard } from "../auth/device.guard.js";
import { VersionController } from "./version.controller.js";
import { VERSION } from "../version.js";

describe("the version endpoint", () => {
  it("reports the version this build was released as", () => {
    // Read from package.json, which the release job writes before it tags —
    // so this is the number the tag states, not one maintained by hand.
    expect(new VersionController().read()).toEqual({ version: VERSION });
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is behind the device guard", () => {
    // The property worth asserting. `/health` is unauthenticated so a
    // container runtime can reach it; an exact build number there would tell
    // anyone who found the domain which advisories apply. Losing this
    // decorator would be a silent change — nothing else would fail.
    //
    // "__guards__" is the key Nest's @UseGuards writes; it is read directly
    // rather than through @nestjs/testing so this stays a unit test.
    const guards: unknown = Reflect.getMetadata("__guards__", VersionController);
    expect(Array.isArray(guards) ? guards : []).toContain(DeviceGuard);
  });
});
