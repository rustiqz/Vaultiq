import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node, not jsdom: what is under test is the background context's
    // behaviour, which touches no DOM. The popup is not covered here.
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});
