/**
 * Client-side checks of the sign in and register forms: one name field,
 * e-mail and password, no last name and no repeat field, and the consent
 * reported with the rest when the always-enabled button is pressed.
 */

import i18n from '../i18n';
import {
  MIN_PASSWORD_LENGTH,
  isEmailShapeValid,
  validateEmail,
  validateLogin,
  validateRegistration,
} from './authValidation';

describe('email', () => {
  it('checks the shape of an address', () => {
    expect(isEmailShapeValid('zeynep@ornek.com')).toBe(true);
    expect(isEmailShapeValid('zeynep@ornek')).toBe(false);
    expect(isEmailShapeValid('zey nep@ornek.com')).toBe(false);
    expect(isEmailShapeValid('@ornek.com')).toBe(false);
  });

  it('trims before checking and tells an empty field from a malformed one', () => {
    expect(validateEmail('  ')).toBe('errors.emailRequired');
    expect(validateEmail('abc')).toBe('errors.emailInvalid');
    expect(validateEmail(' zeynep@ornek.com ')).toBeNull();
  });
});

describe('validateLogin', () => {
  it('needs an email and a password', () => {
    expect(validateLogin({ email: '', password: '' })).toEqual({
      email: 'errors.emailRequired',
      password: 'errors.passwordRequired',
    });
    expect(validateLogin({ email: 'a@b.co', password: 'x' })).toEqual({});
  });

  it('does not judge the length of a sign-in password (Firebase does)', () => {
    expect(validateLogin({ email: 'a@b.co', password: '1' })).toEqual({});
  });
});

describe('validateRegistration', () => {
  const valid = { name: 'Zeynep', email: 'zeynep@ornek.com', password: 'gizli-sifre' };

  it('is valid with a name, an email and a password: no last name, no repeat', () => {
    expect(validateRegistration(valid, true)).toEqual({});
    // The form has exactly these three fields.
    expect(Object.keys(valid).sort()).toEqual(['email', 'name', 'password']);
  });

  it('reports every unfinished field and the missing consent at once', () => {
    expect(validateRegistration({ name: '  ', email: 'x', password: '' }, false)).toEqual({
      name: 'errors.nameRequired',
      email: 'errors.emailInvalid',
      password: 'errors.passwordRequired',
      consent: 'register.consentRequired',
    });
  });

  it('a filled form without consent only asks for the consent', () => {
    expect(validateRegistration(valid, false)).toEqual({ consent: 'register.consentRequired' });
  });

  it('checks the password length at the boundary', () => {
    const short = 'x'.repeat(MIN_PASSWORD_LENGTH - 1);
    const enough = 'x'.repeat(MIN_PASSWORD_LENGTH);
    expect(validateRegistration({ ...valid, password: short }, true)).toEqual({
      password: 'errors.passwordShort',
    });
    expect(validateRegistration({ ...valid, password: enough }, true)).toEqual({});
  });

  it('does not trim the password (spaces are characters)', () => {
    expect(validateRegistration({ ...valid, password: '      ' }, true)).toEqual({});
  });
});

describe('copy', () => {
  it('every key the checks return has a translation in both languages', () => {
    const keys = [
      ...Object.values(validateRegistration({ name: '', email: '', password: '' }, false)),
      ...Object.values(validateLogin({ email: '', password: '' })),
      'errors.emailInvalid',
      'errors.passwordShort',
    ];
    for (const lang of ['tr', 'en']) {
      for (const key of keys) {
        expect(i18n.exists(`auth:${key}`, { lng: lang })).toBe(true);
      }
    }
  });
});
