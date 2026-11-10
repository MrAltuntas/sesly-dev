/**
 * The UI language reaches the backend once per account and language: at a
 * session start and on every change while signed in, always alone, and a
 * refusal (an older backend) is ignored.
 */

const mockSync = jest.fn();
jest.mock('../services/UserPreferencesService', () => ({
  __esModule: true,
  default: { syncUiLanguage: (...args: unknown[]) => mockSync(...args) },
}));

import i18n from './index';
import { startUiLanguageSync } from './uiLanguageSync';
import { resetSessionForTests, setSessionUserId } from '../stores/session';

// Microtasks only (the suite runs on fake timers).
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

let stop: (() => void) | null = null;

beforeEach(async () => {
  mockSync.mockReset().mockResolvedValue(true);
  resetSessionForTests();
  await i18n.changeLanguage('tr');
});

afterEach(() => {
  stop?.();
  stop = null;
  resetSessionForTests();
});

describe('UI language sync', () => {
  it('sends nothing signed out, then the language when a session starts', async () => {
    stop = startUiLanguageSync();
    await flush();
    expect(mockSync).not.toHaveBeenCalled();

    setSessionUserId('user-1');
    await flush();
    expect(mockSync).toHaveBeenCalledWith('tr');
  });

  it('a returning user is told at start; a language change is sent once', async () => {
    setSessionUserId('user-1');
    stop = startUiLanguageSync();
    await flush();
    expect(mockSync.mock.calls).toEqual([['tr']]);

    await i18n.changeLanguage('en');
    await flush();
    expect(mockSync.mock.calls).toEqual([['tr'], ['en']]);

    // The same language again sends nothing.
    await i18n.changeLanguage('en');
    await flush();
    expect(mockSync).toHaveBeenCalledTimes(2);
  });

  it('a new sign-in of the same account (or another one) is told again', async () => {
    setSessionUserId('user-1');
    stop = startUiLanguageSync();
    await flush();
    setSessionUserId(null);
    setSessionUserId('user-1');
    setSessionUserId('user-2');
    await flush();
    expect(mockSync.mock.calls).toEqual([['tr'], ['tr'], ['tr']]);
  });

  it('a refusal or a thrown error is swallowed and not retried for the same language', async () => {
    mockSync.mockRejectedValueOnce(new Error('400'));
    setSessionUserId('user-1');
    stop = startUiLanguageSync();
    await flush();
    await i18n.changeLanguage('tr');
    await flush();
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('starts once', async () => {
    setSessionUserId('user-1');
    stop = startUiLanguageSync();
    expect(startUiLanguageSync()).toBe(stop);
    await i18n.changeLanguage('en');
    await flush();
    expect(mockSync.mock.calls).toEqual([['tr'], ['en']]);
  });
});
