# Install the browser extension

One build works in both Firefox and Chrome. Every
[release](https://github.com/rustiqz/Vaultiq/releases/latest) carries it as a
download, so you do not need to build anything.

Check any download against `SHA256SUMS` from the same release:

```bash
sha256sum --ignore-missing -c SHA256SUMS
```

## Firefox

Download `vaultiq-extension-X.Y.Z.xpi` from the latest release. It is signed
by Mozilla for self-distribution. Open the file in Firefox (or drag it onto the
window) and accept the prompt. It stays installed across restarts.

It updates itself: Firefox checks the release feed about once a day and
installs a newer signed build. To check right away, open `about:addons`, click
the gear and choose **Check for Updates**. This is the one network request
outside your own server; see the [FAQ](faq.md).

## Chrome

Download `vaultiq-extension-X.Y.Z.zip` from the latest release and unzip it.

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and pick the unzipped folder.

Chrome does not update an unpacked extension. To upgrade, unzip the new
release over the same folder and press the reload icon on the extension's card.
Other Chromium browsers are untested.

## Build it from source

You need Rust (with the `wasm32-unknown-unknown` target), `wasm-pack`, Node 24
and pnpm.

```bash
git clone https://github.com/rustiqz/Vaultiq.git
cd Vaultiq/extension
pnpm install
pnpm run build        # output in extension/dist
```

Load `extension/dist` as unpacked in Chrome as above. In Firefox, a build from
source can only be loaded as a temporary add-on: open `about:debugging`, choose
**This Firefox** then **Load Temporary Add-on**, and pick
`extension/dist/manifest.json`. It is removed when Firefox restarts and never
updates itself.

## First run

Open the Vaultiq toolbar popup and choose **Create your vault**. Pick a master
password and decide whether to use the vault [without a server](getting-started.md).

If you already have a vault on a server, use **Join with a token** instead; see
[Connect your devices](server/connect-devices.md). If you have an exported
backup, use the **Restore backup** tab on the welcome screen.
