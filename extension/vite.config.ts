import { resolve } from "node:path";
import { defineConfig } from "vite";

// Explicit entry points, no extension bundler plugin. A plugin that rewrites
// the output would sit inside the trust boundary of a password manager; the
// cost of avoiding one is this file (CLAUDE.md §5.1).
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false, // scripts/manifest.ts writes here first
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background/index.ts"),
        // At the package root so Vite emits dist/popup.html rather than
        // burying it under dist/src/popup/, which the manifest cannot reach.
        popup: resolve(__dirname, "popup.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
      },
    },
  },
});
