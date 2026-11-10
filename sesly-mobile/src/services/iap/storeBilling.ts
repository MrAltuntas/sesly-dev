/**
 * The store library (expo-iap: Google Play Billing on Android, StoreKit 2 on
 * iOS), loaded on first use. A build without the native module (an old
 * development client) or a platform without a store gets null, and the
 * purchase store shows "purchases are not available" instead of crashing.
 *
 * Only PurchaseStore talks to it; tests mock `expo-iap` itself.
 */

import { Platform } from 'react-native';
import type { StorePlatform } from './storeProducts';

export type BillingModule = typeof import('expo-iap');

let cached: BillingModule | null | undefined;

/** The platform's store, or null where the app sells nothing (web). */
export function storePlatform(): StorePlatform | null {
  if (Platform.OS === 'android' || Platform.OS === 'ios') return Platform.OS;
  return null;
}

export function loadBilling(): BillingModule | null {
  if (cached !== undefined) return cached;
  if (!storePlatform()) {
    cached = null;
    return cached;
  }
  try {
    cached = require('expo-iap') as BillingModule;
  } catch (error) {
    console.warn('[iap] store library is not available:', error);
    cached = null;
  }
  return cached;
}

/** Test-only: load the library again on next use. */
export function resetBillingForTests(): void {
  cached = undefined;
}
