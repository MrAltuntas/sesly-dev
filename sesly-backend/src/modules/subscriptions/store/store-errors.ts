import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * Coded errors of the purchase validation endpoints. The client must keep
 * the store transaction unfinished on STORE_UNAVAILABLE / STORE_NOT_CONFIGURED
 * (retry later) and may finish it on every other answer.
 */
export const STORE_ERROR_CODES = {
  RECEIPT_IN_USE: 'RECEIPT_IN_USE',
  RECEIPT_INVALID: 'RECEIPT_INVALID',
  PRODUCT_UNKNOWN: 'PRODUCT_UNKNOWN',
  STORE_UNAVAILABLE: 'STORE_UNAVAILABLE',
  STORE_NOT_CONFIGURED: 'STORE_NOT_CONFIGURED',
} as const;

// Messages are i18n keys (errors.store.*): HttpExceptionFilter serves them
// per Accept-Language. Clients branch on the codes.
export const RECEIPT_IN_USE_CODE = STORE_ERROR_CODES.RECEIPT_IN_USE;
export const RECEIPT_IN_USE_MESSAGE = 'errors.store.receiptInUse';

export const RECEIPT_INVALID_CODE = STORE_ERROR_CODES.RECEIPT_INVALID;
export const RECEIPT_INVALID_MESSAGE = 'errors.store.receiptInvalid';

export const PRODUCT_UNKNOWN_MESSAGE = 'errors.store.productUnknown';

export const STORE_UNAVAILABLE_MESSAGE = 'errors.store.unavailable';

export const STORE_NOT_CONFIGURED_MESSAGE = 'errors.store.notConfigured';

export function receiptInUse(): ConflictException {
  return new ConflictException({ code: RECEIPT_IN_USE_CODE, message: RECEIPT_IN_USE_MESSAGE });
}

export function receiptInvalid(): BadRequestException {
  return new BadRequestException({ code: RECEIPT_INVALID_CODE, message: RECEIPT_INVALID_MESSAGE });
}

export function productUnknown(productId: string | null | undefined): BadRequestException {
  return new BadRequestException({
    code: STORE_ERROR_CODES.PRODUCT_UNKNOWN,
    productId: productId ?? null,
    message: PRODUCT_UNKNOWN_MESSAGE,
  });
}

export function storeUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: STORE_ERROR_CODES.STORE_UNAVAILABLE,
    retryable: true,
    message: STORE_UNAVAILABLE_MESSAGE,
  });
}

export function storeNotConfigured(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: STORE_ERROR_CODES.STORE_NOT_CONFIGURED,
    retryable: true,
    message: STORE_NOT_CONFIGURED_MESSAGE,
  });
}

/** The store says the token / signature is not valid (never retry). */
export class StoreRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreRejectedError';
  }
}

/** Network, 5xx, rate limit or OCSP trouble: retry later. */
export class StoreTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreTransientError';
  }
}

/** Missing or refused credentials on our side. */
export class StoreConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreConfigError';
  }
}

/** Map a store client error to the HTTP answer of a validation endpoint. */
export function toHttpError(error: unknown): unknown {
  if (error instanceof StoreRejectedError) return receiptInvalid();
  if (error instanceof StoreConfigError) return storeNotConfigured();
  if (error instanceof StoreTransientError) return storeUnavailable();
  return error;
}
