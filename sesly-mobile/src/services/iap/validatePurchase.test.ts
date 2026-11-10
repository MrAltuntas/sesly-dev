/**
 * The backend hand-over of a store purchase: the request per platform and
 * what each answer means for the store transaction (finish on 200 and on a
 * receipt verdict, keep on 503, no connection, 5xx, 401, 408, 429).
 */

const mockApiPost = jest.fn();
jest.mock('../ApiClient', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => mockApiPost(...args) },
}));

import { apiErrorFromResponse } from '../ApiError';
import { isRetryableStatus, validatePurchase } from './validatePurchase';

const purchase = { productId: 'pro_monthly', purchaseToken: 'token' };

beforeEach(() => {
  mockApiPost.mockReset();
});

describe('validatePurchase', () => {
  it('posts the Google token with the product and the package', async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, entitled: true });
    await expect(validatePurchase(purchase, 'android')).resolves.toEqual({ kind: 'ok', entitled: true });
    expect(mockApiPost).toHaveBeenCalledWith('/subscriptions/google/validate', {
      purchaseToken: 'token',
      productId: 'pro_monthly',
      packageName: 'com.sesly',
    });
  });

  it('posts the StoreKit 2 signed transaction on iOS', async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, entitled: false });
    await expect(validatePurchase({ productId: 'io.sesly.pro_monthly', purchaseToken: 'jws' }, 'ios')).resolves.toEqual(
      { kind: 'ok', entitled: false },
    );
    expect(mockApiPost).toHaveBeenCalledWith('/subscriptions/apple/validate', { signedTransaction: 'jws' });
  });

  it('reads entitlement from isActive, or assumes it from a bare 200', async () => {
    mockApiPost.mockResolvedValueOnce({ isActive: false });
    await expect(validatePurchase(purchase, 'android')).resolves.toEqual({ kind: 'ok', entitled: false });
    mockApiPost.mockResolvedValueOnce(null);
    await expect(validatePurchase(purchase, 'android')).resolves.toEqual({ kind: 'ok', entitled: true });
  });

  it.each([
    [400, 'RECEIPT_INVALID'],
    [400, 'PRODUCT_UNKNOWN'],
    [409, 'RECEIPT_IN_USE'],
    [403, null],
  ])('a %s %s is a verdict: rejected', async (status, code) => {
    mockApiPost.mockRejectedValueOnce(apiErrorFromResponse(status, { statusCode: status, message: 'x', code }));
    await expect(validatePurchase(purchase, 'android')).resolves.toEqual({ kind: 'rejected', status, code });
  });

  it.each([
    [503, 'STORE_UNAVAILABLE'],
    [503, 'STORE_NOT_CONFIGURED'],
    [500, null],
    [401, null],
    [429, null],
  ])('a %s %s is kept for later', async (status, code) => {
    mockApiPost.mockRejectedValueOnce(apiErrorFromResponse(status, { statusCode: status, message: 'x', code }));
    await expect(validatePurchase(purchase, 'android')).resolves.toEqual({ kind: 'retry', status, code });
  });

  it('honours retryable: true on any status, and keeps it without a connection or on an app failure', async () => {
    mockApiPost.mockRejectedValueOnce(
      apiErrorFromResponse(400, { statusCode: 400, message: 'x', code: 'STORE_UNAVAILABLE', retryable: true }),
    );
    expect((await validatePurchase(purchase, 'android')).kind).toBe('retry');
    mockApiPost.mockRejectedValueOnce(apiErrorFromResponse(undefined, null));
    expect(await validatePurchase(purchase, 'android')).toEqual({ kind: 'retry', status: 0, code: 'NETWORK_ERROR' });
    mockApiPost.mockRejectedValueOnce(new TypeError('parser'));
    expect(await validatePurchase(purchase, 'android')).toEqual({ kind: 'retry', status: 0, code: null });
  });

  it('isRetryableStatus', () => {
    expect([0, 401, 408, 429, 500, 502, 503].every(isRetryableStatus)).toBe(true);
    expect([400, 403, 404, 409, 422].some(isRetryableStatus)).toBe(false);
  });
});
