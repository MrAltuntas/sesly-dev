/**
 * Legal Service
 *
 * Thin client over the backend /legal endpoints (public, no auth required;
 * we still pipe through ApiClient so error handling and dev logging remain
 * consistent with the rest of the surface).
 *
 * Backend endpoints (`?language=tr|en`, absent: tr):
 *   GET /legal           LegalDocument[]
 *   GET /legal/:slug     LegalDocument (404 while no version is published)
 *
 * Every request names the language it asks for (the UI language). While a
 * document has no published text in that language the backend answers with
 * the Turkish one, and the document's `language` says so; the copy is still
 * kept under the language that was asked for, so the next read in that
 * language finds it (and its refresh picks up a translation once published).
 *
 * Cache-first (`read`):
 *   Every successful fetch is kept in memory and persisted to AsyncStorage
 *   under `legal:<language>:<slug>` (the language asked for) together with
 *   a timestamp. A read with a saved copy returns it at once
 *   (`fromCache: true`) and refreshes it in the background; the refresh
 *   reports through `onRefresh` (so a Turkish fallback kept under English
 *   gives way to the English text on the first read after it is
 *   published). Only without a saved copy does the read wait for the
 *   network. A 404 is its own result (`unpublished`) and removes the saved
 *   copy. Legal copy rarely changes, so an old copy beats a sheet that
 *   waits up to the request timeout.
 *
 * `prefetch` fills the cache ahead of time (Login and Registration call it
 * on mount in the UI language, so the documents open at once). It skips a
 * recently saved copy, but never a Turkish fallback of another language.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import ApiClient from './ApiClient';
import { hasApiStatus } from './ApiError';
import {
  LegalDocument,
  LegalLanguage,
  LegalRefresh,
  LegalResult,
  isLegalLanguageFallback,
  parseLegalDocumentFromJSON,
  parseLegalDocumentsFromJSON,
} from '../models/Legal';

// ============================================================================
// Cache constants
// ============================================================================

const CACHE_KEY_PREFIX = 'legal:';

/** A prefetch skips a document saved more recently than this. */
export const LEGAL_PREFETCH_FRESH_MS = 6 * 60 * 60 * 1000; // 6 hours

interface CachedEntry {
  cachedAt: number;
  doc: LegalDocument;
}

export interface LegalReadOptions {
  /**
   * The language to ask for (the UI language). The answer can be in Turkish
   * (`doc.language`) while that language's text is unpublished.
   */
  language: LegalLanguage;
  /**
   * Called once the background refresh of a saved copy settles: the new
   * document, `unpublished`, or `failed` (the saved copy stays). Not called
   * when the read had to wait for the network.
   */
  onRefresh?: (refresh: LegalRefresh) => void;
}

// ============================================================================
// Legal Service Class (Singleton)
// ============================================================================

class LegalService {
  private static instance: LegalService;

  /** Saved copies read or fetched this session, by cache key (language and slug). */
  private memory = new Map<string, CachedEntry>();
  /** One request per slug and language at a time (a prefetch and a read share it). */
  private inFlight = new Map<string, Promise<LegalResult>>();

  private constructor() {}

  public static getInstance(): LegalService {
    if (!LegalService.instance) {
      LegalService.instance = new LegalService();
    }
    return LegalService.instance;
  }

  /**
   * List all currently-published legal documents in `language` (each one
   * in Turkish while its text in that language is unpublished).
   *
   * Network-first. If the list call fails (offline / server down), we try to
   * stitch together whatever individual slugs we have cached for that
   * language so the Legal index screen still renders something useful.
   */
  public async list(language: LegalLanguage): Promise<LegalDocument[]> {
    try {
      const response = await ApiClient.get<unknown>('/legal', { params: { language } });
      const docs = parseLegalDocumentsFromJSON(response);

      await Promise.all(docs.map(doc => this.writeCache(doc.slug, language, doc)));
      return docs;
    } catch (error) {
      console.error('Failed to list legal documents:', error);
      const cached = await this.readAllCached(language);
      if (cached.length > 0) {
        return cached;
      }
      throw error;
    }
  }

  /**
   * One legal document, cache-first (see the file comment). Throws when
   * there is no saved copy and the request fails for any reason but a 404.
   */
  public async read(slug: string, options: LegalReadOptions): Promise<LegalResult> {
    if (!slug) {
      throw new Error('Legal document slug is required');
    }

    const { language, onRefresh } = options;
    const cached = await this.readCache(slug, language);
    if (cached) {
      this.request(slug, language).then(
        result => onRefresh?.(result),
        error => {
          console.warn(`[LegalService] Background refresh of "${slug}" failed:`, error);
          onRefresh?.({ status: 'failed', error });
        },
      );
      return { status: 'document', doc: { ...cached.doc, fromCache: true } };
    }

    try {
      return await this.request(slug, language);
    } catch (error) {
      console.error(`Failed to get legal document "${slug}":`, error);
      throw error;
    }
  }

  /**
   * The copy of `slug` asked for in `language` kept in memory this
   * session, without waiting (null before the first read or fetch). Lets a
   * sheet draw a known document in its first frame.
   */
  public peek(slug: string, language: LegalLanguage): LegalDocument | null {
    const entry = this.memory.get(this.cacheKey(slug, language));
    return entry ? { ...entry.doc, fromCache: true } : null;
  }

  /**
   * Fills the cache for `slug` in `language` so a later read is instant.
   * Skips a copy saved within LEGAL_PREFETCH_FRESH_MS, unless that copy is
   * the Turkish fallback of another language: that one is asked for again,
   * so a translation published meanwhile is there before the sheet opens
   * (instead of replacing the Turkish text in front of the reader). Never
   * throws.
   */
  public async prefetch(slug: string, language: LegalLanguage): Promise<void> {
    if (!slug) return;
    try {
      const cached = await this.readCache(slug, language);
      if (
        cached &&
        Date.now() - cached.cachedAt < LEGAL_PREFETCH_FRESH_MS &&
        !isLegalLanguageFallback(language, cached.doc.language)
      ) {
        return;
      }
      await this.request(slug, language);
    } catch (error) {
      console.warn(`[LegalService] Prefetch of "${slug}" failed:`, error);
    }
  }

  // ============================================================================
  // Network
  // ============================================================================

  /**
   * Fetches, saves (under the language asked for) and returns one document;
   * a 404 is `unpublished`.
   */
  private request(slug: string, language: LegalLanguage): Promise<LegalResult> {
    const key = this.cacheKey(slug, language);
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const run = (async (): Promise<LegalResult> => {
      try {
        const response = await ApiClient.get<unknown>(`/legal/${encodeURIComponent(slug)}`, {
          params: { language },
        });
        const doc = parseLegalDocumentFromJSON(response);
        await this.writeCache(slug, language, doc);
        return { status: 'document', doc };
      } catch (error) {
        if (hasApiStatus(error, 404)) {
          await this.removeCache(slug, language);
          return { status: 'unpublished' };
        }
        throw error;
      }
    })();

    this.inFlight.set(key, run);
    const clear = () => {
      if (this.inFlight.get(key) === run) this.inFlight.delete(key);
    };
    run.then(clear, clear);
    return run;
  }

  // ============================================================================
  // Cache helpers
  // ============================================================================

  /** Storage key of `slug` asked for in `language` (also the memory and request key). */
  private cacheKey(slug: string, language: LegalLanguage): string {
    return `${this.languagePrefix(language)}${slug}`;
  }

  private languagePrefix(language: LegalLanguage): string {
    return `${CACHE_KEY_PREFIX}${language}:`;
  }

  /** Saves `doc` as the copy of `slug` asked for in `language`. */
  private async writeCache(slug: string, language: LegalLanguage, doc: LegalDocument): Promise<void> {
    const key = this.cacheKey(slug, language);
    const payload: CachedEntry = {
      cachedAt: Date.now(),
      // Never persist the transient `fromCache` flag.
      doc: {
        slug: doc.slug,
        language: doc.language,
        title: doc.title,
        contentMd: doc.contentMd,
        version: doc.version,
        publishedAt: doc.publishedAt,
      },
    };
    this.memory.set(key, payload);
    try {
      await AsyncStorage.setItem(key, JSON.stringify(payload));
    } catch (err) {
      // Cache failure is non-fatal; just log.
      console.warn('[LegalService] Failed to write cache:', err);
    }
  }

  private async removeCache(slug: string, language: LegalLanguage): Promise<void> {
    const key = this.cacheKey(slug, language);
    this.memory.delete(key);
    try {
      await AsyncStorage.removeItem(key);
    } catch (err) {
      console.warn('[LegalService] Failed to remove cache:', err);
    }
  }

  /** The saved copy of `slug` asked for in `language`, however old, or null. */
  private async readCache(slug: string, language: LegalLanguage): Promise<CachedEntry | null> {
    const key = this.cacheKey(slug, language);
    const remembered = this.memory.get(key);
    if (remembered) return remembered;
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedEntry;
      if (!parsed || typeof parsed.cachedAt !== 'number' || !parsed.doc) {
        return null;
      }
      const entry: CachedEntry = {
        cachedAt: parsed.cachedAt,
        doc: parseLegalDocumentFromJSON(parsed.doc),
      };
      this.memory.set(key, entry);
      return entry;
    } catch (err) {
      console.warn('[LegalService] Failed to read cache:', err);
      return null;
    }
  }

  /** Every saved copy asked for in `language`. */
  private async readAllCached(language: LegalLanguage): Promise<LegalDocument[]> {
    try {
      const prefix = this.languagePrefix(language);
      const keys = await AsyncStorage.getAllKeys();
      const legalKeys = keys.filter(k => k.startsWith(prefix));
      if (legalKeys.length === 0) return [];

      const pairs = await AsyncStorage.multiGet(legalKeys);
      const docs: LegalDocument[] = [];
      for (const [, raw] of pairs) {
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as CachedEntry;
          if (parsed?.doc) {
            docs.push({ ...parseLegalDocumentFromJSON(parsed.doc), fromCache: true });
          }
        } catch {
          // skip malformed entry
        }
      }
      return docs;
    } catch (err) {
      console.warn('[LegalService] Failed to read cached list:', err);
      return [];
    }
  }

  /** Test hook: forgets the in-memory copies and requests. */
  public resetForTests(): void {
    this.memory.clear();
    this.inFlight.clear();
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export default LegalService.getInstance();
