/**
 * The player shows a story's content note ("3-6 yaş için. Korkutucu bir
 * sahne içeriyor.") once per narration: the first time that narration's
 * player opens. Which narrations have shown it is kept on the device
 * (AsyncStorage, the newest 300), best effort: a storage failure only means
 * the note may show again.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const CONTENT_NOTICE_STORAGE_KEY = '@sesly/content-notice-seen';
export const CONTENT_NOTICE_LIMIT = 300;

let seen: string[] | null = null;
let loading: Promise<string[]> | null = null;

async function load(): Promise<string[]> {
  if (seen) return seen;
  if (!loading) {
    loading = AsyncStorage.getItem(CONTENT_NOTICE_STORAGE_KEY)
      .then(raw => {
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        seen = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
        return seen;
      })
      .catch(() => {
        seen = [];
        return seen;
      });
  }
  return loading;
}

/**
 * True the first time it is asked for a narration, false afterwards (also
 * after a restart). Marks the narration as shown.
 */
export async function takeContentNotice(narrationId: string): Promise<boolean> {
  if (!narrationId) return false;
  const list = await load();
  if (list.includes(narrationId)) return false;
  seen = [...list, narrationId].slice(-CONTENT_NOTICE_LIMIT);
  AsyncStorage.setItem(CONTENT_NOTICE_STORAGE_KEY, JSON.stringify(seen)).catch(() => {});
  return true;
}

/** Tests only. */
export function resetContentNoticeForTests(): void {
  seen = null;
  loading = null;
}
