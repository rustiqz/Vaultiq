// Emits dist/manifest.json.
//
// The version comes from package.json, which the release job sets to this
// component's own version — one that moves only when the shipped extension
// actually changes, and not when some unrelated part of the repo does. See
// scripts/component-versions.sh at the repo root.
//
// Between releases this reports the last released version, which is the
// honest answer for a development build.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../dist/manifest.json");

function version(): string {
  const pkg = JSON.parse(
    readFileSync(resolve(here, "../package.json"), "utf8"),
  ) as { version?: string };
  const value = pkg.version ?? "0.0.0";
  // Manifest versions must be plain dotted numbers, at most four parts.
  return /^\d+(\.\d+){0,3}$/.test(value) ? value : "0.0.0";
}

const manifest = {
  manifest_version: 3,
  name: "Vaultiq",
  version: version(),
  description: "Zero-knowledge password manager.",

  // Chrome reads `service_worker`; Firefox reads `scripts` and ignores the
  // other. Firefox has no MV3 service worker at all (bugzil.la/1573659), so
  // shipping both keys is what makes one manifest work in both.
  background: {
    scripts: ["background.js"],
    service_worker: "background.js",
    type: "module",
  },

  action: {
    default_popup: "popup.html",
    default_title: "Vaultiq",
    default_icon: {
      "16": "icons/16.png",
      "32": "icons/32.png",
      "48": "icons/48.png",
      "128": "icons/128.png",
    },
  },

  // Same set as `action.default_icon`, generated from the production
  // favicon artwork via rsvg-convert -- see CLAUDE.md §0.
  icons: {
    "16": "icons/16.png",
    "32": "icons/32.png",
    "48": "icons/48.png",
    "128": "icons/128.png",
  },

  // WebAssembly will not instantiate without `wasm-unsafe-eval`: it is
  // excluded from the default MV3 policy. `self` and `wasm-unsafe-eval` are
  // the only values MV3 permits here.
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },

  // `storage` for the vault and the session key; `alarms` drives auto-lock,
  // which a suspended background context cannot do with setTimeout. No host
  // permissions, no tabs, no scripting — autofill is a later phase, and
  // asking for nothing until then keeps the blast radius of a compromised
  // extension page as small as it can be.
  // `activeTab` lets the background read the URL of the tab you are looking
  // at when you open the popup — granted by that click, and by nothing else.
  // No blanket host access yet; that arrives with autofill.
  // `clipboardRead` is only so a copied secret can be *taken back*: the timer
  // checks the clipboard still holds what it put there before clearing it,
  // rather than wiping whatever the user copied in the meantime.
  permissions: ["storage", "alarms", "activeTab", "clipboardWrite", "clipboardRead"],

  // Autofill has to work on whatever login page you land on, so the content
  // script runs everywhere. This is the largest grant in the extension: it
  // means Vaultiq can read and modify every page you visit. What limits the
  // damage is what the content script is *allowed to ask for* — a list of
  // names for its own site, and one password after a real click.
  host_permissions: ["<all_urls>"],

  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["content.js"],
      // The picker anchors to a focused field, so it needs the document to
      // exist but not its subresources.
      run_at: "document_idle",
      all_frames: true,
    },
  ],

  browser_specific_settings: {
    gecko: {
      id: "vaultiq@rustiqz.github.io",
      strict_min_version: "115.0",
    },
  },
} as const;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest.json written at version ${manifest.version}`);
