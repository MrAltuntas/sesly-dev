import i18n from './index';
import { looksTurkish, serverTextInUiLanguage } from './serverText';

afterEach(async () => {
  await i18n.changeLanguage('tr');
});

describe('server sentences in the UI language', () => {
  it('tells a Turkish sentence by its letters', () => {
    expect(looksTurkish('Planın en fazla 3 hazır anlatıcı sese izin veriyor.')).toBe(true);
    expect(looksTurkish('Your plan allows 3 narrators.')).toBe(false);
  });

  it('a Turkish UI shows any sentence the backend wrote', async () => {
    await i18n.changeLanguage('tr');
    expect(serverTextInUiLanguage('  Ses yuvan doldu.  ')).toBe('Ses yuvan doldu.');
    expect(serverTextInUiLanguage('Limit reached.')).toBe('Limit reached.');
    expect(serverTextInUiLanguage('   ')).toBeNull();
    expect(serverTextInUiLanguage(null)).toBeNull();
  });

  it('an English UI shows only an English sentence', async () => {
    await i18n.changeLanguage('en');
    expect(serverTextInUiLanguage('Planın en fazla 3 hazır anlatıcı sese izin veriyor.')).toBeNull();
    expect(serverTextInUiLanguage('Your plan allows 3 narrators.')).toBe('Your plan allows 3 narrators.');
  });
});
