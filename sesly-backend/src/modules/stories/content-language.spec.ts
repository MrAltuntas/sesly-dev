import { createSettingsStub } from '../../test-utils/settings-stub';
import {
  enabledContentLanguages,
  resolveContentLanguages,
  resolveRequestedLanguage,
} from './content-language';

describe('content-language', () => {
  describe('resolveContentLanguages', () => {
    it('code defaults: Turkish only, Turkish default', () => {
      expect(resolveContentLanguages(createSettingsStub())).toEqual({
        enabled: ['tr'],
        defaultLanguage: 'tr',
      });
    });

    it('returns the enabled languages in catalogue order, whatever order the setting has', () => {
      const settings = createSettingsStub({
        'content.enabledLanguages': ['de', 'tr', 'en'],
        'content.defaultLanguage': 'en',
      });
      expect(resolveContentLanguages(settings)).toEqual({
        enabled: ['tr', 'en', 'de'],
        defaultLanguage: 'en',
      });
    });

    it('an empty or unusable list means Turkish only', () => {
      for (const value of [[], ['xx', 'da'], undefined, 'tr'] as any[]) {
        const settings = createSettingsStub({ 'content.enabledLanguages': value });
        expect(resolveContentLanguages(settings).enabled).toEqual(['tr']);
      }
    });

    it('a default language that is not enabled falls back to the first enabled one', () => {
      const settings = createSettingsStub({
        'content.enabledLanguages': ['en', 'de'],
        'content.defaultLanguage': 'tr',
      });
      expect(resolveContentLanguages(settings)).toEqual({
        enabled: ['en', 'de'],
        defaultLanguage: 'en',
      });
    });

    it('reads the settings on every call, so a panel change applies at once', () => {
      const settings = createSettingsStub();
      expect(resolveContentLanguages(settings).enabled).toEqual(['tr']);
      settings.values['content.enabledLanguages'] = ['tr', 'en'];
      expect(resolveContentLanguages(settings).enabled).toEqual(['tr', 'en']);
    });
  });

  describe('resolveRequestedLanguage', () => {
    const settings = createSettingsStub({
      'content.enabledLanguages': ['tr', 'en'],
      'content.defaultLanguage': 'tr',
    });

    it('an old client that sends no language gets the default language', () => {
      for (const requested of [undefined, null, '']) {
        expect(resolveRequestedLanguage(settings, requested)).toEqual({
          enabled: ['tr', 'en'],
          defaultLanguage: 'tr',
          language: 'tr',
          available: true,
        });
      }
    });

    it('an enabled language is served', () => {
      expect(resolveRequestedLanguage(settings, 'en')).toMatchObject({ language: 'en', available: true });
    });

    it('a language that is switched off is not available', () => {
      expect(resolveRequestedLanguage(settings, 'de')).toMatchObject({ language: 'de', available: false });
    });
  });

  it('enabledContentLanguages returns the full language records', () => {
    const settings = createSettingsStub({ 'content.enabledLanguages': ['en', 'tr'] });
    expect(enabledContentLanguages(settings).map((l) => [l.code, l.nativeName])).toEqual([
      ['tr', 'Türkçe'],
      ['en', 'English'],
    ]);
  });
});
