/**
 * Content language ("Masal dili") store.
 *
 * Content language is not the UI language: it decides in which language the
 * story lists are shown (Home lists only that language, grouped lists pick
 * that version of a tale). The user's explicit pick is stored on the account
 * (`UserPreferences.contentLanguage`).
 *
 * The language in use (`effective`):
 *   1. the stored pick, while the catalogue offers it;
 *   2. else the UI language, when it is an enabled catalogue language with
 *      stories (an English UI reads English stories without ever choosing);
 *   3. else the catalogue default.
 * The backend's `effectiveContentLanguage` is not used: it falls back to its
 * own default (Turkish) for a null pick and would override step 2.
 *
 * Before the catalogue is loaded a language counts as offered (both UI
 * languages are catalogue languages); before the account's pick is known
 * the copy cached on the device stands in for it (`seed()`).
 *
 * Whenever `effective` changes (a new pick, the pick arriving from the
 * server, the UI language changing without a pick, the catalogue arriving),
 * the story store fetches its lists, shelves and saved list again; the
 * screens with lists of their own (Keşfet, collections) react to it too.
 */

import { makeAutoObservable, reaction, runInAction } from 'mobx';
import { useMemo } from 'react';
import StoryService from '../services/StoryService';
import userPreferencesService from '../services/UserPreferencesService';
import type { CatalogueLanguage } from '../models/Story';
import { getStoryStore } from './useStory';
import { getSessionUserId } from '../stores/session';
import { resolveUiLanguage } from '../i18n/language';
import i18n from '../i18n';

const FALLBACK_LANGUAGE = 'tr';
const CEFR_ORDER: readonly string[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

class ContentLanguageStore {
  /** Enabled content languages, catalogue order. Empty until loaded. */
  languages: CatalogueLanguage[] = [];
  defaultLanguage: string = FALLBACK_LANGUAGE;
  /** Stored pick, or null when the user never chose. */
  contentLanguage: string | null = null;
  /** The UI language, kept in step with i18n. */
  uiLanguage: string = resolveUiLanguage(i18n.language);
  /** The catalogue languages arrived. */
  isLoaded = false;
  /** The account's stored pick arrived from the server. */
  preferencesLoaded = false;
  isLoading = false;
  isSaving = false;
  /** The device copy of the pick was read (seed). */
  private seeded = false;
  private disposers: (() => void)[] = [];

  constructor() {
    makeAutoObservable<this, 'seeded' | 'disposers'>(this, { seeded: false, disposers: false });
    const onLanguage = (language: string) => {
      const next = resolveUiLanguage(language);
      if (next !== this.uiLanguage) {
        runInAction(() => {
          this.uiLanguage = next;
        });
      }
    };
    i18n.on('languageChanged', onLanguage);
    this.disposers.push(() => i18n.off('languageChanged', onLanguage));
    // Every list in the old language is fetched again. (Screen tests hand
    // in partial story stores, or none.)
    this.disposers.push(
      reaction(
        () => this.effective,
        () => getStoryStore?.()?.contentLanguageChanged?.(),
      ),
    );
  }

  /** Stop following the UI language and the lists (tests; the app keeps one store). */
  dispose(): void {
    this.disposers.forEach(dispose => dispose());
    this.disposers = [];
  }

  /**
   * A language the lists can be shown in: listed by the catalogue, and with
   * stories when `withStories`. Anything counts before the catalogue loaded.
   */
  private offers(code: string, withStories: boolean): boolean {
    if (!this.isLoaded) return true;
    const found = this.languages.find(language => language.code === code);
    return !!found && (!withStories || found.storyCount > 0);
  }

  /** The language the lists are shown in (see the file comment). */
  get effective(): string {
    const stored = this.contentLanguage;
    if (stored && this.offers(stored, false)) return stored;
    if (this.offers(this.uiLanguage, true)) return this.uiLanguage;
    return this.defaultLanguage;
  }

  /** Languages with at least one published story (the Dil filter lists these). */
  get languagesWithStories(): CatalogueLanguage[] {
    const withStories = this.pickableLanguages;
    return withStories.length > 0 ? withStories : this.languages;
  }

  /**
   * The languages "Masal dili" offers: those with published stories. With
   * fewer than two there is no choice, and the picker is hidden.
   */
  get pickableLanguages(): CatalogueLanguage[] {
    return this.languages.filter(language => language.storyCount > 0);
  }

  /** CEFR levels present in the catalogue, easiest first. */
  get levels(): string[] {
    const present = new Set<string>();
    this.languages.forEach(language => language.levels.forEach(level => present.add(level)));
    return CEFR_ORDER.filter(level => present.has(level));
  }

  /**
   * CEFR levels present in the given languages (every language when none is
   * given), easiest first. Keşfet asks with the languages it is showing: a
   * level filter with no level to pick is not offered.
   */
  levelsFor(codes: readonly string[]): string[] {
    if (codes.length === 0) return this.levels;
    const wanted = new Set(codes.map(code => code.toLowerCase()));
    const present = new Set<string>();
    this.languages
      .filter(language => wanted.has(language.code))
      .forEach(language => language.levels.forEach(level => present.add(level)));
    return CEFR_ORDER.filter(level => present.has(level));
  }

  /**
   * The language a picker should show as chosen: the effective one while it
   * is enabled, else the catalogue default, else the first language.
   */
  get selectable(): string {
    const enabled = (code: string) => this.languages.some(language => language.code === code);
    if (enabled(this.effective)) return this.effective;
    if (enabled(this.defaultLanguage)) return this.defaultLanguage;
    return this.languages[0]?.code ?? this.effective;
  }

  /** The language in its own name ("English"); the code in capitals when unknown. */
  nativeName(code: string): string {
    const found = this.languages.find(language => language.code === code);
    return found?.nativeName ?? contentLanguageNativeName(code);
  }

  /**
   * The account's pick as the device last saw it, before the server
   * answers, so the first lists of a returning user are already in the
   * right language. Local only (no request); never throws.
   */
  async seed(): Promise<void> {
    if (this.seeded || this.preferencesLoaded) return;
    this.seeded = true;
    const userId = getSessionUserId();
    if (!userId) return;
    const cached = await Promise.resolve()
      .then(() => userPreferencesService.readCached(userId))
      .catch(() => null);
    if (!cached || this.preferencesLoaded || this.isSaving || getSessionUserId() !== userId) return;
    runInAction(() => {
      this.contentLanguage = cached.contentLanguage;
    });
  }

  /** Load the catalogue languages and the stored preference. Never throws. */
  async load(force = false): Promise<void> {
    if (this.isLoading || (this.isLoaded && this.preferencesLoaded && !force)) return;
    runInAction(() => {
      this.isLoading = true;
    });
    const userId = getSessionUserId();
    const [languages, preferences] = await Promise.all([
      Promise.resolve()
        .then(() => StoryService.getLanguages())
        .catch(() => null),
      Promise.resolve()
        .then(() => userPreferencesService.get())
        .catch(() => null),
    ]);
    runInAction(() => {
      if (languages) {
        this.languages = [...languages.languages];
        this.defaultLanguage = languages.defaultLanguage;
        this.isLoaded = true;
      }
      // Not while a new pick is being saved (its answer sets it), and never
      // the answer for an account that left meanwhile.
      if (preferences && !this.isSaving && getSessionUserId() === userId) {
        this.contentLanguage = preferences.contentLanguage;
        this.preferencesLoaded = true;
      }
      this.isLoading = false;
    });
  }

  /**
   * Store a new content language (null follows the UI language again). The
   * lists follow at once (they react to `effective`); rolls back and
   * rethrows when the backend refuses.
   */
  async setContentLanguage(code: string | null): Promise<void> {
    const previous = this.contentLanguage;
    runInAction(() => {
      this.contentLanguage = code;
      this.isSaving = true;
    });
    try {
      const updated = await userPreferencesService.update({ contentLanguage: code });
      runInAction(() => {
        this.contentLanguage = updated.contentLanguage;
        this.preferencesLoaded = true;
      });
    } catch (error) {
      runInAction(() => {
        this.contentLanguage = previous;
      });
      throw error;
    } finally {
      runInAction(() => {
        this.isSaving = false;
      });
    }
  }

  /** Sign out: forget the account's preference, keep the catalogue list. */
  reset(): void {
    this.contentLanguage = null;
    this.preferencesLoaded = false;
    this.seeded = false;
  }
}

// ─────────────────────────────────────────────────────────────
// Language names
// ─────────────────────────────────────────────────────────────

/** Each content language in its own name, for when the catalogue list is not loaded. */
const NATIVE_NAMES: Record<string, string> = {
  tr: 'Türkçe',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  nl: 'Nederlands',
  pt: 'Português',
  ar: 'العربية',
  ru: 'Русский',
};

export function contentLanguageNativeName(code: string): string {
  return NATIVE_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

/**
 * The language named in the UI language, for use inside a sentence
 * ("İngilizce masallarda ..."). Chips and pickers show the native name.
 */
export function contentLanguageLabel(code: string): string {
  const key = `common:languageNames.${code.toLowerCase()}`;
  return i18n.exists(key) ? i18n.t(key) : contentLanguageNativeName(code);
}

// ─────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────

let instance: ContentLanguageStore | null = null;

export function getContentLanguageStore(): ContentLanguageStore {
  if (!instance) instance = new ContentLanguageStore();
  return instance;
}

export function useContentLanguage(): ContentLanguageStore {
  return useMemo(() => getContentLanguageStore(), []);
}

export { ContentLanguageStore };
