/**
 * Session bridge without Firebase.
 *
 * The audio store, the queue and other per-user state need to know who is
 * signed in and when a session ends, but must not import `useAuth` (it pulls
 * in Firebase and would create import cycles). AuthStore writes the current
 * backend user id here on every change and runs the end handlers on sign-out
 * and session expiry, before it clears the user.
 */

type UserChangeListener = (userId: string | null) => void;
type SessionEndHandler = () => void | Promise<void>;

let currentUserId: string | null = null;
const userListeners = new Set<UserChangeListener>();
// Insertion order is the run order (a Set iterates in insertion order).
const endHandlers = new Set<SessionEndHandler>();

/** Called by AuthStore wherever `backendUser` is set or cleared. */
export function setSessionUserId(id: string | null): void {
  const next = id || null;
  if (next === currentUserId) {
    return;
  }
  currentUserId = next;
  // Copy: a listener may unsubscribe itself while being notified.
  [...userListeners].forEach(listener => {
    try {
      listener(next);
    } catch (error) {
      console.warn('[session] user change listener failed:', error);
    }
  });
}

export function getSessionUserId(): string | null {
  return currentUserId;
}

/** Fires only when the id actually changes. Returns an unsubscribe. */
export function onSessionUserChange(listener: UserChangeListener): () => void {
  userListeners.add(listener);
  return () => {
    userListeners.delete(listener);
  };
}

/**
 * Work that must finish before the signed-in user is cleared (stop playback,
 * drop the queue, turn the sleep timer off). Returns an unregister.
 */
export function registerSessionEndHandler(handler: SessionEndHandler): () => void {
  endHandlers.add(handler);
  return () => {
    endHandlers.delete(handler);
  };
}

/**
 * Runs every end handler in registration order, awaiting each one. A failing
 * handler is logged and the rest still run. Never throws.
 */
export async function runSessionEndHandlers(): Promise<void> {
  for (const handler of [...endHandlers]) {
    try {
      await handler();
    } catch (error) {
      console.warn('[session] end handler failed:', error);
    }
  }
}

/** Test-only: forget the user, the listeners and the handlers. */
export function resetSessionForTests(): void {
  currentUserId = null;
  userListeners.clear();
  endHandlers.clear();
}
