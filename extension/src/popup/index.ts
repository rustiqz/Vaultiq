// The popup. Renders state and sends requests; it never holds a key and
// never calls the crypto core. Everything sensitive happens in the
// background context.

import "./popup.css";
import { cardBrand, lastFour } from "../lib/card.js";
import { parseOtpauth, TOTP_DEFAULTS } from "../lib/otpauth.js";
import { CLIPBOARD_SECONDS, copyForAWhile } from "../lib/clipboard.js";
import { el } from "./dom.js";
import { ago } from "./format.js";
import { icon, logoMark } from "./icons.js";
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
  type VaultStatus,
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
  const label = el("span");
  const button = el(
    "button",
    {
      className: "copyable",
      type: "button",
      title: `Copy — cleared after ${String(CLIPBOARD_SECONDS)} seconds`,
    },
    [icon("copy", { size: 13 }), label],
  );

  let shown = !hidden;
  const paint = (text?: string): void => {
    label.textContent = text ?? (shown ? value : "•".repeat(Math.min(value.length, 12)));
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

  const reveal = el("button", { className: "inline icon-button", type: "button", title: "Show" }, [icon("reveal", { size: 14 })]);
  reveal.addEventListener("click", () => {
    shown = !shown;
    reveal.title = shown ? "Hide" : "Show";
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

let emptyMode: "create" | "join" = "create";

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
      : [
          el("p", {
            className: "muted",
            textContent:
              "Uses a token from a device that's already in your vault. Your master password stays on this device — it's only used to unwrap the vault key once you're in.",
          }),
          joinForm(),
        ];

  root.replaceChildren(
    el("main", { className: "onboard" }, [
      el("div", { className: "brand" }, [logoMark({ size: 26 }), el("h1", { textContent: "Welcome to Vaultiq" })]),
      el("div", { className: "scope-tabs" }, [createTab, joinTab]),
      ...body,
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

  // --- local-only mode ---
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

  panel.append(
    el("h3", { textContent: "Vault mode" }),
    el("label", {}, [localOnlyToggle, " Never sync this vault"]),
    el("p", {
      className: "muted",
      textContent:
        "Keeps this vault on this device only. Turning it on disconnects any server this device is using. Turning it off does not connect anywhere by itself — it only makes syncing available again.",
    }),
  );

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
  const make = el("button", { className: "inline", type: "button" }, [icon("regenerate", { size: 12 }), "Generate one"]);

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
      el("div", { className: "brand" }, [logoMark({ size: 26 }), el("h1", { textContent: "Vaultiq is locked" })]),
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
    el("main", { className: "onboard" }, [
      el("div", { className: "brand" }, [logoMark({ size: 26 }), el("h1", { textContent: "Vaultiq is locked" })]),
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
let unlockedScreen: "vault" | "new" | "edit" | "settings" | "sync" | "generator" | "trash" = "vault";
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

  const fields = el("div", { className: "detail-card" });
  if (item.type === "login") {
    fields.append(
      detailField(item, "Username", item.username),
      detailField(item, "Password", item.password, { masked: true }),
      detailField(item, "Website", item.url),
    );
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
      detailField(item, "Account", item.account),
      detailField(item, "One-time code", item.code),
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
  const destinations: { label: string; screen: typeof unlockedScreen }[] = [
    { label: "Password generator", screen: "generator" },
    { label: "Sync & devices", screen: "sync" },
    { label: "Settings", screen: "settings" },
    { label: "Trash", screen: "trash" },
  ];
  for (const destination of destinations) {
    const button = el("button", { className: "menu-item", type: "button", textContent: destination.label });
    button.addEventListener("click", () => {
      unlockedScreen = destination.screen;
      void renderUnlocked();
    });
    menu.append(button);
  }
  const lock = el("button", { className: "menu-item", type: "button" }, [icon("lock", { size: 14 }), "Lock vault"]);
  lock.addEventListener("click", () => void send({ kind: "lock" }).then(refresh));
  menu.append(lock);
  more.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
  });

  return el("header", { className: "popup-header" }, [
    brand,
    el("div", { className: "header-search grow" }, [icon("search", { size: 18 }), search]),
    add,
    el("div", { className: "menu-wrap" }, [more, menu]),
  ]);
}

function renderUtility(title: string, content: HTMLElement): void {
  root.replaceChildren(
    popupHeader(),
    el("main", { className: "utility-screen" }, [el("h1", { textContent: title }), content]),
  );
}

async function renderUnlocked(): Promise<void> {
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

  if (unlockedScreen === "settings") return renderUtility("Settings", settingsPanel());
  if (unlockedScreen === "sync") return renderUtility("Sync & devices", syncPanel(showError));
  if (unlockedScreen === "generator") return renderUtility("Password generator", generatorPanel());
  if (unlockedScreen === "trash") {
    return renderUtility(
      "Trash",
      trashed.length
        ? el("ul", { className: "trash-list" }, trashed.map(trashedRow))
        : el("p", { className: "muted", textContent: "Trash is empty." }),
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
  if (!shownItems.length) rows.append(el("p", { className: "empty-list muted", textContent: needle ? "Nothing matches that." : "Nothing saved here yet." }));

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
    : el("section", { className: "item-detail detail-empty" }, [
        logoMark({ size: 42 }),
        el("h1", { textContent: "Choose an item" }),
        el("p", { className: "muted", textContent: "Select a vault item to see its details and quick actions." }),
      ]);

  root.replaceChildren(
    popupHeader(search),
    el("div", { className: "vault-workspace" }, [sidebar, detail]),
  );

  if (refocusSearch) {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
    refocusSearch = false;
  }
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
