import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GeminiModelOptions {
  /** Model ids usable for text generation, without the "models/" prefix. */
  models: string[];
  /** Why the list is empty (Turkish, shown in the panel); null on success. */
  reason: string | null;
  /** When the list was fetched from Google; null when there is no list. */
  fetchedAt: string | null;
}

export const GEMINI_MODELS_CACHE_TTL_MS = 10 * 60 * 1000;
export const GEMINI_MODELS_TIMEOUT_MS = 10_000;
const MAX_PAGES = 5;

/**
 * generateContent is also advertised by models that do not produce text
 * (speech, image, live audio, embeddings, robotics). They are useless for
 * story segmentation, so they are left out of the picker.
 */
const NON_TEXT_MODEL = /(tts|image|audio|embedding|aqa|live|robotics|computer-use|veo|imagen|lyria)/i;

/**
 * Lists the Gemini models the configured key can use for text generation.
 * Never throws: any failure becomes an empty list plus a reason, so the
 * admin panel can fall back to a free-text model field.
 */
@Injectable()
export class GeminiModelsService {
  private readonly logger = new Logger(GeminiModelsService.name);
  private cache: { at: number; models: string[] } | null = null;

  constructor(private readonly config: ConfigService) {}

  async listTextModels(): Promise<GeminiModelOptions> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < GEMINI_MODELS_CACHE_TTL_MS) {
      return this.ok(this.cache);
    }

    const apiKey = this.config.get<string>('gemini.apiKey') ?? '';
    if (!apiKey) {
      return this.failed('Gemini API anahtarı sunucuda tanımlı değil.');
    }
    const apiUrl =
      this.config.get<string>('gemini.apiUrl') ?? 'https://generativelanguage.googleapis.com';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_MODELS_TIMEOUT_MS);
    try {
      const ids = new Set<string>();
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const url =
          `${apiUrl}/v1beta/models?pageSize=1000` +
          (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
        // The key travels in a header, never in the URL, so it cannot end up in a log line.
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'x-goog-api-key': apiKey },
          signal: controller.signal,
        });
        if (!res.ok) {
          this.logger.warn(`Gemini model list request failed with HTTP ${res.status}`);
          return this.failed(`Gemini model listesi alınamadı (HTTP ${res.status}).`);
        }
        const json: any = await res.json();
        for (const model of Array.isArray(json?.models) ? json.models : []) {
          const id = typeof model?.name === 'string' ? model.name.replace(/^models\//, '') : '';
          const methods: unknown = model?.supportedGenerationMethods;
          if (!id || !Array.isArray(methods) || !methods.includes('generateContent')) continue;
          if (NON_TEXT_MODEL.test(id)) continue;
          ids.add(id);
        }
        pageToken = typeof json?.nextPageToken === 'string' && json.nextPageToken ? json.nextPageToken : undefined;
        if (!pageToken) break;
      }

      if (ids.size === 0) {
        return this.failed('Gemini bu anahtar için metin üretebilen bir model döndürmedi.');
      }
      this.cache = { at: Date.now(), models: [...ids].sort() };
      return this.ok(this.cache);
    } catch (error) {
      const aborted = (error as Error)?.name === 'AbortError';
      this.logger.warn(`Gemini model list request failed: ${(error as Error)?.message ?? error}`);
      return this.failed(
        aborted
          ? 'Gemini model listesi alınamadı: istek zaman aşımına uğradı.'
          : 'Gemini model listesi alınamadı: bağlantı hatası.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private ok(cache: { at: number; models: string[] }): GeminiModelOptions {
    return { models: [...cache.models], reason: null, fetchedAt: new Date(cache.at).toISOString() };
  }

  private failed(reason: string): GeminiModelOptions {
    return { models: [], reason, fetchedAt: null };
  }
}
