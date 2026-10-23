# Third-party notices

## Fonts

The extension popup, the Android app and the landing page bundle Archivo,
IBM Plex Mono and Space Grotesk, unmodified, under the SIL Open Font License
1.1. The copyright lines and the full license text sit next to the font files:

- `extension/src/popup/fonts/OFL.txt`
- `mobile/android/app/src/main/assets/fonts/OFL.txt`
- `site/assets/fonts/OFL.txt`

## Word list

The passphrase generator draws from the Electronic Frontier Foundation's long
word list (7,776 words), unmodified, under the Creative Commons Attribution 3.0
United States license
(<https://creativecommons.org/licenses/by/3.0/us/>). Source:
<https://www.eff.org/dice>. The file, its source and its SHA-256 are in
`pw-crypto-core/src/wordlist/`; a test pins the hash.

## Code dependencies

Dependencies keep their own licenses. `deny.toml` restricts the Rust
dependency licenses CI will accept.
