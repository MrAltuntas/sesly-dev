import { Logger } from '@nestjs/common';
import { APP_CONFIG_DEFAULTS, AppConfigService, compareVersions } from './app-config.service';

const FORBIDDEN_UI_CHARS = /[—–…→←•·★✓›⚡‘’“”]|\p{Extended_Pictographic}/u;

function build(env: Record<string, string | undefined> = {}) {
  return new AppConfigService({ get: jest.fn((key: string) => env[key]) } as any);
}

describe('AppConfigService (GET /app/config)', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it('defaults when nothing is configured', () => {
    expect(build().getConfig()).toEqual({
      minSupportedVersion: { android: '1.0.0', ios: '1.0.0' },
      latestVersion: { android: '1.0.8', ios: '1.0.8' },
      storeUrl: { android: 'https://play.google.com/store/apps/details?id=com.sesly', ios: '' },
      updateMessage: "Sesly'nin yeni bir sürümü var. Devam etmek için lütfen uygulamayı güncelle.",
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('English copy for an English request; APP_UPDATE_MESSAGE_EN overrides it, APP_UPDATE_MESSAGE stays Turkish', () => {
    expect(build().getConfig('en').updateMessage).toBe(
      'A new version of Sesly is available. Please update the app to continue.',
    );
    expect(build().getConfig('tr').updateMessage).toBe(APP_CONFIG_DEFAULTS.updateMessage);
    expect(build().getConfig(null).updateMessage).toBe(APP_CONFIG_DEFAULTS.updateMessage);
    const env = { APP_UPDATE_MESSAGE: 'Yeni sürüm hazır.', APP_UPDATE_MESSAGE_EN: ' New version out. ' };
    expect(build(env).getConfig('en').updateMessage).toBe('New version out.');
    expect(build(env).getConfig('tr').updateMessage).toBe('Yeni sürüm hazır.');
    expect(build({ APP_UPDATE_MESSAGE: 'Yeni sürüm hazır.' }).getConfig('en').updateMessage).toBe(
      APP_CONFIG_DEFAULTS.updateMessageEn,
    );
    expect(APP_CONFIG_DEFAULTS.updateMessageEn).not.toMatch(FORBIDDEN_UI_CHARS);
  });

  it('reads every value from the environment (trimmed)', () => {
    const cfg = build({
      APP_MIN_VERSION_ANDROID: ' 1.0.5 ',
      APP_MIN_VERSION_IOS: '1.0.6',
      APP_LATEST_VERSION_ANDROID: '1.2.0',
      APP_LATEST_VERSION_IOS: '1.10.0',
      APP_STORE_URL_ANDROID: 'https://play.google.com/store/apps/details?id=com.sesly&hl=tr',
      APP_STORE_URL_IOS: 'https://apps.apple.com/tr/app/sesly/id123',
      APP_UPDATE_MESSAGE: 'Yeni sürüm hazır.',
    }).getConfig();

    expect(cfg).toEqual({
      minSupportedVersion: { android: '1.0.5', ios: '1.0.6' },
      latestVersion: { android: '1.2.0', ios: '1.10.0' },
      storeUrl: {
        android: 'https://play.google.com/store/apps/details?id=com.sesly&hl=tr',
        ios: 'https://apps.apple.com/tr/app/sesly/id123',
      },
      updateMessage: 'Yeni sürüm hazır.',
    });
  });

  it.each([['1.0'], ['v1.0.1'], ['1.0.0-beta'], ['latest']])(
    'an invalid version %p falls back to the default with a warning',
    (value) => {
      const cfg = build({ APP_MIN_VERSION_ANDROID: value, APP_LATEST_VERSION_IOS: value }).getConfig();
      expect(cfg.minSupportedVersion.android).toBe(APP_CONFIG_DEFAULTS.minVersion);
      expect(cfg.latestVersion.ios).toBe(APP_CONFIG_DEFAULTS.latestVersion);
      expect(warn).toHaveBeenCalled();
    },
  );

  it('blank values count as unset', () => {
    const cfg = build({ APP_MIN_VERSION_IOS: '  ', APP_STORE_URL_ANDROID: '', APP_UPDATE_MESSAGE: ' ' }).getConfig();
    expect(cfg.minSupportedVersion.ios).toBe('1.0.0');
    expect(cfg.storeUrl.android).toBe(APP_CONFIG_DEFAULTS.storeUrlAndroid);
    expect(cfg.updateMessage).toBe(APP_CONFIG_DEFAULTS.updateMessage);
  });

  it('latestVersion is never below minSupportedVersion (clamped up, numeric compare)', () => {
    const cfg = build({ APP_MIN_VERSION_ANDROID: '1.0.10', APP_LATEST_VERSION_ANDROID: '1.0.9' }).getConfig();
    expect(cfg.latestVersion.android).toBe('1.0.10');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('APP_LATEST_VERSION_ANDROID'));
  });

  it('a non-https store URL falls back to the default', () => {
    const cfg = build({ APP_STORE_URL_ANDROID: 'http://example.com', APP_STORE_URL_IOS: 'itms-apps://x' }).getConfig();
    expect(cfg.storeUrl).toEqual({ android: APP_CONFIG_DEFAULTS.storeUrlAndroid, ios: '' });
  });

  it('returns a fresh copy per call', () => {
    const service = build();
    const first = service.getConfig();
    first.minSupportedVersion.android = '9.9.9';
    first.storeUrl.ios = 'x';
    expect(service.getConfig().minSupportedVersion.android).toBe('1.0.0');
    expect(service.getConfig().storeUrl.ios).toBe('');
  });

  it('default update copy is Turkish with a plain apostrophe and no AI-signature characters', () => {
    expect(APP_CONFIG_DEFAULTS.updateMessage).not.toMatch(FORBIDDEN_UI_CHARS);
    expect(APP_CONFIG_DEFAULTS.updateMessage).toContain("Sesly'nin");
  });

  it('compareVersions is numeric per part', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });
});
