/**
 * Why the last story start failed (the audio store's `loadError`).
 *
 *   - notFound: the narration is gone (deleted, or replaced by a regenerate);
 *   - audioRemoved: the narration still exists but is not READY (an admin
 *     removed its audio, for example after the story's segments were
 *     edited); it has to be created again from the story page;
 *   - loadFailed: the start itself failed (network, player);
 *   - streamFailed: the loaded story's stream would not play.
 *
 * Kept apart from the store so the queue, the continue card and their tests
 * read it without the player module.
 */
export type LoadError = 'notFound' | 'audioRemoved' | 'loadFailed' | 'streamFailed';

/**
 * A narration that cannot play at all (gone, or its audio removed): the
 * queue skips it and the continue card forgets it. A retry never helps.
 */
export function isUnplayableLoadError(
  error: LoadError | null | undefined,
): error is 'notFound' | 'audioRemoved' {
  return error === 'notFound' || error === 'audioRemoved';
}
