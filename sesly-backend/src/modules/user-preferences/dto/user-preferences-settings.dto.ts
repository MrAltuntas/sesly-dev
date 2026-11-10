/**
 * Documentation-only type for the `settings` JSON bucket.
 *
 * The runtime service does NOT strictly validate this shape — `settings` is
 * intentionally a forward-compatible free-form object so the mobile app can
 * ship new keys without a backend deploy. This type captures the keys that
 * are currently blessed so editors/autocomplete and future typed clients
 * have something to target.
 *
 * If you add a key here, also bump the mobile client's matching type in
 * `sesly-mobile/src/services/UserService.ts` (or wherever preferences
 * are typed) to keep the two sides in sync.
 */
export interface UserPreferencesSettings {
  /** "light" | "dark" | "system" — default "system" */
  theme?: 'light' | 'dark' | 'system';

  /** Mobile UI language — default "tr" */
  language?: 'tr' | 'en';

  /** Playback speed multiplier, 0.8 - 1.5, default 1.0 */
  playbackSpeed?: number;

  /** Whether the player auto-advances to the next story in the queue */
  autoplayNextStory?: boolean;
}
