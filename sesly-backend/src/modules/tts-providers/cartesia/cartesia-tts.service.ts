import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  TTSProvider,
  TTSGenerationOptions,
  Voice,
  TTSProviderEnum,
  VoiceCloningCapableProvider,
  VoiceCloningOptions,
  VoiceCloneClip,
} from '../interfaces/tts-provider.interface';
import {
  PermanentVoiceCloningError,
  isPermanentCloningFailure,
} from '../voice-cloning-errors';
import {
  SONIC3_SPEED_MIN,
  SONIC3_SPEED_MAX,
  SONIC3_VOLUME_MIN,
  SONIC3_VOLUME_MAX,
} from './cartesia-emotions.constants';
import { toCartesiaLanguage } from './cartesia-language';
import { renderCartesiaTranscript } from './cartesia-transcript';
import { SettingsService } from '../../settings/settings.service';

/**
 * CARTESIA_DEFAULT_API_VERSION is used when CARTESIA_VERSION is not set.
 * CARTESIA_DEFAULT_MODEL documents the code default of the tts.cartesia.model
 * runtime setting (the registry is the source of truth at run time).
 */
export const CARTESIA_DEFAULT_API_VERSION = '2026-08-14';
export const CARTESIA_DEFAULT_MODEL = 'sonic-3.6';
/** Cartesia /voices/clone rejects clips above 16 MB. */
export const CARTESIA_MAX_CLIP_BYTES = 16 * 1024 * 1024;

/**
 * Cartesia Sonic text-to-speech + voice cloning provider (API 2026-08-14,
 * model sonic-3.6 by default).
 *
 * API reference: https://docs.cartesia.ai
 *   - POST /tts/bytes: single-shot synthesis, returns raw audio bytes
 *   - POST /voices/clone: multipart (clip, name, language, optional accent
 *     and description), returns the voice id
 *   - DELETE /voices/{id}: remove a cloned voice (idempotent on 404)
 *
 * Cartesia is used ONLY for user clones. There are no Cartesia presets (see
 * getAvailableVoices).
 */
@Injectable()
export class CartesiaTTSService
  implements TTSProvider, VoiceCloningCapableProvider {
  private readonly logger = new Logger(CartesiaTTSService.name);
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly apiVersion: string;

  // Model and default speed / volume / emotion are runtime settings
  // (tts.cartesia.*), read through SettingsService on every synthesis.
  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
    private settings: SettingsService,
  ) {
    this.apiKey = this.configService.get<string>('cartesia.apiKey') || '';
    this.apiUrl =
      this.configService.get<string>('cartesia.apiUrl') ||
      'https://api.cartesia.ai';
    this.apiVersion =
      this.configService.get<string>('cartesia.version') ||
      CARTESIA_DEFAULT_API_VERSION;

    if (!this.apiKey) {
      this.logger.warn(
        'CARTESIA_API_KEY is not set. Cartesia TTS will not work.',
      );
    }
  }

  getProviderName(): string {
    return TTSProviderEnum.CARTESIA;
  }

  async textToSpeech(
    text: string,
    voiceId: string,
    options?: TTSGenerationOptions,
  ): Promise<Buffer> {
    if (!this.apiKey) {
      throw new Error('Cartesia API key is missing');
    }

    const speed = this.clamp(
      options?.speed ?? this.settings.get('tts.cartesia.defaultSpeed'),
      SONIC3_SPEED_MIN,
      SONIC3_SPEED_MAX,
    );
    const volume = this.clamp(
      options?.volume ?? this.settings.get('tts.cartesia.defaultVolume'),
      SONIC3_VOLUME_MIN,
      SONIC3_VOLUME_MAX,
    );
    const emotion = options?.emotion ?? this.settings.get('tts.cartesia.defaultEmotion');
    const model = this.settings.get('tts.cartesia.model');

    const generationConfig: Record<string, unknown> = { speed, volume };
    if (emotion) {
      generationConfig.emotion = emotion;
    }

    const language = toCartesiaLanguage(options?.language);
    // Grouped segments: one transcript with inline speed and break tags.
    const transcript = options?.parts?.length ? renderCartesiaTranscript(options.parts, speed) : text;
    const body = this.buildTtsBody(transcript, voiceId, {
      language,
      generationConfig,
      pronunciationDictId: options?.pronunciationDictId,
      model,
    });

    try {
      this.logger.log(
        `Generating speech with Cartesia (${model}, lang=${language}, emotion=${emotion}, speed=${speed}, volume=${volume}) for voice: ${voiceId}`,
      );

      const response = await firstValueFrom(
        this.httpService.post(`${this.apiUrl}/tts/bytes`, body, {
          headers: {
            'X-API-Key': this.apiKey,
            'Cartesia-Version': this.apiVersion,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
        }),
      );

      return Buffer.from(response.data);
    } catch (error: any) {
      const errorMsg = this.extractErrorMessage(error);
      this.logger.error(`Cartesia TTS generation failed: ${errorMsg}`);
      throw new HttpException(
        `Cartesia TTS failed: ${errorMsg}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * /tts/bytes request body for API 2026-08-14. `voice` keeps `mode: 'id'`
   * (2026-08-14 allows extra properties on the voice object and only needs
   * `id`; older pinned versions require `mode`). The pronunciation
   * dictionary is a single `pronunciation_dict_id` string in this version.
   */
  buildTtsBody(
    text: string,
    voiceId: string,
    params: {
      language: string;
      generationConfig: Record<string, unknown>;
      pronunciationDictId?: string;
      /** Defaults to the tts.cartesia.model runtime setting. */
      model?: string;
    },
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model_id: params.model ?? this.settings.get('tts.cartesia.model'),
      transcript: text,
      voice: { mode: 'id', id: voiceId },
      output_format: {
        container: 'mp3',
        bit_rate: 128000,
        sample_rate: 44100,
      },
      language: params.language,
      generation_config: params.generationConfig,
    };
    if (params.pronunciationDictId) {
      body.pronunciation_dict_id = params.pronunciationDictId;
    }
    return body;
  }

  // =========================================================================
  // VOICE CLONING
  // =========================================================================

  /**
   * Create a Cartesia cloned voice from an in-memory clip (preferred) or a
   * URL the service downloads first.
   *
   * POST /voices/clone (API 2026-08-14) takes multipart `clip`, `name`,
   * `language` (ISO 639-1), an optional `accent` (accent id valid for that
   * language) and an optional `description`. Access defaults to private.
   * The accent is metadata only: if Cartesia rejects it, the clone is
   * requested once more without it, so a label can never fail a clone. Sonic 3.6+ learns from up to 60 s of the clip. Callers must
   * send WAV (the production pipeline transcodes every upload).
   *
   * @returns Cartesia voice id (e.g. `"a0e99841-..."`). The caller stores it
   *   as `voiceCloningKey` + `voiceId` on VoiceProfile.
   * @throws PermanentVoiceCloningError on input validation failures.
   */
  async createVoiceClone(
    source: string | VoiceCloneClip,
    voiceName: string,
    options?: VoiceCloningOptions,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Cartesia API key is missing');
    }

    const language = toCartesiaLanguage(options?.language);

    // Resolve the clip bytes + content-type + filename. URL input falls
    // back to wav assumption (matches what voice-training.processor uploads
    // to GCS as `.normalized.wav`).
    let clipBuffer: Buffer;
    let clipMime = 'audio/wav';
    let clipFilename = 'reference.wav';

    if (typeof source === 'string') {
      try {
        const download = await firstValueFrom(
          this.httpService.get(source, { responseType: 'arraybuffer' }),
        );
        clipBuffer = Buffer.from(download.data);
      } catch (error: any) {
        throw new Error(
          `Failed to download reference audio: ${error?.message ?? error}`,
        );
      }
    } else {
      clipBuffer = source.buffer;
      if (source.mimeType) clipMime = source.mimeType;
      if (source.filename) clipFilename = source.filename;
    }

    if (!clipBuffer || clipBuffer.length === 0) {
      throw new PermanentVoiceCloningError(
        'Reference audio is empty, cannot clone voice.',
      );
    }
    if (clipBuffer.length > CARTESIA_MAX_CLIP_BYTES) {
      throw new PermanentVoiceCloningError(
        `Reference audio is ${clipBuffer.length} bytes, above the 16 MB clone limit.`,
      );
    }

    // Diagnostic: Cartesia's "could not be processed" is generic so we
    // log the size + a magic-byte preview to triage whether we shipped a
    // valid container at all.
    const headerHex = clipBuffer.subarray(0, 12).toString('hex');
    const headerAscii = clipBuffer
      .subarray(0, 12)
      .toString('ascii')
      .replace(/[^\x20-\x7e]/g, '.');

    const accent = options?.accent?.trim() || undefined;
    const clip = { buffer: clipBuffer, mimeType: clipMime, filename: clipFilename };
    const postClone = (withAccent: boolean) =>
      firstValueFrom(
        this.httpService.post(
          `${this.apiUrl}/voices/clone`,
          this.buildCloneForm(
            clip,
            voiceName,
            language,
            options?.description,
            withAccent ? accent : undefined,
          ),
          {
            headers: {
              'X-API-Key': this.apiKey,
              'Cartesia-Version': this.apiVersion,
              // axios sets the multipart boundary itself: do not set Content-Type.
            },
            // Cartesia is generally fast (<10s) but allow headroom for slow uploads.
            timeout: 60_000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          },
        ),
      );

    try {
      this.logger.log(
        `Cloning voice with Cartesia (language=${language}, accent=${accent ?? 'not sent'}, clip=${clipBuffer.length} bytes, mime=${clipMime}, header=${headerHex} "${headerAscii}")`,
      );

      let response;
      try {
        response = await postClone(true);
      } catch (error: any) {
        if (!accent || !this.isAccentRejection(error)) throw error;
        this.logger.warn(
          `Cartesia rejected the accent label "${accent}" for language ${language}; cloning without it: ${this.extractErrorMessage(error)}`,
        );
        response = await postClone(false);
      }

      const data: any = response.data;
      const id: string | undefined =
        data?.id ?? data?.voice?.id ?? data?.data?.id;

      if (!id || typeof id !== 'string') {
        throw new Error(
          `Cartesia clone response did not include a voice id: ${JSON.stringify(data).slice(0, 300)}`,
        );
      }

      this.logger.log(`Cartesia voice clone created: ${id}`);
      return id;
    } catch (error: any) {
      const errorMsg = this.extractErrorMessage(error);
      const status = error?.response?.status;
      const rawBody = error?.response?.data;
      const rawBodyPreview = Buffer.isBuffer(rawBody)
        ? rawBody.toString('utf8').slice(0, 500)
        : typeof rawBody === 'object'
          ? JSON.stringify(rawBody).slice(0, 500)
          : String(rawBody ?? '').slice(0, 500);
      this.logger.error(
        `Cartesia voice cloning failed (status=${status ?? 'n/a'}): ${errorMsg}\n  upstream body: ${rawBodyPreview}`,
      );

      if (
        error instanceof PermanentVoiceCloningError ||
        isPermanentCloningFailure(errorMsg)
      ) {
        throw error instanceof PermanentVoiceCloningError
          ? error
          : new PermanentVoiceCloningError(errorMsg);
      }

      throw new HttpException(
        `Cartesia voice cloning failed: ${errorMsg}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * A 4xx answer that complains about the optional accent label (unknown
   * accent id, accent not valid for the language, field not accepted).
   */
  private isAccentRejection(error: any): boolean {
    const status = error?.response?.status;
    if (typeof status !== 'number' || status < 400 || status >= 500) return false;
    return /accent/i.test(this.extractErrorMessage(error));
  }

  /**
   * Multipart body for POST /voices/clone (API 2026-08-14): exactly
   * clip + name + language, plus accent and description when given. Uses
   * Node 18+ native FormData / Blob, which axios v1 serializes natively.
   */
  buildCloneForm(
    clip: VoiceCloneClip,
    voiceName: string,
    language: string,
    description?: string,
    accent?: string,
  ): FormData {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(clip.buffer)], { type: clip.mimeType });
    form.append('clip', blob, clip.filename);
    form.append('name', voiceName);
    form.append('language', language);
    if (accent) {
      // Plain string field: an accent id from Cartesia's GET /accents.
      form.append('accent', accent);
    }
    if (description) {
      form.append('description', description);
    }
    return form;
  }

  /**
   * Delete a Cartesia cloned voice. 404 is treated as success (idempotent)
   * because the audit-trail row should still be marked COMPLETED if the
   * voice no longer exists upstream.
   */
  async deleteVoiceClone(customVoiceId: string): Promise<void> {
    if (!customVoiceId || !customVoiceId.trim()) {
      this.logger.warn('deleteVoiceClone called with empty voice id, skipping');
      return;
    }
    if (!this.apiKey) {
      throw new Error('Cartesia API key is missing');
    }

    try {
      await firstValueFrom(
        this.httpService.delete(
          `${this.apiUrl}/voices/${encodeURIComponent(customVoiceId)}`,
          {
            headers: {
              'X-API-Key': this.apiKey,
              'Cartesia-Version': this.apiVersion,
            },
            timeout: 30_000,
          },
        ),
      );
      this.logger.log(`Cartesia voice clone deleted: ${customVoiceId}`);
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 404) {
        this.logger.log(
          `Cartesia voice ${customVoiceId} already gone (404) — treating as deleted.`,
        );
        return;
      }
      const errorMsg = this.extractErrorMessage(error);
      this.logger.error(
        `Cartesia voice deletion failed for ${customVoiceId}: ${errorMsg}`,
      );
      throw new HttpException(
        `Cartesia voice deletion failed: ${errorMsg}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // =========================================================================

  /**
   * Cartesia has NO ready-made (preset) voices in Sesly, on purpose.
   *
   * GET /voices on the org account returns every voice the org owns, which
   * includes every user's private clone (the response is paginated as
   * {data, has_more, next_page}). Listing it would leak other users' cloned
   * voices into the "Hazır Anlatıcılar" grid and let anyone narrate with them.
   * Ready-made narrators come from Google; Cartesia is clone-only, and
   * createVoiceProfileV2 only accepts the clone placeholder for CARTESIA.
   */
  async getAvailableVoices(): Promise<Voice[]> {
    return [];
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(Math.max(value, min), max);
  }

  /**
   * Cartesia returns errors as JSON, but when responseType is `arraybuffer`
   * axios delivers them as Buffer. Decode and surface a useful message.
   */
  private extractErrorMessage(error: any): string {
    const data = error?.response?.data;
    if (data) {
      if (Buffer.isBuffer(data)) {
        try {
          const parsed = JSON.parse(data.toString('utf8'));
          return (
            parsed?.error?.message ||
            parsed?.message ||
            data.toString('utf8')
          );
        } catch {
          return data.toString('utf8');
        }
      }
      return data?.error?.message || data?.message || JSON.stringify(data);
    }
    return error?.message || 'Unknown error';
  }
}
