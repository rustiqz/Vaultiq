# Vaultiq — Working Rules

Rules for implementing the design in [PROJECT.md](PROJECT.md). PROJECT.md is
*what* we build; this file is *how*. Where they conflict, PROJECT.md wins on
design, this file wins on process.

This is a zero-knowledge password manager. The cost of a mistake here is not
a bug report — it is someone's entire credential set. Slow and correct beats
fast and clever, every time.

---

## 0. Current state (keep this section accurate)

- **Phases 1–3 are complete.** The crypto core, the browser extension and the
  sync server all build, test and lint clean.
  - `pw-crypto-core/` — key derivation, vault key wrapping, item encryption and
    the wasm bindings, pinned by known-answer vectors cross-computed with
    OpenSSL and libsodium.
  - `extension/` — Firefox Manifest V3: vault UI, autofill, capture, quick
    unlock by PIN, per-device audit trail, sync, master password change, and
    all five item types (login, card, identity, authenticator, secure note).
  - `server/` — NestJS + PostgreSQL: device authentication, enrolment tokens,
    revocation, item sync with version-based optimistic concurrency, and the
    Docker/Caddy deployment.
- **Phase 4 is underway**: native mobile over the same Rust core via FFI.
  `pw-crypto-core/src/ffi.rs` (behind the `ffi` feature) mirrors `wasm.rs` for
  Kotlin/Swift via `uniffi`, generating the same opaque-handle contract the
  wasm bindings use. §4.2 forecast this as "the first `unsafe` in the repo,
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
    exports instead (delivered as `~/Downloads/screen-*.svg`, rasterized
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
    into the AEAD), and delete is a tombstone — content replaced with
    `{"purged": true}`, `deleted: true` — the mobile analogue of the
    extension's `purgeItem`. There's no separate soft-delete/trash screen
    here, so unlike the extension's two-stage trash-then-purge, this is the
    only kind of delete: permanent, with a confirmation dialog first.
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
      it's explicitly on this file's forever-deferred list (§1.3: "Sharing,
      recovery flows, passkeys, import, breach checking — not now, not
      partially"). Deliberately not building even the visual component for
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
  - **Explicitly declined**: breach-checking. It's on §1.3's forever-deferred
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
    breach-checking (§1.3, forever-deferred, unrelated to this feature but
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
- [SECURITY.md](SECURITY.md) holds the threat model. Keep it true: a change to
  what is defended against belongs in that file in the same commit.
- PROJECT.md said `pw-crypto-core/` was already scaffolded. It was not — the
  crate was created from scratch, with dependency versions looked up fresh
  against crates.io rather than taken from the doc.
- Cargo workspace at the repo root; one `Cargo.lock` for every crate. The
  extension and the server each have their own pnpm workspace and lockfile.
- Git repository initialized; `main` is the trunk; `origin` is
  `git@github.com:rustiqz/Vaultiq.git`. CI and release automation live in
  `.github/workflows/` — see §8.
- Toolchain: cargo/rustc 1.98.0, node 24, pnpm 11.3, git 2.55.0. The
  `wasm32-unknown-unknown` target is required for the `wasm` feature (Arch:
  `rust-wasm`), and `wasm-pack` for the extension's bundle and browser tests.

Update this section when it stops being true.

---

## 1. Scope discipline

1. **Build phases in order.** Phase 1 (crypto core) must build, test, and
   lint clean before any extension, server, or mobile code exists. No
   "while I'm here" scaffolding of later phases.
2. **The design is settled.** Do not re-litigate Argon2id, XChaCha20-Poly1305,
   the vault-key indirection, or the data model. If something is genuinely
   unworkable, stop and explain why *before* deviating — never silently
   substitute an approach.
3. **Deferred means deferred.** Sharing, recovery flows, passkeys, import,
   breach checking — not now, not partially, not "just the types for later".
   Item types beyond login and TOTP were on this list until phases 1–3 were
   done end to end, which was the condition PROJECT.md set for them; they
   have since been built. Nothing else has moved.
4. **No shortcuts justified by "it's only me".** Single-user today does not
   license plaintext metadata, skipped auth separation, or hardcoded paths.

---

## 2. Secrets: never leak, never commit, never log

This is the section that matters most.

### 2.1 Never commit
- No real passwords, master passwords, vault exports, or `.env` files.
- No private keys, certificates, API tokens, or server credentials.
- No database dumps, sync payloads, or captured HTTP bodies.
- No personal vault data of any kind, encrypted or not.

Every commit gets `git diff --staged` reviewed before it happens. Never
`git add -A` / `git add .` without reading what it staged.

### 2.2 If a secret does get committed
Treat it as **compromised, permanently**. Rotate the secret first, then clean
history. Amending the commit is not a fix — assume it was already read.

### 2.3 Never log
- No key material — master key, vault key, auth key, stretched key, wrapped
  key bytes.
- No plaintext item content, no master password, no password-derived value.
- No "just the first 8 bytes" of anything secret. Prefixes are secrets.

Secret types must have a **hand-written `Debug`** that prints a redacted
placeholder (e.g. `MasterKey([REDACTED])`). Never `#[derive(Debug)]` on a
type holding key material. Never `#[derive(Serialize)]` on one either —
serializing a key is a bug, and the compiler should be the one to catch it.

### 2.4 Never reveal through errors
Per PROJECT.md: wrong password, tampered ciphertext, wrong key, and truncated
input all return the **same** `DecryptionFailed`. No context, no source error
chained in, no distinct message. This holds especially at trust boundaries —
WASM return values, FFI, and (later) API responses.

Detailed diagnostics may exist behind a debug-only, client-side-only path.
They must never be reachable from the WASM/FFI surface.

### 2.5 Never send outward
- The crypto core makes **zero network calls**. Ever. No telemetry, no
  crash reporting, no update checks.
- Don't paste project files, vault data, or real passwords into external
  services, pastebins, or issue trackers.
- Ask before pushing anything to a remote, publishing a crate, or uploading
  build artifacts.

### 2.6 Test data is fake and obviously so
Fixtures use values like `"correct horse battery staple"` and all-zero or
counting byte arrays, with a comment marking them test-only. Never use a
real password as a test vector, even once, even locally.

---

## 3. Git rules

1. **Commit only when asked.** Don't auto-commit after edits.
2. **Never commit directly to `main`.** Branch as
   `phase1/kdf`, `phase1/keys`, `fix/nonce-reuse`, `chore/deps`.
3. **Atomic commits.** One logical change. A commit that touches `kdf.rs`
   and adds a README section is two commits.
4. **Conventional commit subjects**, imperative, ≤72 chars:
   `feat(kdf): derive MasterKey via Argon2id`,
   `fix(vault_item): reject reused nonce`,
   `test(keys): add wrap/unwrap round-trip`,
   `chore(deps): pin chacha20poly1305 0.10`.
   Body explains *why*, not what the diff already shows. Security-relevant
   commits state the threat they address.
5. **Never force-push a shared branch.** Never rewrite pushed history.
6. **Never `--no-verify`.** If a hook fails, fix the cause.
7. **Green before commit.** `fmt`, `clippy -D warnings`, and `test` all pass
   (see §6). A commit that doesn't build is not a commit.
8. **Commit `Cargo.lock`.** This is a security product; reproducible
   dependency resolution is part of the threat model.
9. **Never commit build output** — `target/`, `pkg/`, `node_modules/`,
   `dist/`, `*.wasm`. See `.gitignore`.
10. **Never tag by hand.** Tags and releases are produced by git-cliff from
    the commit subjects. See §8.
11. Dependency bumps are their own commits, never bundled into feature work.

---

## 4. Crypto implementation rules

1. **Never write a primitive.** No hand-rolled KDF, cipher, MAC, or padding.
   Vetted crates only, used through their documented high-level API.
2. **`#![forbid(unsafe_code)]`** in the core crate. When FFI later requires
   `unsafe`, it lives in a separate, minimal, documented module — never in
   `kdf`/`keys`/`vault_item`.
3. **No panics in library code.** No `unwrap`, `expect`, `panic!`, `todo!`,
   slice indexing, or integer-overflow-prone arithmetic outside `#[cfg(test)]`.
   Every failure is a `CryptoError`. A panic in a crypto path is a side
   channel and a DoS.
4. **Randomness only from `OsRng`.** Never `thread_rng` for key material,
   never a seeded RNG outside tests, never a counter or timestamp as a nonce.
5. **Fresh random nonce per encryption**, generated internally. Callers must
   not be able to supply a nonce for encryption. Nonce reuse under a single
   key is catastrophic for XChaCha20-Poly1305 — the API shape should make it
   impossible, not merely discouraged.
6. **Constant-time comparison** (`subtle`) for anything derived from a
   secret. Never `==` on key bytes, tags, or auth values.
7. **Zeroize everything secret.** `MasterKey`, `VaultKey`, `AuthKey`,
   `StretchedEncryptionKey`, decrypted plaintext buffers, and any
   intermediate derivation output implement `ZeroizeOnDrop`. Avoid `Clone`
   on secrets; each clone is another copy to scrub.
8. **Domain separation is explicit.** Auth key and stretched encryption key
   come from HKDF with distinct, versioned `info` strings — never from
   splitting or truncating one output. Keep those constants in one place
   (`keys.rs`) so drift is visible in a diff.
9. **Version every persisted format.** Wrapped vault keys, encrypted items,
   and KDF parameter records carry an explicit version/format field from the
   first commit. Retrofitting a version byte later means a migration on
   real user data.
10. **Store KDF parameters alongside the vault**, don't hardcode them at the
    read path. Argon2 costs must be raisable later without breaking existing
    vaults.
11. **Bind context into AEAD associated data** where it prevents blob
    swapping (e.g. item `id` and `version` as AAD on `encrypt_item`), so a
    substituted ciphertext fails authentication rather than decrypting.
12. **Validate all input lengths** before use — salts, nonces, keys, base64
    decode results. Return `InvalidInput`, never index blindly.
13. **The WASM layer is a marshalling layer only.** No crypto decisions, no
    branching on error kind, no extra error detail crossing into JS.

Changing any algorithm, key-derivation input, `info` string, or serialized
format after data exists is a **breaking, data-affecting change** — raise it
before implementing.

---

## 5. Dependency rules

1. Minimal surface. Every new dependency needs a stated reason.
2. Pin exact versions; no wildcards, no `*`, no loose `>=`.
3. Prefer RustCrypto / well-audited crates for anything security-relevant.
4. Run `cargo audit` (and `cargo deny` if configured) before adding or
   bumping, and read the changelog on bump — never bump blind.
5. `default-features = false` where practical; pull in only what's used.
6. No dependency that performs I/O, networking, or process spawning in the
   crypto core.

---

## 6. Verification — required before every commit

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo build --features wasm          # WASM feature must compile
cargo audit                          # when available
```

Testing requirements (from PROJECT.md, plus):
- Round trips: encrypt→decrypt, wrap→unwrap.
- Same salt + same password → same key; different salt → different key.
- Tampering with any ciphertext byte, nonce byte, or tag byte → failure.
- Wrong `VaultKey` → failure.
- All failure modes above return the *same* error variant (assert this
  explicitly — it's a security property, so it gets a test).
- Property tests (`proptest`) over arbitrary plaintext, including empty
  input and large input.
- **Known-answer tests**: pin fixed (password, salt, params) → expected key
  bytes, and fixed key + nonce + plaintext → expected ciphertext. These are
  what catch a refactor silently changing derivation.
- Tests must not print secret material on failure.

**Never report a test as passing without having run it.** If something
fails, say so and show the output.

---

## 7. Working process

1. Read the relevant PROJECT.md section before writing the module.
2. One module at a time, with its tests, building green before moving on.
3. Ask before: changing crypto choices, changing the key hierarchy, changing
   a serialized format, adding a dependency, initializing/pushing to a
   remote, or expanding beyond the current phase.
4. Don't narrow scope silently. If part of a task is blocked, finish the
   rest and say exactly what was left out and why.
5. Security-relevant reasoning goes in the code as a comment where a future
   reader would otherwise be tempted to "simplify" it away.
6. Keep a `SECURITY.md` with the threat model once the core lands — what the
   design defends against (compromised server, stolen ciphertext, tampered
   blobs) and what it does not (compromised client, keylogger, weak master
   password).

---

## 8. CI and releases

### 8.1 What runs, and when

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` → `gate` | every PR, push to `main` | fmt, clippy `-D warnings`, tests, WASM feature build |
| `ci.yml` → `commit-messages` | PRs only | rejects malformed commit subjects |
| `ci.yml` → `release` | push to `main`, **after `gate` passes** | tags and cuts the GitHub release |
| `audit.yml` | dependency changes, weekly cron, manual | `cargo audit` against the RustSec advisory database |

Release is a job inside `ci.yml`, not its own workflow, so `needs: gate` can
guarantee ordering. As a separate workflow it would run *in parallel* with the
checks, and a broken build could be tagged.

The weekly cron on `audit.yml` is the point of it: an advisory can land
against a dependency nobody touched.

### 8.2 Commit subjects decide the version

Version numbers are not edited by hand. git-cliff reads the
conventional-commit subjects since the last tag and derives the bump. A
malformed subject is therefore not a style problem — it silently produces the
wrong release, which is why `ci.yml` rejects one.

The mapping lives in `cliff.toml`: `commit_parsers` decides the changelog
section, `[bump]` decides the version.

| Subject | Changelog section | Bump while `0.x` | Bump at `1.0`+ |
|---|---|---|---|
| `feat:` | Added | minor | minor |
| `fix:` | Fixed | patch | patch |
| `perf:` | Performance | patch | patch |
| `refactor:` | Changed | patch | patch |
| `revert:` | Reverted | patch | patch |
| `docs:` `test:` `build:` `ci:` | own sections | patch | patch |
| `chore(deps):` | Dependencies | patch | patch |
| `feat!:` or `BREAKING CHANGE:` footer | Breaking | **minor** | **major** |
| `chore:` `style:` | hidden | none | none |

Note the `0.x` column: while the version is below `1.0`, a breaking change
bumps the *minor*, per SemVer. That changes the day `1.0.0` ships.

**Breaking, here, means data.** A change to an HKDF `info` string, a KDF
parameter default, an AAD layout or a serialized format makes existing vaults
undecryptable. That is a breaking change even when the Rust API is untouched,
and it must carry `!` or a `BREAKING CHANGE:` footer.

### 8.3 Two levels of version

The **product version** is the git tag. It moves on any releasable change
anywhere in the repo, and it is what a GitHub release is named after.

Each **component** carries its own version, which moves only when that
component's shipped artifact changes:

| Component | Version lives in |
|---|---|
| `pw-crypto-core` | `pw-crypto-core/Cargo.toml` |
| `extension` | `extension/package.json`, copied into `manifest.json` at build |
| `server` | `server/package.json`, copied into the image and reported at boot |

All three come from the same commits and the same tags, computed by
`scripts/component-versions.sh`: a component that changed since the last tag
takes the version being cut, and one that did not keeps the version of the
release that last carried it — the earliest tag containing its most recent
change.

That rule replaced a path-filtered `git cliff --bumped-version`, which was
quietly wrong. Filtering the history to one component also filters out the
`chore(release)` commits the tags sit on, so every release since that
component's last change vanished from the filtered view and the answer came
back a version or more behind. The core and the extension were spared only
because the release commit happens to write their manifests; the server, which
it did not, resolved to `v0.17.0` for code that shipped in `v0.18.0`.
The release job writes them **before** it tags, so a tagged tree states the
truth about what it contains.

A component's paths cover everything that lands in its artifact, not just its
own directory. The extension bundles the crypto core as wasm, so a core-only
change moves the extension's version too — otherwise two different builds
would claim to be the same version. The server is the opposite case: it stores
ciphertext and never opens it, so it bundles no crypto core and its paths are
exactly `server/**`.

A component that ships an artifact but is not in this table has no version at
all — its manifest keeps whatever it was scaffolded with, and a deployed build
cannot say what it is. That was true of the server between phase 3 and
`v0.19.0`; check this table when a new component lands.

One consequence: component numbers share the product's tag stream, so
`extension 0.3.1` can ship inside product `v0.3.2`. The versions stored in the
tree are the answer to "what is in this release"; the release notes carry the
same table. Give components their own tags (`extension-v0.3.1`) when one needs
a release cadence of its own.

Never edit either version by hand — the next release overwrites both.

### 8.4 Release flow

1. Open a PR. `gate` and `commit-messages` run on it.
2. Merge into `main`. `gate` runs again on the merge commit.
3. Only if it passes, `release` computes the next version with
   `git cliff --bumped-version`.
4. If nothing since the last tag is releasable — only `chore:` and `style:` —
   the job exits quietly. Otherwise it writes the component versions (§8.3),
   commits them as `chore(release): ... [skip ci]`, tags `vX.Y.Z` on that
   commit, pushes both, and cuts a GitHub release with notes generated from
   the commit subjects.

**Merging two PRs close together starts two release jobs**, and the slower one
would be rejected when it pushes, because `main` has moved. The concurrency
group does not prevent this — it serialises the jobs, not the branch. The job
therefore checks whether `main` has moved past the commit it was started for
and stands aside if so. Nothing is lost: git-cliff computes from the last tag,
so the newer run's release contains the older one's commits too. A skipped
release job with "main has moved past …" in its log is working as intended.

Because the release is cut straight from `main`, **the commit message is the
last chance to catch a mistyped change** — there is no release PR to review
before the tag lands. A key-derivation change typed as `fix:` releases as a
patch. Get the subject right in the PR.

There is deliberately **no `CHANGELOG.md`** in the repo: the GitHub Releases
page is authoritative, and a committed copy would either go stale or force CI
to push commits back to `main`. Regenerate one whenever it is useful:

```bash
git cliff -o CHANGELOG.md     # full history
git cliff --unreleased        # what the next release would contain
```

The product version lives only in git tags. Component versions *are* written
into `Cargo.toml` and `package.json` by the release job — see §8.3 — and must
not be edited by hand.

### 8.5 Branch protection

`main` is **not** protected server-side. GitHub gates both classic branch
protection and rulesets behind a paid plan for private repositories, and this
repo is private on a free account — both API endpoints return
`403 Upgrade to GitHub Pro or make this repository public`.

Standing in for it, two hooks in `.githooks/`:

- **`pre-commit`** refuses to commit while `main` is checked out, catching the
  mistake at the moment it happens rather than at push time.
- **`pre-push`** refuses direct pushes and force-pushes to `main`, letting
  branches and tags through so CI can still push release tags.

Both are guard rails on one machine, not controls — `--no-verify` walks past
either, which §3.7 forbids. Neither runs in CI, because hooks only fire when
`core.hooksPath` is set and a fresh checkout never sets it; that is what
leaves the release job free to make its own `chore(release):` commit on
`main`. Enable them after cloning:

```bash
git config core.hooksPath .githooks
```

**When the repo goes public** (or gets a Pro plan), replace it with the real
thing. The check names below are exact — a typo means the check never matches
and every PR blocks forever:

```bash
gh api -X PUT repos/rustiqz/Vaultiq/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["fmt · clippy · test · wasm", "conventional commits"]
  },
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "enforce_admins": false,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

Two traps in that payload:

- **`required_approving_review_count` must be 0** while this is a solo
  project. GitHub forbids approving your own PR, so any higher number locks
  you out of your own repository.
- **Never require `Tag and release`.** It only runs on push to `main`, never
  on a PR, so requiring it leaves every PR waiting on a check that cannot
  arrive.

### 8.6 Other settings that are not in this repo

- **Settings → Actions → General → "Allow GitHub Actions to create and
  approve pull requests"** is enabled. Releases no longer need it, but leave
  it on.
- The default `GITHUB_TOKEN` does not trigger workflows on PRs it creates. Not
  currently relevant — releases are cut directly rather than via a PR — but it
  matters if that ever changes.
