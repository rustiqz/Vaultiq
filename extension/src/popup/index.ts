// The popup. Renders state and sends requests; it never holds a key and
// never calls the crypto core. Everything sensitive happens in the
// background context.

import "./popup.css";
import { send, type DecryptedItem, type Response, type VaultStatus } from "../lib/messages.js";

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

function itemRow(item: DecryptedItem): HTMLLIElement {
  return el("li", {}, [
    el("div", { className: "name", textContent: item.username || "(no username)" }),
    el("div", { className: "meta", textContent: item.url || "(no site)" }),
  ]);
}

function addItemForm(): HTMLFormElement {
  const username = el("input", { type: "text", required: true, autocomplete: "off" });
  const password = el("input", { type: "password", required: true, autocomplete: "off" });
  const url = el("input", { type: "text", autocomplete: "off", placeholder: "https://" });
  const submit = el("button", { className: "primary", type: "submit", textContent: "Save item" });

  const form = el("form", {}, [
    el("label", {}, ["Username", username]),
    el("label", {}, ["Password", password]),
    el("label", {}, ["Site", url]),
    submit,
  ]);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit.disabled = true;
    void send({
      kind: "addItem",
      content: { username: username.value, password: password.value, url: url.value, notes: "" },
    })
      .then(unwrap)
      .then(refresh)
      .catch((error: unknown) => {
        submit.disabled = false;
        showError(error instanceof Error ? error.message : "Failed.");
      });
  });

  return form;
}

async function renderUnlocked(): Promise<void> {
  const response = unwrap(await send({ kind: "listItems" }));
  if (response.kind !== "listItems") throw new Error("unexpected reply");

  const lockButton = el("button", { textContent: "Lock" });
  lockButton.addEventListener("click", () => {
    void send({ kind: "lock" }).then(refresh);
  });

  root.replaceChildren(
    el("div", { className: "row" }, [
      el("h1", { textContent: `${response.items.length} item(s)` }),
      lockButton,
    ]),
    response.items.length
      ? el("ul", {}, response.items.map(itemRow))
      : el("p", { className: "muted", textContent: "Nothing saved yet." }),
    el("hr"),
    addItemForm(),
  );
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
