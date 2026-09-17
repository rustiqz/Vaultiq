// Connecting this vault to a server, and saying honestly what happened last.
//
// The master password is typed here for the two connect flows only, because
// the auth key is derived from it. It goes straight to the background and is
// never held: the field is cleared as soon as the request is sent.

import QRCode from 'qrcode';
import { el } from "./dom.js";
import { ago } from "./format.js";
import { send, type RemoteDevice, type Response, type SyncSummary } from "../lib/messages.js";
import { enrollmentQrPayload } from '../lib/enrollment-qr.js';

type Fail = (message: string) => void;

function unwrap(response: Response): Response & { ok: true } {
  if (!response.ok) throw new Error(response.error);
  return response;
}

/** A button that reports what it did, then goes back to its label. */
function acting(label: string, work: () => Promise<string>, fail: Fail): HTMLButtonElement {
  const button = el("button", { className: "inline", type: "button", textContent: label });
  button.addEventListener("click", () => {
    button.disabled = true;
    button.textContent = "Working…";
    work()
      .then((done) => {
        button.textContent = done;
        setTimeout(() => (button.textContent = label), 1800);
      })
      .catch((error: unknown) => {
        button.textContent = label;
        fail(error instanceof Error ? error.message : "Failed.");
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  return button;
}

function field(labelText: string, input: HTMLElement): HTMLElement {
  return el("label", {}, [labelText, input]);
}

/** The form shown while this device has no server. */
function connectForm(panel: HTMLElement, fail: Fail): HTMLElement {
  const server = el("input", { type: "url", placeholder: "https://vault.example.com" });
  const deviceName = el("input", { type: "text", placeholder: "This laptop" });
  const password = el("input", { type: "password", autocomplete: "off" });
  const registrationToken = el("input", {
    type: "text",
    autocomplete: "off",
    placeholder: "From the server's admin",
  });
  const joinToken = el("input", { type: "text", autocomplete: "off", placeholder: "From another device" });

  const clear = (): void => {
    // The master password is not kept around after the request goes out.
    password.value = "";
    registrationToken.value = "";
    joinToken.value = "";
  };

  const first = acting(
    "Set up a new server",
    async () => {
      unwrap(
        await send({
          kind: "connectServer",
          server: server.value.trim(),
          token: registrationToken.value.trim(),
          deviceName: deviceName.value.trim(),
          masterPassword: password.value,
        }),
      );
      clear();
      void repaint(panel, fail);
      return "Connected";
    },
    fail,
  );

  const join = acting(
    "Join with a token",
    async () => {
      unwrap(
        await send({
          kind: "enrollWithServer",
          server: server.value.trim(),
          token: joinToken.value.trim(),
          deviceName: deviceName.value.trim(),
          masterPassword: password.value,
        }),
      );
      clear();
      void repaint(panel, fail);
      return "Joined";
    },
    fail,
  );

  return el("div", {}, [
    field("Server address", server),
    field("Name for this device", deviceName),
    field("Master password", password),
    field("Registration token", registrationToken),
    el("div", { className: "field" }, [first]),
    el("p", {
      className: "muted",
      textContent:
        "Uploads this vault as it stands, as the account the token grants — a fresh personal server logs one at boot; an organisation's admin issues one.",
    }),
    el("hr"),
    field("Enrolment token", joinToken),
    el("div", { className: "field" }, [join]),
    el("p", {
      className: "muted",
      textContent:
        "For joining a vault that already exists. Get a token from one of its devices; it lasts fifteen minutes.",
    }),
  ]);
}

/** The device list, once connected. */
function devices(fail: Fail): HTMLElement {
  const list = el("ul", { className: "devices" }, [
    el("li", { className: "muted", textContent: "Loading…" }),
  ]);

  const paint = (): void => {
    void send({ kind: "remoteDevices" })
      .then(unwrap)
      .then((response) => {
        if (response.kind !== "remoteDevices") return;
        list.replaceChildren(...response.devices.map((device) => row(device, paint, fail)));
      })
      .catch((error: unknown) => {
        list.replaceChildren(
          el("li", {
            className: "muted",
            textContent: error instanceof Error ? error.message : "Could not list devices.",
          }),
        );
      });
  };
  paint();
  return list;
}

function row(device: RemoteDevice, repaintList: () => void, fail: Fail): HTMLElement {
  const label = device.current ? `${device.name} (this device)` : device.name;
  const when = new Date(device.enrolledAt).getTime();

  const line = el("li", {}, [
    el("span", { textContent: label }),
    el("span", { className: "muted", textContent: ` · added ${ago(when)}` }),
  ]);

  if (device.revokedAt !== null) {
    line.append(el("span", { className: "muted", textContent: " · revoked" }));
    return line;
  }

  if (!device.current) {
    line.append(
      acting(
        "Revoke",
        async () => {
          unwrap(await send({ kind: "revokeRemoteDevice", deviceId: device.id }));
          repaintList();
          return "Revoked";
        },
        fail,
      ),
    );
  }
  return line;
}

/** The panel shown once this device has a server. */
function connected(panel: HTMLElement, sync: SyncSummary, fail: Fail): HTMLElement {
  const body = el("div", {}, [
    el("p", {}, [
      el("span", { textContent: sync.server ?? "" }),
      el("span", {
        className: "muted",
        textContent:
          sync.lastSyncedAt === undefined
            ? " · never synced"
            : ` · synced ${ago(sync.lastSyncedAt)}`,
      }),
    ]),
  ]);

  if (sync.lastError !== undefined) {
    // Staleness is reported rather than hidden: a local edit is already
    // saved, and the useful thing to say is that it has not left this device.
    body.append(el("p", { className: "error", textContent: sync.lastError }));
  }

  const token = el("p", { className: "muted token", textContent: "" });
  const qrImage = el('img', { className: 'enrollment-qr', alt: 'Vaultiq enrollment QR code' });
  const invite = el('div', { className: 'enrollment-invite', hidden: true }, [
    qrImage,
    token,
    el('p', { className: 'muted', textContent: 'Scan in Vaultiq on the new device. Expires in 15 minutes.' }),
  ]);

  body.append(
    el("div", { className: "field" }, [
      acting(
        "Sync now",
        async () => {
          const response = unwrap(await send({ kind: "syncNow" }));
          if (response.kind !== "syncNow") return "Synced";
          void repaint(panel, fail);
          const { pulled, pushed, conflicts } = response.outcome;
          return conflicts > 0
            ? `${String(conflicts)} conflicted`
            : `↓${String(pulled)} ↑${String(pushed)}`;
        },
        fail,
      ),
      acting(
        "Add a device",
        async () => {
          const response = unwrap(await send({ kind: "newEnrollmentToken" }));
          if (response.kind !== "newEnrollmentToken") return "Failed";
          if (sync.server === undefined) throw new Error('Server address is missing.');
          qrImage.src = await QRCode.toDataURL(enrollmentQrPayload(sync.server, response.token), {
            width: 220,
            margin: 2,
            errorCorrectionLevel: 'M',
            color: { dark: '#674636', light: '#FFF8E8' },
          });
          token.textContent = `Token (15 min): ${response.token}`;
          invite.hidden = false;
          return "Token made";
        },
        fail,
      ),
      acting(
        "Disconnect",
        async () => {
          unwrap(await send({ kind: "disconnectServer" }));
          void repaint(panel, fail);
          return "Disconnected";
        },
        fail,
      ),
    ]),
    invite,
    el("h3", { textContent: "Devices" }),
    devices(fail),
  );

  return body;
}

/** Shown instead of the connect form once this vault has gone local-only. */
function localOnlyNotice(): HTMLElement {
  return el("p", {
    className: "muted",
    textContent:
      "This vault is set to never sync. Turn that off in Settings to connect it to a server.",
  });
}

async function repaint(panel: HTMLElement, fail: Fail): Promise<void> {
  const heading = el("h2", { textContent: "Sync" });
  try {
    const localOnly = unwrap(await send({ kind: "localOnly" }));
    if (localOnly.kind === "localOnly" && localOnly.value) {
      panel.replaceChildren(heading, localOnlyNotice());
      return;
    }

    const response = unwrap(await send({ kind: "syncStatus" }));
    if (response.kind !== "syncStatus") return;
    panel.replaceChildren(
      heading,
      response.sync.connected
        ? connected(panel, response.sync, fail)
        : connectForm(panel, fail),
    );
  } catch (error: unknown) {
    panel.replaceChildren(heading);
    fail(error instanceof Error ? error.message : "Failed.");
  }
}

export function syncPanel(fail: Fail): HTMLElement {
  const panel = el("div", { className: "group" });
  void repaint(panel, fail);
  return panel;
}
