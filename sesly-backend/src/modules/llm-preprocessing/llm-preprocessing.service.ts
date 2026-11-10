import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import {
  SONIC3_BEDTIME_EMOTIONS,
  SONIC3_EXTENDED_EMOTIONS,
  SONIC3_SPEED_MAX,
  SONIC3_SPEED_MIN,
  SONIC3_VOLUME_MAX,
  SONIC3_VOLUME_MIN,
} from '../tts-providers/cartesia/cartesia-emotions.constants';
import { AgeGroup, LanguageLevel } from '../../common/enums/prisma.enums';
import {
  AGE_GROUPS,
  AGE_GROUP_ASSESSMENT_SCHEMA,
  ageGroupAssessmentPrompt,
  LANGUAGE_LEVELS,
  LEVEL_ASSESSMENT_SCHEMA,
  TRANSLATION_SCHEMA,
  describeLanguage,
  levelAssessmentPrompt,
  segmentationPromptFor,
  translationPrompt,
} from './story-llm.prompts';
import {
  LlmOutputRejectedError,
  checkTranslation,
  normaliseTypography,
  splitParagraphs,
} from './translation-guards';

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export interface LlmStorySegment {
  text: string;
  emotion?: string;
  speed?: number;
  volume?: number;
}

export interface LlmPreprocessingResult {
  /** Final segments after defensive validation. Safe to PATCH onto a Story. */
  segments: LlmStorySegment[];
  /** Raw LLM output before any normalization (debug / audit). */
  rawSegments: LlmStorySegment[];
  /** Which model produced this — stored on Story.preprocessedModel. */
  modelUsed: string;
  /** End-to-end LLM call duration. */
  durationMs: number;
  /** Token usage if reported by the API. */
  usage?: {
    promptTokens?: number;
    candidatesTokens?: number;
    thoughtsTokens?: number;
    totalTokens?: number;
  };
  /** Human-readable list of normalizations applied (shown to admin). */
  warnings: string[];
}

export interface LanguageLevelAssessment {
  level: LanguageLevel;
  /** 0..1, how sure the model is. */
  confidence: number;
  /** One or two Turkish sentences explaining the choice. */
  note: string;
  modelUsed: string;
}

export interface AgeGroupAssessment {
  ageGroup: AgeGroup;
  /** 0..1, how sure the model is. */
  confidence: number;
  /** One or two Turkish sentences explaining the choice. */
  note: string;
  modelUsed: string;
}

export interface StoryTranslationInput {
  title: string;
  summary?: string | null;
  content: string;
  /** Content language code of the source text. */
  language: string;
}

export interface StoryTranslationResult {
  title: string;
  /** Null when the source has no summary (the model never writes its own). */
  summary: string | null;
  content: string;
  modelUsed: string;
  durationMs: number;
  /** Paragraphs of the source / of the translation. */
  sourceParagraphs: number;
  translatedParagraphs: number;
  /** Translated length / source length (characters without whitespace). */
  lengthRatio: number;
}

interface GeminiCall {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  model: string;
}

export class LlmContentDriftError extends Error {
  constructor(
    message: string,
    public readonly editDistance: number,
    public readonly diffSnippet: string,
  ) {
    super(message);
    this.name = 'LlmContentDriftError';
  }
}

// =============================================================================
// SCHEMA (the prompts live in story-llm.prompts.ts)
// =============================================================================

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    segments: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          emotion: {
            type: 'STRING',
            enum: SONIC3_EXTENDED_EMOTIONS as unknown as string[],
            format: 'enum',
          },
          speed: { type: 'NUMBER' },
          volume: { type: 'NUMBER' },
        },
        required: ['text', 'emotion', 'speed'],
        propertyOrdering: ['text', 'emotion', 'speed', 'volume'],
      },
    },
  },
  required: ['segments'],
};

// =============================================================================
// CONSTANTS
// =============================================================================

// The five children-safe emotions the prompt asks for. We don't enforce this
// at the schema level (schema allows the extended set so admin can still pick
// uncommon emotions manually); but we WARN when LLM uses something outside
// this list because it's almost certainly an instruction-following slip.
const ALLOWED_EMOTIONS_BEDTIME: readonly string[] = SONIC3_BEDTIME_EMOTIONS;

const SEGMENT_MIN_CHARS = 80;
// Maximum acceptable whitespace-tolerant edit distance before we reject.
// The test harness showed `gemini-3-flash-preview` reliably produces 0,
// so any drift here is a real problem worth surfacing.
const MAX_TOLERATED_DRIFT = 0;

/** Level assessment reads at most this much of a story (plenty to judge the language). */
export const LEVEL_ASSESSMENT_MAX_CHARS = 20_000;
/** An invalid level answer is asked for once more, then the call fails. */
export const LEVEL_ASSESSMENT_ATTEMPTS = 2;
const LEVEL_NOTE_MAX_CHARS = 600;
const TRANSLATED_TITLE_MAX_CHARS = 300;

// =============================================================================
// SERVICE
// =============================================================================

@Injectable()
export class LlmPreprocessingService {
  private readonly logger = new Logger(LlmPreprocessingService.name);
  private readonly apiKey: string;
  private readonly apiUrl: string;

  // Model, temperature, thinking budget and timeout are runtime settings
  // (llm.gemini.*): read through SettingsService on every call, never cached
  // here, so a change in the admin panel applies to the next request.
  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {
    this.apiKey = this.config.get<string>('gemini.apiKey') ?? '';
    this.apiUrl =
      this.config.get<string>('gemini.apiUrl') ??
      'https://generativelanguage.googleapis.com';

    if (!this.apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY not set — LLM preprocessing will reject every request.',
      );
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Run the full preprocess pipeline:
   *   1. Call Gemini with the production prompt + schema.
   *   2. Validate JSON shape.
   *   3. Run 4 defensive layers:
   *      - content drift detection (whitespace-tolerant)
   *      - whitespace re-injection (LLM eats spaces between segments)
   *      - consecutive-scared cooldown
   *      - undersized segment merge
   *   4. Return the cleaned segments + the warnings the admin should see.
   */
  async preprocessStory(
    content: string,
    language?: string | null,
  ): Promise<LlmPreprocessingResult> {
    this.assertConfigured();

    const start = Date.now();
    // One read per run so the reported model is the one that was called.
    const model = this.settings.get('llm.gemini.model');
    // The prompt is written per story language (Turkish when not stated).
    const prompt = segmentationPromptFor(language);
    const apiResp = await this.callGemini({
      system: prompt.system,
      user: `${prompt.userLabel}:\n\n${content}`,
      schema: RESPONSE_SCHEMA,
      model,
    });
    const durationMs = Date.now() - start;

    let parsed: { segments: LlmStorySegment[] };
    try {
      parsed = JSON.parse(apiResp.text);
    } catch (err: any) {
      throw new BadGatewayException(
        `Gemini returned non-JSON: ${err?.message ?? err}`,
      );
    }

    // `null`, a bare number/string or an array parse fine but carry no
    // segments; all of them are malformed model output (502), never a 500.
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.segments) ||
      parsed.segments.length === 0
    ) {
      throw new BadGatewayException(
        'Gemini response had no usable segments array.',
      );
    }

    const rawSegments = parsed.segments.map((s) => ({
      text: typeof s.text === 'string' ? s.text : '',
      ...(typeof s.emotion === 'string' ? { emotion: s.emotion } : {}),
      ...(typeof s.speed === 'number' ? { speed: s.speed } : {}),
      ...(typeof s.volume === 'number' ? { volume: s.volume } : {}),
    }));

    const warnings: string[] = [];

    // -----------------------------------------------------------------
    // Layer 1: Content drift detection (whitespace-tolerant)
    // -----------------------------------------------------------------
    const reconstructed = rawSegments.map((s) => s.text).join('');
    const stripWs = (s: string) => s.replace(/\s+/g, '');
    const reconNoWs = stripWs(reconstructed);
    const origNoWs = stripWs(content);
    if (reconNoWs !== origNoWs) {
      const dist = this.levenshteinSafe(reconNoWs, origNoWs);
      const diffPos = this.firstDiffIndex(reconNoWs, origNoWs);
      const diff =
        `recon: ${this.snippet(reconNoWs, diffPos)} | ` +
        `orig: ${this.snippet(origNoWs, diffPos)}`;
      this.logger.error(
        `Gemini content drift detected (ws-tolerant edit dist ${dist}): ${diff}`,
      );
      throw new LlmContentDriftError(
        `LLM hikayeyi degistirdi (${dist} karakter farki). Sonuc reddedildi.`,
        dist,
        diff,
      );
    }

    // -----------------------------------------------------------------
    // Layer 2: Whitespace re-injection
    //   When LLM eats the space between segments, we reinflate it from
    //   the original text by walking it char-by-char and reattaching any
    //   whitespace that lives at the segment boundary.
    // -----------------------------------------------------------------
    let segments = this.reinjectWhitespace(rawSegments, content, warnings);

    // -----------------------------------------------------------------
    // Layer 3: Consecutive-scared cooldown
    //   Prompt rule: "ardisik iki segment SCARED olmasin". When LLM
    //   drops two scared in a row, demote the second one to 'excited'
    //   (closest neighbor in arousal but won't fatigue the listener).
    // -----------------------------------------------------------------
    let scaredFixCount = 0;
    for (let i = 1; i < segments.length; i++) {
      if (segments[i].emotion === 'scared' && segments[i - 1].emotion === 'scared') {
        segments[i] = { ...segments[i], emotion: 'excited' };
        scaredFixCount++;
      }
    }
    if (scaredFixCount > 0) {
      warnings.push(
        `${scaredFixCount} ardisik 'scared' segmenti 'excited' olarak degistirildi.`,
      );
    }

    // -----------------------------------------------------------------
    // Layer 4: Merge undersized segments
    //   Prompt asks for 80-400 char range. Lite models tend to over-split.
    //   Merge any <80 char segment with the previous one; a short FIRST
    //   segment (e.g. a title line) is folded into the next one. The
    //   metadata of the segment it is merged into wins; missing fields are
    //   filled from the short one.
    // -----------------------------------------------------------------
    const merged: LlmStorySegment[] = [];
    let mergeCount = 0;
    let firstMerged = false;
    for (const seg of segments) {
      if (seg.text.length < SEGMENT_MIN_CHARS && merged.length > 0) {
        const prev = merged[merged.length - 1];
        // If the merged result would still be reasonable, fold it in.
        merged[merged.length - 1] = {
          text: prev.text + seg.text,
          emotion: prev.emotion ?? seg.emotion,
          speed: prev.speed ?? seg.speed,
          volume: prev.volume ?? seg.volume,
        };
        mergeCount++;
      } else {
        merged.push({ ...seg });
      }
    }
    if (
      merged.length > 1 &&
      merged[0].text.length < SEGMENT_MIN_CHARS
    ) {
      const [first, next] = merged;
      merged.splice(0, 2, {
        text: first.text + next.text,
        emotion: next.emotion ?? first.emotion,
        speed: next.speed ?? first.speed,
        volume: next.volume ?? first.volume,
      });
      firstMerged = true;
    }
    segments = merged;
    if (mergeCount > 0) {
      warnings.push(
        `${mergeCount} kisa segment (<80 karakter) bir oncekiyle birlestirildi.`,
      );
    }
    if (firstMerged) {
      warnings.push('Kisa ilk segment (<80 karakter) bir sonrakiyle birlestirildi.');
    }

    // -----------------------------------------------------------------
    // Layer 5 (soft): emotion not in bedtime whitelist?
    //   Schema accepts the extended Sonic 3 list; we only WARN if the
    //   LLM picked an "adult" emotion. Admin can keep it or override.
    // -----------------------------------------------------------------
    const offWhitelist = segments.filter(
      (s) => s.emotion && !ALLOWED_EMOTIONS_BEDTIME.includes(s.emotion),
    );
    if (offWhitelist.length > 0) {
      const samples = offWhitelist
        .slice(0, 3)
        .map((s) => s.emotion)
        .join(', ');
      warnings.push(
        `${offWhitelist.length} segment 'bedtime' duygu listesi disinda (${samples}). Admin kontrol etmeli.`,
      );
    }

    return {
      segments,
      rawSegments,
      modelUsed: model,
      durationMs,
      usage: apiResp.usage,
      warnings,
    };
  }

  // =========================================================================
  // LANGUAGE LEVEL (CEFR)
  // =========================================================================

  /**
   * CEFR level of a story as LISTENING material for a learner of
   * `language`. The answer is validated (level in A1..C2, confidence 0..1,
   * a non-empty note); an invalid answer is asked for once more and then
   * rejected with LlmOutputRejectedError. Provider errors propagate.
   */
  async assessLanguageLevel(
    content: string,
    language: string,
  ): Promise<LanguageLevelAssessment> {
    this.assertConfigured();

    const text = (content ?? '').trim().slice(0, LEVEL_ASSESSMENT_MAX_CHARS);
    if (!text) {
      throw new LlmOutputRejectedError('INVALID_ANSWER', 'Masal metni boş, seviye değerlendirilemez.');
    }

    const model = this.settings.get('llm.gemini.model');
    let problem = '';
    for (let attempt = 1; attempt <= LEVEL_ASSESSMENT_ATTEMPTS; attempt++) {
      const apiResp = await this.callGemini({
        system: levelAssessmentPrompt(language),
        user: `STORY (${describeLanguage(language)}):\n\n${text}`,
        schema: LEVEL_ASSESSMENT_SCHEMA,
        model,
      });
      const parsed = this.parseLevelAnswer(apiResp.text);
      if (typeof parsed !== 'string') {
        return { ...parsed, modelUsed: model };
      }
      problem = parsed;
      this.logger.warn(
        `Invalid level assessment answer (attempt ${attempt}/${LEVEL_ASSESSMENT_ATTEMPTS}): ${problem}`,
      );
    }
    throw new LlmOutputRejectedError(
      'INVALID_ANSWER',
      `Model geçerli bir seviye yanıtı vermedi (${problem}).`,
    );
  }

  /** The validated answer, or a Turkish description of what is wrong with it. */
  private parseLevelAnswer(raw: string): Omit<LanguageLevelAssessment, 'modelUsed'> | string {
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      return 'yanıt JSON değil';
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return 'yanıt bir nesne değil';
    }
    const level = typeof json.level === 'string' ? json.level.trim().toUpperCase() : '';
    if (!(LANGUAGE_LEVELS as readonly string[]).includes(level)) {
      return 'seviye A1 ile C2 arasında değil';
    }
    const confidence = json.confidence;
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return 'güven değeri 0 ile 1 arasında bir sayı değil';
    }
    const note = typeof json.note === 'string' ? normaliseTypography(json.note).replace(/\s+/g, ' ') : '';
    if (!note) {
      return 'açıklama boş';
    }
    return {
      level: level as LanguageLevel,
      confidence: Math.round(confidence * 100) / 100,
      note: note.slice(0, LEVEL_NOTE_MAX_CHARS),
    };
  }

  // =========================================================================
  // AGE GROUP
  // =========================================================================

  /**
   * Age band a story suits as a bedtime story for a native-speaking child.
   * Same contract as assessLanguageLevel: the answer is validated (one of
   * the four bands, confidence 0..1, a non-empty note); an invalid answer
   * is asked for once more and then rejected with LlmOutputRejectedError.
   * Provider errors propagate.
   */
  async assessAgeGroup(content: string, language: string): Promise<AgeGroupAssessment> {
    this.assertConfigured();

    const text = (content ?? '').trim().slice(0, LEVEL_ASSESSMENT_MAX_CHARS);
    if (!text) {
      throw new LlmOutputRejectedError('INVALID_ANSWER', 'Masal metni boş, yaş grubu değerlendirilemez.');
    }

    const model = this.settings.get('llm.gemini.model');
    let problem = '';
    for (let attempt = 1; attempt <= LEVEL_ASSESSMENT_ATTEMPTS; attempt++) {
      const apiResp = await this.callGemini({
        system: ageGroupAssessmentPrompt(language),
        user: `STORY (${describeLanguage(language)}):\n\n${text}`,
        schema: AGE_GROUP_ASSESSMENT_SCHEMA,
        model,
      });
      const parsed = this.parseAgeGroupAnswer(apiResp.text);
      if (typeof parsed !== 'string') {
        return { ...parsed, modelUsed: model };
      }
      problem = parsed;
      this.logger.warn(
        `Invalid age group answer (attempt ${attempt}/${LEVEL_ASSESSMENT_ATTEMPTS}): ${problem}`,
      );
    }
    throw new LlmOutputRejectedError(
      'INVALID_ANSWER',
      `Model geçerli bir yaş grubu yanıtı vermedi (${problem}).`,
    );
  }

  /** The validated answer, or a Turkish description of what is wrong with it. */
  private parseAgeGroupAnswer(raw: string): Omit<AgeGroupAssessment, 'modelUsed'> | string {
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      return 'yanıt JSON değil';
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return 'yanıt bir nesne değil';
    }
    const ageGroup = typeof json.ageGroup === 'string' ? json.ageGroup.trim().toUpperCase() : '';
    if (!(AGE_GROUPS as readonly string[]).includes(ageGroup)) {
      return 'yaş grubu geçerli değerlerden biri değil';
    }
    const confidence = json.confidence;
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return 'güven değeri 0 ile 1 arasında bir sayı değil';
    }
    const note = typeof json.note === 'string' ? normaliseTypography(json.note).replace(/\s+/g, ' ') : '';
    if (!note) {
      return 'açıklama boş';
    }
    return {
      ageGroup: ageGroup as AgeGroup,
      confidence: Math.round(confidence * 100) / 100,
      note: note.slice(0, LEVEL_NOTE_MAX_CHARS),
    };
  }

  // =========================================================================
  // TRANSLATION
  // =========================================================================

  /**
   * Translates a story into `targetLanguage`. The text goes to the model as
   * an ordered list of paragraphs and comes back the same way, so the
   * paragraph structure can be checked one to one. Before returning, the
   * typography is normalised (no em dash, no emoji) and the guards in
   * translation-guards.ts run; a translation that fails one is rejected
   * with LlmOutputRejectedError (Turkish reason) and must not be saved.
   */
  async translateStory(
    story: StoryTranslationInput,
    targetLanguage: string,
  ): Promise<StoryTranslationResult> {
    this.assertConfigured();

    const source = splitParagraphs(story.content);
    if (source.paragraphs.length === 0) {
      throw new LlmOutputRejectedError('TRANSLATION_GUARD', 'Masal metni boş, çevrilemez.');
    }
    const sourceSummary = (story.summary ?? '').trim();

    const start = Date.now();
    const model = this.settings.get('llm.gemini.model');
    const apiResp = await this.callGemini({
      system: translationPrompt(story.language, targetLanguage),
      user:
        `STORY (${describeLanguage(story.language)}, translate into ${describeLanguage(targetLanguage)}):\n\n` +
        JSON.stringify(
          { title: story.title, summary: sourceSummary, paragraphs: source.paragraphs },
          null,
          2,
        ),
      schema: TRANSLATION_SCHEMA,
      model,
    });
    const durationMs = Date.now() - start;

    let json: any;
    try {
      json = JSON.parse(apiResp.text);
    } catch {
      json = null;
    }
    if (
      !json ||
      typeof json !== 'object' ||
      typeof json.title !== 'string' ||
      !Array.isArray(json.paragraphs) ||
      json.paragraphs.some((p: unknown) => typeof p !== 'string')
    ) {
      throw new LlmOutputRejectedError(
        'INVALID_ANSWER',
        'Model geçerli bir çeviri yanıtı vermedi (başlık ya da paragraf listesi eksik).',
      );
    }

    const title = normaliseTypography(json.title)
      .replace(/\s+/g, ' ')
      .replace(/^["'\u201C\u201D\u00AB\u00BB\u201E]+|["'\u201C\u201D\u00AB\u00BB\u201E]+$/g, '')
      .trim()
      .slice(0, TRANSLATED_TITLE_MAX_CHARS);
    const paragraphs = (json.paragraphs as string[]).map((p) => normaliseTypography(p));
    const summary =
      sourceSummary && typeof json.summary === 'string'
        ? normaliseTypography(json.summary).replace(/\s+/g, ' ')
        : '';

    const check = checkTranslation(
      { title: story.title, paragraphs: source.paragraphs },
      { title, paragraphs },
    );

    return {
      title,
      summary: summary || null,
      content: paragraphs.join(source.separator),
      modelUsed: model,
      durationMs,
      ...check,
    };
  }

  // =========================================================================
  // GEMINI API CALL (raw fetch — no SDK dependency)
  // =========================================================================

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Gemini API key is not configured on the server.',
      );
    }
  }

  private async callGemini(call: GeminiCall): Promise<{
    text: string;
    usage?: LlmPreprocessingResult['usage'];
  }> {
    const url = `${this.apiUrl}/v1beta/models/${encodeURIComponent(call.model)}:generateContent`;

    const generationConfig: Record<string, unknown> = {
      temperature: this.settings.get('llm.gemini.temperature'),
      topP: 0.95,
      maxOutputTokens: 32_768,
      responseMimeType: 'application/json',
      responseSchema: call.schema,
    };
    generationConfig.thinkingConfig = {
      thinkingBudget: this.settings.get('llm.gemini.thinkingBudget'),
      includeThoughts: false,
    };

    const body = {
      systemInstruction: { parts: [{ text: call.system }] },
      contents: [{ role: 'user', parts: [{ text: call.user }] }],
      generationConfig,
    };

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.settings.get('llm.gemini.timeoutMs'),
    );
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // res.json() consumes the body, so keep a clone to read the raw text
      // for the diagnostic snippet when the body is not JSON.
      const backup = typeof res.clone === 'function' ? res.clone() : null;
      let json: any;
      try {
        json = await res.json();
      } catch (e: any) {
        const txt = await (backup ?? res).text().catch(() => '');
        throw new BadGatewayException(
          `Gemini non-JSON response (status ${res.status}): ${txt.slice(0, 200)}`,
        );
      }

      if (!res.ok) {
        const msg = json?.error?.message ?? JSON.stringify(json).slice(0, 300);
        if (res.status === 429 || res.status === 503) {
          throw new ServiceUnavailableException(`Gemini ${res.status}: ${msg}`);
        }
        throw new BadGatewayException(`Gemini ${res.status}: ${msg}`);
      }

      const text: string | undefined =
        json?.candidates?.[0]?.content?.parts?.[0]?.text;
      const finishReason: string | undefined =
        json?.candidates?.[0]?.finishReason;

      if (!text) {
        throw new BadGatewayException(
          `Gemini returned empty text (finishReason=${finishReason})`,
        );
      }

      const usageMeta = json?.usageMetadata ?? null;
      return {
        text,
        usage: usageMeta
          ? {
            promptTokens: usageMeta.promptTokenCount,
            candidatesTokens: usageMeta.candidatesTokenCount,
            thoughtsTokens: usageMeta.thoughtsTokenCount,
            totalTokens: usageMeta.totalTokenCount,
          }
          : undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // =========================================================================
  // WHITESPACE RE-INJECTION
  //
  // Walk the original story char-by-char. For each LLM segment, find
  // where its (whitespace-stripped) text falls in the (whitespace-stripped)
  // original — then read off the corresponding raw slice from the original
  // including any whitespace at the segment boundary. This guarantees the
  // reconstructed `segments[].text.join('')` matches the original verbatim.
  //
  // Pre-condition: the whitespace-stripped reconstruction MUST already match
  // (Layer 1 enforces this). If it doesn't, this function will quietly
  // return the original segments unchanged.
  // =========================================================================

  private reinjectWhitespace(
    raw: LlmStorySegment[],
    original: string,
    warnings: string[],
  ): LlmStorySegment[] {
    let cursor = 0;
    const out: LlmStorySegment[] = [];
    let injected = 0;

    for (let i = 0; i < raw.length; i++) {
      const seg = raw[i];
      const segNoWs = seg.text.replace(/\s+/g, '');

      // Skip leading whitespace in the original to find segment start.
      while (cursor < original.length && /\s/.test(original[cursor])) {
        cursor++;
      }
      const segStart = cursor;

      // Walk through original, matching non-ws chars one by one against
      // the segment's non-ws chars. When matched count == segNoWs.length,
      // we've found the segment's end in the original.
      let matched = 0;
      while (cursor < original.length && matched < segNoWs.length) {
        const c = original[cursor];
        if (!/\s/.test(c)) {
          // Defensive: char must match the next non-ws char in segNoWs.
          if (c !== segNoWs[matched]) {
            // Drift we couldn't reconcile — give up, return raw.
            this.logger.warn(
              `Whitespace re-injection bailed at segment ${i}, char ${cursor}.`,
            );
            return raw;
          }
          matched++;
        }
        cursor++;
      }
      const segEnd = cursor;

      // For segments after the first, also greedily consume trailing
      // whitespace BEFORE the next non-ws char so paragraph breaks stick
      // to the previous segment (mimics the prompt's example).
      let trailingEnd = segEnd;
      if (i < raw.length - 1) {
        while (trailingEnd < original.length && /\s/.test(original[trailingEnd])) {
          trailingEnd++;
        }
        cursor = trailingEnd;
      }

      const finalText = original.slice(segStart, trailingEnd);
      if (finalText !== seg.text) injected++;
      out.push({
        text: finalText,
        ...(seg.emotion ? { emotion: seg.emotion } : {}),
        ...(typeof seg.speed === 'number' ? { speed: seg.speed } : {}),
        ...(typeof seg.volume === 'number' ? { volume: seg.volume } : {}),
      });
    }

    // Flush any trailing whitespace from the original onto the last segment
    // so the reconstruction is byte-exact.
    if (out.length > 0 && cursor < original.length) {
      const last = out[out.length - 1];
      out[out.length - 1] = { ...last, text: last.text + original.slice(cursor) };
    }

    if (injected > 0) {
      warnings.push(
        `${injected} segmentin sinirinda eksik bosluk/satir tespit edildi ve orijinal metinden geri eklendi.`,
      );
    }
    return out;
  }

  // =========================================================================
  // SMALL HELPERS
  // =========================================================================

  private levenshteinSafe(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;
    if (Math.abs(m - n) > 1000 && Math.max(m, n) > 5000) {
      // Bail out on pathological inputs so we don't allocate gigabytes.
      return Math.max(m, n);
    }
    let prev = new Uint32Array(n + 1);
    let curr = new Uint32Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      [prev, curr] = [curr, prev];
    }
    return prev[n];
  }

  private firstDiffIndex(a: string, b: string): number {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) if (a[i] !== b[i]) return i;
    return a.length === b.length ? -1 : len;
  }

  private snippet(s: string, idx: number, ctx = 30): string {
    if (idx < 0 || idx >= s.length) return '(eos)';
    const start = Math.max(0, idx - ctx);
    const end = Math.min(s.length, idx + ctx);
    return JSON.stringify(s.slice(start, end));
  }

  // Re-export for the schema validator on the admin segments DTO so we
  // don't accidentally drift between LLM-produced and admin-edited values.
  static readonly SPEED_MIN = SONIC3_SPEED_MIN;
  static readonly SPEED_MAX = SONIC3_SPEED_MAX;
  static readonly VOLUME_MIN = SONIC3_VOLUME_MIN;
  static readonly VOLUME_MAX = SONIC3_VOLUME_MAX;
}
