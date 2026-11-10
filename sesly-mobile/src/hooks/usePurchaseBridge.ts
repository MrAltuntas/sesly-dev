/**
 * In-app purchases follow the backend session (RootNavigator): the store
 * connects for the signed-in user (products, listeners, the purchases a
 * previous run left unfinished) and disconnects on sign-out. Returning to
 * the foreground sends the kept purchases again (PurchaseStore's own
 * AppState listener).
 */

import { useEffect, useMemo } from 'react';
import { getPurchaseStore, type PurchaseStore } from '../stores/PurchaseStore';

export function usePurchaseBridge(userId: string | null): void {
  useEffect(() => {
    const store = getPurchaseStore();
    if (!userId) {
      store.stop();
      return undefined;
    }
    store.start(userId).catch(error => console.warn('[iap] start failed:', error));
    return undefined;
  }, [userId]);
}

export function usePurchases(): PurchaseStore {
  return useMemo(getPurchaseStore, []);
}
