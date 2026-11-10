/**
 * Client-side checks of the sign in and register forms.
 *
 * Deliberately permissive: the backend and Firebase are the authority on
 * whether an address or password is acceptable. These only catch what is
 * obviously unfinished, and return i18n keys (namespace `auth`) so the
 * screens stay free of copy.
 */

export const MIN_PASSWORD_LENGTH = 6;

/** Something@something.something, no spaces. */
export function isEmailShapeValid(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export type AuthErrorKey =
  | 'errors.emailRequired'
  | 'errors.emailInvalid'
  | 'errors.passwordRequired'
  | 'errors.passwordShort'
  | 'errors.nameRequired'
  | 'register.consentRequired';

export function validateEmail(email: string): AuthErrorKey | null {
  const trimmed = email.trim();
  if (!trimmed) return 'errors.emailRequired';
  if (!isEmailShapeValid(trimmed)) return 'errors.emailInvalid';
  return null;
}

export interface LoginForm {
  email: string;
  password: string;
}

export type LoginErrors = Partial<Record<keyof LoginForm, AuthErrorKey>>;

export function validateLogin(form: LoginForm): LoginErrors {
  const errors: LoginErrors = {};
  const email = validateEmail(form.email);
  if (email) errors.email = email;
  if (!form.password) errors.password = 'errors.passwordRequired';
  return errors;
}

/**
 * One name field, e-mail and password. The backend takes the name as the
 * first name and needs no last name; the password field has its own show /
 * hide toggle, so there is no repeat field.
 */
export interface RegistrationForm {
  name: string;
  email: string;
  password: string;
}

/** Field errors plus `consent`, shown under the checkbox. */
export type RegistrationErrors = Partial<Record<keyof RegistrationForm | 'consent', AuthErrorKey>>;

/**
 * Everything the register button reports when pressed: the button is
 * always enabled and says what is missing instead of greying out.
 */
export function validateRegistration(form: RegistrationForm, accepted: boolean): RegistrationErrors {
  const errors: RegistrationErrors = {};
  if (!form.name.trim()) errors.name = 'errors.nameRequired';
  const email = validateEmail(form.email);
  if (email) errors.email = email;

  if (!form.password) {
    errors.password = 'errors.passwordRequired';
  } else if (form.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = 'errors.passwordShort';
  }

  if (!accepted) errors.consent = 'register.consentRequired';
  return errors;
}
