# Testing Vaultiq end to end

How to get the server, the extension, and the mobile app running together
so you can actually exercise a synced vault — including the six features
just added to mobile (favoriting, add-authenticator-from-Codes, clipboard
auto-clear, change master password, fingerprint unlock, TOTP QR scanning),
none of which were verified on real hardware while building them.

This assumes the repo is already cloned and you're starting from a clean
checkout of `redesign/v2-item-screens` (or `main` once that PR merges).

---

## 1. Prerequisites

| Tool | Why |
|---|---|
| `rustup`, with `wasm32-unknown-unknown` and `aarch64-linux-android` targets installed | builds `pw-crypto-core` for both the extension (wasm) and mobile (native) |
| `cargo-ndk` | cross-compiles the crypto core for Android |
| Node 22+, `pnpm` | every JS/TS package |
| Android SDK + NDK, `adb` on your `PATH` | building/installing the mobile app |
| Docker, or a local Postgres 17 | the sync server |
| A physical Android device (or two — see §6), USB debugging on | mobile testing; fingerprint unlock and QR scanning both need a real camera and real biometric hardware, which an emulator can't give you |
| Firefox or Chrome (for the extension) | easiest way to create a vault and generate enrollment tokens for mobile to join |

```bash
rustup target add wasm32-unknown-unknown aarch64-linux-android
```

---

## 2. Start the server

```bash
cp .env.example .env      # set POSTGRES_PASSWORD (openssl rand -base64 32) and VAULTIQ_DOMAIN
docker compose up -d
```

`docker-compose.yml` deliberately publishes nothing but Caddy — the server
and database aren't reachable from the host. For local testing you need a
second, gitignored file to expose the server directly:

```yaml
# docker-compose.override.yml (create this, it's gitignored)
services:
  server:
    ports:
      - "3000:3000"
```

```bash
docker compose up -d   # re-run after adding the override
```

Prefer running the server outside Docker (faster iteration, real stack
traces)? `cd server && pnpm install && pnpm run migrate && pnpm run dev`
against a local Postgres works the same way — it listens on `:3000` either
way.

### Reaching it from a device

- **Device connected over USB** (simplest, works from anywhere):
  ```bash
  adb reverse tcp:3000 tcp:3000
  ```
  Then use `http://localhost:3000` as the server URL on that device.
- **Device on the same Wi-Fi, no USB**: use your machine's LAN IP instead
  (`http://192.168.x.x:3000`). Make sure your firewall allows inbound
  connections on 3000. Debug builds of the mobile app already allow
  cleartext HTTP (`usesCleartextTraffic=true` in debug, set in
  `mobile/android/app/build.gradle`) — no extra config needed for `http://`.
- **Testing two devices at once** (§6): both need their own reachable path
  to the same server — two USB `adb reverse`s (one per device, run against
  each with `adb -s <serial> reverse ...`) or both on the same LAN using
  the machine's IP.

---

## 3. Build and run the extension (to create a vault)

Mobile can only *join* an existing vault, not create one — the extension
is the quickest way to get one to test against.

```bash
cd extension
pnpm install
pnpm run dev   # builds, then launches Firefox with the extension loaded
```

Prefer Chrome? `pnpm run dev:chrome` (set `CHROME_PATH` if it is not in a
standard location), or `pnpm run build`, then `chrome://extensions` → Developer
mode → **Load unpacked** → `extension/dist/`. It is the same build and the same
behaviour in both browsers.

In the popup: **Create your vault**, set a master password (write it down —
mobile needs the exact same one). Then, to make it reachable over the
network: open the **Sync** panel → **Set up a new server** → enter the
server URL from §2 and a device name. This vault now exists server-side.

To get a token mobile can join with: Sync panel → **Add a device** → copy
the 15-minute token it shows. Tokens are single-use and expire fast, so
generate one right before you're ready to paste it into the mobile app.

---

## 4. Build and run the mobile app

```bash
cd mobile
pnpm install
cp src/devConfig.example.ts src/devConfig.ts   # fill in DEV_SERVER_URL / DEV_DEVICE_NAME if you want them prefilled
pnpm run crypto                                 # cross-compiles pw-crypto-core + regenerates Kotlin bindings (needs ANDROID_NDK_HOME, defaults to /opt/android-ndk)
```

Then either:

- **Full dev loop** (Metro + live reload): `pnpm run android` with a
  device connected — installs and launches the app, connected to your
  local Metro bundler.
- **Just a debug APK**: `cd android && ./gradlew assembleDebug`, then
  `adb install -r app/build/outputs/apk/debug/app-debug.apk`.

If Gradle runs out of memory (this repo has hit that before on
memory-constrained machines): `taskset -c 0,1 ./gradlew ...` caps the CPUs
Ninja's job-count autodetection sees, which keeps it inside
`org.gradle.workers.max=2` in `android/gradle.properties`. A killed build
isn't wasted — Ninja's cache picks up from the last completed object file.

### Enrolling

Open the app → **Join an existing vault** → paste the server URL, the
enrollment token from §3, a device name, and the **same master password**
used when the vault was created. This should land you on Vault Home with
whatever items the vault has (none yet, unless you added some from the
extension first).

---

## 5. Feature checklist

Everything below except the last block already had some on-device
verification earlier in this project. The last block — this session's
work — has none; it only passed `tsc`/`eslint`/`:app:assembleDebug`.

**Already spot-checked previously** (re-verify if you're touching nearby code):
- Unlock, Vault Home, New/Edit/Detail for all five item types, Cards/Identities/Notes lists, Codes tab, Settings, device revoke.

**New this session — needs real verification:**

- [ ] **Favoriting** — open any item's detail screen, tap the heart in the
      header. It should fill in. Back out and back in: it should still be
      filled (confirms the round trip through `updateItem` actually
      persisted it, not just local state).
- [ ] **Add authenticator from Codes tab** — Codes tab → `+` → should land
      directly on a blank "New Authenticator" form (no type picker, since
      the type is already known).
- [ ] **Clipboard auto-clear** — copy any secret (a password, a card
      number, a TOTP code). Wait 30 seconds. Paste somewhere: should be
      empty. Copy something *else* before the 30 seconds are up: the first
      timer should NOT clear the second thing you copied.
- [ ] **Change master password** — Settings → Change master password.
      Enter the current password wrong first (should fail cleanly, vault
      still opens with the old password after). Then do it correctly.
      Lock and re-unlock with the **new** password — the old one should no
      longer work. If you have a second enrolled device (§6), confirm it
      can still sync after picking up the change on its next sync.
- [ ] **Fingerprint unlock** — needs a device with at least one fingerprint
      already enrolled in Android's own Settings first. Settings → toggle
      "Unlock with fingerprint" on → confirm the current password once →
      lock the vault → "Use fingerprint" on the lock screen should prompt
      and unlock without typing the password. Then: remove/re-enroll a
      fingerprint in Android Settings and confirm the app notices
      (`biometric_key_invalidated` — it should fall back to asking for the
      password, not crash or hang). Also confirm canceling the prompt just
      returns to the password field, no error banner.
- [ ] **TOTP QR scanning** — New/Edit Authenticator → "Scan QR code" should
      open a camera view (grant camera permission when asked). Point it at
      a real `otpauth://totp/...` QR code — most authenticator setup pages
      (GitHub, Google, etc.) show one; a `qrencode` command-line tool or
      any online QR generator can also turn a hand-built `otpauth://`
      string into a scannable code for testing. On a good scan it should
      return to the form with issuer/account/secret (and algorithm/digits/
      period, if non-default) filled in. Point it at a non-otpauth QR code
      (any random URL) and confirm it shows an error instead of silently
      accepting garbage.

---

## 6. Testing with two devices

Several things only really prove themselves with two enrolled devices:

1. Enroll device A as in §4.
2. From device A's Settings (or the extension's sync panel), generate a
   fresh enrollment token and enroll device B with it.
3. **Device list**: each device's Settings → Devices should show both,
   with a "This device" badge on the right one. Revoke device B from
   device A; device B's next server call should start failing.
4. **Master password change propagation**: change the password on device
   A (§5). Device B is still "logically" on the old password until its
   next sync — the extension's design note calls this out explicitly:
   nothing breaks, device B just adopts the new record next time it talks
   to the server. Confirm device B can still unlock and sync afterward
   with the *new* password once it's picked up the change.
5. **Fingerprint invalidation is per-device**: turning it on for device A
   should have no effect on device B at all — there's no shared state,
   it's a local Keystore key on each device.

---

## 7. If something doesn't work

- **`crypto_core_error` / decryption failed** on unlock: almost always a
  wrong password or a stale `devConfig.ts`/salt mismatch — not a bug to
  chase further without also checking the password.
- **Server unreachable from device**: re-check `adb reverse` is still
  attached (it doesn't survive a device reboot or USB replug) or that the
  LAN IP/firewall is right.
- **Gradle OOM**: see the `taskset` note in §4.
- **Camera permission permanently denied**: Android won't re-prompt after
  a hard denial — grant it manually in the OS app-info screen for Vaultiq.
- Found a real bug in the six new features? That's the point of this pass
  — note exactly what you did and what happened, the same level of detail
  as CLAUDE.md §0's existing bug write-ups, so it's actionable later.
