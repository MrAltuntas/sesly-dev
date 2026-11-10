/**
 * Voice clone flow: pure models and rules.
 *
 * - CloneConfig: GET /voice-profiles/clone-config?language= (durations, the
 *   reading script, the consent text + version and the optional intro steps
 *   + recording tips in the language the user will speak, plus the languages
 *   a voice can be recorded in).
 *   Parsed defensively; durations and script fall back to VOICE_CLONING
 *   constants, consent fields never do. Intro steps and recording tips are
 *   optional (older backends omit them): malformed items are dropped and the
 *   field is left out when nothing usable remains, so screens fall back to
 *   their built-in copy.
 * - Recording gating: when a take may be stopped, auto-stopped, or accepted.
 * - Input level classification for the live meter.
 * - Error-code mapping for clone create/upload failures: every known code is
 *   explained with app copy in the UI language (the backend's sentences are
 *   Turkish only), the creation allowance through the quota model.
 *
 * Nothing here touches native modules, so it is unit tested directly.
 */

import { VOICE_CLONING } from '../config/constants';
import { getErrorMessage, isApiError } from '../services/ApiError';
import i18n from '../i18n';
import { msg } from '../i18n/messages';
import { DEFAULT_VOICE_LANGUAGE, languageCodeOf } from './VoiceProfile';
import { PLANS, type PlanId } from './Plans';
import {
  QUOTA_CODES,
  QuotaBlock,
  QuotaCopy,
  describeQuotaBlock,
  parseQuotaBlock,
} from './Quota';

// ============================================================================
// Clone config
// ============================================================================

export interface CloneDurations {
  readonly minSeconds: number;
  readonly targetSeconds: number;
  readonly maxSeconds: number;
}

/** One numbered step on the clone intro screen (CreateVoiceProfile). */
export interface CloneIntroStep {
  readonly title: string;
  readonly body: string;
}

/** Icon keys the backend may send with a recording tip. */
export const RECORDING_TIP_ICONS = ['quiet', 'distance', 'calm', 'pauses'] as const;
export type RecordingTipIcon = (typeof RECORDING_TIP_ICONS)[number];

/** One line of the "before you record" guidance on VoiceRecording. */
export interface CloneRecordingTip {
  /** null when the backend sent an icon key this build does not know. */
  readonly icon: RecordingTipIcon | null;
  readonly text: string;
}

/** A language a voice can be recorded in (clone config `supportedLanguages`). */
export interface VoiceLanguage {
  /** Content language code, "tr". */
  readonly code: string;
  /** Locale sent when the voice is created, "tr-TR". */
  readonly locale: string;
  /** The language in its own name, "Türkçe". */
  readonly nativeName: string;
  readonly englishName: string;
}

export interface CloneConfig extends CloneDurations {
  readonly enabled: boolean;
  readonly provider: string;
  /** Content language code the texts below are written in, "tr". */
  readonly language: string;
  /** Locale of that language, sent as `language` when the voice is created. */
  readonly locale: string;
  /**
   * The languages a voice can be recorded in. Empty when the backend does
   * not offer a choice yet (older backends): the flow is Turkish then and
   * shows no language step.
   */
  readonly supportedLanguages: readonly VoiceLanguage[];
  readonly scriptTitle: string;
  readonly script: string;
  readonly consentVersion: string;
  readonly consentTitle: string;
  readonly consentText: string;
  /** Served intro steps; absent when the backend sent none usable. */
  readonly introSteps?: readonly CloneIntroStep[];
  /** Served recording tips; absent when the backend sent none usable. */
  readonly recordingTips?: readonly CloneRecordingTip[];
}

export const FALLBACK_CLONE_DURATIONS: CloneDurations = {
  minSeconds: VOICE_CLONING.FALLBACK_MIN_SECONDS,
  targetSeconds: VOICE_CLONING.FALLBACK_TARGET_SECONDS,
  maxSeconds: VOICE_CLONING.FALLBACK_MAX_SECONDS,
};

const defaultConsentTitle = (): string => msg('clone.consentTitle');

/** Thrown when the config cannot be used (missing consent text/version). */
export class CloneConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloneConfigError';
    Object.setPrototypeOf(this, CloneConfigError.prototype);
  }
}

function positiveNumber(raw: unknown): number | null {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim()
        ? Number(raw)
        : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonEmptyString(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

/**
 * Durations with per-field fallback. If the combination is inconsistent
 * (max below min) the whole set falls back; target is clamped into range.
 */
export function resolveCloneDurations(data: Record<string, unknown>): CloneDurations {
  const min = positiveNumber(data.minSeconds) ?? FALLBACK_CLONE_DURATIONS.minSeconds;
  const max = positiveNumber(data.maxSeconds) ?? FALLBACK_CLONE_DURATIONS.maxSeconds;
  if (max < min) {
    return FALLBACK_CLONE_DURATIONS;
  }
  const rawTarget =
    positiveNumber(data.targetSeconds) ?? FALLBACK_CLONE_DURATIONS.targetSeconds;
  const target = Math.min(Math.max(rawTarget, min), max);
  return { minSeconds: min, targetSeconds: target, maxSeconds: max };
}

/** Trimmed text; only real strings count (display copy, not ids). */
function textField(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function plainObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function isRecordingTipIcon(raw: unknown): raw is RecordingTipIcon {
  return typeof raw === 'string' && (RECORDING_TIP_ICONS as readonly string[]).includes(raw);
}

/**
 * `introSteps` from the clone config. Never throws: anything that is not an
 * array yields [], items without both a title and a body are dropped.
 */
export function parseCloneIntroSteps(raw: unknown): CloneIntroStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: CloneIntroStep[] = [];
  for (const item of raw) {
    const obj = plainObject(item);
    if (!obj) continue;
    const title = textField(obj.title);
    const body = textField(obj.body);
    if (title && body) steps.push({ title, body });
  }
  return steps;
}

/**
 * `recordingTips` from the clone config. Never throws: anything that is not
 * an array yields [], items without text are dropped, and an unknown icon
 * key keeps the text with `icon: null` (the screen shows a generic icon).
 */
export function parseCloneRecordingTips(raw: unknown): CloneRecordingTip[] {
  if (!Array.isArray(raw)) return [];
  const tips: CloneRecordingTip[] = [];
  for (const item of raw) {
    const obj = plainObject(item);
    if (!obj) continue;
    const text = textField(obj.text);
    if (!text) continue;
    tips.push({ icon: isRecordingTipIcon(obj.icon) ? obj.icon : null, text });
  }
  return tips;
}

const FALLBACK_LOCALES: Record<string, string> = { tr: 'tr-TR', en: 'en-US' };

/** "tr" gives "tr-TR"; an unknown language keeps its code. */
export function localeForVoiceLanguage(code: string): string {
  return FALLBACK_LOCALES[code] ?? code;
}

/**
 * `supportedLanguages` from the clone config. Never throws: anything that is
 * not an array yields [], items without a language code are dropped, a code
 * is listed once.
 */
export function parseVoiceLanguages(raw: unknown): VoiceLanguage[] {
  if (!Array.isArray(raw)) return [];
  const languages: VoiceLanguage[] = [];
  for (const item of raw) {
    const obj = plainObject(item);
    if (!obj) continue;
    const code = languageCodeOf(obj.code) || languageCodeOf(obj.locale);
    if (!code || languages.some(language => language.code === code)) continue;
    const nativeName = textField(obj.nativeName);
    languages.push({
      code,
      locale: textField(obj.locale) ?? localeForVoiceLanguage(code),
      nativeName: nativeName ?? code.toUpperCase(),
      englishName: textField(obj.englishName) ?? nativeName ?? code.toUpperCase(),
    });
  }
  return languages;
}

/**
 * The reading script for a config that sends none, in the voice's language
 * (the voice must read its own language): Turkish for Turkish, English for
 * every other language.
 */
export function fallbackCloneScript(language: string): { title: string; script: string } {
  return languageCodeOf(language) === 'tr'
    ? { title: VOICE_CLONING.FALLBACK_SCRIPT_TITLE_TR, script: VOICE_CLONING.FALLBACK_SCRIPT_TR }
    : { title: VOICE_CLONING.FALLBACK_SCRIPT_TITLE_EN, script: VOICE_CLONING.FALLBACK_SCRIPT_EN };
}

export function parseCloneConfigFromJSON(json: unknown): CloneConfig {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new CloneConfigError('Invalid clone config: expected object');
  }
  const data = json as Record<string, unknown>;

  const consentVersion = nonEmptyString(data.consentVersion);
  const consentText = nonEmptyString(data.consentText);
  if (!consentVersion || !consentText) {
    // Explicit consent is a legal precondition: never record without the
    // served text and version.
    throw new CloneConfigError('Invalid clone config: missing consent text or version');
  }

  const introSteps = parseCloneIntroSteps(data.introSteps);
  const recordingTips = parseCloneRecordingTips(data.recordingTips);
  // An older backend sends "tr" (or nothing): the flow is Turkish then.
  const language =
    languageCodeOf(data.language) || languageCodeOf(data.locale) || DEFAULT_VOICE_LANGUAGE;
  const supportedLanguages = parseVoiceLanguages(data.supportedLanguages);
  const fallbackScript = fallbackCloneScript(language);

  return {
    enabled: typeof data.enabled === 'boolean' ? data.enabled : true,
    provider: nonEmptyString(data.provider) ?? 'CARTESIA',
    language,
    locale:
      textField(data.locale) ??
      supportedLanguages.find(item => item.code === language)?.locale ??
      localeForVoiceLanguage(language),
    supportedLanguages,
    ...resolveCloneDurations(data),
    scriptTitle: nonEmptyString(data.scriptTitle) ?? fallbackScript.title,
    script: nonEmptyString(data.script) ?? fallbackScript.script,
    consentVersion,
    consentTitle: nonEmptyString(data.consentTitle) ?? defaultConsentTitle(),
    consentText,
    // Optional: left out entirely (not []) so callers fall back with `??`.
    ...(introSteps.length > 0 ? { introSteps } : {}),
    ...(recordingTips.length > 0 ? { recordingTips } : {}),
  };
}

/** Consent text split into paragraphs on blank lines, for readable rendering. */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

// ============================================================================
// Recording gating (all values in speech-elapsed seconds)
// ============================================================================

/** The user may stop only once the minimum has been read. */
export function canStopRecording(elapsedSeconds: number, d: CloneDurations): boolean {
  return elapsedSeconds >= d.minSeconds;
}

/** Hard cap: the recorder stops itself here. */
export function shouldAutoStop(elapsedSeconds: number, d: CloneDurations): boolean {
  return elapsedSeconds >= d.maxSeconds;
}

/** 0..1 progress towards the hard cap (drives the ring). */
export function recordingProgress(elapsedSeconds: number, d: CloneDurations): number {
  if (d.maxSeconds <= 0) return 0;
  return Math.min(Math.max(elapsedSeconds / d.maxSeconds, 0), 1);
}

/** 0..1 position of a marker (min / target) on the same scale. */
export function markerFraction(markerSeconds: number, d: CloneDurations): number {
  if (d.maxSeconds <= 0) return 0;
  return Math.min(Math.max(markerSeconds / d.maxSeconds, 0), 1);
}

export type TakeVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'no_speech' | 'too_short'; readonly message: string };

/** Whether a finished take can be uploaded. */
export function evaluateTake(
  elapsedSeconds: number,
  speechDetected: boolean,
  d: CloneDurations,
): TakeVerdict {
  if (!speechDetected) {
    return {
      ok: false,
      reason: 'no_speech',
      message:
        msg('clone.noSpeech'),
    };
  }
  if (elapsedSeconds < d.minSeconds) {
    return {
      ok: false,
      reason: 'too_short',
      message: msg('clone.tooShort', { seconds: Math.ceil(d.minSeconds) }),
    };
  }
  return { ok: true };
}

// ============================================================================
// Input level meter
// ============================================================================

export type InputLevel = 'idle' | 'quiet' | 'good' | 'loud';

export function levelThresholds(platform: string): { quiet: number; loud: number } {
  return platform === 'android'
    ? {
        quiet: VOICE_CLONING.LEVEL_QUIET_DBFS_ANDROID,
        loud: VOICE_CLONING.LEVEL_LOUD_DBFS_ANDROID,
      }
    : {
        quiet: VOICE_CLONING.LEVEL_QUIET_DBFS_IOS,
        loud: VOICE_CLONING.LEVEL_LOUD_DBFS_IOS,
      };
}

/**
 * Classify a rolling window of dBFS metering samples. "Loud" wins when a
 * few samples reach the clipping zone; "quiet" means even the loudest sample
 * in the window stayed under the quiet threshold.
 */
export function classifyInputLevel(
  samples: readonly number[],
  platform: string,
): InputLevel {
  const valid = samples.filter(s => Number.isFinite(s));
  if (valid.length === 0) return 'idle';
  const { quiet, loud } = levelThresholds(platform);
  const loudCount = valid.filter(s => s >= loud).length;
  if (loudCount >= VOICE_CLONING.LEVEL_LOUD_MIN_SAMPLES) return 'loud';
  const peak = Math.max(...valid);
  if (peak < quiet) return 'quiet';
  return 'good';
}

/** Map dBFS (-60..0) to a 0..1 bar fill. */
export function meterFraction(dbfs: number): number {
  if (!Number.isFinite(dbfs)) return 0;
  return Math.min(Math.max((dbfs + 60) / 60, 0), 1);
}

// ============================================================================
// Upload helpers
// ============================================================================

/**
 * MIME type + filename extension for a recorded take. iOS records LPCM WAV,
 * Android records AAC in an MPEG-4 container; the backend accepts both.
 */
export function sampleFileTypeForUri(uri: string): { mimeType: string; extension: string } {
  const clean = uri.split('?')[0].toLowerCase();
  if (clean.endsWith('.wav')) {
    return { mimeType: 'audio/wav', extension: 'wav' };
  }
  return { mimeType: 'audio/m4a', extension: 'm4a' };
}

// ============================================================================
// Error mapping
// ============================================================================

export const CLONE_ERROR_CODES = {
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  VOICE_ALREADY_UPLOADED: 'VOICE_ALREADY_UPLOADED',
  VOICE_LANGUAGE_NOT_SUPPORTED: 'VOICE_LANGUAGE_NOT_SUPPORTED',
  CLONE_SLOT_LIMIT: 'CLONE_SLOT_LIMIT',
  /** The plan's own-voice creations are used up (lifetime on FREE, monthly else). */
  CLONE_CREATION_LIMIT: 'CLONE_CREATION_LIMIT',
  PRESET_SLOT_LIMIT: 'PRESET_SLOT_LIMIT',
} as const;

/**
 * Whether more own-voice places can be bought: Mini has one like Free,
 * Premium has more. Ready-made narrator places differ only between Free and
 * the paid plans (Mini and Premium both have 10), see `offersMorePresetSlots`.
 */
export function offersMoreCloneSlots(plan: PlanId): boolean {
  return plan !== 'premium';
}

export function offersMorePresetSlots(plan: PlanId): boolean {
  return plan === 'free';
}

/**
 * What the screen should do after showing the dialog:
 * - reconsent: refetch config and go back to the consent step
 * - paywall:   offer the plans (a limit a higher plan lifts)
 * - track:     the sample is already uploaded; follow training status
 * - retry:     generic failure, the user may try the upload again
 * - none:      informational only
 */
export type CloneErrorAction = 'reconsent' | 'paywall' | 'track' | 'retry' | 'none';

export interface CloneErrorInfo {
  readonly code: string | null;
  readonly title: string;
  readonly message: string;
  readonly action: CloneErrorAction;
}

export function getApiErrorCode(error: unknown): string | null {
  return isApiError(error) ? error.code : null;
}

/**
 * The backend's own sentence, only when it came from the server. It is
 * written in Turkish (the backend does not localise yet), so it is shown for
 * an unknown code in the Turkish UI only; known codes always use app copy.
 */
function backendMessage(error: unknown): string | null {
  if (!isApiError(error) || error.status === 0 || error.status >= 500) return null;
  const data = error.data;
  const raw = data?.message;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return null;
}

function isTurkishUi(): boolean {
  return languageCodeOf(i18n.language) === DEFAULT_VOICE_LANGUAGE;
}

/**
 * Title and message for a used-up own-voice creation allowance (the
 * `quota.creation*` copy): lifetime on Free (it never renews and a delete
 * gives nothing back), monthly with its renewal date on the paid plans, and
 * a plans offer unless the plan is Premium. A missing limit or period is
 * read from the plan.
 */
export function describeCreationLimit(block: Omit<QuotaBlock, 'code'>): QuotaCopy {
  const allowance = PLANS[block.planId].cloneCreations;
  return describeQuotaBlock({
    ...block,
    code: QUOTA_CODES.CLONE_CREATION,
    // A used-up allowance has a number; the plan's own when none was sent.
    limit: block.limit ?? allowance.amount,
    period: block.period ?? allowance.period,
  });
}

/**
 * The copy of a CLONE_CREATION_LIMIT refusal, from the error's own numbers
 * (plan, limit, period, renewsAt) when the backend sent them.
 */
function creationLimitCopy(error: unknown, plan: PlanId): QuotaCopy {
  const parsed = parseQuotaBlock(error, plan);
  return describeCreationLimit(
    parsed ?? { planId: plan, limit: null, period: null, renewsAt: null },
  );
}

/**
 * The dialog for a refused clone create or upload (and a refused ready-made
 * narrator add).
 *
 * @param planId the user's plan (`SubscriptionStore.planId`).
 */
export function describeCloneError(error: unknown, planId: PlanId): CloneErrorInfo {
  const code = getApiErrorCode(error);

  switch (code) {
    case CLONE_ERROR_CODES.CONSENT_REQUIRED:
      return {
        code,
        title: msg('clone.consentRequiredTitle'),
        message: msg('clone.consentRequired'),
        action: 'reconsent',
      };
    case CLONE_ERROR_CODES.VOICE_ALREADY_UPLOADED:
      return {
        code,
        title: msg('clone.alreadyUploadedTitle'),
        message: msg('clone.alreadyUploaded'),
        action: 'track',
      };
    case CLONE_ERROR_CODES.VOICE_LANGUAGE_NOT_SUPPORTED:
      return {
        code,
        title: msg('clone.languageNotSupportedTitle'),
        message: msg('clone.languageNotSupported'),
        action: 'none',
      };
    case CLONE_ERROR_CODES.CLONE_SLOT_LIMIT:
      return {
        code,
        title: msg('voice.cloneLimitTitle'),
        message: msg(
          planId === 'free'
            ? 'clone.slotLimitFree'
            : planId === 'mini'
              ? 'clone.slotLimitMini'
              : 'clone.slotLimitPro',
        ),
        action: offersMoreCloneSlots(planId) ? 'paywall' : 'none',
      };
    case CLONE_ERROR_CODES.CLONE_CREATION_LIMIT: {
      const copy = creationLimitCopy(error, planId);
      return {
        code,
        title: copy.title,
        message: copy.message,
        // A used-up allowance never gets better by trying again.
        action: copy.offerPlans ? 'paywall' : 'none',
      };
    }
    case CLONE_ERROR_CODES.PRESET_SLOT_LIMIT:
      return {
        code,
        title: msg('voice.presetLimitTitle'),
        message: msg(offersMorePresetSlots(planId) ? 'clone.presetLimitFree' : 'clone.presetLimitPro'),
        action: offersMorePresetSlots(planId) ? 'paywall' : 'none',
      };
    default: {
      const serverMessage = backendMessage(error);
      return {
        code,
        title: msg('clone.uploadFailedTitle'),
        message: serverMessage
          ? isTurkishUi()
            ? serverMessage
            : msg('clone.uploadFailed')
          : getErrorMessage(error, msg('clone.uploadFailed')),
        action: 'retry',
      };
    }
  }
}

/**
 * A failed upload leaves a PENDING profile that eats a slot, so it is deleted,
 * except when the backend says the sample is already in (the profile is
 * training and must survive).
 */
export function shouldDiscardPendingProfile(error: unknown): boolean {
  return getApiErrorCode(error) !== CLONE_ERROR_CODES.VOICE_ALREADY_UPLOADED;
}
