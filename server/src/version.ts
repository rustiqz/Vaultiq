// What this build calls itself.
//
// Read from package.json rather than baked in at compile time, because the
// release job writes that file and then tags the tree — so the number in it
// is the one the tag states, with nothing in between to drift.
//
// The image copies package.json next to dist/, and `tsx src/main.ts` runs
// from src/, so "../package.json" resolves to the same file either way.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function read(): string {
  try {
    const manifest = require("../package.json") as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "unknown";
  } catch {
    // A server that cannot read its own manifest still serves vaults. Saying
    // "unknown" is the honest answer; refusing to start over it is not.
    return "unknown";
  }
}

export const VERSION = read();
