/**
 * Content language store: catalogue languages, the stored "Masal dili", the
 * UI language as the language without a pick, and the reload of the story
 * lists whenever the language in use changes.
 */

import { apiErrorFromResponse } from '../services/ApiError';

const mockGetLanguages = jest.fn();
const mockPrefsGet = jest.fn();
const mockPrefsUpdate = jest.fn();
const mockReadCached = jest.fn();
const mockLanguageChanged = jest.fn();
let mockStoryStore: unknown = null;

jest.mock('../services/StoryService', () => ({
  __esModule: true,
  default: { getLanguages: (...args: unknown[]) => mockGetLanguages(...args) },
}));
jest.mock('../services/UserPreferencesService', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockPrefsGet(...args),
    update: (...args: unknown[]) => mockPrefsUpdate(...args),
    readCached: (...args: unknown[]) => mockReadCached(...args),
  },
}));
jest.mock('./useStory', () => ({
  getStoryStore: () => mockStoryStore,
}));

import i18n from '../i18n';
import { resetSessionForTests, setSessionUserId } from '../stores/session';
import {
  ContentLanguageStore,
  contentLanguageLabel,
  contentLanguageNativeName,
  getContentLanguageStore,
} from './useContentLanguage';

const language = (code: string, storyCount: number, levels: string[] = []) => ({
  code,
  nativeName: code === 'tr' ? 'Türkçe' : code === 'en' ? 'English' : 'Deutsch',
  englishName: code,
  isDefault: code === 'tr',
  storyCount,
  levels,
});

/** The production catalogue: Turkish and English with stories. */
const CATALOGUE = {
  defaultLanguage: 'tr',
  languages: [language('tr', 182), language('en', 157, ['A1', 'A2'])],
};

const prefs = (contentLanguage: string | null, effectiveContentLanguage: string | null = 'tr') => ({
  contentLanguage,
  effectiveContentLanguage,
});

beforeEach(async () => {
  mockGetLanguages.mockReset();
  mockPrefsGet.mockReset();
  mockPrefsUpdate.mockReset();
  mockReadCached.mockReset().mockResolvedValue(null);
  mockLanguageChanged.mockReset();
  mockStoryStore = { contentLanguageChanged: mockLanguageChanged };
  resetSessionForTests();
  setSessionUserId('user-1');
  await i18n.changeLanguage('tr');
});

// Every store follows i18n and calls the story store: only the test's own stay attached.
const created: ContentLanguageStore[] = [];
function newStore(): ContentLanguageStore {
  const store = new ContentLanguageStore();
  created.push(store);
  return store;
}
afterEach(() => {
  created.splice(0).forEach(store => store.dispose());
});

afterAll(() => {
  resetSessionForTests();
});

describe('ContentLanguageStore', () => {
  it('loads the languages and the preference once', async () => {
    mockGetLanguages.mockResolvedValue({
      defaultLanguage: 'tr',
      languages: [language('tr', 29, ['A2', 'B1']), language('en', 3, ['A1']), language('de', 0)],
    });
    mockPrefsGet.mockResolvedValue(prefs('en', 'en'));
    const store = newStore();
    expect(store.effective).toBe('tr');

    await store.load();
    await store.load();

    expect(mockGetLanguages).toHaveBeenCalledTimes(1);
    expect(mockPrefsGet).toHaveBeenCalledTimes(1);
    expect(store.isLoaded).toBe(true);
    expect(store.preferencesLoaded).toBe(true);
    expect(store.effective).toBe('en');
    expect(store.languagesWithStories.map(l => l.code)).toEqual(['tr', 'en']);
    expect(store.pickableLanguages.map(l => l.code)).toEqual(['tr', 'en']);
    expect(store.levels).toEqual(['A1', 'A2', 'B1']);
    expect(store.nativeName('de')).toBe('Deutsch');
    expect(store.nativeName('ru')).toBe('Русский');
  });

  it('levelsFor: the levels of the languages on screen, every language when none is picked', async () => {
    mockGetLanguages.mockResolvedValue({
      defaultLanguage: 'tr',
      languages: [language('tr', 29), language('en', 3, ['B1', 'A1']), language('de', 2, ['A2'])],
    });
    mockPrefsGet.mockResolvedValue(null);
    const store = newStore();
    await store.load();

    expect(store.levelsFor([])).toEqual(['A1', 'A2', 'B1']);
    // Turkish stories carry no level: nothing to filter by.
    expect(store.levelsFor(['tr'])).toEqual([]);
    expect(store.levelsFor(['EN'])).toEqual(['A1', 'B1']);
    expect(store.levelsFor(['tr', 'de'])).toEqual(['A2']);
    expect(store.levelsFor(['xx'])).toEqual([]);
  });

  it('no level anywhere: there is nothing to offer', async () => {
    mockGetLanguages.mockResolvedValue({
      defaultLanguage: 'tr',
      languages: [language('tr', 29), language('en', 3)],
    });
    mockPrefsGet.mockResolvedValue(null);
    const store = newStore();
    await store.load();
    expect(store.levels).toEqual([]);
    expect(store.levelsFor([])).toEqual([]);
    expect(store.levelsFor(['en'])).toEqual([]);
  });

  describe('the language in use', () => {
    it('follows the UI language while there is no pick', async () => {
      mockGetLanguages.mockResolvedValue(CATALOGUE);
      mockPrefsGet.mockResolvedValue(prefs(null));
      const store = newStore();
      await store.load();
      expect(store.effective).toBe('tr');

      await i18n.changeLanguage('en');
      expect(store.uiLanguage).toBe('en');
      expect(store.effective).toBe('en');
      expect(store.selectable).toBe('en');
    });

    it('never takes the server default for a null pick', async () => {
      // The backend resolves a null pick to its default, Turkish.
      await i18n.changeLanguage('en');
      mockGetLanguages.mockResolvedValue(CATALOGUE);
      mockPrefsGet.mockResolvedValue(prefs(null, 'tr'));
      const store = newStore();
      await store.load();
      expect(store.contentLanguage).toBeNull();
      expect(store.effective).toBe('en');
    });

    it('is the UI language before anything is known (an English phone starts in English)', async () => {
      await i18n.changeLanguage('en');
      const store = newStore();
      expect(store.isLoaded).toBe(false);
      expect(store.effective).toBe('en');
    });

    it('a UI language without stories falls back to the catalogue default', async () => {
      await i18n.changeLanguage('en');
      mockGetLanguages.mockResolvedValue({
        defaultLanguage: 'tr',
        languages: [language('tr', 182), language('en', 0)],
      });
      mockPrefsGet.mockResolvedValue(prefs(null));
      const store = newStore();
      await store.load();
      expect(store.effective).toBe('tr');
      // One language with stories: no choice to offer.
      expect(store.pickableLanguages.map(l => l.code)).toEqual(['tr']);
    });

    it('a pick wins over the UI language', async () => {
      mockGetLanguages.mockResolvedValue(CATALOGUE);
      mockPrefsGet.mockResolvedValue(prefs('tr', 'tr'));
      await i18n.changeLanguage('en');
      const store = newStore();
      await store.load();
      expect(store.effective).toBe('tr');
      await i18n.changeLanguage('tr');
      await i18n.changeLanguage('en');
      expect(store.effective).toBe('tr');
    });

    it('a pick the catalogue no longer offers gives way to the UI language', async () => {
      mockGetLanguages.mockResolvedValue({
        defaultLanguage: 'tr',
        languages: [language('tr', 29), language('de', 1)],
      });
      mockPrefsGet.mockResolvedValue(prefs('en', 'tr'));
      const store = newStore();
      await store.load();
      expect(store.contentLanguage).toBe('en');
      expect(store.effective).toBe('tr');
      expect(store.selectable).toBe('tr');

      // Not even the default is in the list: the first enabled language.
      mockGetLanguages.mockResolvedValue({ defaultLanguage: 'fr', languages: [language('de', 1)] });
      await store.load(true);
      expect(store.effective).toBe('fr');
      expect(store.selectable).toBe('de');
    });

    it('reloads the story lists whenever it changes, and only then', async () => {
      mockGetLanguages.mockResolvedValue(CATALOGUE);
      mockPrefsGet.mockResolvedValue(prefs(null));
      const store = newStore();
      await store.load();
      expect(mockLanguageChanged).not.toHaveBeenCalled();

      await i18n.changeLanguage('en');
      expect(mockLanguageChanged).toHaveBeenCalledTimes(1);

      // A pick of the language already in use changes nothing on screen.
      mockPrefsUpdate.mockResolvedValue(prefs('en', 'en'));
      await store.setContentLanguage('en');
      expect(mockLanguageChanged).toHaveBeenCalledTimes(1);

      // With a pick, the UI language no longer moves the lists.
      await i18n.changeLanguage('tr');
      expect(mockLanguageChanged).toHaveBeenCalledTimes(1);
    });
  });

  it('survives a failed load and can be forced again', async () => {
    mockGetLanguages.mockRejectedValue(new Error('offline'));
    mockPrefsGet.mockRejectedValue(new Error('offline'));
    const store = newStore();
    await store.load();
    expect(store.isLoaded).toBe(false);
    expect(store.preferencesLoaded).toBe(false);
    expect(store.languages).toEqual([]);
    expect(store.languagesWithStories).toEqual([]);
    expect(store.effective).toBe('tr');

    mockGetLanguages.mockResolvedValue({ defaultLanguage: 'en', languages: [language('en', 0)] });
    mockPrefsGet.mockResolvedValue(prefs(null, null));
    await store.load();
    expect(store.isLoaded).toBe(true);
    // The Turkish UI has no Turkish stories here: the default.
    expect(store.effective).toBe('en');
    // No language has stories yet: the full list is offered.
    expect(store.languagesWithStories.map(l => l.code)).toEqual(['en']);
    expect(store.pickableLanguages).toEqual([]);
  });

  it('stores a new content language; the lists follow at once', async () => {
    let finishSave: (value: unknown) => void = () => undefined;
    mockPrefsUpdate.mockReturnValue(new Promise(resolve => (finishSave = resolve)));
    const store = newStore();
    const saving = store.setContentLanguage('en');
    // A reload started now already asks for English.
    expect(store.effective).toBe('en');
    expect(store.isSaving).toBe(true);
    expect(mockLanguageChanged).toHaveBeenCalledTimes(1);
    finishSave(prefs('en', 'en'));
    await saving;
    expect(mockPrefsUpdate).toHaveBeenCalledWith({ contentLanguage: 'en' });
    expect(store.contentLanguage).toBe('en');
    expect(store.effective).toBe('en');
    expect(store.isSaving).toBe(false);
    expect(mockLanguageChanged).toHaveBeenCalledTimes(1);
  });

  it('a load answering while a pick is saved does not undo the pick', async () => {
    mockGetLanguages.mockResolvedValue(CATALOGUE);
    let answerPrefs: (value: unknown) => void = () => undefined;
    mockPrefsGet.mockReturnValue(new Promise(resolve => (answerPrefs = resolve)));
    let finishSave: (value: unknown) => void = () => undefined;
    mockPrefsUpdate.mockReturnValue(new Promise(resolve => (finishSave = resolve)));
    const store = newStore();
    const loading = store.load();
    const saving = store.setContentLanguage('en');
    answerPrefs(prefs(null));
    await loading;
    expect(store.effective).toBe('en');
    finishSave(prefs('en', 'en'));
    await saving;
    expect(store.effective).toBe('en');
  });

  it('null follows the UI language again and works before any list exists', async () => {
    mockStoryStore = null;
    mockPrefsUpdate.mockResolvedValue(prefs(null, 'tr'));
    await i18n.changeLanguage('en');
    const store = newStore();
    store.contentLanguage = 'tr';
    await store.setContentLanguage(null);
    expect(store.contentLanguage).toBeNull();
    expect(store.effective).toBe('en');
  });

  it('rolls back when the backend refuses the language', async () => {
    mockPrefsUpdate.mockRejectedValue(apiErrorFromResponse(400, { code: 'CONTENT_LANGUAGE_NOT_ENABLED' }));
    const store = newStore();
    store.contentLanguage = 'tr';
    await expect(store.setContentLanguage('ru')).rejects.toMatchObject({ status: 400 });
    expect(store.contentLanguage).toBe('tr');
    expect(store.effective).toBe('tr');
    expect(store.isSaving).toBe(false);
  });

  describe('seed', () => {
    it("reads the account's pick from the device before the server answers", async () => {
      await i18n.changeLanguage('en');
      mockReadCached.mockResolvedValue(prefs('tr', 'tr'));
      const store = newStore();
      expect(store.effective).toBe('en');
      await store.seed();
      expect(mockReadCached).toHaveBeenCalledWith('user-1');
      expect(store.effective).toBe('tr');
      // Once per session.
      await store.seed();
      expect(mockReadCached).toHaveBeenCalledTimes(1);

      // The server's answer wins.
      mockGetLanguages.mockResolvedValue(CATALOGUE);
      mockPrefsGet.mockResolvedValue(prefs(null));
      await store.load();
      expect(store.effective).toBe('en');
    });

    it('does nothing signed out, nor once the server answered', async () => {
      resetSessionForTests();
      const store = newStore();
      await store.seed();
      expect(mockReadCached).not.toHaveBeenCalled();

      setSessionUserId('user-1');
      mockGetLanguages.mockResolvedValue(CATALOGUE);
      mockPrefsGet.mockResolvedValue(prefs('en', 'en'));
      const loaded = newStore();
      await loaded.load();
      await loaded.seed();
      expect(mockReadCached).not.toHaveBeenCalled();
      expect(loaded.effective).toBe('en');
    });

    it('a device copy of another account is never used', async () => {
      let answer: (value: unknown) => void = () => undefined;
      mockReadCached.mockReturnValue(new Promise(resolve => (answer = resolve)));
      const store = newStore();
      const seeding = store.seed();
      setSessionUserId('user-2');
      answer(prefs('en', 'en'));
      await seeding;
      expect(store.contentLanguage).toBeNull();
    });
  });

  it('drops a preference that answers after the account changed', async () => {
    mockGetLanguages.mockResolvedValue(CATALOGUE);
    let answer: (value: unknown) => void = () => undefined;
    mockPrefsGet.mockReturnValue(new Promise(resolve => (answer = resolve)));
    const store = newStore();
    const loading = store.load();
    setSessionUserId('user-2');
    answer(prefs('en', 'en'));
    await loading;
    expect(store.contentLanguage).toBeNull();
    expect(store.preferencesLoaded).toBe(false);
  });

  it('reset forgets the account preference, and the next account is asked again', async () => {
    const store = getContentLanguageStore();
    expect(getContentLanguageStore()).toBe(store);
    mockGetLanguages.mockResolvedValue(CATALOGUE);
    mockPrefsGet.mockResolvedValue(prefs('en', 'en'));
    await store.load(true);
    expect(store.effective).toBe('en');

    store.reset();
    expect(store.contentLanguage).toBeNull();
    expect(store.effective).toBe('tr');

    mockPrefsGet.mockResolvedValue(prefs('en', 'en'));
    await store.load();
    expect(mockPrefsGet).toHaveBeenCalledTimes(2);
    expect(store.effective).toBe('en');
    store.reset();
  });
});

describe('language names', () => {
  it('native names for chips, UI language names inside sentences', async () => {
    expect(contentLanguageNativeName('EN')).toBe('English');
    expect(contentLanguageNativeName('xx')).toBe('XX');
    expect(contentLanguageLabel('en')).toBe('İngilizce');
    expect(contentLanguageLabel('xx')).toBe('XX');
    await i18n.changeLanguage('en');
    expect(contentLanguageLabel('tr')).toBe('Turkish');
  });
});
