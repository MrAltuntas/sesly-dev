/**
 * Whose downloaded narrations are on the device.
 *
 * The audio cache can hold the previous account's own-voice narrations. It is
 * wiped when a different user signs in, in the background: sign-in never
 * waits for it. Covers are public, so the image cache stays.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import CacheService from '../services/CacheService';

export const LAST_USER_ID_STORAGE_KEY = '@sesly/lastUserId';

/**
 * Records `userId` as the cache owner. When the stored owner is someone else
 * (or nobody), the audio cache is cleared without being awaited. Never throws.
 */
export async function claimCacheOwner(userId: string): Promise<void> {
  try {
    const previous = await AsyncStorage.getItem(LAST_USER_ID_STORAGE_KEY);
    if (previous === userId) {
      return;
    }
    void CacheService.clearAudioCache().catch(error => {
      console.warn('[cacheOwner] audio cache clear failed:', error);
    });
    await AsyncStorage.setItem(LAST_USER_ID_STORAGE_KEY, userId);
  } catch (error) {
    console.warn('[cacheOwner] owner check failed:', error);
  }
}
