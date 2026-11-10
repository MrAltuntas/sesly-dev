import { msg } from '../i18n/messages';

/**
 * Sign-in outcomes that are not plain failures. Kept apart from AuthService
 * so stores and screens can branch on them without importing Firebase.
 */

/**
 * The user closed the Google / Apple picker. Not a failure: callers should
 * stay silent (no error toast).
 */
export class AuthCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthCancelledError';
    Object.setPrototypeOf(this, AuthCancelledError.prototype);
  }
}

export function isAuthCancelledError(error: unknown): error is AuthCancelledError {
  return error instanceof AuthCancelledError;
}

/** Backend code on POST /auth/firebase/verify (409). */
export const EMAIL_IN_USE_CODE = 'EMAIL_IN_USE';

// Getters: the text follows the UI language at the moment it is read.
export const EMAIL_IN_USE_DIALOG = {
  get title(): string {
    return msg('auth.emailInUseTitle');
  },
  get message(): string {
    return msg('auth.emailInUseMessage');
  },
};

/**
 * The e-mail already belongs to an account created with another sign-in
 * method (409 EMAIL_IN_USE). AuthService signs out of Firebase before
 * throwing it; the auth screens explain it in a dialog.
 */
export class EmailInUseError extends Error {
  constructor(message?: string) {
    super(message ?? EMAIL_IN_USE_DIALOG.message);
    this.name = 'EmailInUseError';
    Object.setPrototypeOf(this, EmailInUseError.prototype);
  }
}

export function isEmailInUseError(error: unknown): error is EmailInUseError {
  return error instanceof EmailInUseError;
}

/** The form field an auth failure belongs to; null for a form-level error. */
export type AuthErrorField = 'email' | 'password' | null;

/**
 * A sign-in, registration or password reset failure with user-facing copy
 * (msg()) and the field the auth screens show it under. A null field goes
 * into the one form-level line above the submit button.
 */
export class AuthFieldError extends Error {
  readonly field: AuthErrorField;

  constructor(message: string, field: AuthErrorField = null) {
    super(message);
    this.name = 'AuthFieldError';
    this.field = field;
    Object.setPrototypeOf(this, AuthFieldError.prototype);
  }
}

export function isAuthFieldError(error: unknown): error is AuthFieldError {
  return error instanceof AuthFieldError;
}
