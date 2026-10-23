/**
 * "Something arrived from another device": a way for the code that fetches it
 * to tell the screens that show it, without either knowing about the other.
 *
 * A screen that is on top subscribes while it is, and re-reads when told.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Calls `listener` whenever new data has arrived. Returns how to stop. */
export function onRemoteChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tells every subscriber. One that throws does not stop the others hearing. */
export function announceRemoteChange(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A broken screen must not keep the rest of the app from refreshing.
    }
  }
}
