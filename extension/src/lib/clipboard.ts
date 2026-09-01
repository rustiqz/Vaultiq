// Copying a secret, and taking it back.
//
// A password left on the clipboard is readable by every application on the
// machine, and on some setups is synced to other devices. So a copy here is
// always a *timed* copy: it goes back to whatever was there before, or to
// nothing, after a short window.

/** How long a copied secret stays on the clipboard. */
export const CLIPBOARD_SECONDS = 30;

let pending: ReturnType<typeof setTimeout> | undefined;

/**
 * Copies text, then clears it again.
 *
 * The clear only fires if nothing else has been copied since — overwriting
 * whatever the user copied in the meantime would be its own small betrayal.
 */
export async function copyForAWhile(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);

  if (pending !== undefined) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = undefined;
    void (async () => {
      try {
        const current = await navigator.clipboard.readText();
        if (current === value) await navigator.clipboard.writeText("");
      } catch {
        // Reading the clipboard can be refused. Clearing blind would wipe
        // something the user copied since, so leaving it is the safer miss.
      }
    })();
  }, CLIPBOARD_SECONDS * 1000);
}
