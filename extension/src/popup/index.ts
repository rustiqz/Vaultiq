// The popup. Renders state and sends requests; it never holds a key and
// never calls the crypto core. Everything sensitive happens in the
// background context.

import "./popup.css";
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

function showError(message: string): void {
  root.append(el("p", { className: "error", textContent: message }));
}

/** Narrows a response, surfacing the background's message unchanged. */
function unwrap(response: Response): Response & { ok: true } {
  if (!response.ok) throw new Error(response.error);
  return response;
}

async function refresh(): Promise<void> {
  root.replaceChildren(el("p", { className: "muted", textContent: "Loading…" }));
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
    el("h1", { textContent: "Create your vault" }),
    el("p", {
      className: "muted",
      textContent:
        "Your master password is never stored or sent anywhere. If you lose it, the vault cannot be recovered.",
    }),
    passwordForm("Create vault", async (value) => {
      unwrap(await send({ kind: "create", masterPassword: value }));
    }),
  );
}

function renderLocked(): void {
  root.replaceChildren(
    el("h1", { textContent: "Vaultiq is locked" }),
    passwordForm("Unlock", async (value) => {
      unwrap(await send({ kind: "unlock", masterPassword: value }));
    }),
  );
}

/** A form for one item, used for both adding and editing. */
function itemForm(
  submitLabel: string,
  initial: LoginContent | undefined,
  submit: (content: LoginContent) => Promise<void>,
  cancel?: () => void,
): HTMLFormElement {
  const username = el("input", { type: "text", required: true, autocomplete: "off" });
  const password = el("input", { type: "password", required: true, autocomplete: "off" });
  const url = el("input", { type: "text", autocomplete: "off", placeholder: "https://" });

  if (initial) {
    username.value = initial.username;
    password.value = initial.password;
    url.value = initial.url;
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
    el("label", {}, ["Username", username]),
    el("label", {}, ["Password", el("div", { className: "field" }, [password, generate]), meter]),
    el("label", {}, ["Site", url]),
    actions,
  ]);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save.disabled = true;
    void submit({
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

function liveRow(item: DecryptedItem): HTMLLIElement {
  const edit = el("button", { type: "button", textContent: "Edit" });

  const heading = el("div", { className: "name" }, [item.username || "(no username)"]);
  if (isWeak(item.strength.level)) {
    // Surfaced rather than hidden behind a health screen: the whole point is
    // noticing without going looking.
    heading.append(
      el("span", {
        className: `badge level-${item.strength.level}`,
        textContent: STRENGTH_LABEL[item.strength.level],
        title: `About ${String(item.strength.bits)} bits. Worth replacing.`,
      }),
    );
  }

  const row = el("li", {}, [
    heading,
    el("div", { className: "meta", textContent: item.url || "(no site)" }),
    el("div", { className: "row" }, [edit, action("Delete", { kind: "trashItem", id: item.id })]),
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
  return el("li", { className: "trashed" }, [
    el("div", { className: "name", textContent: item.username || "(no username)" }),
    el("div", { className: "meta", textContent: item.url || "(no site)" }),
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

async function renderUnlocked(): Promise<void> {
  const response = unwrap(await send({ kind: "listItems" }));
  if (response.kind !== "listItems") throw new Error("unexpected reply");

  const live = response.items.filter((item) => !item.deleted);
  const trashed = response.items.filter((item) => item.deleted);

  const lockButton = el("button", { textContent: "Lock" });
  lockButton.addEventListener("click", () => {
    void send({ kind: "lock" }).then(refresh);
  });

  const children: (Node | string)[] = [
    el("div", { className: "row" }, [
      el("h1", { textContent: `${live.length} item(s)` }),
      lockButton,
    ]),
    live.length
      ? el("ul", {}, live.map(liveRow))
      : el("p", { className: "muted", textContent: "Nothing saved yet." }),
  ];

  if (trashed.length) {
    children.push(
      el("hr"),
      el("h2", { textContent: `Trash (${trashed.length})` }),
      el("ul", {}, trashed.map(trashedRow)),
    );
  }

  children.push(
    el("hr"),
    el("h2", { textContent: "Add an item" }),
    itemForm("Save item", undefined, async (content) => {
      unwrap(await send({ kind: "addItem", content }));
    }),
  );

  root.replaceChildren(...children);
}

function render(status: VaultStatus): void {
  switch (status) {
    case "empty":
      return renderEmpty();
    case "locked":
      return renderLocked();
    case "unlocked":
      void renderUnlocked().catch((error: unknown) => {
        root.replaceChildren();
        showError(error instanceof Error ? error.message : "Failed.");
      });
      return;
  }
}

void refresh();
