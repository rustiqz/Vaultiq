// The popup. Renders state and sends requests; it never holds a key and
// never calls the crypto core. Everything sensitive happens in the
// background context.

import "./popup.css";
import { CLIPBOARD_SECONDS, copyForAWhile } from "../lib/clipboard.js";
import { el } from "./dom.js";
import { ago } from "./format.js";
import { syncPanel } from "./sync-panel.js";
import {
  send,
  type DecryptedItem,
  type DecryptedLogin,
  type DecryptedNote,
  type ItemContent,
  type ItemType,
  type LoginContent,
  type Request,
  type Response,
  type StrengthLevel,
  type VaultStatus,
} from "../lib/messages.js";

/** What each item type is called on screen. */
const TYPE_LABEL: Record<ItemType, string> = {
  login: "Login",
  note: "Secure note",
};

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

/** PIN, auto-lock, this device's name, and the master password itself. */
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

  // --- master password ---
  const currentPassword = el("input", { type: "password", autocomplete: "off" });
  const nextPassword = el("input", { type: "password", autocomplete: "new-password" });
  const againPassword = el("input", { type: "password", autocomplete: "new-password" });
  const change = el("button", {
    className: "inline",
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

  panel.append(
    el("h3", { textContent: "Master password" }),
    el("label", {}, ["Current", currentPassword]),
    el("label", {}, ["New", nextPassword]),
    el("label", {}, ["New again", againPassword]),
    el("div", { className: "field" }, [change]),
    el("p", {
      className: "muted",
      textContent:
        "Re-wraps the vault key, so no item is re-encrypted and nothing has to re-sync. Other devices pick the change up the next time they sync. The old password then opens nothing, and there is no way back.",
    }),
  );

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

/** One row, dispatched on what the item actually is. */
function liveRow(item: DecryptedItem): HTMLLIElement {
  return item.type === "login" ? loginRow(item) : noteRow(item);
}

/** The buttons every live row ends with, and the edit form they open. */
function rowActions(item: DecryptedItem, row: HTMLLIElement): HTMLElement {
  const edit = el("button", { className: "inline", type: "button", textContent: "Edit" });
  edit.addEventListener("click", () => {
    row.replaceChildren(
      itemForm(
        "Save",
        item.type,
        item,
        async (content) => {
          unwrap(await send({ kind: "updateItem", id: item.id, content }));
        },
        () => void refresh(),
      ),
    );
  });

  return el("div", { className: "row" }, [
    edit,
    action("Delete", { kind: "trashItem", id: item.id }),
  ]);
}

function loginRow(item: DecryptedLogin): HTMLLIElement {
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
  ]);
  row.append(rowActions(item, row));
  return row;
}

function noteRow(item: DecryptedNote): HTMLLIElement {
  const noteUse = (): void => {
    void send({ kind: "recordUse", id: item.id });
  };

  const row = el("li", {}, [
    el("div", { className: "name" }, [item.name?.trim() || "(untitled note)"]),
    el("div", { className: "meta", textContent: TYPE_LABEL.note }),
    // Masked like a password. The body of a secure note is the secret — it
    // has no username half that is safe to show at a glance.
    el("div", { className: "row" }, [
      copyable(item.notes, { masked: true, onCopy: noteUse }),
    ]),
    stamps(item),
  ]);
  row.append(rowActions(item, row));
  return row;
}

function trashedRow(item: DecryptedItem): HTMLLIElement {
  const label = item.name?.trim();
  const fallback = item.type === "login" ? item.username : "(untitled note)";
  const detail =
    item.type === "login"
      ? [label ? item.username : "", item.url].filter(Boolean).join(" · ") || "(no site)"
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
  const fields =
    item.type === "login"
      ? [item.name, item.username, item.email, item.mobile, item.url, item.notes]
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
  return item.name ?? (item.type === "login" ? item.username : "");
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
    placeholder: "Search the vault",
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
          el("h2", { textContent: site.length ? "Everything else" : "All items" }),
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

  body.append(el("hr"), generatorPanel(), el("hr"), syncPanel(showError), el("hr"), settingsPanel());

  /** Opens an empty form for one type. */
  const startNew = (type: ItemType): void => {
    body.replaceChildren(
      el("h2", { textContent: `New ${TYPE_LABEL[type].toLowerCase()}` }),
      itemForm(
        "Save item",
        type,
        undefined,
        async (content) => {
          unwrap(await send({ kind: "addItem", content }));
        },
        () => void refresh(),
      ),
    );
  };

  // Asked before the form rather than switched on it: the type is fixed for
  // the life of an item, so it is a choice, not a field.
  add.addEventListener("click", () => {
    const choices = (Object.keys(TYPE_LABEL) as ItemType[]).map((type, index) => {
      const button = el("button", {
        ...(index === 0 ? { className: "primary" } : {}),
        type: "button",
        textContent: TYPE_LABEL[type],
      });
      button.addEventListener("click", () => {
        startNew(type);
      });
      return button;
    });

    body.replaceChildren(
      el("h2", { textContent: "What are you saving?" }),
      el("div", { className: "row" }, choices),
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
