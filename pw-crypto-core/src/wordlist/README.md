# Word list

`eff_large_wordlist.txt` is the Electronic Frontier Foundation's long word
list for dice-generated passphrases, unmodified.

- Source: <https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt>
  (see <https://www.eff.org/dice>)
- Licence: Creative Commons Attribution 3.0 United States
  (<https://creativecommons.org/licenses/by/3.0/us/>). Attribution: Electronic
  Frontier Foundation.
- 7,776 words, one per line, each preceded by its five-dice code and a tab.
- SHA-256: `addd35536511597a02fa0a9ff1e5284677b8883b83e986e43f15a3db996b903e`

The hash is pinned by a test in `src/passphrase.rs`, so a changed list fails
the build instead of quietly changing how strong every passphrase is. The
entropy figure the crate reports (about 12.92 bits per word) is only true for
exactly this list.

Replacing the list is a data-affecting decision: nothing stored depends on it,
but the strength claims in the UI and in `SECURITY.md` do.
