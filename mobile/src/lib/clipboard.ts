import Clipboard from '@react-native-clipboard/clipboard';

/**
 * Copying a secret, and taking it back -- the mobile analogue of
 * extension/src/lib/clipboard.ts. A password left on the clipboard is
 * readable by any other app on the device (and, on some setups, synced
 * elsewhere), so a copy here is always a *timed* copy.
 */
export const CLIPBOARD_SECONDS = 30;

let pending: ReturnType<typeof setTimeout> | undefined;

/** Clears the clipboard only if it still holds what was copied. */
async function clearIfUnchanged(value: string): Promise<void> {
  try {
    const current = await Clipboard.getString();
    if (current === value) Clipboard.setString('');
  } catch {
    // Reading the clipboard can be refused. Clearing blind would wipe
    // something the user copied since, so leaving it is the safer miss.
  }
}

/**
 * Copies text, then clears it again.
 *
 * The clear only fires if nothing else has been copied since -- overwriting
 * whatever the user copied in the meantime would be its own small betrayal.
 */
export async function copyForAWhile(value: string): Promise<void> {
  Clipboard.setString(value);

  if (pending !== undefined) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = undefined;
    clearIfUnchanged(value);
  }, CLIPBOARD_SECONDS * 1000);
}
