import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node by default — the background touches no DOM. The content script
    // does, so those files opt into jsdom individually with a docblock.
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});
