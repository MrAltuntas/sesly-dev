/**
 * Firebase Auth for the email action page (/auth/action) only. The page is a
 * lazy route, so this module and the Firebase SDK load nowhere else.
 *
 * The config comes from the build-time Vite variables. Firebase puts the
 * project's web API key into every action link (`apiKey`), so that value is
 * the fallback when the build carries no key. The web config is public by
 * design (it ships in every client), it is not a secret.
 *
 * In-memory persistence: the action handlers never sign anyone in, so nothing
 * is written to IndexedDB or localStorage.
 */
import { getApp, getApps, initializeApp } from 'firebase/app';
import { type Auth, inMemoryPersistence, initializeAuth } from 'firebase/auth';

const APP_NAME = 'sesly-auth-action';

let cached: Auth | null = null;

export function getActionAuth(linkApiKey: string | null): Auth | null {
  if (cached) return cached;

  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY || linkApiKey || '';
  if (!apiKey) return null;

  const app = getApps().some((a) => a.name === APP_NAME)
    ? getApp(APP_NAME)
    : initializeApp(
        {
          apiKey,
          authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || undefined,
          projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || undefined,
        },
        APP_NAME,
      );

  cached = initializeAuth(app, { persistence: inMemoryPersistence });
  return cached;
}
