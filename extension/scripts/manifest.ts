// Emits dist/manifest.json.
//
// The version is read from the git tag rather than kept in a file, so the
// repo tag stays the single source of truth (CLAUDE.md §8.2) and a manifest
// version cannot silently drift from the release it shipped in.

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../dist/manifest.json");

/** `v1.2.3` -> `1.2.3`. Manifest versions must be plain dotted numbers. */
function versionFromGit(): string {
  try {
    const tag = execSync("git describe --tags --abbrev=0", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const cleaned = tag.replace(/^v/, "");
    return /^\d+(\.\d+){0,3}$/.test(cleaned) ? cleaned : "0.0.0";
  } catch {
    // A shallow clone or a fresh repo with no tags yet.
    return "0.0.0";
  }
}

const manifest = {
  manifest_version: 3,
  name: "Vaultiq",
  version: versionFromGit(),
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
  permissions: ["storage", "alarms"],

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
