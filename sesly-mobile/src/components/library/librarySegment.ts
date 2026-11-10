/**
 * Which segment of the Kütüphane tab to show next.
 *
 * The tab route takes no params, so another screen that wants the saved list
 * (the "Göster" action of the "kaydedildi" snackbar, "Tümü" on the saved
 * shelf) asks for it here right before navigating:
 *
 *   requestLibrarySegment('saved');
 *   navigation.navigate('Main', { screen: 'Library' });
 *
 * The library applies the request at once when it is mounted, else when it
 * mounts or gains focus.
 */

export type LibrarySegment = 'mine' | 'saved';

type Listener = (segment: LibrarySegment) => void;

let pending: LibrarySegment | null = null;
const listeners = new Set<Listener>();

/** Ask the Kütüphane tab to show `segment` the next time it is on screen. */
export function requestLibrarySegment(segment: LibrarySegment): void {
  if (listeners.size === 0) {
    pending = segment;
    return;
  }
  pending = null;
  listeners.forEach(listener => listener(segment));
}

/** The request that is waiting, if any. Reading it clears it. */
export function consumeLibrarySegmentRequest(): LibrarySegment | null {
  const segment = pending;
  pending = null;
  return segment;
}

/** Called by the library while it is mounted. Returns the unsubscribe function. */
export function subscribeLibrarySegment(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
