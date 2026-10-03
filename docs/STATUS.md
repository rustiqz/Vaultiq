# Project status

A running record of what has been built, what was verified and how, and what
was deliberately left out. Verification notes matter most: several mobile
features are compile-verified only, not exercised on a real device, and this
file says which.

Paths and decisions here are written as they were at the time. Keep it
accurate when something stops being true.

- **Phases 1–3 are complete.** The crypto core, the browser extension and the
  sync server all build, test and lint clean.
  - `pw-crypto-core/` — key derivation, vault key wrapping, item encryption and
    the wasm bindings, pinned by known-answer vectors cross-computed with
    OpenSSL and libsodium.
  - `extension/` — Manifest V3 for Firefox and Chrome (one build, both
    supported): vault UI, autofill, capture, quick
    unlock by PIN, per-device audit trail, sync, master password change, and
    all five item types (login, card, identity, authenticator, secure note).
  - `server/` — NestJS + PostgreSQL: device authentication, enrolment tokens,
    revocation, item sync with version-based optimistic concurrency, and the
    Docker/Caddy deployment.
- **Phase 4 is underway**: native mobile over the same Rust core via FFI.
  `pw-crypto-core/src/ffi.rs` (behind the `ffi` feature) mirrors `wasm.rs` for
  Kotlin/Swift via `uniffi`, generating the same opaque-handle contract the
  wasm bindings use. The original plan forecast this as "the first `unsafe` in the repo,
  in its own module" — that did not happen: `uniffi`'s generated code holds
  the unsafe FFI glue, ours doesn't need any, and `#![forbid(unsafe_code)]`
  stays crate-wide, unmodified. Verified by cross-compiling to Android
  arm64-v8a via `cargo-ndk` and generating Kotlin bindings from it — see
  `pw-crypto-core/Cargo.toml` for the `ffi` / `uniffi-bindgen` features. The
  `mobile/` app below is the first thing that consumes it.
  - Toolchain switched from the pacman `rust`/`rust-wasm` packages to
    `rustup` (same pinned `1.98.0`) so `aarch64-linux-android` and
    `wasm32-unknown-unknown` can both be installed as targets. Android SDK
    (`~/Android/Sdk`, cmdline-tools from `/opt/android-sdk`) and NDK
    (`/opt/android-ndk`, AUR `android-ndk` r29) are machine-local, not
    project-committed. **No iOS toolchain exists here and cannot**: this is
    Linux, and Xcode requires macOS. iOS work is deferred until that changes.
  - `mobile/` is a bare (non-Expo) React Native app, Android only for now —
    one JS/TS codebase for the eventual vault UI, but that does not remove
    native work: the FFI bridge is still per-platform (uniffi's generated
    Kotlin today, Swift later), and Android Autofill / iOS Credential
    Provider are both OS-invoked native processes RN cannot reach. Its
    `pnpm run crypto` (`mobile/scripts/build-crypto-core.sh`) cross-compiles
    `pw-crypto-core` and regenerates the Kotlin bindings into
    `android/app/src/main/{jniLibs,java/uniffi}` — gitignored, not
    committed, same as `extension/vendor/` for wasm. `./gradlew assembleDebug`
    installed and ran on a physical device (Android 16, arm64-v8a) —
    generated a real salt and scored a test password through the full
    Rust → JNI → Kotlin → JS chain.
  - Vault enrollment and unlock now work, mirroring
    `extension/src/background/vault.ts`'s `enrollWithServer`/`unlock`/`lock`
    rather than inventing a parallel design: `mobile/src/vault.ts`
    orchestrates in TypeScript (server calls in `syncClient.ts`, local state
    in `storage.ts`), the same JS-orchestrates-native-crypto-only split the
    extension uses. `CryptoCoreModule.kt` is now stateful — it holds at most
    one unwrapped `VaultKeyHandle` at a time, the mobile analogue of the
    extension's single `warmVaultKey` / `storage.session`; no key material
    ever crosses the RN bridge as a value. Local storage is plain
    `AsyncStorage`, matching the extension's `storage.local` model (the one
    genuine secret, the device credential, is sealed under the vault key
    before it's persisted, same as `sealCredential`). Deliberately out of
    scope so far: pushing items, autofill, quick-unlock by PIN (its
    session-only design doesn't map cleanly onto Android's process
    lifecycle — a later, deliberate decision, not an oversight), and vault
    *creation* (this app only joins an existing vault). **Verified
    end-to-end** against a real running server: enrolled a physical device
    onto a test vault (`auth/enrollment-params` → on-device auth key →
    `auth/enroll` → `GET vault` → on-device unlock) and confirmed the device
    row landed in Postgres. `docker-compose.yml` still deliberately publishes
    only Caddy; reaching the `server` container for this test needed a local,
    gitignored `docker-compose.override.yml` publishing its port plus
    `adb reverse tcp:3000 tcp:3000` — dev-only, not how a real deployment
    is reached.
  - Item **pull** now works too: `vault.pullItems()` unseals the stored
    device credential, calls `GET /sync` (paginating on the server's `more`
    flag), and decrypts each non-tombstoned item. No local item cache yet —
    every call re-pulls and re-decrypts from scratch rather than persisting
    ciphertext or plaintext between sessions, since there's nothing here yet
    that needs one; that's a deliberate simplification, not a gap, until a
    real Vault Home design exists to build a cache for. `App.tsx` renders a
    bare, unstyled item list (name/username fallback + type) — proving the
    pipeline, not the designed screen from the Figma brief.
  - `EncryptedItem`'s wire shape on the native bridge is base64 strings for
    `ciphertext`/`nonce` (`CryptoCoreModule.kt`'s `encryptItem`/`decryptItem`),
    matching `server/src/sync/dto.ts`'s `@IsBase64()` validation on the
    `sync` routes exactly. This is deliberately *different* from
    `WrappedVaultKeyFfi` in `unlock` (still number arrays): the vault
    bootstrap's `wrappedVaultKey` field is untyped and unvalidated
    server-side, so it stays whatever shape wasm's default serialization
    produced; `sync` items are validated, so the bridge matches that wire
    format instead of picking one convention and converting. Caught by
    testing on-device: an app upgrade over stale `AsyncStorage` data written
    in the old (number-array) shape failed decryption with a Kotlin cast
    error, not a silent misdecrypt — expected given there is no migration
    path for local dev state, not a data-loss bug.
  - Auto-lock is now real and user-configurable (1/5/15/30 minutes or
    never, default 15 — matches the extension's default): a foreground-only
    idle timer in `App.tsx`, reset on touch, not the extension's background
    alarm. Deliberately not full parity — Android backgrounding this app
    already tends to kill the process and wipe the held vault key regardless,
    so the gap that matters is staying unlocked while foregrounded and
    untouched, which this covers.
  - Join Vault, Unlock and Vault Home are now styled against real mockups —
    `mobile/src/theme.ts` holds a fall/autumn palette (cream background, deep
    brown primary, sage secondary, rust danger) plus a warm, system-aware
    dark palette. iOS uses `DynamicColorIOS`; Android resolves the same
    tokens through `values`/`values-night` resources. Branded artwork such
    as the splash and payment-card face keeps the exact supplied brown/cream
    colors in both modes. Built from exported screenshots, not a live Figma
    connection, so spacing and type scale are approximate. `mobile/src/devConfig.ts` (gitignored,
    `.example` committed, same pattern as the repo-root `.env`) prefills the
    Join Vault server URL and device name for local testing — never the
    enrollment token, which is single-use and expires in 15 minutes, so
    there is no default that would still be valid by the time it's read.
  - Real navigation now, via `@react-navigation` (native-stack + bottom-tabs
    + `react-native-screens`): a bottom-tab shell (Vault, Settings) once
    unlocked, with Vault Home → Item Detail as its own native stack — native
    Android back gesture/button support throughout, not custom-handled.
    Item Detail is styled and real for all five types (login, card,
    identity, note, totp), reading the already-decrypted content already in
    memory; TOTP gets a live 6-digit code via two new native methods
    (`totpCode`/`totpSecondsRemaining`, mirroring `ffi.rs`'s stateless
    `totp_code_ffi`/`totp_seconds_remaining_ffi` — no vault key needed).
    Settings is real too: device list/revoke (`GET`/`DELETE /devices`,
    newly added to `syncClient.ts`), auto-lock (moved here from Vault
    Home), server URL. Copy-to-clipboard on secret fields via
    `@react-native-clipboard/clipboard`. New Item and Autofill still have
    no plumbing and don't exist as screens.
  - Fixed on the way: `SafeAreaView` from `'react-native'` is a no-op on
    Android (iOS-only in core RN) — content was rendering under the status
    bar until switched to `react-native-safe-area-context`'s version
    (already a dependency) under a root `SafeAreaProvider`. Also dropped the
    default header shadow and tab-bar top border for a flatter, borderless
    look (`headerShadowVisible: false`, `tabBarStyle` with no border/
    elevation, header `card` color matched to the page background), and
    restored an explicit mode-aware `<StatusBar>` that had been dropped in
    the navigation rewrite — without it Android can choose unreadable status
    bar content against the app background.
  - The above was screenshot-approximate; screens now follow the real Figma
    exports instead (delivered as `screen-*.svg` files, rasterized
    with `rsvg-convert` and reviewed visually — the SVGs export selectable
    text as flattened vector paths, not `<text>` elements, so there was
    nothing to read from the markup itself). The fall palette stays ours
    (the Figma set uses teal); layout, spacing, icons and components now
    follow Figma. Two new dependencies for fidelity: `react-native-svg`
    (the Authenticator ring — a real animated arc, not an approximation)
    and `@react-native-vector-icons/feather` (outline icons matching the
    Figma set closely). A third bottom tab, **Authenticator**, lists every
    TOTP item with its live code inline (Authy-style quick access, tap to
    copy) rather than requiring a trip through Vault Home — `useTotpCode.ts`
    factors the ticking logic shared with Item Detail's ring. Settings'
    auto-lock control moved to its own pushed screen
    (`SettingsStack: SettingsHome → AutoLock`) to match Figma's chevron-row
    pattern. Item Detail's header gained the mockup's favorite/edit/delete
    icons; they are **not wired to anything real** (no favorite, edit, or
    delete plumbing exists) and tapping them says so via
    `Alert.alert('Not yet available', ...)` rather than doing nothing
    silently. `DetailField` grew a `multiline` mode after testing surfaced
    that Secure Note content was being clipped to one line.
  - Verified end-to-end on a physical device against seeded real data (one
    item per type, pushed straight to `/sync` with real ciphertext from a
    throwaway `#[cfg(test)]` block in `pw-crypto-core`, the same pattern as
    the earlier test-vault bootstrap — not committed): every item type's
    detail view, the Authenticator tab's live code, and Settings' device
    revoke (which also cleaned up a stale duplicate device row left over
    from an earlier test re-enrollment this session).
  - This machine's native Android builds are memory-constrained enough that
    `react-native-svg`'s C++ view manager compile can OOM-kill the Gradle
    daemon under load — `org.gradle.workers.max=2` in
    `mobile/android/gradle.properties` caps it, and even that was not
    always enough when the machine's other applications were also under
    memory pressure; `taskset -c 0,1 ./gradlew ...` (capping visible CPUs,
    which Ninja's job-count autodetection respects) was the reliable fix.
    Ninja's build cache survives a killed daemon, so a crashed attempt is
    not wasted work — retrying picks up from the last completed object
    file.
  - Item **create, edit, and delete** now work, mirroring the extension's
    design (`extension/src/background/vault.ts`) rather than inventing a
    parallel one: every mutation is a fresh encryption at `version + 1`
    (never an in-place field change, since `version`/`deleted` are bound
    into the AEAD), and delete from Item Detail moves the item to Trash —
    the same content re-encrypted with `deleted: true`, recoverable via
    `restoreItem`. Trash is a separate screen reached from Settings;
    `purgeItem` is the permanent tombstone — content replaced with
    `{"purged": true}`, `deleted: true` — the mobile analogue of the
    extension's `purgeItem`.
    Deliberately simpler than the extension in two ways: pushes happen
    immediately per operation rather than through a debounced outbox (the
    extension's `synced_version`-vs-`version` dirty tracking exists to
    diff against a persisted IndexedDB cache, which this app still doesn't
    have — see the still-true note above about `pullItems`), and a version
    conflict from the server is surfaced as a plain error rather than the
    extension's fork-and-keep-both-copies reconciliation, since that
    machinery exists for two offline devices drifting apart, which doesn't
    happen the same way when every write is a synchronous round trip.
    Item ids: a small local UUIDv4 helper (`src/lib/id.ts`) using
    `Math.random()`, not a new dependency — Hermes/React Native has no
    built-in `crypto.randomUUID()` the way a browser does, and an item id
    isn't secret (it's AAD, never key material), so it only needs to be
    unique, not cryptographically random. `ItemEditScreen.tsx` is one form
    for both create and edit, showing every field the type's schema
    carries, matching how Item Detail already does it.
  - Two bugs caught only by testing this on a physical device, not by
    `tsc`/`eslint`: the "+" button's new-item type picker was first built
    on `Alert.alert`, which silently caps at three buttons on Android —
    two of the five types (and Cancel) just vanished with no error. Fixed
    with a real themed `Modal` (`NewItemPicker` in `VaultHomeScreen.tsx`).
    Separately, a seeded TOTP item threw on open: its secret decoded to 10
    bytes, under this crate's 16-byte minimum (`kdf.rs`'s `MIN_SECRET_LEN`)
    — a bad test fixture, not an app bug, but a reminder that this floor
    exists.
  - Every dialog in the app is now themed instead of the bare native
    `Alert.alert` (delete confirmation, revoke-device confirmation, and
    the "not yet available" stubs for favoriting/autofill/master-password
    change) — a `ConfirmDialog` + `useConfirmDialog()` pair in `ui.tsx`,
    written as a near-drop-in for `Alert.alert(title, message, buttons)`
    so call sites barely changed. Also fixed on the way: `JoinVaultScreen`
    and `UnlockScreen` still imported `SafeAreaView` from `'react-native'`
    (a no-op on Android — see the fix already applied elsewhere in this
    section) — missed when that fix landed, caught now because the Join
    Vault heading was visibly overlapping the status bar.
  - Verified end-to-end on a physical device: seeded one item per type
    again (same throwaway `#[cfg(test)]`-block-in-`pw-crypto-core`
    pattern, not committed), then created, edited, and deleted items
    through the real UI against a real running server. 23 screenshots
    covering every screen and dialog state were handed to a designer for
    a redesign pass (kept outside the repo, not committed); known gap
    flagged alongside them: there is no native splash screen, so a cold
    start shows a brief default blank flash before the in-app loading
    view (`App.tsx`'s `status === 'loading'` branch) pops in.
  - **Redesign v2, part 1 of 2 (foundation + app shell).** The designer's
    redesign came back as a Claude Design canvas project (33 mockups plus a
    written design-system doc), read via the `DesignSync` MCP tool rather
    than screenshots. This first half replaces the visual system everywhere
    and completes the IA restructure the design backlog called for; item
    create/edit/detail's own layout is part two.
    - **Palette**: cream `#FFF8E8` background, `#674636` ink (there is no
      separate muted-text color anymore — hierarchy is size, not shade),
      sage/amber/rust as real state colors (healthy/needs-attention/
      compromised), never decoration.
    - **Type**: Space Grotesk (body), IBM Plex Mono (secrets/codes), and
      Archivo — used as a *variable* font in the design (continuous
      `wdth`/`wght` axes) that React Native's `TextStyle` cannot express
      (no `fontVariationSettings`). Approximated with pre-instanced static
      files at the two width steps actually used, fetched from Google
      Fonts' legacy static-instance endpoint (an old User-Agent trick: an
      old/simple UA gets already-instanced static TTFs back instead of the
      variable font blob) rather than hand-instanced with `fonttools` — this
      machine has neither `pip` nor `fonttools` installed, and reaching for
      `pacman`/`sudo` to fix that was ruled out (see the "no sudo" note
      elsewhere in this file's history). Not true continuous interpolation,
      so not pixel-identical to the mockups. Bundled directly under
      `android/app/src/main/assets/fonts` (committed binaries, like the
      launcher icons — nothing to generate, so no linking step).
    - **Icons**: the design's whole hand-drawn icon set, hand-extracted into
      `src/icons.tsx` (a first attempt at delegating this extraction to a
      subagent produced nothing usable — see the retrospective below),
      replacing `@react-native-vector-icons/feather` entirely. The "reveal
      password" toggle reuses one eye glyph for both states; the design has
      no separate closed-eye icon.
    - **Logo**: the three-spoke dial (`src/LogoMark.tsx`), replacing the
      shield glyph on Unlock/Settings/the loading view.
    - **IA restructure** (design backlog, now done): Vault Home is
      Logins-only with three Browse tiles (Cards/Identities/Notes), each
      opening its own list screen (`TypeListScreen.tsx`, one component for
      all three types). Bottom tab renamed Authenticator → Codes.
    - **Sort**: Vault Home's logins default to last-used-first (explicit
      ask, not what the mockup itself defaults to — its own toggle affordance
      is kept, just re-defaulted). Device-local only (`storage.ts`'s
      `recordItemUsed`/`readLastUsed`) — the extension has a real
      cross-device usage record for this (and for password-reuse detection);
      building that properly is a later, deliberate addition, not parity
      lost by accident.
    - **Codes tab**: groups live TOTP codes by account (design backlog),
      factored through the same `useTotpCode` hook Item Detail's ring uses.
    - Restyled: delete/revoke confirmation dialogs and the "not yet
      available" stub (now "Not built yet", matching the mockup's copy and
      icon exactly — `showComingSoon` in `ui.tsx`), Settings, the auto-lock
      picker (now a bottom sheet, `presentation: 'transparentModal'`),
      Join Vault (now a 3-step flow: welcome → device details → master
      password, with a paste button on the token field), Unlock.
    - **Native splash**: `MainActivity`'s own `windowBackground` (a
      layer-list drawable: ink fill plus a hand-ported vector-drawable copy
      of the dial), so there's no default blank flash before `App.tsx`'s
      loading view — which shows the same dial, so the handoff between
      native and JS reads as one screen. No `react-native-bootsplash`
      dependency; this is the older, dependency-free technique, sufficient
      for a static splash with no interaction.
    - Item Detail and the create/edit form (`ItemDetailScreen.tsx`,
      `ItemEditScreen.tsx`) got a **light-touch pass only** — old color/font
      token names swapped for new ones so the app compiles and looks
      consistent, `DetailField` carried over as-is — not the deeper
      per-mockup rework (the real card graphic, the every-time/sometimes
      field system, the identity wizard). That's part two.
    - **Assumed by the design, not built** (flagged per-mockup as
      encountered, not silently designed around): biometric unlock
      (Settings shows the toggle; tapping it is a stub), QR-code scanning
      for adding an authenticator, clipboard auto-clear after copying a
      secret, a real Android `AutofillService` (the "autofill picker"
      mockup is the actual OS-level suggestion overlay, not an app screen —
      nothing to build here without that native integration), and vault
      import. One is a bigger deal than the others: the mockups include a
      breach-checked/compromised-password state, which isn't just unbuilt —
      it's explicitly on the project's forever-deferred list (see CONTRIBUTING.md, "What is deliberately out of scope":
      not now, not partially). Deliberately not building even the visual component for
      that one until the scope call gets revisited on purpose.
    - **Retrospective**: a subagent forked off to extract the icon set ran
      for several minutes and, on completion, confidently reported having
      written `theme.ts`, `LogoMark.tsx`, and `storage.ts`'s usage tracking
      — all files it never touched (verified after the fact by content
      hash: nothing on disk had changed). Its actual deliverable,
      `icons.tsx`, was untouched, still the old Feather wrapper. The
      report was pure confabulation, not a race or an overwrite. Redone
      directly instead of re-delegated.
  - **Redesign v2, part 2 of 2 (item screens).** Item Detail for all five
    types, the create/edit forms, and the identity wizard, replacing part
    one's light token-compat pass with the actual per-mockup rework.
    - **Card**: a real card graphic (`CardPreview.tsx`, shared between
      New/Edit and Detail) — ink face, the dial watermarked into it, brand
      guessed from the number's prefix (Visa/Mastercard/Amex/Discover, a
      prefix check, not a real BIN lookup) — the design backlog's ask,
      replacing the old generic field-list.
    - **Every-time/sometimes fields** (design rule 2), for login, card, and
      authenticator: a fixed set of fields always shown, everything else
      starts as an add-chip and becomes a field once tapped — never hidden
      again once added. Editing a saved item starts with every field that
      already has a value pre-shown, not just the schema defaults.
    - **Identity is its own wizard** (`IdentityWizard.tsx`), not the shared
      form: three data steps (Name, Contact, Address) plus a fourth "step"
      that's the review screen itself, matching the mockups exactly (6i/
      6ab/6ac) — a per-group summary with a jump-back Edit pill, not a
      literal fourth data-entry step. One schema wrinkle the mockups
      revealed: identity's `name` field is repurposed there as a
      Personal/Work label shown in the review as "Label," not the display
      title — the person's `firstName`/`lastName` is the title everywhere
      instead (`itemContent.ts`'s `displayName` special-cases this now).
      Company/date of birth/national ID/street 2/state — real schema
      fields the mockups' three data steps didn't have room to show
      individually — were distributed across the three steps as their own
      sometimes-chips rather than dropped.
    - **TOTP**: "Scan QR code" is shown as the design specifies but is a
      labeled stub (manual entry works) — real QR scanning needs camera
      access, already flagged in part one's gap list.
    - Not touched: the Autofill picker mockup (6aa) — still nothing to
      build without the real `AutofillService`, as in part one.
    - **On-device testing surfaced real bugs, all fixed**: the bottom tab
      bar stayed visible underneath every pushed screen in the Vault
      stack (Item Detail, Item Edit, the per-type lists) — nested-stack-
      inside-tabs keeps it by default in React Navigation, which the
      mockups never show. Fixed with a per-tab `tabBarStyle: {display:
      'none'}` driven by `getFocusedRouteNameFromRoute`, live only on
      `VaultHome`. Separately, `ItemEdit` rendered a double header (the
      native-stack default plus `ItemEditScreen`'s own custom app bar)
      because its `App.tsx` screen options still computed a `title`
      instead of setting `headerShown: false`. And `VaultHomeScreen`,
      `AuthenticatorScreen`, `ItemEditScreen`, and `IdentityWizard` were
      each missing `SafeAreaView` on their self-drawn app bars, so
      content collided with the status bar — same class of bug already
      fixed once on Join Vault/Unlock in part one, recurring because
      these are newer custom-header screens. `TypeListScreen`'s search
      placeholder also naively pluralized `identity` to "identitys";
      fixed with an explicit map, the same approach already used for its
      screen title.
- **All six "not yet available" mobile stubs are now real** (favoriting,
  adding an authenticator from the Codes tab, changing the master password,
  clipboard auto-clear, fingerprint unlock, TOTP QR-code scanning). None of
  this needed any server change: every gap identified while building the
  mobile redesign turned out to be either pure client/OS integration or
  buildable entirely on the sync API the extension already uses (item
  content is opaque ciphertext to the server either way).
  - **Favoriting**: `favorite?: boolean` on `itemContent.ts`'s
    `CommonContent` — mobile-only, no extension or server equivalent,
    needed none since content is arbitrary client-encrypted JSON. The
    heart icon (`App.tsx`'s `ItemDetailHeaderActions`) toggles it via the
    existing `vault.updateItem`. Deliberately minimal: filled-vs-outline on
    the icon itself, no color change (rust/amber/sage are reserved state
    colors, design rule 7, and favoriting isn't one of those states), and
    no new "Favorites" view or Vault Home section — nothing in the design
    backlog calls for one, so this makes the existing stub real without
    inventing UI beyond it. `icons.tsx`'s `Icon` grew a `filled` prop for
    this (fills path shapes with `color` instead of stroking them; the
    heart glyph is a closed path already, so no new path data was needed).
  - **Add authenticator from the Codes tab**: navigates into the Vault
    tab's existing `ItemEdit` (create, `totp`) rather than building a
    second entry point to the same form. Needed `RootTabParamList`
    (`navigation.ts`) so cross-tab navigation (`Codes` → `Vault`'s nested
    stack) is typed, since the bottom-tab navigator had none before.
  - **Clipboard auto-clear**: `mobile/src/lib/clipboard.ts`'s
    `copyForAWhile`, ported line-for-line from
    `extension/src/lib/clipboard.ts` onto
    `@react-native-clipboard/clipboard` (already a dependency) instead of
    the web Clipboard API — same 30-second window, same "only clear if
    nothing else was copied since" check. Replaces every direct
    `Clipboard.setString` call in `ItemDetailScreen.tsx` and
    `AuthenticatorScreen.tsx`.
  - **Changing the master password**: mirrors
    `extension/src/background/vault.ts`'s `changeMasterPassword` exactly —
    verify the current password by unwrapping the *persisted* wrapped
    vault key under it (not whatever `unlock` already holds in session),
    then wrap that same key under a fresh salt and the new password, push
    the rewrapped record to the existing `POST vault/master-password`
    server route (already used by the extension — no server change), and
    only then update local storage. The vault key itself never changes, so
    nothing is re-encrypted and the sealed device credential (wrapped
    under the vault key, not the master key) needs no resealing.
    Everything this needed already existed in `pw-crypto-core`'s FFI layer
    (`wrap_vault_key`/`unwrap_vault_key`/`derive_master_key`, exported
    since uniffi mirrors `wasm.rs` 1:1) — the only new code is
    `CryptoCoreModule.kt`'s `rewrapVaultKey`, exposing a wrap the Kotlin
    bridge had never called before. No Rust changes, no NDK rebuild.
    Costs (`memoryKib`/`iterations`/`parallelism`) carry over unchanged
    rather than being raised to "today's recommended" ones on rotation, the
    one place this doesn't fully mirror the extension — a reasonable
    follow-up, not done here. New screen: `ChangeMasterPasswordScreen.tsx`,
    pushed from Settings. **Verified**: `tsc`, `eslint`, and
    `:app:assembleDebug` all pass; **not yet verified on-device** — no
    device was connected this session, so the actual unwrap→wrap→push→sync
    round trip hasn't been exercised against a real server yet.
  - **Fingerprint unlock** protects a *cached master password*, not
    anything pw-crypto-core derives -- a fingerprint can't re-run Argon2id.
    After confirming the password once (`EnableBiometricScreen.tsx`), it's
    encrypted under an Android Keystore AES/GCM key that requires biometric
    auth for every single use (`setUserAuthenticationRequired`, no validity
    window) and is invalidated the moment the device's enrolled biometrics
    change (`setInvalidatedByBiometricEnrollment`) — a new fingerprint added
    to the device doesn't inherit access to an old cached password. New
    native module `BiometricModule.kt` (AndroidX Biometric,
    `androidx.biometric:biometric:1.1.0`, the standard library for exactly
    this — Google's own BiometricPrompt+Keystore pairing, not a hand-rolled
    prompt) does the encrypt/decrypt behind one `BiometricPrompt`; JS
    (`vault.ts`'s `enableBiometric`/`unlockWithBiometric`/`disableBiometric`)
    owns storing the ciphertext (`storage.ts`'s `EnrollmentState.biometric`)
    and re-running the normal `unlock()` once the password comes back. A
    device whose biometrics changed surfaces as a specific rejection code
    (`biometric_key_invalidated`) so JS forgets the cached password and asks
    for it again, rather than showing a raw crypto error; a cancelled prompt
    (`biometric_cancelled`) is treated as "nothing happened," not a failed
    unlock. This is a different, simpler problem from mobile's earlier
    decision to defer PIN quick-unlock (session-only design not mapping
    onto Android's process lifecycle) — biometric unlock re-derives the
    real vault key through the normal path every time, it just skips typing
    the password to get there.
  - **TOTP QR-code scanning**: `QrScanScreen.tsx`, a full-screen camera view
    using `react-native-vision-camera`'s built-in `useCodeScanner` (no
    separate frame-processor plugin, no Reanimated/Skia/worklets-core --
    those are optional peers only needed for custom frame processors, which
    this doesn't use; confirmed by the "Frame Processors: OFF!" line in its
    own CMake build output). Pinned to `4.7.3` rather than the current
    `5.x` line, which requires an additional required peer,
    `react-native-nitro-modules` (a newer native-binding architecture) --
    not worth the extra dependency for one QR scan. `lib/otpauth.ts` is
    `extension/src/lib/otpauth.ts`'s `parseOtpauth` ported verbatim (pure
    string/URL logic, no browser-specific API). The scan result crosses
    back to `ItemEditScreen.tsx` via a plain module-level pending-callback
    (`lib/qrScanResult.ts`), not a route param: React Navigation's typed
    `navigate({..., merge: true})` can't express "these params merge into
    ItemEdit's existing route" without widening every other param on that
    screen to optional too.
  - **Enrollment QR scanning** reuses that camera shell before unlock. The
    extension's "Add a device" action renders a branded QR carrying only a
    `vaultiq://enroll` payload with the server URL and single-use token; the
    Join Vault flow validates it and fills both fields. The master password
    is never part of the QR. Android must keep
    `VisionCamera_enableCodeScanner=true` in `gradle.properties`; without it
    VisionCamera packages a preview but no native barcode detector.
  - **Verified**: `tsc`, `eslint`, and `:app:assembleDebug` all pass for
    both (the vision-camera native build in particular, since it compiles
    real C++/CMake code, not just Kotlin). **Neither is verified on a real
    device** — no device was connected this session, so the actual
    fingerprint-prompt round trip and camera/QR-decode path haven't been
    exercised.
  - **Explicitly declined**: breach-checking. It's on the project's forever-deferred
    list ("not now, not partially, not 'just the types for later'") — not
    revisited here even though a mockup assumes it, per that rule.
  - **Explicitly out of scope for this pass**: a real Android
    `AutofillService`. Its own planning session, below.
- **Cross-app theme parity**: the extension popup now uses the same fall
  palette, fonts, icon set, and dial logo as the mobile redesign, so the
  three apps read as one product — a token-level reskin, not a layout
  redesign (there is no Figma canvas for the extension, unlike mobile's).
  - `extension/src/popup/popup.css`'s `:root` tokens now hold mobile's
    cream/ink/rust palette instead of the old indigo one. `--accent` is set
    equal to `--text` (both ink) rather than a separate hue, matching
    mobile's design rule 5 (hierarchy rides on size, not shade) — there is
    no "brand color" distinct from ink anywhere in the mobile design.
    `--warn`/`--good` are darkened readings of amber/sage rather than the
    raw hues: mobile explicitly restricts amber to icon/border use and sage
    to backgrounds, never text (design rule 7), but the extension's
    password-strength meter needs a readable *text* color for "fair" and
    "strong" and has no mobile equivalent to defer to — a documented,
    deliberate exception to that rule, not an oversight.
  - **Dark mode is kept**: the existing
    `prefers-color-scheme`/`data-theme` toggle machinery is untouched. Its
    tokens now match `mobile/src/theme.ts` exactly: mobile background maps to
    the popup ground, mobile surface to tinted chrome, and mobile card to
    inputs/list cards, with the same ink/rust/amber/sage values.
  - **Fonts**: the same bundled TTFs as mobile (Space Grotesk body, IBM Plex
    Mono for copyable/token values, Archivo Condensed/SemiCondensed for
    headings and button chrome), loaded via `@font-face` in `popup.css` only
    — never in the content-script's injected stylesheets, which stay on OS
    system colors/fonts by design (see below). Copied straight from
    `mobile/android/app/src/main/assets/fonts` rather than re-fetched, with
    one exception: `ArchivoCondensed-SemiBold.ttf` there is byte-identical
    to `ArchivoCondensed-Bold.ttf` (same MD5) — a mislabeled duplicate from
    that redesign's font-fetch step, not a real semibold instance. Caught
    here because Vite's build collapsed the two `@font-face` rules onto one
    output file. Every mobile screen using `fonts.condensedSemiBold` is
    silently getting Bold weight instead — a real bug, left unfixed on
    mobile for now (its other on-device issues are being triaged
    separately) and not propagated here: the extension only bundles the 5
    fonts it actually uses, skipping the duplicate rather than shipping it
    under a name nothing references.
  - **Icons**: `extension/src/popup/icons.ts` ports the exact path/circle/
    rect data from `mobile/src/icons.tsx` and `LogoMark.tsx` — same shapes,
    a different renderer (raw DOM via `document.createElementNS`, since the
    extension has no UI framework to mount a component into). Every icon
    defaults to `currentColor` rather than a fixed hex: the browser resolves
    CSS custom properties for us, which React Native cannot do. Wired into
    the popup at low-risk, additive spots only — the dial next to "Vaultiq
    is locked"/"Create your vault", copy/reveal glyphs on every `copyable()`
    value, and icons on the Lock/Add/Generate/trash-toggle buttons — without
    restructuring `index.ts`'s single-file, no-framework architecture, which
    this task didn't need touching.
  - **Production logo pass**: the mobile dial component now carries the
    supplied primary, compact, micro, mono, locked, and syncing geometries;
    the native splash matches the reversed primary mark; and Android/iOS
    launcher assets come from the supplied platform artwork. The extension's
    toolbar/manifest icons use the supplied small-size favicon geometry at
    16/32/48/128px under `extension/public/icons/` (Vite's default
    `publicDir`, copied to `dist/` root).
  - **Lock-screen identity**: enrollment now retains the user-entered device
    name in the local enrollment record and shows it under the locked mark.
    The field is optional in the stored type so existing installations remain
    readable and show "This device" until they enroll again.
  - **Deliberately untouched**: the content-script's autofill dropdown and
    save-password prompt (`extension/src/content/dropdown.ts`, `prompt.ts`)
    stay on OS system colors (`Canvas`/`CanvasText`) in their isolated
    shadow roots — an existing trust-boundary decision (they inject into
    arbitrary third-party pages), not something this reskin should override
    by shipping custom fonts onto every page a user visits. `sync-panel.ts`
    also wasn't touched beyond inheriting the new tokens automatically: its
    buttons swap their own `textContent` between a label and "Working…", so
    adding a persistent icon would mean restructuring that pattern for
    uncertain benefit — out of scope for a reskin.
  - **Verified visually**, not just by `tsc`/`eslint`/`vitest`: the real
    built `popup.js`/`popup.css` (not a hand-approximated markup copy),
    loaded in headless Chromium against a `window.browser.runtime
    .sendMessage` stub returning fixture data, screenshotted for the empty/
    locked/unlocked states — including the weak/reused-password badges,
    copy/reveal icons, and the settings and password-generator panels.
- **Mobile: a manual dark-theme toggle, and a lock-screen biometric race
  fix.** The app already followed the OS light/dark setting through
  `theme.ts`'s system-aware `colors` (`DynamicColorIOS` on iOS,
  `PlatformColor` reading `values`/`values-night` on Android); Settings gains
  an explicit System/Light/Dark override (`storage.ts`'s `ThemeMode`,
  persisted under `vaultiq:themeMode`). Choosing one calls
  `Appearance.setColorScheme` so native-resolved colors flip immediately, not
  just RN-styled ones. `App.tsx` remounts the unlocked tab tree on
  `key={theme-${themeMode}-${colorScheme}}` because some nested native
  components (the tab bar) don't otherwise repaint on the state change alone.
  Separately, on-device testing surfaced a real bug: the fingerprint prompt
  could fire against a not-yet-resumed `FragmentActivity` when the lock
  screen mounts, so it's now also gated on `vault.biometricAvailable()` (not
  just `biometricEnabled`) and was delayed 80ms past mount as a first fix.
  That delay was not reliable on all devices — first-tap-fails-silently
  (rejects `biometric_error` with no prompt shown at all, second tap works)
  still reproduced. Replaced with a deterministic fix in
  `BiometricModule.kt`: `authenticateWhenResumed` checks the activity's
  actual `Lifecycle.State`, calling `BiometricPrompt.authenticate()`
  immediately if already `RESUMED` or via a one-shot
  `DefaultLifecycleObserver.onResume` otherwise, instead of guessing a
  delay. The JS-side `setTimeout` in `App.tsx`'s `runBiometricUnlock` is
  gone — no longer needed once the native call itself is lifecycle-safe.
- **Extension popup redesign ("Match Desk") and active-tab fill.** The popup
  moves from a single scrolling list (inline rows, settings/sync/generator/
  trash always stacked below it) to a master-detail layout: a header
  (brand, search, add, overflow menu), a sidebar (This site/All items scope
  tabs plus the row list), and a detail pane for the selected item.
  Settings, Sync, the password generator, Trash, and New/Edit are now
  separate screens reached from the overflow menu rather than permanent
  panels. Source design: an AI image-generation exploration named "Match
  Desk" (a wide master/detail concept using a Proton Pass screenshot only as
  *structural* reference, explicitly instructed not to copy its palette,
  branding, or exact component shapes) — kept outside the repo, the same as
  other design handoffs (see the redesign v2 screenshot note above).
  - **Active-tab fill**: the detail pane's dominant action is "Fill on
    `<site>`", wired through a new `fillActiveLogin` request
    (`lib/messages.ts`). The popup never receives the credential itself —
    background asks the *active tab's* content script to do the fill, and
    the content script requests the credential directly from background
    (`content/index.ts`'s new `vaultiqFillActiveLogin` listener), so the
    existing sender-tab site check in `credentialForFill` stays the final
    gate regardless of which context initiated the fill.
  - **Physical footprint**: a browser toolbar popup has far less screen
    budget than the 720×520 concept was designed at, so the whole shell
    renders at its native size and is scaled down 30% (`transform: scale
    (0.7)`, popup.css) to a 504×364 footprint, keeping every measurement,
    scroll pane, and overlay proportional rather than redrawing the layout
    at the smaller size.
- **Real Android `AutofillService`, login-only (fill + save), v1.** The
  mobile analogue of the extension's autofill, and the last of the
  mockup-assumed features that was flagged as needing its own planning
  session rather than folding into a stub-wiring pass.
  - **The core problem**: `AutofillService` runs as a plain Kotlin service
    callback with no access to whatever JS/React holds in memory, and the
    vault is very likely *locked* when some other app triggers it
    (backgrounding already tends to kill this app's process — see
    `CryptoCoreModule`'s held key — and there is no native item cache to
    search even when it isn't; building one just for this would be its own
    separate, larger project). So `onFillRequest` never tries to decrypt or
    match anything itself: it only inspects the *form* (does it look like a
    login?) and, if so, replies with exactly one generic, always-the-same
    authenticated placeholder ("Fill with Vaultiq"), gated behind a
    `PendingIntent` that opens `AutofillActivity` — a second `ReactActivity`
    hosting the *same* registered `"Vaultiq"` component `MainActivity` does
    (RN's standard multi-entry-point pattern, one extra `autofillRequest`
    prop via `getLaunchOptions`), running the app's own already-correct
    unlock → `vault.pullItems()` → decrypt pipeline completely unchanged.
    Whatever the user picks there is handed back through a small native
    module, `AutofillModule.kt`, to complete the framework's response. No
    native cache, no native decrypt path, no duplicated matching logic.
    This is standard behavior for a locked password manager (Bitwarden/
    1Password's own services work the same way) — there is no personalized
    suggestion to offer before that pipeline runs regardless of
    implementation.
  - **Save** follows the identical shape in reverse: `onSaveRequest` (no UI
    of its own — Android already showed its own "Save to Vaultiq?" prompt)
    launches `AutofillActivity` in save mode with the typed
    username/password/domain, which confirms and calls the existing
    `vault.addItem`. `SaveCallback` isn't JS-representable, so that handoff
    stays entirely native: `VaultiqAutofillService` holds it on a companion
    var until the launched screen's confirm/discard finishes it — the same
    pending-callback shape `lib/qrScanResult.ts` already uses for an
    equivalent Activity-boundary handoff in JS, just on the Kotlin side.
  - **Field detection**: primarily explicit `AUTOFILL_HINT_USERNAME`/
    `_PASSWORD`/`_EMAIL_ADDRESS` (Chrome reliably infers these from HTML
    `autocomplete` attributes, so most modern web forms are covered), with
    an `InputType`-based fallback (treats the free-text field immediately
    before a password field as the username) for the minority of forms —
    mostly older sites, some non-Chrome apps — that never set a hint at
    all. A known, accepted imprecision, not a bug to chase further.
  - **New files**: `VaultiqAutofillService.kt`, `AutofillActivity.kt`,
    `AutofillModule.kt`, `res/layout/autofill_suggestion.xml` (the one
    suggestion row), `res/xml/autofill_service_config.xml` (required
    service metadata), `nativeAutofill.ts`, `AutofillFillScreen.tsx`,
    `AutofillSaveScreen.tsx`.
  - **Matches mockup 6aa exactly**, checked against the actual design
    handoff file rather than approximated from the shared component kit
    (the first pass got this wrong — see the retrospective below): a
    *bottom sheet* over the dimmed third-party form, not a full screen.
    `AutofillActivity` gets its own translucent window
    (`AutofillSheetTheme` in `styles.xml` —
    `windowIsTranslucent`/transparent `windowBackground`) so the calling
    app's own activity, still on the back stack underneath and never
    finished, shows through wherever the RN content doesn't paint over it;
    the RN side renders only a `colors.scrim` backdrop and a
    bottom-anchored cream sheet (3px ink top border, 20px corner radius) —
    the same conceptual pattern `AutoLockScreen.tsx` already uses for its
    own bottom sheet, just at the Activity/window level here since this
    screen isn't hosted inside the normal navigation tree. Header: the
    `compact` `LogoMark` variant + "VAULTIQ" wordmark + a mono subtitle,
    a close (×) button. Up to three direct matches show as compact rows
    (`ItemAvatar`'s existing single-letter login-avatar square + name/
    username + a solid-ink "FILL" button per row, not a whole-row tap);
    two escape-hatch buttons below them, "Search vault" (reveals a
    `SearchBar` + the full login list, still inside the sheet) and
    "Save new" (an inline quick-create form for this exact site, calling
    `vault.addItem` then completing the fill immediately with the
    just-created values — no need to re-pull and pick it back out).
    `AutofillSaveScreen.tsx` has no reference mockup (only the fill picker
    was designed) but was built to match the same sheet language rather
    than stay a full-screen form, on request.
  - **Caller identity is never guessed, and always shown** — added after a
    direct question surfaced a real gap: `onFillRequest` originally only
    ever read the browser-verified `webDomain`, which is empty for a
    native app, so a malicious app faking a familiar login screen would
    have shown *no identifying signal at all* in the picker, only an
    empty domain hint, while still letting a fooled user hand it real
    credentials. `VaultiqAutofillService.callerFor` now always resolves a
    real identifier: the `webDomain` when there is one (a page cannot lie
    about this; the browser reports the true URL-bar domain, not whatever
    the page's own HTML claims), otherwise `AssistStructure
    .activityComponent`'s actual requesting package name and label —
    never blank, never the vault's own guess. The sheet shows this
    unmissably in both fill and save mode: a plain "*N* matches for
    *domain*" when verified, or an amber alert-triangle icon (design rule
    7: amber is icon/border-only, text stays ink) next to "Not a verified
    website — *caller*" when it isn't. This doesn't eliminate the risk — a
    convincingly-named fake app could still fool an inattentive user, and
    nothing here blocks the fill, it only surfaces the signal — but it
    closes the "shows literally nothing to check" gap the first pass had.
  - **`MainActivity` gained `android:importantForAutofill=
    "noExcludeDescendants"`**: Vaultiq's own unlock/master-password fields
    must never be offered autofill suggestions, by our own service or any
    other — both a UX nonsense-loop and a mild security smell worth closing
    explicitly.
  - **Retrospective**: the first implementation pass built a full-screen
    picker using the shared UI kit for visual consistency, without
    checking it against the actual mockup — reasonable-looking, but not
    what was asked for, and the sheet-vs-full-screen difference isn't
    cosmetic (it's *why* the design shows the third-party form dimmed
    underneath at all). Caught only because the user asked directly
    whether the screen matched the stored designs; this project's own
    `claude_design` MCP connection wasn't available in-session to check
    proactively, and the mismatch would not have been caught otherwise.
    Worth checking design fidelity explicitly for any future screen this
    session didn't source through that MCP tool.
  - **Verified**: `tsc`, `eslint`, `:app:compileDebugKotlin`, and
    `:app:assembleDebug` all pass, including a full manifest-merge check
    (the new `<service>`/`<activity>`, `importantForAutofill`, and
    `AutofillSheetTheme` all landed correctly in the merged manifest).
    **Not verified on a real device** — none was connected while building
    this, same caveat as the biometric/QR-scan/master-password-change
    work. Enabling Vaultiq as the system autofill service, confirming the
    translucent sheet actually shows the calling app dimmed underneath
    (a real device/window-manager behavior no static check can confirm),
    triggering a real fill, and the save-prompt round trip all still need
    that.
  - **Deliberately out of scope**: identity/card autofill (login only, per
    the same design-rule-scoping this session applied elsewhere) and
    breach-checking (forever-deferred, unrelated to this feature but
    worth restating every time a mockup nearby assumes it).
- **Phase 6 underway: multi-tenancy and self-hosted distribution.**
  [MULTI-TENANCY.md](MULTI-TENANCY.md) is the design doc — the reasoning,
  the recovery/escrow question (deliberately left open), and the sequencing.
  `PROJECT.md`'s Phase 6 section is the settled subset of it. Three work
  items landed (PR #47, `phase6/isolation-defects` → `main`).
  - **Work item 1 — isolation defects**, worth doing regardless of the rest:
    `vaults.next_seq` replaces the single global `item_seq` (was a
    cross-tenant side channel — the gaps in your own sequence numbers
    reported how much another tenant wrote), a 10,000-item-per-vault quota
    (`MAX_ITEMS_PER_VAULT` in `sync.service.ts`, hardcoded — a reasonable
    follow-up, not done, to make it configurable), and rate limiting keyed
    by device (`DeviceThrottlerGuard`) instead of IP for every authenticated
    route, so one office behind one NAT no longer shares a bucket. The
    three bootstrap routes (register/enrollment-params/enroll) stay
    IP-keyed unconditionally — nothing has authenticated yet when they run,
    and trusting a self-claimed device id there would let an attacker mint
    a fresh "device" per guess and walk past the limit.
  - **Work item 2 — always-invite-only registration.** `register()` drops
    the old "refuse once an account exists" check for a required, valid,
    unspent `account_create`-kind token (`enrollment_tokens` gained `kind`,
    `grants_role`, `created_by`, a shape-check constraint tying the two
    kinds' columns together). `ensureBootstrapToken()` mints and logs one
    automatically at boot when `users` is empty, reproducing today's
    single-account behaviour on a fresh server without a special case.
    `users.role` (`member`/`admin`) is the first real role — an admin can
    issue registration tokens and revoke devices, never read a vault.
    Administration is `server/src/admin/cli.ts` (`pnpm run admin`;
    `docker compose exec server node dist/admin/cli.js` against a real
    deployment, since Postgres isn't reachable from the host any other
    way), an interactive `@clack/prompts` wizard rather than a fourth app
    or a new HTTP surface — invite, list users/devices/outstanding
    invitations, revoke (revokes every device on the account and spends
    its outstanding device-join tokens), and a "recover a locked-out
    account" entry that's present but inert, pointing at the escrow
    section rather than looking like a missing feature. Invite tokens
    render as a terminal QR (`qrcode`) alongside the plaintext, encoding
    the same `vaultiq://enroll` shape the extension's device-join QR uses,
    with `kind=account`.
  - **Work item 3 — symmetric client enrollment.** No app is privileged as
    "the first device" anymore — that was only ever true because the
    extension shipped first. Mobile gained a `GetStartedScreen.tsx`
    choice screen, a `CreateVaultScreen.tsx` (mirrors `JoinVaultScreen`'s
    three-step wizard shape but generates fresh crypto locally and asks
    the user to *choose* a password, single field, no confirmation,
    matching the extension's own "Create your vault" convention), and
    "Invite a device" in Settings (`react-native-qrcode-svg`, new
    dependency — mobile had QR scanning but no generation before).
    Creating a vault needed native crypto mobile never had a bridge for:
    `CryptoCoreModule.kt` gained `createVault`/`defaultArgon2Params`,
    calling `pw-crypto-core` FFI exports the extension's wasm bindings
    already use for the same purpose — no Rust changes. Both QR generators
    (extension and mobile) and the CLI mark their kind explicitly
    (`device`/`account`) in the invite URI; each screen's scanner rejects
    a mismatched kind rather than misrouting it, but this is a UX routing
    hint only — the server enforces kind on every route regardless
    (`register` only accepts `account_create`, `enroll`/`enrollment-params`
    only `device_join`), so there's no server round-trip to ask "what is
    this token" and no trust decision riding on a client's own read of it.
    Caught along the way: `connectServer()` (the extension's "upload this
    local vault to a fresh server" path) had never been updated to send
    the new required token — a real break, not hypothetical, fixed here.
  - **Verified**: server — `pnpm typecheck`/`lint`/`test`/`build` green
    across every commit (checked in isolation via temporary stashing at
    each commit boundary, not just at the end), migrations applied fresh
    and twice for idempotency against a real Postgres, a live smoke test
    against a running built server (bootstrap → register → push/pull;
    rate-limit behaviour confirmed live), and the admin CLI driven
    end-to-end over a real pty against a real database. Extension — `pnpm
    typecheck`/`lint`/`test`, 275 tests. Mobile — `tsc`, `eslint`,
    `:app:assembleDebug` (full native build, including the new Kotlin
    bridge methods and the new dependency's autolinking). **Not verified**:
    no physical Android device was connected this session, so
    `CreateVaultScreen`/`GetStartedScreen`/the invite QR/the native
    `createVault` bridge are compile-verified only, not run on hardware.
  - **Two pre-existing, unrelated test-infra gaps found and fixed
    separately from the phase-6 work itself**: `version.controller.test.ts`
    and mobile's Jest config both transitively required `DATABASE_URL` /
    failed to parse an ESM dependency with no gate, meaning a checkout
    without a database (or, for mobile, at all) couldn't run them — same
    class of bug Work Item 1's `device-throttler.guard.test.ts` fix
    addressed, just predating this phase. Fixed by making `pool.ts`
    construct its `Pool` lazily (a Proxy, on first real use, rather than
    at import time — the fix generalizes past this one test file, to any
    future test that transitively imports `AuthService`) and by widening
    mobile's Jest `transformIgnorePatterns` plus adding native-module
    mocks (`jest.setup.js`) for Clipboard/AsyncStorage/VisionCamera/
    `react-native-qrcode-svg`. `SECURITY.md`'s "one account per server and
    no sharing" claim and this file's own missing phase-6 entry (this one)
    were also stale and caught in the same pass.
  - **Work item 4 — admin capabilities and an audit log**, prompted by
    deciding the recovery question (Path A: no escrow, ever — see
    MULTI-TENANCY.md) and wanting a real answer to "what happened" for
    incident investigation. `users.role` (a plain `member`/`admin` column)
    replaced by `user_capabilities` (`manage_invitations`, `manage_devices`,
    `view_audit_log` — granular, not all-or-nothing; nothing enforces these
    at an HTTP layer yet since nothing admin-facing runs over HTTP, the CLI
    already having full database trust). A new `audit_log` table records
    registrations, enrolments and their refusals, device revocations,
    master password changes, and invitations issued — never a credential,
    token, or key material. Writes go through the plain connection pool
    rather than whatever transaction the caller is in, specifically so a
    refusal's log entry survives the refusal's own transaction rolling
    back (verified by a test: `expect(rows).toEqual([{event_type:
    "registration_refused", ...}])` after a rejected `register()` call).
    Source IP is recorded only for registration/enrolment refusals — one
    deliberate, documented exception to "a database dump identifies
    nobody," decided explicitly rather than defaulted into. Retention is
    manual (`prune audit log older than N days` in the CLI); no scheduler
    added for this. **Caught while building the IP-logging half**, not
    something either feature set out to find: the real deployment sits
    behind Caddy, and the server never trusted it as a proxy, so `req.ip`
    resolved to Caddy's own container address for every request — meaning
    Work Item 1's IP-keyed rate limiting on the three bootstrap routes had
    been silently ineffective in the real deployment the whole time (every
    caller collapsed into one shared bucket, one hop further out than the
    NAT problem that work item was built to prevent). Fixed with
    `app.set('trust proxy', 1)`. Admin CLI gained capability multiselect
    (replacing the member/admin picker) and "view/prune audit log" menu
    entries. **Verified**: `pnpm typecheck`/`lint`/`test` (75 tests, real
    Postgres, including the rollback-survival property above), a live
    HTTP smoke test confirming a spoofed `X-Forwarded-For` header now
    produces the correct `source_ip` in a refused-registration audit row,
    and the CLI's new multiselect/audit-log-view screens driven end to end
    over a real pty against a real database.
- **CSV import (extension + mobile)**, un-deferred from the deferred list. Imports login
  and secure-note rows from a CSV export (Chrome, Firefox, Bitwarden,
  LastPass, 1Password, and similar all produce something the parser
  recognises) — deliberately **not** cards, identities, or TOTP: their CSV
  schemas diverge too much between vendors to map correctly without a real
  sample from each, so a row whose `type` column says anything else is
  skipped and counted, not guessed at — a reasonable v2 follow-up, not an
  oversight. No de-duplication against existing items either, at the time —
  see the later, dedicated entry below for that.
  - **Parsing** (`extension/src/lib/csvImport.ts`, ported — not shared — to
    `mobile/src/lib/csvImport.ts`, the same relationship `itemContent.ts`
    already has with `messages.ts`): a hand-rolled ~150-line RFC4180-ish
    parser (quoted fields, embedded commas/newlines, `""` escaping, CRLF or
    LF), no CSV dependency on either app — same call already made for
    `otpauth.ts` and `lib/id.ts`. A header-alias table maps common column
    names case-insensitively (`login_uri`/`uri`/`website` → url, etc.) so
    one parser reads Chrome's header-less-type export and Bitwarden's
    `type`/`login_*` columns alike. A row with nothing meaningful in it
    (no username/password for a login, no name/notes for a note) is
    skipped and counted, not imported blank.
  - **Extension**: no new message kind — a new "Import" overflow-menu entry
    (`popup/import-panel.ts`) reads a local file via a plain
    `<input type="file">` (no dependency, no `host_permissions`; nothing
    like this existed in the popup before), parses it, shows a preview list
    with a per-row include toggle, then loops the existing
    `{ kind: "addItem", content }` request sequentially — the same request
    the "New item" form already sends, so every parsed row gets encrypted
    exactly the way a hand-typed item does. `scheduleSync`'s debounce
    coalesces the resulting pushes into one sync after the last item.
  - **Mobile** needed a new dependency: `@react-native-documents/picker`
    (exact-pinned `12.0.2`; the older `react-native-document-picker` is
    deprecated — checked against npm directly this session, not assumed).
    Its `pick()` has no `readContent`/base64 option — checked against the
    package's actual `.d.ts` after an initial web search suggested
    otherwise and turned out to be wrong for this package — so the file is
    read via `fetch(uri).then(r => r.text())`, which the package's own docs
    confirm handles a picked `content://`/`file://` uri directly; no second
    filesystem dependency needed. `errorCodes.OPERATION_CANCELED` is
    treated as "nothing happened," not an error, matching the existing
    `biometric_cancelled` convention in `vault.ts`. New `ImportScreen.tsx`,
    reached from a new "Data" section in Settings; the row is labelled
    "Import from file" and handles CSV, Bitwarden JSON and Proton Pass JSON.
    It mirrors the same pick → preview (toggleable `FlatList` rows) → import
    flow, looping `vault.addItem` per included row in its own `try`/`catch`
    so one failure doesn't abort the batch — `addItem` was already mode-aware
    (local-only-vault-mode work), so this screen never needs to know which
    kind of vault it's importing into. The package's own jest mock isn't
    reachable from outside it (`ERR_PACKAGE_PATH_NOT_EXPORTED` on its
    `jest/build/jest/setup` subpath, despite that file existing precisely
    for this) — a hand-written mock in `jest.setup.js` instead, same
    pattern as the Clipboard/VisionCamera/qrcode-svg entries already there.
    `jest.config.js`'s `transformIgnorePatterns` gained
    `@react-native-documents` alongside the existing RN-ecosystem entries,
    for the same ESM-parsing reason every other one is listed.
  - Both apps carry a plain warning in the import UI to delete the source
    CSV once it's confirmed imported — it's plaintext credentials sitting
    outside Vaultiq's control the moment it's picked.
  - **Verified**: extension — `pnpm typecheck`/`lint`/`test` (291 tests, 16
    new for `csvImport.ts`: header aliasing, quoted/escaped/CRLF fields,
    skipped-row counting) and `pnpm build`. Mobile — `tsc`, `eslint`, jest
    (17 tests, 16 new for the ported parser, plus the existing
    `App.test.tsx` smoke test now also covering the new dependency's mock),
    and `:app:assembleDebug` (full native build, confirming the new
    dependency autolinks and compiles). **Not verified on a real device or
    in a real browser** — no physical device was connected and no headless
    Chromium was available this session, so the actual pick → preview →
    import round trip hasn't been exercised end to end on either app.
- **Local-only vault mode (extension + mobile)**: a vault that is created and
  used entirely without ever contacting a sync server. Research before
  building this turned up an asymmetry worth recording: the extension needed
  almost no new storage, because it was already local-first.
  - **Extension**: `vault.create()` has never touched the network — every
    item mutation already writes to IndexedDB unconditionally, and sync
    (`connectServer`/`enrollWithServer`) has always been a separate, opt-in
    step. So this is a policy feature, not a storage one: a new
    `browser.storage.local` flag (`isLocalOnly`/`setLocalOnly` in
    `vault.ts`, same shape as `autoLockMinutes`), enforced at the source —
    `connectServer`/`enrollWithServer` refuse outright while it's set, and
    `setLocalOnly(true)` itself (background) still refuses while a server is
    connected. The popup's Settings toggle therefore, when a server is
    connected, asks for confirmation and disconnects before setting the flag,
    so the user never sees the refusal; with no server it sets the flag directly.
    `scheduleSync`/`syncOnUnlock` short-circuit before ever reaching
    `connectedClient()`. Settings gained a "Never sync this vault" toggle;
    the Sync screen shows an explanatory line instead of the connect form
    once it's on, rather than a form that would only error.
  - **Mobile** needed real new work: it had no local item cache at all
    before this (`pullItems()` always re-pulled and re-decrypted from the
    server — see its own prior doc comment). `storage.ts`'s
    `EnrollmentState` is now a discriminated union on `mode: 'local' |
    'server'` (a record with no `mode` — everything written before this
    existed — reads as `'server'`, since that's the only kind that did), and
    a new `vaultiq:localItems` AsyncStorage key holds an `EncryptedItem[]`
    in the same wire shape `nativeCryptoCore.ts` already defines, matching
    `server/src/sync/dto.ts`'s DTO for free. New `createLocalVaultAndUnlock`
    sits beside `createVaultAndUnlock`, skipping registration, the device
    credential, and the device-name requirement entirely (display-only for
    a vault with no other device to show it to). `addItem`/`updateItem`/
    `deleteItem`/`pullItems` branch on enrollment mode — same encryption,
    same AEAD/AAD discipline, same version-bump-never-hard-delete tombstone
    rule, just written to and read from the local store instead of pushed
    or pulled. `authenticated()` now refuses outright for a local-only
    vault rather than only failing on the credential check, so a
    programming error can't accidentally reach a server call for one.
    `changeMasterPassword` skips auth-key derivation and the server round
    trip entirely for local mode, mirroring how the extension's own
    version already made that conditional on a connected server.
  - **New screen**: `GetStartedScreen` gained a third option, "Use without a
    server," opening `CreateLocalVaultScreen.tsx` — a single password field,
    not CreateVaultScreen's three-step wizard, since a local vault has
    nothing server-shaped left to collect once the device-name step is
    dropped. Settings hides the device list, "Invite a device," and the
    server-address row for a local-only vault, showing "Local (no server)"
    in the vault card instead.
  - **Deliberately not built**: any upgrade path from a local vault to a
    server-backed one later (agreed before implementation started), and any
    backup/export mechanism for a local-only vault — losing the device
    loses the vault, same as losing the master password does for any vault;
    see SECURITY.md's new "No offsite backup" entry.
  - **Verified**: extension — `pnpm typecheck`/`lint`/`test` (280 tests,
    including new refusal tests for the guard on `connectServer`/
    `enrollWithServer`/`setLocalOnly`) and `pnpm build`. No headless
    Chromium was available in this session to visually check the Settings
    toggle and Sync screen's notice, unlike prior popup-reskin work — that
    manual check is still outstanding. Mobile — `tsc`, `eslint`, the
    existing `App.test.tsx` smoke test, and `:app:assembleDebug` (full
    native build). **Not verified on a real device** — none was connected
    this session, so creating a local vault, adding/editing/deleting items,
    and confirming they persist across a restart haven't been exercised on
    hardware.
- **More import formats: Bitwarden JSON and Proton Pass JSON**, on top of
  the CSV importer. Research came first, not a parser: both formats were
  looked up fresh against primary sources rather than assumed, per this
  project's own discipline for the CSV importer.
  - **Bitwarden JSON**: schema confirmed solidly — Bitwarden's own docs plus
    several independently-built community import/export tools agree on the
    same shape, `{ items: [{ type, name, notes, login|card|identity }] }`
    with a numeric `type` (1 login, 2 secure note, 3 card, 4 identity).
    Solid enough to cover one type further than the CSV importer: login,
    secure note, card, and identity. `identity`'s `company`/`dateOfBirth`/
    `nationalId` were not confirmed present in this schema, so they are not
    mapped; type 5 (SSH key) and anything else is skipped and counted, not
    guessed at, the same rule the CSV importer states for an unrecognised
    CSV column.
  - **Proton Pass JSON**: the trail ran out partway through. The vault
    wrapper and `login` item fields are confirmed against a real exported
    file (via an independently-built Proton-Pass-to-CSV converter script)
    and a forum thread quoting real exported JSON —
    `{ vaults: { <id>: { items: [{ state, data: { type, metadata: {name,
    note}, content: {username, password, urls, totpUri} } }] } } }`. What
    is *not* confirmed: the field names Proton uses for `alias`,
    `creditCard`, or `identity` items. Proton's own docs don't show the
    schema, and their open-source `proton-pass-common` repo stores items as
    protobuf internally — a different, unrelated schema from the exported
    DTO, so the Rust-side type names give no shortcut to the JSON field
    names. Rather than guess from those names alone, this version maps only
    `login` and `note` — matching the CSV importer's scope exactly — and
    skips and counts everything else. Trashed items (`state: 2`, confirmed
    from `proton-pass-common`'s `ItemState` enum) are skipped too:
    importing something the user deleted back to life isn't "the same
    content typed by hand," the bar every import here holds to.
  - **Format detection, both apps**: a picked file starting with `{` is
    tried against `parseBitwardenJson` first, then `parseProtonPassJson` —
    whichever throws "not a Bitwarden/Proton Pass export" is skipped in
    favor of the other; anything else falls back to the existing CSV path.
    No format picker in the UI — the same "just pick a file" flow as
    before, now reading three shapes instead of one.
  - **Extension**: new `lib/bitwardenImport.ts` / `lib/protonPassImport.ts`,
    following `lib/csvImport.ts`'s exact shape (`ImportResult`, one parse
    function). `popup/import-panel.ts`'s file input now accepts `.json`
    alongside `.csv`, and its preview-row `describe()` now labels a card
    (last four digits) and an identity (full name), not just a login/note.
  - **Mobile**: `lib/bitwardenImport.ts` / `lib/protonPassImport.ts`, ported
    from the extension's rather than shared (this repo's established
    pattern) and adapted to this app's `ItemContent`, where every field is
    optional. `ImportScreen.tsx`'s picker now also accepts
    `application/json`.
  - **Verified**: extension — `pnpm typecheck`/`lint`/`test` (319 tests, 23
    new) and `pnpm build`. Mobile — `tsc`, `eslint`, `jest` (40 tests, 23
    new), and `:app:assembleDebug` (full native build; no new native
    dependency this time). **Not verified against a real Bitwarden or
    Proton Pass export** — no account on either service was available this
    session, so both parsers are built and tested against fixtures matching
    the confirmed schema, not a file either service actually produced. A
    reasonable follow-up before relying on this for a real migration:
    generate one real export from each and run it through, especially for
    Bitwarden's card/identity mapping, which went further than what a
    single confirmatory source covers.
- **Encrypted backup/restore (extension + mobile)**, closing the gap
  local-only vault mode deliberately left open (the earlier local-only vault entry, and
  SECURITY.md's "No offsite backup"). No `pw-crypto-core` change at all:
  every field a backup needs — the wrapped vault key, its salt and costs,
  every item — is already a serializable, already-encrypted structure the
  crate produces; this is pure bundling at the application layer, not a new
  crypto format.
  - **The envelope**: `{kind: "vaultiq-backup", format, exportedAt, vault:
    {saltB64, memoryKib, iterations, parallelism, wrappedVaultKey},
    items}`, versioned from the first commit like every other persisted
    format. Both clients write the extension's flat layout
    (`vault.memoryKib`, `item_type`, `ciphertext`/`nonce` as byte arrays) and
    read either that or mobile's earlier nested layout; see ADR-1
    (`.design/adr/1-backup-envelope-canonical-shape.md`). No file-level
    encryption on top — every field is already ciphertext or a wrapped key
    at the same strength as at-rest storage, so a second KDF layer would
    protect nothing new; see
    SECURITY.md's new "An exported backup file" entry for the reasoning and
    the one real difference from at-rest storage (portability, not
    protection). Trashed-but-not-purged items are included (still real,
    restorable content); nothing is filtered or decrypted to build the file.
  - **Extension**: `vault.ts`'s `exportBackup`/`restoreBackup`, reusing
    `getVault`/`putVault`/`allItems`/`putItem` exactly as `create()` and
    `unlock()` already do. Export touches no key material and needs no
    unlock — it reads IndexedDB straight through, the same property the
    crypto core's "zero network calls" rule is stated for. Restore verifies
    the password by unwrapping the backup's own wrapped key before writing
    anything (`unwrapVaultKey(...).free()` pattern already used in
    `connectServer`), then leaves the vault unlocked exactly as `create`
    does, since the caller just proved they know the password. Local-only
    bookkeeping fields (`synced_version`, `conflict_of`) are stripped on
    export — they describe this device's relationship to a server, not the
    vault's content. Popup: "Export backup" in the overflow menu (a Blob +
    `<a download>`, no new dependency), and a third "Restore backup" tab
    alongside Create/Join on the welcome screen.
  - **Mobile** needed one new dependency mid-session: `@react-native-documents
    /picker`'s `saveDocuments()` only saves an *existing* source file, not
    raw bytes — unlike CSV import, which only ever needed to *read* a picked
    file — so writing one temp file first needed real filesystem access,
    which neither core React Native nor the picker package has. Checked npm
    directly rather than assuming (same discipline as the picker choice
    itself): the original `react-native-fs` was last published February
    2025 with uncertain New Architecture support; `@dr.pogodin/react-native-fs`
    is the actively-maintained fork and the current de facto choice for this
    exact reason. Exact-pinned `2.40.3`. `SettingsScreen.tsx`'s "Export
    backup" row writes to `RNFS.CachesDirectoryPath` (app-private, no storage
    permission needed at any Android version), hands that to
    `saveDocuments()` for the real "Save as" dialog, and removes the temp
    file whether the save succeeded, failed, or was cancelled.
  - **Mobile restore always lands as a local-only vault** (`mode: 'local'`),
    regardless of whether the backup's original vault was server-backed —
    simplest, fully symmetric with the extension, needs no invite token or
    network round trip, and is exactly what `createLocalVaultAndUnlock`
    already writes. `RestoreBackupScreen.tsx` is a fourth option on
    `GetStartedScreen` alongside join/create/create-local, reusing
    `@react-native-documents/picker`'s `pick()` + `fetch(uri).then(r =>
    r.text())` the same way `ImportScreen.tsx` already reads a CSV.
  - **Mobile export asymmetry, stated rather than papered over**: a
    local-only vault's export touches no key material either, reading
    `storage.readLocalItems()` straight through — but a server-backed
    vault's local cache (`storage.ts`'s `SyncCache`) is only ever
    *guaranteed* complete once something has actually caught it up, so
    `exportBackup()` calls the same `syncCiphertext` helper `pullItems()`
    uses first, which does need the vault unlocked and a network round
    trip. Not a bug — the alternative (trusting a cache that might be empty
    right after enrollment) would silently produce an incomplete backup.
  - **Verified**: extension — `pnpm typecheck`/`lint`/`test` (304 tests, 8
    new for `exportBackup`/`restoreBackup`: round-trip, no-key-material-
    touched, refuses-existing-vault, refuses-wrong-format, writes-nothing-
    on-wrong-password) and `pnpm build`. Mobile — `tsc`, `eslint`, jest (17
    tests, the existing suite unaffected — no vault.ts unit tests were added
    here, following this project's existing mobile convention of relying on
    `tsc`/`eslint`/on-device checks for `vault.ts` rather than a fakes-based
    unit layer like the extension's), and `:app:assembleDebug` (full native
    build, confirming the new dependency autolinks and compiles — only
    deprecation warnings from the library's own `AsyncTask` usage, not
    errors). **Not verified on a real device or in a real browser** — no
    physical device was connected and no headless Chromium was available
    this session, so the actual export → move-the-file → restore round trip
    hasn't been exercised end to end on either app, including whether
    Android's real "Save as" dialog behaves as expected against the
    app-private cache path.
- **Import de-duplication (extension + mobile)**, the follow-up the CSV
  importer entry above deferred. Every importer (CSV, Bitwarden JSON, Proton
  Pass JSON) still only ever produces `ItemContent` rows for the existing
  preview screen — this changes what that screen does with a row that looks
  like something already in the vault, not the parsers themselves.
  - **Two levels, not one flag**: an "identity" match (plausibly the same
    real-world login/card/identity/TOTP account/note, by the fields that
    actually name it — username+site for a login, digits-only card number,
    first+last name for an identity, issuer+account for TOTP, name or body
    for a note) and, within that, an "identical" match (every field an
    import can set agrees too). Only the identical case defaults to
    excluded ("auto-merge" in the sense that a byte-for-byte repeat of
    something already there doesn't clutter the list); a same-identity-
    different-content match (a password rotated since the export, say) is
    always surfaced, never silently skipped or overwritten — it defaults to
    **included, as a new item**, with a "Replace the existing entry instead
    of adding a new one" toggle so the user picks, rather than the importer
    guessing which copy is current.
  - **New module**, `extension/src/lib/importDedupe.ts` ported (not shared)
    to `mobile/src/lib/importDedupe.ts`, the same relationship every other
    importer file already has. `findMatch(item, existing)` returns the
    matched id (and, on mobile, its `version`, since `vault.updateItem`
    needs one and mobile's `DecryptedItem` carries it while the extension's
    background re-reads its own IndexedDB copy instead) plus a display
    label and the `identical` flag. Deliberately not `site.ts`'s
    public-suffix-aware `siteScope`/`tldts` for the login URL comparison —
    a light hostname strip instead: a dedup false-positive costs nothing
    worse than a badge on the wrong row, unlike the real trust boundary
    `site.ts` exists for, so it wasn't worth a second `tldts` dependency on
    mobile, which had never needed one.
  - **Popup/screen change**: both `import-panel.ts` and `ImportScreen.tsx`
    now fetch the existing vault (`listItems`/`vault.pullItems()`) once,
    right after parsing, before showing the preview list; trashed items are
    excluded from matching. Each row gets a caption when matched ("Already
    in your vault as …" or "Differs from existing …") and, for a differing
    match, the replace toggle. Import still goes through `addItem` for
    every row except an explicit replace, which calls `updateItem` on the
    matched id instead — an ordinary edit, same version-bump path
    everything else already uses, not a new write path.
  - **Verified**: extension — `pnpm typecheck`/`lint`/`test` (339 tests, 12
    new for `importDedupe.ts`) and mobile — `tsc`, `eslint`, jest (53
    tests, 13 new), and `:app:assembleDebug` (no new native dependency, so
    mostly confirming the JS bundle still compiles). **Not verified on a
    real device or in a real browser** — no physical device was connected
    and no headless Chromium was available this session, so the actual
    preview-list interaction (checkbox/replace-toggle behaviour, the
    caption text) hasn't been exercised end to end on either app.
- **Chrome support verified (extension).** The same `dist/` that Firefox loads
  runs in Chrome: Chrome 154 (Chrome for Testing, headless, driven over CDP)
  passed vault create/lock/unlock and restart persistence, all five item
  types, autofill and the save prompt on a real page (including refusing a
  different origin), service-worker kill and restart without losing the
  unlocked state, backup export/restore, CSV import, trash, PIN, auto-lock by
  alarm, master password change, and two-device sync against a real server.
  No code change was needed. **Not covered**: the real toolbar popup (the
  popup page was opened as a tab, so "Fill on this site" is unchecked),
  QR scanning, and any other Chromium browser.
- [SECURITY.md](SECURITY.md) holds the threat model. Keep it true: a change to
  what is defended against belongs in that file in the same commit.
- PROJECT.md said `pw-crypto-core/` was already scaffolded. It was not — the
  crate was created from scratch, with dependency versions looked up fresh
  against crates.io rather than taken from the doc.
- Cargo workspace at the repo root; one `Cargo.lock` for every crate. The
  extension and the server each have their own pnpm workspace and lockfile.
- Git repository initialized; `main` is the trunk; `origin` is
  `git@github.com:rustiqz/Vaultiq.git`. CI and release automation live in
  `.github/workflows/` — see [RELEASING.md](RELEASING.md).
- Toolchain: cargo/rustc 1.98.0, node 24, pnpm 11.3, git 2.55.0. The
  `wasm32-unknown-unknown` target is required for the `wasm` feature (Arch:
  `rust-wasm`), and `wasm-pack` for the extension's bundle and browser tests.



---
