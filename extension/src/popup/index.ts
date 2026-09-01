// The popup. Renders state and sends requests; it never holds a key and
// never calls the crypto core. Everything sensitive happens in the
// background context.

import "./popup.css";
import { CLIPBOARD_SECONDS, copyForAWhile } from "../lib/clipboard.js";
import { ago } from "./format.js";
import {
  send,
  type DecryptedItem,
  type LoginContent,
  type Request,
  type Response,
  type StrengthLevel,
  type VaultStatus,
} from "../lib/messages.js";

const STRENGTH_LABEL: Record<StrengthLevel, string> = {
  "very-weak": "Very weak",
  weak: "Weak",
  fair: "Fair",
  strong: "Strong",
  excellent: "Excellent",
};

/** Levels worth nagging about in the list. */
function isWeak(level: StrengthLevel): boolean {
  return level === "very-weak" || level === "weak";
}

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("popup root missing");
const root = app;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/**
 * A value that copies itself when clicked.
 *
 * Secrets go to the clipboard on a timer — see `copyForAWhile`. `masked`
 * keeps a password off screen until asked for, which is the default for one.
 */
function copyable(
  value: string,
  options: { masked?: boolean; onCopy?: () => void } = {},
): HTMLElement {
  if (!value) return el("span", { className: "muted", textContent: "—" });

  // Destructured rather than reached through on each call: a member access
  // to a function property reads as an unbound method to the linter.
  const { masked, onCopy } = options;
  const hidden = masked === true;
  const button = el("button", {
    className: "copyable",
    type: "button",
    title: `Copy — cleared after ${String(CLIPBOARD_SECONDS)} seconds`,
  });

  let shown = !hidden;
  const paint = (label?: string): void => {
    button.textContent = label ?? (shown ? value : "•".repeat(Math.min(value.length, 12)));
  };
  paint();

  button.addEventListener("click", () => {
    void copyForAWhile(value)
      .then(() => {
        onCopy?.();
        button.classList.add("copied");
        paint("Copied");
        setTimeout(() => {
          button.classList.remove("copied");
          paint();
        }, 1200);
      })
      .catch(() => {
        showError("Could not copy.");
      });
  });

  if (!hidden) return button;

  const reveal = el("button", { className: "inline", type: "button", textContent: "Show" });
  reveal.addEventListener("click", () => {
    shown = !shown;
    reveal.textContent = shown ? "Hide" : "Show";
    paint();
  });

  return el("span", { className: "field" }, [button, reveal]);
}

function showError(message: string): void {
  root.append(el("p", { className: "error", textContent: message }));
}

/** Narrows a response, surfacing the background's message unchanged. */
function unwrap(response: Response): Response & { ok: true } {
  if (!response.ok) throw new Error(response.error);
  return response;
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

function renderEmpty(): void {
  root.replaceChildren(
    el("main", {}, [
    el("h1", { textContent: "Create your vault" }),
    el("p", {
      className: "muted",
      textContent:
        "Your master password is never stored or sent anywhere. If you lose it, the vault cannot be recovered.",
    }),
    passwordForm("Create vault", async (value) => {
      unwrap(await send({ kind: "create", masterPassword: value }));
    }),
    ]),
  );
}

/** PIN, auto-lock and this device's name. */
function settingsPanel(): HTMLElement {
  const panel = el("div", { className: "group" }, [el("h2", { textContent: "Settings" })]);

  // --- PIN ---
  const pin = el("input", {
    type: "password",
    inputMode: "numeric",
    autocomplete: "off",
    placeholder: "At least 4 digits",
  });
  const setPin = el("button", { className: "inline", type: "button", textContent: "Set PIN" });
  setPin.addEventListener("click", () => {
    setPin.disabled = true;
    void send({ kind: "setPin", pin: pin.value })
      .then(unwrap)
      .then(() => {
        pin.value = "";
        setPin.textContent = "PIN set";
        setTimeout(() => (setPin.textContent = "Set PIN"), 1400);
      })
      .catch((error: unknown) => {
        showError(error instanceof Error ? error.message : "Failed.");
      })
      .finally(() => {
        setPin.disabled = false;
      });
  });

  panel.append(
    el("label", {}, ["Quick unlock PIN", el("div", { className: "field" }, [pin, setPin])]),
    el("p", {
      className: "muted",
      textContent:
        "Reopens the vault after it locks. Held in memory only, so it lasts until the browser closes.",
    }),
  );

  // --- auto-lock ---
  const minutes = el("input", { type: "number", min: "0", max: "1440", step: "1" });
  void send({ kind: "autoLock" }).then((response) => {
    if (response.ok && response.kind === "autoLock") minutes.value = String(response.minutes);
  });
  minutes.addEventListener("change", () => {
    void send({ kind: "setAutoLock", minutes: Number(minutes.value) });
  });

  panel.append(
    el("label", {}, ["Lock after (minutes, 0 for never)", minutes]),
  );

  // --- device name ---
  const name = el("input", { type: "text", autocomplete: "off" });
  void send({ kind: "device" }).then((response) => {
    if (response.ok && response.kind === "device") name.value = response.device.name;
  });
  name.addEventListener("change", () => {
    void send({ kind: "renameDevice", name: name.value });
  });

  panel.append(el("label", {}, ["This device", name]));
  return panel;
}

/**
 * A generator that needs no vault.
 *
 * Offered on the locked screen too: wanting a password is not a reason to
 * have unlocked, and a signup form does not wait.
 */
function generatorPanel(): HTMLElement {
  const output = el("div", { className: "muted", textContent: "—" });
  const make = el("button", { className: "inline", type: "button", textContent: "Generate one" });

  make.addEventListener("click", () => {
    make.disabled = true;
    void send({ kind: "generatePassword" })
      .then(unwrap)
      .then((response) => {
        if (response.kind !== "generatePassword") throw new Error("unexpected reply");
        output.replaceChildren(copyable(response.password));
      })
      .catch((error: unknown) => {
        showError(error instanceof Error ? error.message : "Failed.");
      })
      .finally(() => {
        make.disabled = false;
      });
  });

  return el("div", { className: "group" }, [
    el("h2", { textContent: "Password generator" }),
    output,
    make,
  ]);
}

/** Unlocking with a PIN, when one is armed for this browser session. */
function renderQuick(): void {
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
      el("h1", { textContent: "Vaultiq is locked" }),
      el("p", {
        className: "muted",
        textContent: "Your PIN lasts until the browser closes.",
      }),
      form,
      useMaster,
      el("hr"),
      generatorPanel(),
    ]),
  );
}

function renderLocked(): void {
  root.replaceChildren(
    el("main", {}, [
      el("h1", { textContent: "Vaultiq is locked" }),
      passwordForm("Unlock", async (value) => {
        unwrap(await send({ kind: "unlock", masterPassword: value }));
      }),
      el("hr"),
      generatorPanel(),
    ]),
  );
}

/** A form for one item, used for both adding and editing. */
function itemForm(
  submitLabel: string,
  initial: LoginContent | undefined,
  submit: (content: LoginContent) => Promise<void>,
  cancel?: () => void,
): HTMLFormElement {
  const name = el("input", {
    type: "text",
    autocomplete: "off",
    placeholder: "Optional, e.g. Work",
  });
  const username = el("input", { type: "text", required: true, autocomplete: "off" });
  const password = el("input", { type: "password", required: true, autocomplete: "off" });
  const url = el("input", { type: "text", autocomplete: "off", placeholder: "https://" });
  const email = el("input", { type: "email", autocomplete: "off" });
  const mobile = el("input", { type: "tel", autocomplete: "off" });
  const notes = el("textarea", { autocomplete: "off" });

  if (initial) {
    name.value = initial.name ?? "";
    username.value = initial.username;
    password.value = initial.password;
    url.value = initial.url;
    email.value = initial.email ?? "";
    mobile.value = initial.mobile ?? "";
    notes.value = initial.notes;
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
  const generate = el("button", {
    type: "button",
    className: "inline",
    textContent: "Generate",
  });
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

  const save = el("button", { className: "primary", type: "submit", textContent: submitLabel });
  const actions = el("div", { className: "row" }, [save]);

  if (cancel) {
    const back = el("button", { type: "button", textContent: "Cancel" });
    back.addEventListener("click", cancel);
    actions.append(back);
  }

  const form = el("form", {}, [
    el("label", {}, ["Name", name]),
    el("label", {}, ["Username", username]),
    el("label", {}, ["Password", el("div", { className: "field" }, [password, generate])]),
    el("label", {}, ["Site", url]),
    actions,
  ]);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save.disabled = true;
    const trimmed = name.value.trim();
    void submit({
      // Omit rather than store an empty string, so an unnamed item looks the
      // same as one saved before this field existed.
      ...(trimmed ? { name: trimmed } : {}),
      username: username.value,
      password: password.value,
      url: url.value,
      notes: initial?.notes ?? "",
    })
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

function liveRow(item: DecryptedItem): HTMLLIElement {
  const edit = el("button", { className: "inline", type: "button", textContent: "Edit" });

  const label = item.name?.trim();
  const heading = el("div", { className: "name" }, [label || item.username || "(untitled)"]);
  if (isWeak(item.strength.level)) {
    heading.append(
      el("span", {
        className: `badge level-${item.strength.level}`,
        textContent: STRENGTH_LABEL[item.strength.level],
        title: `About ${String(item.strength.bits)} bits. Worth replacing.`,
      }),
    );
  }
  if (item.reusedBy > 0) {
    // Flagged even when the password scores well: strength says nothing about
    // whether a breach of one site would open the others.
    heading.append(
      el("span", {
        className: "badge level-fair",
        textContent: `Reused ×${String(item.reusedBy + 1)}`,
        title: `This password is also on ${String(item.reusedBy)} other login(s).`,
      }),
    );
  }

  const noteUse = (): void => {
    void send({ kind: "recordUse", id: item.id });
  };

  const row = el("li", {}, [
    heading,
    el("div", { className: "meta", textContent: item.url || "(no site)" }),
    el("div", { className: "row" }, [
      copyable(item.username, { onCopy: noteUse }),
      copyable(item.password, { masked: true, onCopy: noteUse }),
    ]),
    stamps(item),
    el("div", { className: "row" }, [
      edit,
      action("Delete", { kind: "trashItem", id: item.id }),
    ]),
  ]);

  edit.addEventListener("click", () => {
    row.replaceChildren(
      itemForm(
        "Save",
        item,
        async (content) => {
          unwrap(await send({ kind: "updateItem", id: item.id, content }));
        },
        () => void refresh(),
      ),
    );
  });

  return row;
}

function trashedRow(item: DecryptedItem): HTMLLIElement {
  const label = item.name?.trim();
  return el("li", { className: "trashed" }, [
    el("div", { className: "name" }, [label || item.username || "(untitled)"]),
    el("div", {
      className: "meta",
      textContent: [label ? item.username : "", item.url].filter(Boolean).join(" · ") || "(no site)",
    }),
    el("div", { className: "row" }, [
      action("Restore", { kind: "restoreItem", id: item.id }),
      action(
        "Delete for good",
        { kind: "purgeItem", id: item.id },
        "Erase this password permanently? It cannot be recovered.",
      ),
    ]),
  ]);
}

/** Everything the search box looks at. Never the password. */
function haystack(item: DecryptedItem): string {
  return [item.name, item.username, item.email, item.mobile, item.url, item.notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Most recently used first; anything never used falls back to its name. */
function byRecentUse(a: DecryptedItem, b: DecryptedItem): number {
  const left = a.usage.lastUsedAt ?? 0;
  const right = b.usage.lastUsedAt ?? 0;
  if (left !== right) return right - left;
  return (a.name ?? a.username).localeCompare(b.name ?? b.username, undefined, {
    sensitivity: "base",
  });
}

/** Kept across a re-render, so typing does not reset the list. */
let query = "";
let showTrash = false;

async function renderUnlocked(): Promise<void> {
  const response = unwrap(await send({ kind: "listItems" }));
  if (response.kind !== "listItems") throw new Error("unexpected reply");

  const forSite = unwrap(await send({ kind: "itemsForSite" }));
  if (forSite.kind !== "itemsForSite") throw new Error("unexpected reply");

  const needle = query.trim().toLowerCase();
  const matches = (item: DecryptedItem): boolean =>
    needle === "" || haystack(item).includes(needle);

  const matching = new Set(forSite.items.map((item) => item.id));
  const site = forSite.items.filter(matches).sort(byRecentUse);
  const live = response.items
    .filter((item) => !item.deleted && !matching.has(item.id) && matches(item))
    .sort(byRecentUse);
  const trashed = response.items.filter((item) => item.deleted && matches(item));

  // --- header, pinned ---

  const search = el("input", {
    type: "search",
    placeholder: "Search logins",
    value: query,
    autocomplete: "off",
  });
  search.addEventListener("input", () => {
    query = search.value;
    void renderUnlocked();
  });

  const add = el("button", { className: "primary", type: "button", textContent: "Add" });
  const lock = el("button", { type: "button", textContent: "Lock" });
  lock.addEventListener("click", () => {
    void send({ kind: "lock" }).then(refresh);
  });

  const header = el("header", {}, [
    el("div", { className: "bar" }, [
      el("span", { className: "grow" }, [search]),
      add,
      lock,
    ]),
  ]);

  // --- body, scrolling ---

  const body = el("main");

  if (site.length) {
    body.append(
      el("div", { className: "group for-site" }, [
        el("h2", { textContent: `For ${forSite.site ?? "this site"}` }),
        el("ul", {}, site.map(liveRow)),
      ]),
      el("hr"),
    );
  }

  body.append(
    live.length
      ? el("div", { className: "group" }, [
          el("h2", { textContent: site.length ? "Everything else" : "All logins" }),
          el("ul", {}, live.map(liveRow)),
        ])
      : el("p", {
          className: "muted",
          textContent: needle
            ? "Nothing matches that."
            : site.length
              ? "Nothing else saved."
              : "Nothing saved yet.",
        }),
  );

  if (trashed.length) {
    const toggle = el("button", {
      className: "inline",
      type: "button",
      textContent: `${showTrash ? "Hide" : "Show"} trash (${String(trashed.length)})`,
    });
    toggle.addEventListener("click", () => {
      showTrash = !showTrash;
      void renderUnlocked();
    });

    body.append(el("hr"), toggle);
    if (showTrash) body.append(el("ul", {}, trashed.map(trashedRow)));
  }

  body.append(el("hr"), generatorPanel(), el("hr"), settingsPanel());

  add.addEventListener("click", () => {
    body.replaceChildren(
      el("h2", { textContent: "New login" }),
      itemForm(
        "Save item",
        undefined,
        async (content) => {
          unwrap(await send({ kind: "addItem", content }));
        },
        () => void refresh(),
      ),
    );
  });

  root.replaceChildren(header, body);
  // Focus lands on search so typing filters immediately, but only on the
  // first paint — refocusing on every keystroke would fight the caret.
  if (document.activeElement === document.body) search.focus();
}

function render(status: VaultStatus): void {
  switch (status) {
    case "empty":
      return renderEmpty();
    case "locked":
      return renderLocked();
    case "quick":
      return renderQuick();
    case "unlocked":
      void renderUnlocked().catch((error: unknown) => {
        root.replaceChildren();
        showError(error instanceof Error ? error.message : "Failed.");
      });
      return;
  }
}

void refresh();
