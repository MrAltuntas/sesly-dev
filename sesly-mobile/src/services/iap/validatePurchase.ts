/**
 * Sends a store purchase to the backend (sesly-backend CLAUDE.md, "Plans,
 * limits and in-app purchases"):
 *
 *   POST /subscriptions/google/validate { purchaseToken, productId, packageName }
 *   POST /subscriptions/apple/validate  { signedTransaction }   (StoreKit 2 JWS)
 *
 * and says what to do with the store transaction:
 *
 * - `ok`: 200. Finish (acknowledge) it.
 * - `rejected`: a 4xx about the receipt (400 RECEIPT_INVALID or
 *   PRODUCT_UNKNOWN, 409 RECEIPT_IN_USE, any other verdict). Finish it too:
 *   asking again would get the same answer.
 * - `retry`: the backend could not decide (503 STORE_UNAVAILABLE /
 *   STORE_NOT_CONFIGURED, any 5xx, no connection, 401 / 408 / 429, which are
 *   about the session or the moment, not the receipt). Keep the transaction
 *   and send it again later (next start, next foreground).
 */

import ApiClient from '../ApiClient';
import { isApiError } from '../ApiError';
import { ANDROID_PACKAGE_NAME, type StorePlatform } from './storeProducts';

export const RECEIPT_ERROR_CODES = {
  INVALID: 'RECEIPT_INVALID',
  PRODUCT_UNKNOWN: 'PRODUCT_UNKNOWN',
  IN_USE: 'RECEIPT_IN_USE',
  STORE_UNAVAILABLE: 'STORE_UNAVAILABLE',
  STORE_NOT_CONFIGURED: 'STORE_NOT_CONFIGURED',
} as const;

/** What the app needs of a store purchase to validate it. */
export interface PurchaseForValidation {
  readonly productId: string;
  /** Android: the purchase token. iOS: the signed transaction (JWS). */
  readonly purchaseToken: string;
}

export type ValidationOutcome =
  | { kind: 'ok'; entitled: boolean }
  | { kind: 'rejected'; status: number; code: string | null }
  | { kind: 'retry'; status: number; code: string | null };

/** 4xx answers that are about the session or the moment, not the receipt. */
const RETRYABLE_CLIENT_STATUSES = new Set([401, 408, 429]);

/** Whether a failed validation is kept for later rather than finished. */
export function isRetryableStatus(status: number): boolean {
  if (status === 0) return true;
  if (status >= 500) return true;
  return RETRYABLE_CLIENT_STATUSES.has(status);
}

function readEntitled(response: unknown): boolean {
  if (!response || typeof response !== 'object') return true;
  const body = response as Record<string, unknown>;
  if (typeof body.entitled === 'boolean') return body.entitled;
  if (typeof body.isActive === 'boolean') return body.isActive;
  return true;
}

export async function validatePurchase(
  purchase: PurchaseForValidation,
  platform: StorePlatform,
): Promise<ValidationOutcome> {
  try {
    const response =
      platform === 'ios'
        ? await ApiClient.post<unknown>('/subscriptions/apple/validate', {
            signedTransaction: purchase.purchaseToken,
          })
        : await ApiClient.post<unknown>('/subscriptions/google/validate', {
            purchaseToken: purchase.purchaseToken,
            productId: purchase.productId,
            packageName: ANDROID_PACKAGE_NAME,
          });
    return { kind: 'ok', entitled: readEntitled(response) };
  } catch (error) {
    if (!isApiError(error)) {
      // A failure inside the app (never the store's verdict): try again later.
      return { kind: 'retry', status: 0, code: null };
    }
    const retryableFlag = error.data?.retryable === true;
    if (retryableFlag || isRetryableStatus(error.status)) {
      return { kind: 'retry', status: error.status, code: error.code };
    }
    return { kind: 'rejected', status: error.status, code: error.code };
  }
}
