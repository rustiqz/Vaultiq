# Install the browser extension

One build works in both Firefox and Chrome. There is no store listing yet, so
you build it from source.

## Build it

You need Rust (with the `wasm32-unknown-unknown` target), `wasm-pack`, Node 24
and pnpm.

```bash
git clone https://github.com/rustiqz/Vaultiq.git
cd Vaultiq/extension
pnpm install
pnpm run build        # output in extension/dist
```

## Install the signed build in Firefox

Each release carries `vaultiq-extension-X.Y.Z.xpi`, signed by Mozilla for
self-distribution. Download it from the release page, check it against
`SHA256SUMS`, then open the file in Firefox (or drag it onto the window) and
accept the prompt. It stays installed across restarts. It does not update
itself; install the next release's `.xpi` over it.

## Load it in Firefox without signing

1. Open `about:debugging`.
2. Choose **This Firefox**, then **Load Temporary Add-on**.
3. Pick `extension/dist/manifest.json`.

Temporary add-ons are removed when Firefox restarts, so you repeat this after
each restart.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and pick the `extension/dist` folder.

Other Chromium browsers are untested.

## First run

Open the Vaultiq toolbar popup and choose **Create your vault**. Pick a master
password and decide whether to use the vault [without a server](getting-started.md).

If you already have a vault on a server, use **Join with a token** instead; see
[Connect your devices](server/connect-devices.md). If you have an exported
backup, use the **Restore backup** tab on the welcome screen.
