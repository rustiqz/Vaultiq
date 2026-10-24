// The popup. Renders state and sends requests; it never holds a key and
// never calls the crypto core. Everything sensitive happens in the
// background context.

import "./popup.css";
import { cardBrand, lastFour } from "../lib/card.js";
import { parseOtpauth, TOTP_DEFAULTS } from "../lib/otpauth.js";
import { CLIPBOARD_SECONDS, copyForAWhile } from "../lib/clipboard.js";
import { el } from "./dom.js";
import { ago } from "./format.js";
import { icon, logoMark, svgEl } from "./icons.js";
import { emptyState } from "./empty-state.js";
import { importPanel } from "./import-panel.js";
import { syncPanel } from "./sync-panel.js";
import {
  send,
  type DecryptedItem,
  type DecryptedCard,
  type DecryptedIdentity,
  type DecryptedTotp,
  type CardContent,
  type IdentityContent,
  type ItemContent,
  type TotpContent,
  type ItemType,
  type LoginContent,
  type Request,
  type Response,
  type StrengthLevel,
  type VaultBackup,
  type VaultStatus,
  type PassphraseOptions,
  type PasswordOptions,
  type PendingSaveInfo,
} from "../lib/messages.js";

/** What each item type is called on screen. */
const TYPE_LABEL: Record<ItemType, string> = {
  login: "Login",
  note: "Secure note",
  card: "Card",
  identity: "Identity",
  totp: "Authenticator",
};

const STRENGTH_LABEL: Record<StrengthLevel, string> = {
  "very-weak": "Very weak",
  weak: "Weak",
  fair: "Fair",
  strong: "Strong",
  excellent: "Excellent",
};

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("popup root missing");
const root = app;

type UnlockedScreen = "vault" | "new" | "edit" | "generator" | "trash" | "options";

/**
 * Firefox closes a browser-action popup the moment a native file dialog takes
 * focus, so anything that picks a file cannot run inside one. Those screens
 * open this same page in a full tab instead (`?tab=1`), where the dialog is
 * harmless. Chrome keeps the popup open, but one code path serves both.
 */
const pageParams = new URLSearchParams(location.search);
const inTab = pageParams.has("tab");
if (inTab) document.body.classList.add("tab-mode");

function openInTab(target: "restore" | OptionsSection): void {
  const query = target === "restore" ? "screen=restore" : `screen=options&section=${target}`;
  void browser.tabs
    .create({ url: browser.runtime.getURL(`popup.html?tab=1&${query}`) })
    .then(() => window.close());
}

let currentError: HTMLElement | null = null;

function showError(message: string): void {
  currentError?.remove();
  currentError = el("p", { className: "error", textContent: message });
  root.append(currentError);
}

/** Narrows a response, surfacing the background's message unchanged. */
function unwrap(response: Response): Response & { ok: true } {
  if (!response.ok) throw new Error(response.error);
  return response;
}

/** Saves a backup as a downloaded file — the browser's own save-as prompt does the rest. */
function downloadBackup(backup: VaultBackup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: `vaultiq-backup-${backup.exportedAt.slice(0, 10)}.json` });
  link.click();
  URL.revokeObjectURL(url);
}

async function refresh(): Promise<void> {
  root.replaceChildren(el("main", {}, [el("p", { className: "muted", textContent: "Loading…" })]));
  try {
    const response = unwrap(await send({ kind: "status" }));
    if (response.kind !== "status") throw new Error("unexpected reply");
    render(response.status);
  } catch (error) {
    root.replaceChildren();
    showError(error instanceof Error ? error.message : "Something went wrong.");
  }
}

function passwordForm(label: string, action: (value: string) => Promise<void>): HTMLFormElement {
  const input = el("input", { type: "password", required: true, autocomplete: "current-password" });
  const submit = el("button", { className: "primary", type: "submit", textContent: label });

  const form = el("form", {}, [
    el("label", {}, ["Master password", input]),
    submit,
  ]);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = "Working…";
    void action(input.value)
      .then(refresh)
      .catch((error: unknown) => {
        submit.disabled = false;
        submit.textContent = label;
        showError(error instanceof Error ? error.message : "Failed.");
      });
  });

  return form;
}

let emptyMode: "create" | "join" | "restore" = inTab && pageParams.get("screen") === "restore" ? "restore" : "create";

/** A backup file, picked and parsed, plus the password to unlock it with. */
function restoreForm(): HTMLFormElement {
  let backup: VaultBackup | null = null;

  const input = el("input", { type: "file", accept: ".json,application/json", required: true });
  const fileError = el("p", { className: "error", hidden: true });
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    backup = null;
    fileError.hidden = true;
    if (!file) return;
    void file
      .text()
      .then((text) => {
        backup = JSON.parse(text) as VaultBackup;
      })
      .catch(() => {
        fileError.hidden = false;
        fileError.textContent = "Could not read that file.";
      });
  });

  const password = el("input", { type: "password", required: true, autocomplete: "off" });
  const submit = el("button", { className: "primary", type: "submit", textContent: "Restore vault" });

  const form = el("form", {}, [
    el("label", {}, ["Backup file", input]),
    fileError,
    el("label", {}, ["Master password", password]),
    submit,
  ]);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!backup) {
      showError("Pick a backup file first.");
      return;
    }
    submit.disabled = true;
    submit.textContent = "Working…";
    void send({ kind: "restoreBackup", backup, masterPassword: password.value })
      .then(unwrap)
      .then(refresh)
      .catch((error: unknown) => {
        submit.disabled = false;
        submit.textContent = "Restore vault";
        showError(error instanceof Error ? error.message : "Failed.");
      });
  });

  return form;
}

/** Server URL, invite token (with a paste button), device name, and master password. */
function joinForm(): HTMLFormElement {
  const server = el("input", { type: "url", placeholder: "https://vault.example.com", required: true });
  const token = el("input", { type: "text", autocomplete: "off", placeholder: "From another device", required: true });
  const paste = el("button", { className: "inline", type: "button", textContent: "Paste" });
  paste.addEventListener("click", () => {
    navigator.clipboard
      .readText()
      .then((text) => (token.value = text.trim()))
      .catch(() => showError("Could not read the clipboard."));
  });
  const deviceName = el("input", { type: "text", placeholder: "This laptop", required: true });
  const password = el("input", { type: "password", required: true, autocomplete: "off" });
  const submit = el("button", { className: "primary", type: "submit", textContent: "Join vault" });

  const form = el("form", {}, [
    el("label", {}, ["Server address", server]),
    el("label", {}, ["Invite token", el("div", { className: "field" }, [token, paste])]),
    el("label", {}, ["Name for this device", deviceName]),
    el("label", {}, ["Master password", password]),
    submit,
  ]);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = "Working…";
    void send({
      kind: "enrollWithServer",
      server: server.value.trim(),
      token: token.value.trim(),
      deviceName: deviceName.value.trim(),
      masterPassword: password.value,
    })
      .then(unwrap)
      .then(refresh)
      .catch((error: unknown) => {
        submit.disabled = false;
        submit.textContent = "Join vault";
        showError(error instanceof Error ? error.message : "Failed.");
      });
  });

  return form;
}

function renderEmpty(): void {
  const createTab = el(
    "button",
    { className: `scope-tab${emptyMode === "create" ? " active" : ""}`, type: "button" },
    ["Create vault"],
  );
  createTab.addEventListener("click", () => {
    emptyMode = "create";
    renderEmpty();
  });
  const joinTab = el(
    "button",
    { className: `scope-tab${emptyMode === "join" ? " active" : ""}`, type: "button" },
    ["I have an invite"],
  );
  joinTab.addEventListener("click", () => {
    emptyMode = "join";
    renderEmpty();
  });
  const restoreTab = el(
    "button",
    { className: `scope-tab${emptyMode === "restore" ? " active" : ""}`, type: "button" },
    ["Restore backup"],
  );
  restoreTab.addEventListener("click", () => {
    if (!inTab) {
      openInTab("restore");
      return;
    }
    emptyMode = "restore";
    renderEmpty();
  });

  const body =
    emptyMode === "create"
      ? [
          el("p", {
            className: "muted",
            textContent:
              "Your master password is never stored or sent anywhere. If you lose it, the vault cannot be recovered.",
          }),
          passwordForm("Create vault", async (value) => {
            unwrap(await send({ kind: "create", masterPassword: value }));
          }),
        ]
      : emptyMode === "join"
        ? [
            el("p", {
              className: "muted",
              textContent:
                "Uses a token from a device that's already in your vault. Your master password stays on this device — it's only used to unwrap the vault key once you're in.",
            }),
            joinForm(),
          ]
        : [
            el("p", {
              className: "muted",
              textContent:
                "Restores a vault from a file made with “Export backup.” Every item comes back exactly as it was, and the vault is not connected to any server unless you connect it afterward.",
            }),
            restoreForm(),
          ];

  root.replaceChildren(
    el("main", { className: "onboard" }, [
      el("div", { className: "brand" }, [logoMark({ size: 26 }), el("h1", { textContent: "Welcome to Vaultiq" })]),
      el("div", { className: "scope-tabs" }, [createTab, joinTab, restoreTab]),
      ...body,
    ]),
  );
}

/** One setting: what it is and why on the left, the control on the right. */
function settingRow(label: string, hint: string, control: HTMLElement): HTMLElement {
  return el("div", { className: "setting-row" }, [
    el("div", { className: "setting-copy" }, [el("strong", { textContent: label }), el("small", { textContent: hint })]),
    el("div", { className: "setting-control" }, [control]),
  ]);
}

/**
 * A setting that is on or off. The switch comes first, directly beside its
 * label: pushed to the far edge of a wide row it ends up a screen away from the
 * words that say what it does.
 */
function toggleRow(label: string, hint: string, input: HTMLInputElement): HTMLElement {
  input.className = "switch";
  return el("label", { className: "setting-row toggle-row" }, [
    input,
    el("span", { className: "setting-copy" }, [el("strong", { textContent: label }), el("small", { textContent: hint })]),
  ]);
}

function card(title: string | undefined, children: HTMLElement[]): HTMLElement {
  return el("section", { className: "card" }, [...(title ? [el("h2", { textContent: title })] : []), ...children]);
}

/** Auto-lock. */
function unlockingCard(): HTMLElement {
  const LOCK_CHOICES: [number, string][] = [
    [5, "5 minutes"],
    [15, "15 minutes"],
    [30, "30 minutes"],
    [60, "1 hour"],
    [240, "4 hours"],
    [480, "8 hours"],
    [1440, "24 hours"],
    [0, "Never (until the browser closes)"],
  ];
  const lockAfter = el("select", {});
  const addChoice = (value: number, label: string): void => {
    lockAfter.append(el("option", { value: String(value), textContent: label }));
  };
  for (const [value, label] of LOCK_CHOICES) addChoice(value, label);
  void send({ kind: "autoLock" }).then((response) => {
    if (!response.ok || response.kind !== "autoLock") return;
    // A value saved by an older version (the field used to take any number of
    // minutes) stays selectable rather than silently snapping to a preset.
    if (!LOCK_CHOICES.some(([value]) => value === response.minutes)) {
      addChoice(response.minutes, `${String(response.minutes)} minutes`);
    }
    lockAfter.value = String(response.minutes);
  });
  lockAfter.addEventListener("change", () => {
    void send({ kind: "setAutoLock", minutes: Number(lockAfter.value) });
  });

  return card("Unlocking", [
    settingRow(
      "Lock the vault after",
      "A longer time is more convenient, but leaves your vault open for longer if you step away. Locking always happens when the browser closes.",
      lockAfter,
    ),
  ]);
}

/**
 * Quick unlock: whether a PIN is set, and setting, changing or removing it.
 *
 * Repainted from the background after every action, so what it says is what
 * is actually armed rather than what this card last did.
 */
function quickUnlockCard(): HTMLElement {
  const body = el("div", { className: "card-body stack" });

  const paint = async (): Promise<void> => {
    let status: { set: boolean; attemptsLeft: number; maxAttempts: number; minLength: number };
    try {
      const response = unwrap(await send({ kind: "pinStatus" }));
      if (response.kind !== "pinStatus") throw new Error("unexpected reply");
      status = response;
    } catch (error) {
      showError(error instanceof Error ? error.message : "Could not read the PIN status.");
      return;
    }

    const tries =
      status.set && status.attemptsLeft < status.maxAttempts
        ? `${String(status.attemptsLeft)} of ${String(status.maxAttempts)} wrong tries left, then it is removed.`
        : status.set
          ? "Reopens the vault without your master password."
          : "Set one to reopen the vault without typing your master password.";

    const first = el("input", {
      type: "password",
      inputMode: "numeric",
      autocomplete: "off",
      placeholder: `At least ${String(status.minLength)} digits`,
    });
    const again = el("input", { type: "password", inputMode: "numeric", autocomplete: "off", placeholder: "Repeat it" });
    const submit = el("button", {
      className: "primary",
      type: "submit",
      textContent: status.set ? "Change PIN" : "Set PIN",
    });

    const form = el("form", {}, [
      el("div", { className: "form-grid" }, [
        el("label", {}, [status.set ? "New PIN" : "PIN", first]),
        el("label", {}, ["Repeat PIN", again]),
      ]),
      el("div", { className: "field" }, [submit]),
    ]);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      // The repeat is here to catch a slip: a PIN typed wrongly once would be
      // one the person cannot enter, and every wrong try counts against it.
      if (first.value !== again.value) {
        showError("The two PINs do not match.");
        return;
      }
      submit.disabled = true;
      void send({ kind: "setPin", pin: first.value })
        .then(unwrap)
        .then(() => {
          first.value = "";
          again.value = "";
          return paint();
        })
        .catch((error: unknown) => {
          submit.disabled = false;
          showError(error instanceof Error ? error.message : "Failed.");
        });
    });

    const parts: HTMLElement[] = [
      el("div", { className: "pin-status" }, [
        el("span", { className: `pin-dot ${status.set ? "on" : "off"}` }),
        el("div", { className: "grow" }, [
          el("strong", { textContent: status.set ? "PIN is on" : "No PIN set" }),
          el("small", { className: "muted", textContent: tries }),
        ]),
      ]),
      form,
    ];

    if (status.set) {
      const remove = el("button", { className: "danger", type: "button", textContent: "Remove PIN" });
      remove.addEventListener("click", () => {
        remove.disabled = true;
        void send({ kind: "forgetPin" })
          .then(unwrap)
          .then(() => paint())
          .catch((error: unknown) => {
            remove.disabled = false;
            showError(error instanceof Error ? error.message : "Failed.");
          });
      });
      parts.push(el("div", { className: "field" }, [remove]));
    }

    parts.push(
      el("p", {
        className: "muted",
        textContent:
          "Held in memory only, so it ends when the browser closes. It is kept when the vault locks on idle, and removed when you lock it by hand or get the PIN wrong too many times.",
      }),
    );
    body.replaceChildren(...parts);
  };

  void paint();
  return card("Quick unlock", [body]);
}

/** Changing the master password. */
function masterPasswordCard(): HTMLElement {
  const currentPassword = el("input", { type: "password", autocomplete: "off" });
  const nextPassword = el("input", { type: "password", autocomplete: "new-password" });
  const againPassword = el("input", { type: "password", autocomplete: "new-password" });
  const change = el("button", {
    className: "primary",
    type: "button",
    textContent: "Change password",
  });

  change.addEventListener("click", () => {
    if (nextPassword.value !== againPassword.value) {
      showError("The new passwords do not match.");
      return;
    }

    change.disabled = true;
    change.textContent = "Working…";
    void send({
      kind: "changeMasterPassword",
      currentPassword: currentPassword.value,
      newPassword: nextPassword.value,
    })
      .then(unwrap)
      .then(() => {
        // Nothing typed here is kept once the request has gone out.
        currentPassword.value = "";
        nextPassword.value = "";
        againPassword.value = "";
        change.textContent = "Changed";
        setTimeout(() => (change.textContent = "Change password"), 1800);
      })
      .catch((error: unknown) => {
        change.textContent = "Change password";
        showError(error instanceof Error ? error.message : "Failed.");
      })
      .finally(() => {
        change.disabled = false;
      });
  });

  return card("Master password", [
    el("div", { className: "card-body" }, [
      el("div", { className: "form-grid" }, [
        el("label", {}, ["Current", currentPassword]),
        el("label", {}, ["New", nextPassword]),
        el("label", {}, ["New again", againPassword]),
      ]),
      el("div", { className: "field" }, [change]),
      el("p", {
        className: "muted",
        textContent:
          "Re-wraps the vault key, so no item is re-encrypted and nothing has to re-sync. Other devices pick the change up the next time they sync. The old password then opens nothing, and there is no way back.",
      }),
    ]),
  ]);
}

/** This device's name, and whether the vault may sync at all. */
function deviceCard(): HTMLElement {
  const name = el("input", { type: "text", autocomplete: "off" });
  void send({ kind: "device" }).then((response) => {
    if (response.ok && response.kind === "device") name.value = response.device.name;
  });
  name.addEventListener("change", () => {
    void send({ kind: "renameDevice", name: name.value });
  });

  const localOnlyToggle = el("input", { type: "checkbox" });
  void send({ kind: "localOnly" }).then((response) => {
    if (response.ok && response.kind === "localOnly") localOnlyToggle.checked = response.value;
  });
  localOnlyToggle.addEventListener("change", () => {
    const next = localOnlyToggle.checked;
    void (async () => {
      if (next) {
        const status = unwrap(await send({ kind: "syncStatus" }));
        if (status.kind === "syncStatus" && status.sync.connected) {
          if (
            !confirm(
              `This will disconnect from ${status.sync.server ?? "the server"} and stop this vault from syncing anywhere. Continue?`,
            )
          ) {
            localOnlyToggle.checked = false;
            return;
          }
          unwrap(await send({ kind: "disconnectServer" }));
        }
      }
      unwrap(await send({ kind: "setLocalOnly", value: next }));
    })().catch((error: unknown) => {
      localOnlyToggle.checked = !next;
      showError(error instanceof Error ? error.message : "Failed.");
    });
  });

  return card("This device", [
    settingRow("Device name", "Shown to your other devices, and in the record of where a login was used.", name),
    toggleRow(
      "Never sync this vault",
      "Keeps this vault on this device only. Turning it on disconnects any server this device is using. Turning it off does not connect anywhere by itself — it only makes syncing available again.",
      localOnlyToggle,
    ),
  ]);
}

/** Starts an export: the master password is asked for first, every time. */
function startExport(): void {
  askMasterPassword({
    title: "Export backup",
    detail: "Enter your master password to export. The file holds your whole vault, so this is asked every time.",
    confirm: "Export",
    action: async (masterPassword) => {
      const response = unwrap(await send({ kind: "exportBackup", masterPassword }));
      if (response.kind !== "exportBackup") throw new Error("unexpected reply");
      downloadBackup(response.backup);
    },
  });
}

function backupCard(): HTMLElement {
  const exportButton = el("button", { type: "button" }, [icon("copy", { size: 14 }), "Export backup"]);
  exportButton.addEventListener("click", startExport);
  return card("Backup", [
    settingRow(
      "Export a backup file",
      "A copy of your whole vault, still encrypted, that opens with your master password. Restore it from the welcome screen on a device with no vault.",
      exportButton,
    ),
  ]);
}

type OptionsSection = "security" | "devices" | "data" | "tools";

const OPTIONS_SECTIONS: { id: OptionsSection; label: string; blurb: string }[] = [
  { id: "security", label: "Security", blurb: "How and when the vault locks, and the password that opens it." },
  { id: "devices", label: "Devices & sync", blurb: "This device, and the server it syncs through." },
  { id: "data", label: "Import & backup", blurb: "Bring logins in from another manager, or take a copy out." },
  { id: "tools", label: "Tools", blurb: "Things that do not need an unlocked vault." },
];

function optionsCards(section: OptionsSection): HTMLElement[] {
  switch (section) {
    case "security":
      return [unlockingCard(), quickUnlockCard(), masterPasswordCard()];
    case "devices":
      return [deviceCard(), card(undefined, [el("div", { className: "card-body" }, [syncPanel(showError)])])];
    case "data":
      return [card(undefined, [el("div", { className: "card-body" }, [importPanel()])]), backupCard()];
    case "tools":
      return [card(undefined, [el("div", { className: "card-body" }, [generatorPanel()])])];
  }
}

const GENERATOR_KEY = "vaultiq:generator";
const GENERATOR_MIN = 8;
const GENERATOR_MAX = 64;
const WORDS_MIN = 3;
const WORDS_MAX = 12;

/** What can sit between the words of a passphrase. */
const SEPARATORS: [string, string][] = [
  ["-", "Hyphen  -"],
  [" ", "Space"],
  [".", "Period  ."],
  ["_", "Underscore  _"],
  [",", "Comma  ,"],
  ["", "None"],
];

interface GeneratorState {
  mode: "password" | "passphrase";
  password: PasswordOptions;
  passphrase: PassphraseOptions;
}

const GENERATOR_DEFAULTS: GeneratorState = {
  mode: "password",
  password: {
    length: 20,
    lowercase: true,
    uppercase: true,
    digits: true,
    symbols: true,
    avoid_ambiguous: false,
  },
  passphrase: { words: 6, separator: "-", capitalize: false, include_number: false },
};

function clampWhole(value: unknown, fallback: number, min: number, max: number): number {
  const whole = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, whole));
}

/**
 * What the generator was last set to. A convenience only — nothing in it is
 * secret — so a browser that will not store it (private window, blocked site
 * data) simply starts from the defaults each time. Anything that does not read
 * back as a valid setting falls back to its default rather than being trusted.
 */
function savedGenerator(): GeneratorState {
  const fresh = (): GeneratorState => ({
    mode: GENERATOR_DEFAULTS.mode,
    password: { ...GENERATOR_DEFAULTS.password },
    passphrase: { ...GENERATOR_DEFAULTS.passphrase },
  });
  try {
    const raw = localStorage.getItem(GENERATOR_KEY);
    if (!raw) return fresh();
    const saved = JSON.parse(raw) as {
      mode?: unknown;
      password?: Partial<Record<keyof PasswordOptions, unknown>>;
      passphrase?: Partial<Record<keyof PassphraseOptions, unknown>>;
    };
    const state = fresh();
    if (saved.mode === "passphrase") state.mode = "passphrase";

    const pw = saved.password;
    if (pw) {
      const candidate: PasswordOptions = {
        length: clampWhole(pw.length, state.password.length, GENERATOR_MIN, GENERATOR_MAX),
        lowercase: pw.lowercase === true,
        uppercase: pw.uppercase === true,
        digits: pw.digits === true,
        symbols: pw.symbols === true,
        avoid_ambiguous: pw.avoid_ambiguous === true,
      };
      // A stored set with every type off could never generate anything.
      if (candidate.lowercase || candidate.uppercase || candidate.digits || candidate.symbols) {
        state.password = candidate;
      }
    }

    const phrase = saved.passphrase;
    if (phrase) {
      const separator = SEPARATORS.find(([value]) => value === phrase.separator)?.[0];
      state.passphrase = {
        words: clampWhole(phrase.words, state.passphrase.words, WORDS_MIN, WORDS_MAX),
        separator: separator ?? state.passphrase.separator,
        capitalize: phrase.capitalize === true,
        include_number: phrase.include_number === true,
      };
    }
    return state;
  } catch {
    return fresh();
  }
}

function saveGenerator(state: GeneratorState): void {
  try {
    localStorage.setItem(GENERATOR_KEY, JSON.stringify(state));
  } catch {
    // Not remembered; see above.
  }
}

/**
 * A generator that needs no vault.
 *
 * Offered on the locked screen too: wanting a password is not a reason to
 * have unlocked, and a signup form does not wait. What is made is made by the
 * crypto core in the background; this only chooses what it may contain.
 */
function generatorPanel(): HTMLElement {
  const state = savedGenerator();
  const typeKeys = ["lowercase", "uppercase", "digits", "symbols"] as const;

  const output = el("div", { className: "gen-output", textContent: "—" });
  const meter = el("div", { className: "meter gen-meter" });
  const note = el("p", { className: "muted gen-note" });

  const regenerate = el(
    "button",
    { className: "detail-action", type: "button", title: "Generate another", ariaLabel: "Generate another" },
    [icon("regenerate", { size: 17 })],
  );
  const copy = el(
    "button",
    {
      className: "detail-action",
      type: "button",
      title: `Copy — cleared after ${String(CLIPBOARD_SECONDS)} seconds`,
      ariaLabel: "Copy",
    },
    [icon("copy", { size: 17 })],
  );

  let current = "";
  let latest = 0;

  const generate = async (): Promise<void> => {
    const mine = ++latest;
    try {
      if (state.mode === "passphrase") {
        const made = unwrap(await send({ kind: "generatePassphrase", options: { ...state.passphrase } }));
        if (made.kind !== "generatePassphrase" || mine !== latest) return;
        current = made.passphrase;
        output.textContent = current;
        // The entropy of how it was drawn, not a score of the text.
        meter.className = "meter gen-meter";
        meter.textContent = `~${String(made.bits)} bits · ${String(state.passphrase.words)} words`;
        return;
      }

      const made = unwrap(await send({ kind: "generatePassword", options: { ...state.password } }));
      if (made.kind !== "generatePassword" || mine !== latest) return;
      current = made.password;
      output.textContent = current;

      const rated = unwrap(await send({ kind: "checkStrength", password: current }));
      if (rated.kind !== "checkStrength" || mine !== latest) return;
      meter.className = `meter gen-meter level-${rated.strength.level}`;
      meter.textContent = `${STRENGTH_LABEL[rated.strength.level]} · ~${String(rated.strength.bits)} bits`;
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed.");
    }
  };

  const changed = (): void => {
    saveGenerator(state);
    void generate();
  };

  regenerate.addEventListener("click", () => void generate());
  copy.addEventListener("click", () => {
    if (current === "") return;
    void copyForAWhile(current)
      .then(() => {
        copy.replaceChildren("Copied");
        setTimeout(() => copy.replaceChildren(icon("copy", { size: 17 })), 1200);
      })
      .catch(() => showError("Could not copy."));
  });

  /** A labelled slider with its value beside the label. */
  const slider = (
    label: string,
    min: number,
    max: number,
    value: number,
    update: (next: number) => void,
  ): HTMLElement => {
    const shown = el("strong", { textContent: String(value) });
    const input = el("input", { type: "range", min: String(min), max: String(max), step: "1", value: String(value) });
    input.addEventListener("input", () => {
      const next = Number(input.value);
      shown.textContent = String(next);
      update(next);
      changed();
    });
    return el("label", { className: "gen-length" }, [el("span", { className: "gen-length-row" }, [label, shown]), input]);
  };

  /** An on/off setting with its switch beside its words. */
  const switchRow = (label: string, hint: string, on: boolean, update: (next: boolean) => void): HTMLElement => {
    const box = el("input", { type: "checkbox", className: "switch", checked: on });
    box.addEventListener("change", () => {
      update(box.checked);
      changed();
    });
    return el("label", { className: "gen-toggle" }, [
      box,
      el("span", {}, [label, " ", el("small", { className: "muted", textContent: hint })]),
    ]);
  };

  // --- password controls ---
  const chip = (key: (typeof typeKeys)[number], title: string, sample: string): HTMLElement => {
    const box = el("input", { type: "checkbox", checked: state.password[key] });
    box.addEventListener("change", () => {
      state.password[key] = box.checked;
      // The core refuses a password with nothing to draw from, so the last
      // type cannot be switched off — say why rather than silently ignoring it.
      if (!typeKeys.some((each) => state.password[each])) {
        state.password[key] = true;
        box.checked = true;
        note.textContent = "Keep at least one type selected.";
        setTimeout(() => (note.textContent = ""), 2200);
        return;
      }
      changed();
    });
    return el("label", { className: "chip", title }, [box, el("span", { textContent: sample })]);
  };

  const passwordControls = el("div", { className: "stack gen-controls" }, [
    slider("Length", GENERATOR_MIN, GENERATOR_MAX, state.password.length, (next) => {
      state.password.length = next;
    }),
    el("div", { className: "chips" }, [
      chip("lowercase", "Lowercase letters", "a–z"),
      chip("uppercase", "Uppercase letters", "A–Z"),
      chip("digits", "Numbers", "0–9"),
      chip("symbols", "Symbols", "!@#"),
    ]),
    switchRow("Avoid look-alike characters", "0 O o 1 l I", state.password.avoid_ambiguous === true, (next) => {
      state.password.avoid_ambiguous = next;
    }),
  ]);

  // --- passphrase controls ---
  const separator = el("select", {});
  for (const [value, label] of SEPARATORS) separator.append(el("option", { value, textContent: label }));
  separator.value = state.passphrase.separator;
  separator.addEventListener("change", () => {
    state.passphrase.separator = separator.value;
    changed();
  });

  const passphraseControls = el("div", { className: "stack gen-controls" }, [
    slider("Words", WORDS_MIN, WORDS_MAX, state.passphrase.words, (next) => {
      state.passphrase.words = next;
    }),
    el("label", {}, ["Separator", separator]),
    switchRow("Capitalize each word", "", state.passphrase.capitalize, (next) => {
      state.passphrase.capitalize = next;
    }),
    switchRow("Add a number", "one digit on one word", state.passphrase.include_number, (next) => {
      state.passphrase.include_number = next;
    }),
    el("p", {
      className: "muted",
      textContent:
        "Words come from the EFF long list. Six is plenty for most accounts; use eight or more for a master password.",
    }),
  ]);

  // --- mode ---
  const modeTab = (mode: GeneratorState["mode"], label: string): HTMLButtonElement => {
    const button = el("button", { className: "scope-tab", type: "button", textContent: label });
    button.addEventListener("click", () => {
      if (state.mode === mode) return;
      state.mode = mode;
      showMode();
      changed();
    });
    return button;
  };
  const passwordTab = modeTab("password", "Password");
  const passphraseTab = modeTab("passphrase", "Passphrase");

  function showMode(): void {
    const phrase = state.mode === "passphrase";
    passwordTab.classList.toggle("active", !phrase);
    passphraseTab.classList.toggle("active", phrase);
    passwordControls.hidden = phrase;
    passphraseControls.hidden = !phrase;
    note.textContent = "";
  }
  showMode();

  void generate();

  return el("div", { className: "group generator" }, [
    el("h2", { textContent: "Generator" }),
    el("div", { className: "scope-tabs" }, [passwordTab, passphraseTab]),
    el("div", { className: "gen-result" }, [output, el("div", { className: "gen-actions" }, [regenerate, copy])]),
    meter,
    passwordControls,
    passphraseControls,
    note,
  ]);
}

/**
 * The one-button generator shown on the locked screens.
 *
 * Deliberately small: the lock screen is for entering a PIN or password, and
 * the full generator (modes, options, saved settings) pushed those fields out
 * of reach. The full panel lives behind the unlock.
 */
function quickGeneratorPanel(): HTMLElement {
  const output = el("div", { className: "muted", textContent: "—" });
  const make = el("button", { className: "inline", type: "button" }, [icon("regenerate", { size: 12 }), "Generate one"]);
  const copy = el("button", { className: "inline", type: "button", textContent: "Copy" });
  copy.hidden = true;
  let current = "";
  copy.addEventListener("click", () => {
    void copyForAWhile(current)
      .then(() => {
        copy.textContent = "Copied";
        setTimeout(() => (copy.textContent = "Copy"), 1200);
      })
      .catch(() => showError("Could not copy."));
  });

  make.addEventListener("click", () => {
    make.disabled = true;
    void send({ kind: "generatePassword" })
      .then(unwrap)
      .then((response) => {
        if (response.kind !== "generatePassword") throw new Error("unexpected reply");
        current = response.password;
        output.textContent = current;
        copy.hidden = false;
      })
      .catch((error: unknown) => {
        showError(error instanceof Error ? error.message : "Failed.");
      })
      .finally(() => {
        make.disabled = false;
      });
  });

  return el("div", { className: "group" }, [el("h2", { textContent: "Password generator" }), output, make, copy]);
}

/** Why a login typed into a page is waiting, and what to do about it. */
function pendingSaveCopy(info: PendingSaveInfo): { title: string; detail: string } {
  return {
    title: info.update ? "Update this login?" : "Save this login?",
    detail: `${info.username || "(no username)"} · ${info.site}`,
  };
}

/**
 * Ends whatever the decision was about. In the small window opened from a
 * page's "Unlock to save" button, that window has nothing left to show.
 */
function afterPendingDecision(): void {
  if (pageParams.get("screen") === "unlock") {
    window.close();
    return;
  }
  void refresh();
}

function decidePendingSave(save: boolean, button: HTMLButtonElement): void {
  button.disabled = true;
  void send({ kind: "resolvePendingSave", save })
    .then(unwrap)
    .then(afterPendingDecision)
    .catch((error: unknown) => {
      button.disabled = false;
      showError(error instanceof Error ? error.message : "Could not save.");
    });
}

/** The vault is open: save, update or drop the login that was typed while it was not. */
function pendingSaveBanner(info: PendingSaveInfo): HTMLElement {
  const copy = pendingSaveCopy(info);
  const save = el("button", { className: "primary", type: "button", textContent: info.update ? "Update" : "Save" });
  const dismiss = el("button", { type: "button", textContent: "Not now" });
  save.addEventListener("click", () => decidePendingSave(true, save));
  dismiss.addEventListener("click", () => decidePendingSave(false, dismiss));
  return el("section", { className: "pending-save", role: "status" }, [
    el("div", { className: "grow" }, [
      el("strong", { textContent: copy.title }),
      el("small", { textContent: copy.detail }),
    ]),
    dismiss,
    save,
  ]);
}

/** Still locked: say what unlocking will offer, and let it be dropped. */
function pendingSaveNotice(info: PendingSaveInfo): HTMLElement {
  const dismiss = el("button", { className: "inline", type: "button", textContent: "Not now" });
  dismiss.addEventListener("click", () => decidePendingSave(false, dismiss));
  return el("section", { className: "pending-save pending-note", role: "status" }, [
    el("div", { className: "grow" }, [
      el("strong", { textContent: "Unlock to save a login" }),
      el("small", { textContent: pendingSaveCopy(info).detail }),
    ]),
    dismiss,
  ]);
}

async function fetchPendingSave(): Promise<PendingSaveInfo | null> {
  try {
    const response = await send({ kind: "pendingSave" });
    return response.ok && response.kind === "pendingSave" ? response.pending : null;
  } catch {
    return null;
  }
}

/** Unlocking with a PIN, when one is armed for this browser session. */
function renderQuick(pending: PendingSaveInfo | null = null): void {
  const pin = el("input", {
    type: "password",
    required: true,
    inputMode: "numeric",
    autocomplete: "off",
    placeholder: "PIN",
  });
  const submit = el("button", { className: "primary", type: "submit", textContent: "Unlock" });

  const form = el("form", {}, [el("label", {}, ["PIN", pin]), submit]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit.disabled = true;
    void send({ kind: "unlockWithPin", pin: pin.value })
      .then(unwrap)
      .then(refresh)
      .catch((error: unknown) => {
        submit.disabled = false;
        pin.value = "";
        showError(error instanceof Error ? error.message : "Failed.");
      });
  });

  const useMaster = el("button", {
    className: "inline",
    type: "button",
    textContent: "Use master password",
  });
  useMaster.addEventListener("click", () => {
    void send({ kind: "forgetPin" }).then(refresh);
  });

  root.replaceChildren(
    el("main", {}, [
      el("div", { className: "brand" }, [logoMark({ size: 26 }), el("h1", { textContent: "Vaultiq is locked" })]),
      ...(pending ? [pendingSaveNotice(pending)] : []),
      el("p", {
        className: "muted",
        textContent: "Your PIN lasts until the browser closes.",
      }),
      form,
      useMaster,
      el("hr"),
      quickGeneratorPanel(),
    ]),
  );
}

function renderLocked(pending: PendingSaveInfo | null = null): void {
  root.replaceChildren(
    el("main", { className: "onboard" }, [
      el("div", { className: "brand" }, [logoMark({ size: 26 }), el("h1", { textContent: "Vaultiq is locked" })]),
      ...(pending ? [pendingSaveNotice(pending)] : []),
      passwordForm("Unlock", async (value) => {
        unwrap(await send({ kind: "unlock", masterPassword: value }));
      }),
      el("hr"),
      quickGeneratorPanel(),
    ]),
  );
}

/**
 * A form for one item, used for both adding and editing.
 *
 * The type is fixed when the form opens and never offered as a control: an
 * item does not change what it is, because its type is bound into the
 * authentication tag of every version it has ever had.
 */
function itemForm(
  submitLabel: string,
  type: ItemType,
  initial: ItemContent | undefined,
  submit: (content: ItemContent) => Promise<void>,
  cancel?: () => void,
): HTMLFormElement {
  const name = el("input", {
    type: "text",
    autocomplete: "off",
    placeholder: "Optional, e.g. Work",
  });
  if (initial) name.value = initial.name ?? "";

  /** The name, omitted rather than stored empty — as it was before it existed. */
  const named = (): { name?: string } => {
    const trimmed = name.value.trim();
    return trimmed ? { name: trimmed } : {};
  };

  const fields: HTMLElement[] = [el("label", {}, ["Name", name])];
  let read: () => ItemContent;

  if (type === "login") {
    const login = initial?.type === "login" ? initial : undefined;

    const username = el("input", { type: "text", required: true, autocomplete: "off" });
    const password = el("input", { type: "password", required: true, autocomplete: "off" });
    const url = el("input", { type: "text", autocomplete: "off", placeholder: "https://" });

    if (login) {
      username.value = login.username;
      password.value = login.password;
      url.value = login.url;
    } else {
      // A new login is almost always for the page you are looking at, so the
      // site is filled in rather than typed. Still editable.
      void send({ kind: "itemsForSite" }).then((response) => {
        if (response.ok && response.kind === "itemsForSite" && response.site && !url.value) {
          url.value = response.site;
        }
      });
    }

    // Generation happens in the background; the popup never loads the crypto
    // module. Revealing the field on generate is deliberate — a password you
    // cannot see is one you cannot check against the site's own rules.
    const generate = el("button", { type: "button", className: "inline" }, [icon("regenerate", { size: 12 }), "Generate"]);
    generate.addEventListener("click", () => {
      generate.disabled = true;
      void send({ kind: "generatePassword" })
        .then(unwrap)
        .then((response) => {
          if (response.kind !== "generatePassword") throw new Error("unexpected reply");
          password.value = response.password;
          password.type = "text";
          rescore();
        })
        .catch((error: unknown) => {
          showError(error instanceof Error ? error.message : "Failed.");
        })
        .finally(() => {
          generate.disabled = false;
        });
    });

    // Scored in the background as you type, so the popup never loads the
    // crypto module and every client agrees on the number.
    const meter = el("div", { className: "meter muted" });
    let pending = 0;
    const rescore = (): void => {
      const value = password.value;
      const token = ++pending;
      if (!value) {
        meter.textContent = "";
        meter.className = "meter muted";
        return;
      }
      void send({ kind: "checkStrength", password: value }).then((response) => {
        if (token !== pending || !response.ok || response.kind !== "checkStrength") return;
        const { level, bits } = response.strength;
        meter.textContent = `${STRENGTH_LABEL[level]} · ~${String(bits)} bits`;
        meter.className = `meter level-${level}`;
      });
    };
    password.addEventListener("input", rescore);

    fields.push(
      el("label", {}, ["Username", username]),
      el("label", {}, ["Password", el("div", { className: "field" }, [password, generate])]),
      meter,
      el("label", {}, ["Site", url]),
    );

    read = (): LoginContent => ({
      type: "login",
      ...named(),
      username: username.value,
      password: password.value,
      url: url.value,
      // Fields this form does not show are carried through rather than
      // dropped: an edit must not quietly delete what it cannot display.
      notes: login?.notes ?? "",
      ...(login?.email === undefined ? {} : { email: login.email }),
      ...(login?.mobile === undefined ? {} : { mobile: login.mobile }),
    });
  } else if (type === "card") {
    const card = initial?.type === "card" ? initial : undefined;

    const cardholder = el("input", { type: "text", autocomplete: "off" });
    const number = el("input", { type: "text", inputMode: "numeric", autocomplete: "off" });
    const month = el("input", {
      type: "text",
      inputMode: "numeric",
      placeholder: "MM",
      maxLength: 2,
    });
    const year = el("input", {
      type: "text",
      inputMode: "numeric",
      placeholder: "YYYY",
      maxLength: 4,
    });
    const securityCode = el("input", {
      type: "password",
      inputMode: "numeric",
      autocomplete: "off",
      maxLength: 4,
    });
    const pin = el("input", {
      type: "password",
      inputMode: "numeric",
      autocomplete: "off",
      placeholder: "Optional",
    });

    if (card) {
      cardholder.value = card.cardholder;
      number.value = card.number;
      month.value = card.expiryMonth;
      year.value = card.expiryYear;
      securityCode.value = card.securityCode;
      pin.value = card.pin ?? "";
    }

    // Named as the scheme as soon as the number says which, so a mistyped
    // card is visible before it is saved rather than after.
    const scheme = el("div", { className: "meter muted" });
    const relabel = (): void => {
      const brand = cardBrand(number.value);
      const tail = lastFour(number.value);
      scheme.textContent = brand ? `${brand}${tail ? ` · ends ${tail}` : ""}` : "";
    };
    number.addEventListener("input", relabel);
    relabel();

    fields.push(
      el("label", {}, ["Cardholder", cardholder]),
      el("label", {}, ["Number", number]),
      scheme,
      el("label", {}, ["Expires", el("div", { className: "field" }, [month, year])]),
      el("label", {}, ["Security code", securityCode]),
      el("label", {}, ["PIN", pin]),
    );

    read = (): CardContent => ({
      type: "card",
      ...named(),
      cardholder: cardholder.value,
      number: number.value,
      expiryMonth: month.value,
      expiryYear: year.value,
      securityCode: securityCode.value,
      ...(pin.value ? { pin: pin.value } : {}),
      notes: card?.notes ?? "",
    });
  } else if (type === "identity") {
    const identity = initial?.type === "identity" ? initial : undefined;

    /** One text input, prefilled from the item being edited. */
    const line = (
      key: keyof IdentityContent,
      options: Partial<HTMLInputElement> = {},
    ): HTMLInputElement => {
      const input = el("input", { type: "text", autocomplete: "off", ...options });
      const value = identity?.[key];
      if (typeof value === "string") input.value = value;
      return input;
    };

    const firstName = line("firstName");
    const lastName = line("lastName");
    const company = line("company");
    const email = line("email", { type: "email" });
    const phone = line("phone", { type: "tel" });
    const street = line("street");
    const street2 = line("street2", { placeholder: "Optional" });
    const city = line("city");
    const state = line("state");
    const postalCode = line("postalCode");
    const country = line("country");
    const dateOfBirth = line("dateOfBirth", { type: "date" });
    // Masked like a password: this is the field that opens accounts on its own.
    const nationalId = line("nationalId", { type: "password", placeholder: "Optional" });

    fields.push(
      el("label", {}, ["First name", firstName]),
      el("label", {}, ["Last name", lastName]),
      el("label", {}, ["Company", company]),
      el("label", {}, ["Email", email]),
      el("label", {}, ["Phone", phone]),
      el("label", {}, ["Address", street]),
      el("label", {}, ["Address line 2", street2]),
      el("label", {}, ["City", city]),
      el("label", {}, ["State or region", state]),
      el("label", {}, ["Postcode", postalCode]),
      el("label", {}, ["Country", country]),
      el("label", {}, ["Date of birth", dateOfBirth]),
      el("label", {}, ["Passport or national ID", nationalId]),
    );

    read = (): IdentityContent => ({
      type: "identity",
      ...named(),
      firstName: firstName.value,
      lastName: lastName.value,
      email: email.value,
      phone: phone.value,
      street: street.value,
      ...(street2.value ? { street2: street2.value } : {}),
      city: city.value,
      state: state.value,
      postalCode: postalCode.value,
      country: country.value,
      ...(company.value ? { company: company.value } : {}),
      ...(dateOfBirth.value ? { dateOfBirth: dateOfBirth.value } : {}),
      ...(nationalId.value ? { nationalId: nationalId.value } : {}),
      notes: identity?.notes ?? "",
    });
  } else if (type === "totp") {
    const account = initial?.type === "totp" ? initial : undefined;

    const issuer = el("input", { type: "text", autocomplete: "off", placeholder: "e.g. GitHub" });
    const holder = el("input", { type: "text", autocomplete: "off", placeholder: "you@example.com" });
    const secret = el("input", {
      type: "password",
      autocomplete: "off",
      placeholder: "Secret, or paste the otpauth:// link",
    });

    let shape = account
      ? { algorithm: account.algorithm, digits: account.digits, period: account.period }
      : { ...TOTP_DEFAULTS };

    if (account) {
      issuer.value = account.issuer;
      holder.value = account.account;
      secret.value = account.secret;
    }

    const shapeNote = el("div", { className: "meter muted" });
    const describe = (): void => {
      shapeNote.textContent =
        shape.algorithm === TOTP_DEFAULTS.algorithm &&
        shape.digits === TOTP_DEFAULTS.digits &&
        shape.period === TOTP_DEFAULTS.period
          ? ""
          : `${shape.algorithm} · ${String(shape.digits)} digits · ${String(shape.period)}s`;
    };
    describe();

    // The whole point of accepting the link: an authenticator's setup page
    // offers it beside the QR code, and it carries the parameters that a
    // hand-typed secret leaves to guesswork.
    secret.addEventListener("input", () => {
      const parsed = parseOtpauth(secret.value);
      if (!parsed) return;
      secret.value = parsed.secret;
      if (parsed.issuer) issuer.value = parsed.issuer;
      if (parsed.account) holder.value = parsed.account;
      shape = { algorithm: parsed.algorithm, digits: parsed.digits, period: parsed.period };
      describe();
    });

    fields.push(
      el("label", {}, ["Issuer", issuer]),
      el("label", {}, ["Account", holder]),
      el("label", {}, ["Secret", secret]),
      shapeNote,
    );

    read = (): TotpContent => ({
      type: "totp",
      ...named(),
      issuer: issuer.value.trim(),
      account: holder.value.trim(),
      secret: secret.value.trim(),
      // Stored even when they are the defaults: a record carrying only a
      // secret is one whose codes change the day a default does.
      algorithm: shape.algorithm,
      digits: shape.digits,
      period: shape.period,
      notes: account?.notes ?? "",
    });
  } else {
    // A secure note is its name and its text. `notes` is common to every
    // item, so a note needs no field of its own — see NoteContent.
    const body = el("textarea", { autocomplete: "off", rows: 8 });
    if (initial) body.value = initial.notes;

    fields.push(el("label", {}, ["Note", body]));
    read = () => ({ type: "note", ...named(), notes: body.value });
  }

  const save = el("button", { className: "primary", type: "submit", textContent: submitLabel });
  const actions = el("div", { className: "row" }, [save]);

  if (cancel) {
    const back = el("button", { type: "button", textContent: "Cancel" });
    back.addEventListener("click", cancel);
    actions.append(back);
  }

  const form = el("form", {}, [...fields, actions]);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save.disabled = true;
    void submit(read())
      .then(refresh)
      .catch((error: unknown) => {
        save.disabled = false;
        showError(error instanceof Error ? error.message : "Failed.");
      });
  });

  return form;
}

function action(label: string, request: Request, confirmWith?: string): HTMLButtonElement {
  const button = el("button", { type: "button", textContent: label });
  button.addEventListener("click", () => {
    if (confirmWith && !confirm(confirmWith)) return;
    button.disabled = true;
    void send(request)
      .then(unwrap)
      .then(refresh)
      .catch((error: unknown) => {
        button.disabled = false;
        showError(error instanceof Error ? error.message : "Failed.");
      });
  });
  return button;
}

function stamps(item: DecryptedItem): HTMLElement {
  const parts = [
    `used ${ago(item.usage.lastUsedAt)}`,
    item.usage.useCount ? `${String(item.usage.useCount)}×` : "",
    `changed ${ago(item.lastModifiedAt)}`,
  ].filter(Boolean);
  return el("div", { className: "stamps", textContent: parts.join(" · ") });
}

/** How an identity reads when it has no name of its own. */
function identityLabel(item: DecryptedIdentity): string {
  return [item.firstName, item.lastName].filter(Boolean).join(" ");
}

/** The address as one line, for copying into a single field. */
function oneLineAddress(item: DecryptedIdentity): string {
  return [item.street, item.street2, item.city, item.state, item.postalCode, item.country]
    .filter(Boolean)
    .join(", ");
}

/** How a card reads when it has no name of its own. */
function cardLabel(item: DecryptedCard): string {
  const scheme = item.brand ?? "Card";
  return item.last4 ? `${scheme} ···· ${item.last4}` : scheme;
}

/** How an authenticator account reads when it has no name of its own. */
function totpLabel(item: DecryptedTotp): string {
  return [item.issuer, item.account].filter(Boolean).join(" · ") || TYPE_LABEL.totp;
}

/**
 * A row that counts down.
 *
 * The code is asked for again when its window runs out rather than on a
 * fixed timer, and the request is for this one account — re-listing the vault
 * once a second would decrypt every item to refresh six digits. The interval
 * is cleared when the row leaves the document, which a re-render does.
 */
function trashedRow(item: DecryptedItem): HTMLLIElement {
  const label = item.name?.trim();
  const fallback = untitled(item);
  const detail =
    item.type === "login"
      ? [label ? item.username : "", item.url].filter(Boolean).join(" · ") || "(no site)"
      : item.type === "card"
        ? cardLabel(item)
        : item.type === "identity"
          ? oneLineAddress(item) || TYPE_LABEL.identity
          : item.type === "totp"
            ? totpLabel(item)
            : TYPE_LABEL.note;

  return el("li", { className: "trashed" }, [
    el("div", { className: "name" }, [label || fallback || "(untitled)"]),
    el("div", { className: "meta", textContent: detail }),
    el("div", { className: "row" }, [
      action("Restore", { kind: "restoreItem", id: item.id }),
      action(
        "Delete for good",
        { kind: "purgeItem", id: item.id },
        "Erase this item permanently? It cannot be recovered.",
      ),
    ]),
  ]);
}

/** Everything the search box looks at. Never the password. */
function haystack(item: DecryptedItem): string {
  // A card is searched by its last four and its scheme, never by its full
  // number: those are how a card is asked for, and a search that scanned
  // whole numbers would match a typed digit against every card at once.
  const fields =
    item.type === "login"
      ? [item.name, item.username, item.email, item.mobile, item.url, item.notes]
      : item.type === "card"
        ? [item.name, item.cardholder, item.brand, item.last4, item.notes]
        : item.type === "identity"
          ? // Never the national ID: it is a secret, and nobody searches by it.
            [
              item.name,
              item.firstName,
              item.lastName,
              item.company,
              item.email,
              item.phone,
              item.city,
              item.country,
              item.notes,
            ]
          : item.type === "totp"
            ? // Never the secret, and never the code: one is the credential
              // and the other is stale by the time anyone types it.
              [item.name, item.issuer, item.account, item.notes]
            : [item.name, item.notes];
  return fields.filter(Boolean).join(" ").toLowerCase();
}

/** Most recently used first; anything never used falls back to its name. */
function byRecentUse(a: DecryptedItem, b: DecryptedItem): number {
  const left = a.usage.lastUsedAt ?? 0;
  const right = b.usage.lastUsedAt ?? 0;
  if (left !== right) return right - left;
  return sortName(a).localeCompare(sortName(b), undefined, { sensitivity: "base" });
}

/** What an item sorts under when nothing has been used recently. */
function sortName(item: DecryptedItem): string {
  return item.name ?? untitled(item);
}

/** What an item is called when it has no name of its own. */
function untitled(item: DecryptedItem): string {
  switch (item.type) {
    case "login":
      return item.username;
    case "card":
      return cardLabel(item);
    case "identity":
      return identityLabel(item);
    case "totp":
      return totpLabel(item);
    case "note":
      return "(untitled note)";
  }
}

/** Kept across a re-render, so typing does not reset the list. */
let query = "";
let selectedId: string | undefined;
let listScope: "site" | "all" = "site";
let unlockedScreen: UnlockedScreen = inTab && pageParams.get("screen") === "options" ? "options" : "vault";
let optionsSection: OptionsSection =
  OPTIONS_SECTIONS.find((candidate) => candidate.id === pageParams.get("section"))?.id ?? "security";
let refocusSearch = false;

function itemTitle(item: DecryptedItem): string {
  return item.name?.trim() || untitled(item) || `(untitled ${TYPE_LABEL[item.type].toLowerCase()})`;
}

function itemSummary(item: DecryptedItem): string {
  switch (item.type) {
    case "login":
      return item.username || item.url || TYPE_LABEL.login;
    case "card":
      return [item.brand, item.last4 ? `•••• ${item.last4}` : ""].filter(Boolean).join(" · ") || TYPE_LABEL.card;
    case "identity":
      return item.email || oneLineAddress(item) || TYPE_LABEL.identity;
    case "totp":
      return [item.issuer, item.account].filter(Boolean).join(" · ") || TYPE_LABEL.totp;
    case "note":
      return item.notes.trim().replace(/\s+/g, " ").slice(0, 46) || TYPE_LABEL.note;
  }
}

function itemGlyph(item: DecryptedItem): HTMLElement {
  return el("span", { className: `item-glyph item-glyph-${item.type}` }, [
    icon(item.type, { size: 18 }),
  ]);
}

function recordCopy(item: DecryptedItem): void {
  void send({ kind: "recordUse", id: item.id, event: "copied" });
}

const RING_RADIUS = 20;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** "123456" as "123 456", so a code can be read off the screen and typed. */
function groupCode(code: string): string {
  const half = Math.ceil(code.length / 2);
  return code.length >= 6 ? `${code.slice(0, half)} ${code.slice(half)}` : code;
}

/**
 * A live one-time code: the digits, a ring draining toward the next one, and a
 * copy button.
 *
 * Only the code crosses from the background, once a second, and only while
 * this element is on screen — the secret never reaches the popup, and the
 * background decrypts a single item per request rather than the whole vault.
 * The digits start hidden, like a password, and the copy button works either
 * way, so a code is never shown to someone who only wanted to paste it.
 */
function totpTicker(item: DecryptedTotp): HTMLElement {
  const digits = el("span", { className: "totp-code", textContent: "•••  •••" });
  const seconds = el("span", { className: "totp-seconds" });
  const arc = svgEl("circle", {
    cx: 24, cy: 24, r: RING_RADIUS, fill: "none", "stroke-width": 4, "stroke-linecap": "round",
    "stroke-dasharray": RING_LENGTH, "stroke-dashoffset": 0, transform: "rotate(-90 24 24)",
  });
  arc.setAttribute("class", "totp-arc");
  const track = svgEl("circle", { cx: 24, cy: 24, r: RING_RADIUS, fill: "none", "stroke-width": 4 });
  track.setAttribute("class", "totp-track");
  const ring = svgEl("svg", { width: 48, height: 48, viewBox: "0 0 48 48" });
  ring.setAttribute("aria-hidden", "true");
  ring.append(track, arc);

  const reveal = el("button", { className: "detail-action", type: "button", title: "Show", ariaLabel: "Show code" }, [
    icon("reveal", { size: 17 }),
  ]);
  const copy = el("button", { className: "detail-action", type: "button", title: "Copy code", ariaLabel: "Copy code" }, [
    icon("copy", { size: 17 }),
  ]);

  const widget = el("div", { className: "totp-ticker" }, [
    el("div", { className: "totp-ring" }, [ring, seconds]),
    el("div", { className: "totp-main" }, [
      el("span", { className: "detail-label", textContent: "One-time code" }),
      digits,
    ]),
    reveal,
    copy,
  ]);

  let code = "";
  let revealed = false;
  const paint = (remaining: number): void => {
    digits.textContent = code === "" ? "—" : revealed ? groupCode(code) : "•••  •••";
    seconds.textContent = code === "" ? "" : String(remaining);
    const fraction = Math.max(0, Math.min(1, remaining / item.period));
    arc.setAttribute("stroke-dashoffset", String(RING_LENGTH * (1 - fraction)));
    // The last few seconds are the ones where a typed code can expire.
    widget.classList.toggle("totp-expiring", code !== "" && remaining <= 5);
  };

  const tick = async (): Promise<void> => {
    try {
      const response = await send({ kind: "totpCode", id: item.id });
      if (!response.ok || response.kind !== "totpCode") return;
      code = response.code;
      paint(response.secondsRemaining);
    } catch {
      // A locked or closing vault is handled by the screen that owns it.
    }
  };

  reveal.addEventListener("click", () => {
    revealed = !revealed;
    reveal.title = revealed ? "Hide" : "Show";
    reveal.ariaLabel = revealed ? "Hide code" : "Show code";
    if (revealed) void send({ kind: "recordUse", id: item.id, event: "revealed" });
    digits.textContent = code === "" ? "—" : revealed ? groupCode(code) : "•••  •••";
  });
  copy.addEventListener("click", () => {
    if (code === "") return;
    void copyForAWhile(code)
      .then(() => {
        recordCopy(item);
        copy.replaceChildren("Copied");
        setTimeout(() => copy.replaceChildren(icon("copy", { size: 17 })), 1200);
      })
      .catch(() => showError("Could not copy."));
  });

  void tick();
  const timer = setInterval(() => {
    // The popup rebuilds its DOM on every render; stop with the element.
    if (!widget.isConnected) clearInterval(timer);
    else void tick();
  }, 1000);
  return widget;
}

function detailField(
  item: DecryptedItem,
  label: string,
  value: string,
  options: { masked?: boolean; multiline?: boolean } = {},
): HTMLElement {
  const shown = el("span", {
    className: `detail-value${options.multiline === true ? " detail-value-multiline" : ""}`,
  });
  let revealed = options.masked !== true;
  const paint = (): void => {
    shown.textContent = revealed ? value || "—" : "•".repeat(Math.min(value.length, 12));
  };
  paint();

  const actions: HTMLElement[] = [];
  if (options.masked === true && value) {
    const reveal = el("button", {
      className: "detail-action",
      type: "button",
      title: "Show",
      ariaLabel: "Show value",
    }, [icon("reveal", { size: 17 })]);
    reveal.addEventListener("click", () => {
      revealed = !revealed;
      reveal.title = revealed ? "Hide" : "Show";
      reveal.ariaLabel = reveal.title;
      paint();
      if (revealed) void send({ kind: "recordUse", id: item.id, event: "revealed" });
    });
    actions.push(reveal);
  }

  if (value) {
    const copy = el("button", {
      className: "detail-action",
      type: "button",
      title: `Copy — cleared after ${String(CLIPBOARD_SECONDS)} seconds`,
      ariaLabel: `Copy ${label.toLowerCase()}`,
    }, [icon("copy", { size: 17 })]);
    copy.addEventListener("click", () => {
      void copyForAWhile(value)
        .then(() => {
          recordCopy(item);
          copy.classList.add("copied");
          copy.replaceChildren("Copied");
          setTimeout(() => {
            copy.classList.remove("copied");
            copy.replaceChildren(icon("copy", { size: 17 }));
          }, 1200);
        })
        .catch(() => showError("Could not copy."));
    });
    actions.push(copy);
  }

  return el("div", { className: "detail-field" }, [
    el("div", { className: "detail-field-copy" }, [
      el("span", { className: "detail-label", textContent: label }),
      shown,
    ]),
    el("div", { className: "detail-actions" }, actions),
  ]);
}

function detailForItem(item: DecryptedItem, currentSite: string | null, isForSite: boolean): HTMLElement {
  const edit = el("button", { className: "quiet-button", type: "button" }, [
    icon("edit", { size: 15 }),
    "Edit",
  ]);
  edit.addEventListener("click", () => {
    selectedId = item.id;
    unlockedScreen = "edit";
    void renderUnlocked();
  });

  const del = el("button", { className: "quiet-button danger", type: "button" }, [
    icon("trash", { size: 15 }),
    "Delete",
  ]);
  del.addEventListener("click", () => {
    if (!confirm("Move to trash? You can restore it from Trash later.")) return;
    del.disabled = true;
    void send({ kind: "trashItem", id: item.id })
      .then(unwrap)
      .then(refresh)
      .catch((error: unknown) => {
        del.disabled = false;
        showError(error instanceof Error ? error.message : "Could not delete.");
      });
  });

  const fields = el("div", { className: "detail-card" });
  if (item.type === "login") {
    const meter = el("div", { className: `meter level-${item.strength.level}` }, [
      `${STRENGTH_LABEL[item.strength.level]} · ~${String(item.strength.bits)} bits`,
    ]);
    fields.append(
      detailField(item, "Username", item.username),
      detailField(item, "Password", item.password, { masked: true }),
      meter,
    );
    if (item.reusedBy > 0) {
      fields.append(
        el("div", { className: "reuse-note" }, [
          icon("alertTriangle", { size: 14, color: "var(--warn)" }),
          el("span", {
            textContent: `Also used by ${String(item.reusedBy)} other login${item.reusedBy === 1 ? "" : "s"}.`,
          }),
        ]),
      );
    }
    fields.append(detailField(item, "Website", item.url));
  } else if (item.type === "card") {
    fields.append(
      detailField(item, "Cardholder", item.cardholder),
      detailField(item, "Card number", item.number, { masked: true }),
      detailField(item, "Expires", [item.expiryMonth, item.expiryYear].filter(Boolean).join(" / ")),
      detailField(item, "Security code", item.securityCode, { masked: true }),
    );
  } else if (item.type === "identity") {
    fields.append(
      detailField(item, "Name", identityLabel(item)),
      detailField(item, "Email", item.email),
      detailField(item, "Phone", item.phone),
      detailField(item, "Address", oneLineAddress(item), { multiline: true }),
    );
    if (item.nationalId) fields.append(detailField(item, "Passport or national ID", item.nationalId, { masked: true }));
  } else if (item.type === "totp") {
    fields.append(
      totpTicker(item),
      detailField(item, "Account", item.account),
      detailField(item, "Issuer", item.issuer),
    );
  } else {
    fields.append(detailField(item, "Secure note", item.notes, { masked: true, multiline: true }));
  }

  const content: HTMLElement[] = [
    el("div", { className: "detail-heading" }, [
      itemGlyph(item),
      el("div", { className: "grow" }, [
        el("h1", { textContent: itemTitle(item) }),
        el("p", { className: "detail-subtitle", textContent: item.type === "login" ? (currentSite ?? item.url) : TYPE_LABEL[item.type] }),
      ]),
      edit,
      del,
    ]),
  ];

  if (item.type === "login" && isForSite && currentSite) {
    const fill = el("button", { className: "primary fill-button", type: "button" }, [
      icon("fill", { size: 18 }),
      `Fill on ${currentSite}`,
    ]);
    fill.addEventListener("click", () => {
      fill.disabled = true;
      void send({ kind: "fillActiveLogin", id: item.id })
        .then(unwrap)
        .then((response) => {
          if (response.kind !== "fillActiveLogin") throw new Error("unexpected reply");
          fill.replaceChildren(icon("fill", { size: 18 }), "Filled");
          setTimeout(() => window.close(), 450);
        })
        .catch((error: unknown) => {
          fill.disabled = false;
          showError(error instanceof Error ? error.message : "Could not fill this page.");
        });
    });
    content.push(fill);
  }

  content.push(fields);
  if (item.notes && item.type !== "note") {
    content.push(detailField(item, "Note", item.notes, { multiline: true }));
  }
  content.push(stamps(item));

  return el("section", { className: "item-detail" }, content);
}

/**
 * A modal that asks for the master password and runs `action` with it.
 *
 * Stays open on failure so a mistyped password can be retried; a wrong one
 * reads the same as it does on the lock screen.
 */
function askMasterPassword(options: {
  title: string;
  detail: string;
  confirm: string;
  action: (masterPassword: string) => Promise<void>;
}): void {
  const input = el("input", { type: "password", required: true, autocomplete: "current-password" });
  const error = el("p", { className: "error", hidden: true });
  const cancel = el("button", { type: "button", textContent: "Cancel" });
  const submit = el("button", { className: "primary", type: "submit", textContent: options.confirm });
  const form = el("form", { className: "modal" }, [
    el("h2", { textContent: options.title }),
    el("p", { className: "muted", textContent: options.detail }),
    el("label", {}, ["Master password", input]),
    error,
    el("div", { className: "modal-actions" }, [cancel, submit]),
  ]);
  const backdrop = el("div", { className: "modal-backdrop" }, [form]);
  const close = (): void => {
    input.value = "";
    backdrop.remove();
  };
  cancel.addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = "Working…";
    error.hidden = true;
    void options
      .action(input.value)
      .then(close)
      .catch((failure: unknown) => {
        submit.disabled = false;
        submit.textContent = options.confirm;
        error.hidden = false;
        error.textContent = failure instanceof Error ? failure.message : "Failed.";
        input.select();
      });
  });
  document.body.append(backdrop);
  input.focus();
}


function popupHeader(search?: HTMLInputElement): HTMLElement {
  const brand = el("div", { className: "popup-brand" }, [
    logoMark({ size: 30 }),
    el("span", { textContent: "Vaultiq" }),
  ]);

  if (!search) {
    const back = el("button", { className: "detail-action", type: "button", title: "Back", ariaLabel: "Back" }, [
      icon("chevronLeft", { size: 18 }),
    ]);
    back.addEventListener("click", () => {
      unlockedScreen = "vault";
      void renderUnlocked();
    });
    return el("header", { className: "popup-header sub-header" }, [back, brand]);
  }

  const add = el("button", { className: "primary add-button", type: "button" }, [
    icon("plus", { size: 16 }),
    "Add item",
  ]);
  add.addEventListener("click", () => {
    unlockedScreen = "new";
    void renderUnlocked();
  });

  const more = el("button", { className: "detail-action", type: "button", title: "More", ariaLabel: "More" }, [
    icon("moreVertical", { size: 18 }),
  ]);
  const menu = el("div", { className: "overflow-menu", hidden: true });
  // Settings, sync, and import open in a full tab: they are longer than a
  // popup can hold comfortably, and a file dialog closes a Firefox popup.
  const destinations: { label: string; section?: OptionsSection; screen?: UnlockedScreen }[] = [
    { label: "Settings", section: "security" },
    { label: "Sync & devices", section: "devices" },
    { label: "Import", section: "data" },
    { label: "Password generator", screen: "generator" },
    { label: "Trash", screen: "trash" },
  ];
  for (const destination of destinations) {
    const button = el("button", { className: "menu-item", type: "button", textContent: destination.label });
    button.addEventListener("click", () => {
      const { section, screen } = destination;
      if (section !== undefined) {
        if (!inTab) {
          openInTab(section);
          return;
        }
        optionsSection = section;
        unlockedScreen = "options";
      } else if (screen !== undefined) {
        unlockedScreen = screen;
      }
      void renderUnlocked();
    });
    menu.append(button);
  }
  const exportBackup = el("button", { className: "menu-item", type: "button", textContent: "Export backup" });
  exportBackup.addEventListener("click", () => {
    menu.hidden = true;
    startExport();
  });
  menu.append(exportBackup);

  const lock = el("button", { className: "menu-item", type: "button" }, [icon("lock", { size: 14 }), "Lock vault"]);
  lock.addEventListener("click", () => void send({ kind: "lock" }).then(refresh));
  menu.append(lock);
  more.addEventListener("click", (event) => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  // The header is rebuilt on every render, so these listeners are removed with
  // the menu rather than accumulating on the document.
  const closeMenu = (): void => {
    menu.hidden = true;
  };
  const onDocumentClick = (event: Event): void => {
    if (!menu.isConnected) {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onDocumentKey);
      return;
    }
    if (!menu.hidden && !menu.contains(event.target as Node)) closeMenu();
  };
  const onDocumentKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") closeMenu();
  };
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKey);

  return el("header", { className: "popup-header" }, [
    brand,
    el("div", { className: "header-search grow" }, [icon("search", { size: 18 }), search]),
    add,
    el("div", { className: "menu-wrap" }, [more, menu]),
  ]);
}

/**
 * Settings, sync and import: a side navigation and a page of cards.
 *
 * Only reached in a full tab (see `openInTab`); in the popup these entries open
 * one.
 */
function renderOptionsPage(): void {
  const current = OPTIONS_SECTIONS.find((candidate) => candidate.id === optionsSection) ?? OPTIONS_SECTIONS[0];
  if (!current) return;

  const nav = el(
    "nav",
    { className: "options-nav", ariaLabel: "Sections" },
    OPTIONS_SECTIONS.map((section) => {
      const button = el("button", {
        className: `options-nav-item${section.id === current.id ? " active" : ""}`,
        type: "button",
        textContent: section.label,
      });
      button.addEventListener("click", () => {
        optionsSection = section.id;
        void renderUnlocked();
      });
      return button;
    }),
  );

  const back = el("button", { type: "button" }, [icon("chevronLeft", { size: 14 }), "Back to vault"]);
  back.addEventListener("click", () => {
    unlockedScreen = "vault";
    void renderUnlocked();
  });

  root.replaceChildren(
    el("header", { className: "options-header" }, [
      el("div", { className: "popup-brand" }, [logoMark({ size: 26 }), "Vaultiq"]),
      el("div", { className: "grow" }),
      back,
    ]),
    el("div", { className: "options-layout" }, [
      nav,
      el("section", { className: "options-content" }, [
        el("div", { className: "options-title" }, [
          el("h1", { textContent: current.label }),
          el("p", { className: "muted", textContent: current.blurb }),
        ]),
        el("div", { className: "options-grid" }, optionsCards(current.id)),
      ]),
    ]),
  );
}

function renderUtility(title: string, content: HTMLElement): void {
  root.replaceChildren(
    popupHeader(),
    el("main", { className: "utility-screen" }, [el("h1", { textContent: title }), content]),
  );
}

async function renderUnlocked(): Promise<void> {
  const pending = await fetchPendingSave();
  const response = unwrap(await send({ kind: "listItems" }));
  if (response.kind !== "listItems") throw new Error("unexpected reply");

  const forSite = unwrap(await send({ kind: "itemsForSite" }));
  if (forSite.kind !== "itemsForSite") throw new Error("unexpected reply");

  const needle = query.trim().toLowerCase();
  const matches = (item: DecryptedItem): boolean =>
    needle === "" || haystack(item).includes(needle);

  const siteIds = new Set(forSite.items.map((item) => item.id));
  const site = forSite.items.filter(matches).sort(byRecentUse);
  const live = response.items.filter((item) => !item.deleted && matches(item)).sort(byRecentUse);
  const trashed = response.items.filter((item) => item.deleted && matches(item));

  if (unlockedScreen === "options") return renderOptionsPage();
  if (unlockedScreen === "generator") return renderUtility("Password generator", generatorPanel());
  if (unlockedScreen === "trash") {
    return renderUtility(
      "Trash",
      trashed.length
        ? el("ul", { className: "trash-list" }, trashed.map(trashedRow))
        : emptyState({
            icon: "trash",
            title: "Trash is empty",
            hint: "Items you delete wait here until you remove them for good, so a slip is never final.",
          }),
    );
  }

  const selected = response.items.find((item) => !item.deleted && item.id === selectedId);
  if (unlockedScreen === "edit" && selected) {
    const form = itemForm(
      "Save changes",
      selected.type,
      selected,
      async (content) => {
        unwrap(await send({ kind: "updateItem", id: selected.id, content }));
        unlockedScreen = "vault";
      },
      () => {
        unlockedScreen = "vault";
        void renderUnlocked();
      },
    );
    return renderUtility(`Edit ${TYPE_LABEL[selected.type].toLowerCase()}`, form);
  }

  if (unlockedScreen === "new") {
    const chooser = el("div", { className: "type-chooser" });
    for (const type of Object.keys(TYPE_LABEL) as ItemType[]) {
      const button = el("button", { className: "type-choice", type: "button" }, [
        el("span", { className: `item-glyph item-glyph-${type}` }, [icon(type, { size: 20 })]),
        el("span", {}, [
          el("strong", { textContent: TYPE_LABEL[type] }),
          el("small", { textContent: type === "login" ? "Username, password and site" : type === "totp" ? "Time-based one-time code" : `New ${TYPE_LABEL[type].toLowerCase()}` }),
        ]),
        icon("chevronRight", { size: 16 }),
      ]);
      button.addEventListener("click", () => {
        const form = itemForm(
          "Save item",
          type,
          undefined,
          async (content) => {
            unwrap(await send({ kind: "addItem", content }));
            unlockedScreen = "vault";
          },
          () => {
            unlockedScreen = "vault";
            void renderUnlocked();
          },
        );
        renderUtility(`New ${TYPE_LABEL[type].toLowerCase()}`, form);
      });
      chooser.append(button);
    }
    return renderUtility("Add item", chooser);
  }

  const search = el("input", {
    type: "search",
    placeholder: "Search vault",
    value: query,
    autocomplete: "off",
    ariaLabel: "Search vault",
  });
  search.addEventListener("input", () => {
    query = search.value;
    refocusSearch = true;
    void renderUnlocked();
  });

  if (site.length === 0 && listScope === "site") listScope = "all";
  const shownItems = needle ? live : listScope === "site" ? site : live;
  if (!shownItems.some((item) => item.id === selectedId)) selectedId = shownItems[0]?.id;
  const active = shownItems.find((item) => item.id === selectedId);

  const siteTab = el("button", { className: `scope-tab${listScope === "site" ? " active" : ""}`, type: "button" }, [
    "This site",
    el("span", { textContent: String(site.length) }),
  ]);
  siteTab.disabled = site.length === 0;
  siteTab.addEventListener("click", () => {
    listScope = "site";
    selectedId = site[0]?.id;
    void renderUnlocked();
  });
  const allTab = el("button", { className: `scope-tab${listScope === "all" ? " active" : ""}`, type: "button" }, [
    "All items",
    el("span", { textContent: String(response.items.filter((item) => !item.deleted).length) }),
  ]);
  allTab.addEventListener("click", () => {
    listScope = "all";
    selectedId = live[0]?.id;
    void renderUnlocked();
  });

  const rows = el("div", { className: "vault-rows" });
  for (const item of shownItems) {
    const row = el("button", {
      className: `vault-row${item.id === selectedId ? " selected" : ""}`,
      type: "button",
    }, [
      itemGlyph(item),
      el("span", { className: "vault-row-copy" }, [
        el("strong", { textContent: itemTitle(item) }),
        el("small", { textContent: itemSummary(item) }),
      ]),
      icon("chevronRight", { size: 15 }),
    ]);
    row.addEventListener("click", () => {
      selectedId = item.id;
      void renderUnlocked();
    });
    rows.append(row);
  }
  const vaultEmpty = response.items.every((item) => item.deleted);
  if (!shownItems.length) {
    rows.append(
      vaultEmpty
        ? emptyState({ icon: "login", title: "Nothing yet", hint: "Items you save will be listed here.", compact: true })
        : emptyState({
            icon: "search",
            title: "No matches",
            hint: `Nothing matches “${query.trim()}”.`,
            compact: true,
            actions: [
              {
                label: "Clear search",
                onClick: () => {
                  query = "";
                  refocusSearch = true;
                  void renderUnlocked();
                },
              },
            ],
          }),
    );
  }

  const sidebar = el("aside", { className: "vault-sidebar" }, [
    el("div", { className: "site-context" }, [
      el("span", { className: "status-dot" }),
      el("strong", { textContent: forSite.site ?? "No website detected" }),
      el("span", { textContent: `· ${String(site.length)} ${site.length === 1 ? "match" : "matches"}` }),
    ]),
    el("div", { className: "scope-tabs" }, [siteTab, allTab]),
    rows,
  ]);

  const detail = active
    ? detailForItem(active, forSite.site, siteIds.has(active.id))
    : vaultEmpty
      ? el("section", { className: "item-detail detail-empty" }, [
          emptyState({
            icon: "login",
            title: "Your vault is empty",
            hint: "Add a login, or bring them in from another password manager. Everything is encrypted before it is saved.",
            actions: [
              {
                label: "Add item",
                primary: true,
                onClick: () => {
                  unlockedScreen = "new";
                  void renderUnlocked();
                },
              },
              { label: "Import", onClick: () => openInTab("data") },
            ],
          }),
        ])
      : el("section", { className: "item-detail detail-empty" }, [
        logoMark({ size: 42 }),
        el("h1", { textContent: "Choose an item" }),
        el("p", { className: "muted", textContent: "Select a vault item to see its details and quick actions." }),
      ]);

  root.replaceChildren(
    popupHeader(search),
    ...(pending && !pending.locked ? [pendingSaveBanner(pending)] : []),
    el("div", { className: "vault-workspace" }, [sidebar, detail]),
  );

  if (refocusSearch) {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
    refocusSearch = false;
  }
}

/** What the page is currently drawn for; `watchStatus` redraws when the vault moves on. */
let shownStatus: VaultStatus | undefined;

function render(status: VaultStatus): void {
  shownStatus = status;
  switch (status) {
    case "empty":
      return renderEmpty();
    case "locked":
      void fetchPendingSave().then(renderLocked);
      return;
    case "quick":
      void fetchPendingSave().then(renderQuick);
      return;
    case "unlocked":
      void renderUnlocked().catch((error: unknown) => {
        root.replaceChildren();
        showError(error instanceof Error ? error.message : "Failed.");
      });
      return;
  }
}

/**
 * The vault can lock while this page is open (the auto-lock timer, or Lock in
 * another window). A page left open in a tab would otherwise keep showing a
 * vault that no longer answers. Only a change redraws, so typing in a form is
 * never interrupted; `status` does not count as activity, so this cannot hold
 * the vault open.
 */
async function watchStatus(): Promise<void> {
  try {
    const response = await send({ kind: "status" });
    if (response.ok && response.kind === "status" && shownStatus !== undefined && response.status !== shownStatus) {
      void refresh();
    }
  } catch {
    // The background restarting is not a lock; the next check will see.
  }
}
setInterval(() => void watchStatus(), 3000);
window.addEventListener("focus", () => void watchStatus());

void refresh();

