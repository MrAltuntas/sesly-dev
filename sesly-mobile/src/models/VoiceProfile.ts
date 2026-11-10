/**
 * Voice Profile Models with Strict TypeScript Typing
 */

import {VoiceProfileStatus, TTSProvider} from '../types/enums';

// ============================================================================
// Voice Profile Model
// ============================================================================

/**
 * PRESET = a ready-made narrator voice picked from the catalogue.
 * CLONE  = the user's own recorded voice (Cartesia instant clone).
 */
export type VoiceProfileKind = 'PRESET' | 'CLONE';

export interface VoiceProfile {
  readonly id: string;
  readonly name: string;
  readonly status: VoiceProfileStatus;
  readonly provider: TTSProvider;
  readonly voiceId: string;
  readonly language: string;
  /**
   * The language the voice speaks, as a content language code ("tr", "en"):
   * the same vocabulary as `story.language`. Never empty; see
   * `resolveVoiceContentLanguage` for what an older backend gives.
   */
  readonly contentLanguage: string;
  readonly sampleAudioUrl: string | null;
  readonly errorMessage: string | null;
  readonly voiceModelId: string | null;
  /** Backend `kind`; null when an older backend omitted it (see isCloneProfile). */
  readonly kind: VoiceProfileKind | null;
  /** When the user gave explicit (KVKK) consent for this clone, if recorded. */
  readonly consentAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface VoiceProfileJSON {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly provider: string;
  readonly voiceId: string;
  readonly language: string;
  readonly contentLanguage?: string | null;
  readonly sampleAudioUrl?: string | null;
  readonly errorMessage?: string | null;
  readonly voiceModelId?: string | null;
  readonly kind?: string | null;
  readonly consentAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ============================================================================
// Voice Profile Helper Functions
// ============================================================================

export function parseVoiceProfileKind(raw: unknown): VoiceProfileKind | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  return upper === 'CLONE' || upper === 'PRESET' ? upper : null;
}

/**
 * Whether a profile is the user's own cloned voice. The backend `kind` is
 * authoritative; older payloads without it fall back to the provider
 * (Cartesia was only used for cloning when `kind` did not exist yet).
 */
export function isCloneProfile(profile: {
  readonly kind?: string | null;
  readonly provider?: string | null;
}): boolean {
  const kind = parseVoiceProfileKind(profile.kind);
  if (kind) return kind === 'CLONE';
  return (profile.provider ?? '').toUpperCase() === TTSProvider.CARTESIA;
}

/** The language every voice had before voices carried one. */
export const DEFAULT_VOICE_LANGUAGE = 'tr';

/** "tr-TR", "TR_tr" and "tr" all give "tr"; '' when the value names no language. */
export function languageCodeOf(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = /^([a-z]{2,3})(?:[-_]|$)/i.exec(value.trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * The content language of a voice.
 *
 * The backend's `contentLanguage` wins. A backend that does not send it yet
 * is read like this: a ready-made voice id starts with its locale
 * ("en-US-Chirp3-HD-Achernar"), a clone only ever was Turkish, and a voice
 * nothing is known about is Turkish too. Never throws, never returns ''.
 */
export function resolveVoiceContentLanguage(data: {
  readonly contentLanguage?: unknown;
  readonly voiceId?: unknown;
  readonly language?: unknown;
  readonly kind?: unknown;
  readonly provider?: unknown;
}): string {
  const served = languageCodeOf(data.contentLanguage);
  if (served) return served;
  const clone = isCloneProfile({
    kind: typeof data.kind === 'string' ? data.kind : null,
    provider: typeof data.provider === 'string' ? data.provider : null,
  });
  if (!clone) {
    const fromId =
      typeof data.voiceId === 'string'
        ? /^([a-z]{2,3})-[A-Za-z]{2}-/.exec(data.voiceId)?.[1]
        : undefined;
    if (fromId) return fromId.toLowerCase();
    const stored = languageCodeOf(data.language);
    if (stored) return stored;
  }
  return DEFAULT_VOICE_LANGUAGE;
}

/** Whether a voice speaks the language a story is written in. */
export function voiceMatchesLanguage(
  profile: { readonly contentLanguage?: string | null },
  storyLanguage: string | null | undefined,
): boolean {
  const wanted = languageCodeOf(storyLanguage);
  if (!wanted) return true;
  return (languageCodeOf(profile.contentLanguage) || DEFAULT_VOICE_LANGUAGE) === wanted;
}

export function isVoiceProfileReady(profile: VoiceProfile): boolean {
  return profile.status === VoiceProfileStatus.READY;
}

export function isVoiceProfileProcessing(profile: VoiceProfile): boolean {
  return (
    profile.status === VoiceProfileStatus.PROCESSING ||
    profile.status === VoiceProfileStatus.PENDING
  );
}

export function isVoiceProfileFailed(profile: VoiceProfile): boolean {
  return profile.status === VoiceProfileStatus.FAILED;
}

export function isVoiceProfilePending(profile: VoiceProfile): boolean {
  return profile.status === VoiceProfileStatus.PENDING;
}

// ============================================================================
// Voice Profile JSON Parsers
// ============================================================================

export function parseVoiceProfileFromJSON(json: unknown): VoiceProfile {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid voice profile data: expected object');
  }

  const data = json as Record<string, unknown>;

  if (typeof data.id !== 'string' || !data.id) {
    throw new Error('Invalid voice profile data: missing or invalid id');
  }
  if (typeof data.name !== 'string' || !data.name) {
    throw new Error('Invalid voice profile data: missing or invalid name');
  }
  if (typeof data.status !== 'string') {
    throw new Error('Invalid voice profile data: missing or invalid status');
  }
  if (typeof data.provider !== 'string') {
    throw new Error('Invalid voice profile data: missing or invalid provider');
  }
  if (typeof data.voiceId !== 'string' || !data.voiceId) {
    throw new Error('Invalid voice profile data: missing or invalid voiceId');
  }
  if (typeof data.createdAt !== 'string') {
    throw new Error('Invalid voice profile data: missing or invalid createdAt');
  }
  if (typeof data.updatedAt !== 'string') {
    throw new Error('Invalid voice profile data: missing or invalid updatedAt');
  }

  return {
    id: data.id,
    name: data.name,
    status: data.status as VoiceProfileStatus,
    provider: data.provider as TTSProvider,
    voiceId: data.voiceId,
    language: typeof data.language === 'string' ? data.language : 'tr-TR',
    contentLanguage: resolveVoiceContentLanguage(data),
    sampleAudioUrl:
      typeof data.sampleAudioUrl === 'string' && data.sampleAudioUrl
        ? data.sampleAudioUrl
        : null,
    errorMessage:
      typeof data.errorMessage === 'string' && data.errorMessage
        ? data.errorMessage
        : null,
    voiceModelId:
      typeof data.voiceModelId === 'string' && data.voiceModelId
        ? data.voiceModelId
        : null,
    kind: parseVoiceProfileKind(data.kind),
    consentAt: parseOptionalDate(data.consentAt),
    createdAt: new Date(data.createdAt),
    updatedAt: new Date(data.updatedAt),
  };
}

function parseOptionalDate(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw) return null;
  const date = new Date(raw);
  return isNaN(date.getTime()) ? null : date;
}

export function voiceProfileToJSON(profile: VoiceProfile): VoiceProfileJSON {
  return {
    id: profile.id,
    name: profile.name,
    status: profile.status,
    provider: profile.provider,
    voiceId: profile.voiceId,
    language: profile.language,
    contentLanguage: profile.contentLanguage,
    sampleAudioUrl: profile.sampleAudioUrl,
    errorMessage: profile.errorMessage,
    voiceModelId: profile.voiceModelId,
    kind: profile.kind,
    consentAt: profile.consentAt ? profile.consentAt.toISOString() : null,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

// ============================================================================
// Voice Slot Info
// ============================================================================

/** Per-kind slot usage (GET /voice-profiles/slots `preset` / `clone`). */
export interface VoiceKindSlotInfo {
  readonly used: number;
  readonly limit: number;
  /** Authoritative for this kind. */
  readonly canCreate: boolean;
  /** Optional backend explanation shown when `canCreate` is false. */
  readonly message: string | null;
}

/** How a plan's own-voice creations renew: every month, or never (FREE). */
export type CloneCreationPeriod = 'month' | 'lifetime';

/**
 * The plan's own-voice creations (`clone.creations` of GET /slots). They are
 * counted creations, not existing clones: deleting a voice gives nothing
 * back, and a lifetime allowance never renews.
 */
export interface CloneCreationInfo {
  readonly used: number;
  /** null = unlimited (the backend sends -1). */
  readonly limit: number | null;
  /** null when the backend named no period. */
  readonly period: CloneCreationPeriod | null;
  /** When a monthly allowance renews; null for a lifetime one or when unknown. */
  readonly renewsAt: Date | null;
  readonly canCreate: boolean;
}

export interface CloneSlotInfo extends VoiceKindSlotInfo {
  /**
   * Legacy name: the creations counted against the plan allowance (lifetime
   * numbers on FREE). Null when the backend omitted it. Prefer `creations`.
   */
  readonly monthlyCreated: number | null;
  /** Legacy name of the creation limit; null when omitted. Prefer `creations`. */
  readonly monthlyLimit: number | null;
  /** The creation allowance; null on a backend that does not send it. */
  readonly creations: CloneCreationInfo | null;
}

export interface VoiceSlotInfo {
  readonly used: number;
  readonly limit: number;
  readonly available: number;
  readonly plan: string;
  /** Authoritative: backend decides whether another profile may be created. */
  readonly canCreate: boolean;
  /** Optional backend explanation shown when `canCreate` is false. */
  readonly message: string | null;
  /** Ready-made voice slots; null on older backends (use `canCreate`). */
  readonly preset: VoiceKindSlotInfo | null;
  /** Own-voice clone slots; null on older backends (use `canCreate`). */
  readonly clone: CloneSlotInfo | null;
}

function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toTrimmedMessage(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function parseKindSlot(raw: unknown): VoiceKindSlotInfo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const used = toFiniteNumber(data.used) ?? 0;
  const limit = toFiniteNumber(data.limit) ?? 0;
  const canCreate =
    typeof data.canCreate === 'boolean' ? data.canCreate : used < limit;
  return {used, limit, canCreate, message: toTrimmedMessage(data.message)};
}

/** A limit as the app keeps it: null for unlimited (-1 or below) or unknown. */
function toLimit(raw: unknown): number | null {
  const n = toFiniteNumber(raw);
  return n === null || n < 0 ? null : n;
}

function parseCreationPeriod(raw: unknown): CloneCreationPeriod | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (value === 'lifetime') return 'lifetime';
  return value === 'month' || value === 'monthly' ? 'month' : null;
}

function parseCloneCreations(raw: unknown): CloneCreationInfo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const used = toFiniteNumber(data.used);
  if (used === null) return null;
  const limit = toLimit(data.limit);
  return {
    used,
    limit,
    period: parseCreationPeriod(data.period),
    renewsAt: parseOptionalDate(data.renewsAt),
    canCreate:
      typeof data.canCreate === 'boolean' ? data.canCreate : limit === null || used < limit,
  };
}

function parseCloneSlot(raw: unknown): CloneSlotInfo | null {
  const base = parseKindSlot(raw);
  if (!base) return null;
  const data = raw as Record<string, unknown>;
  return {
    ...base,
    monthlyCreated: toFiniteNumber(data.monthlyCreated),
    monthlyLimit: toFiniteNumber(data.monthlyLimit),
    creations: parseCloneCreations(data.creations),
  };
}

/**
 * The creation allowance of a clone slot. A backend without `creations`
 * only had a monthly cap (`monthlyCreated` / `monthlyLimit`), which is read
 * as a monthly allowance; null when neither is known.
 */
export function cloneCreationsOf(clone: CloneSlotInfo | null): CloneCreationInfo | null {
  if (!clone) return null;
  if (clone.creations) return clone.creations;
  if (clone.monthlyLimit === null || clone.monthlyCreated === null) return null;
  const limit = clone.monthlyLimit < 0 ? null : clone.monthlyLimit;
  return {
    used: clone.monthlyCreated,
    limit,
    period: 'month',
    renewsAt: null,
    canCreate: limit === null || clone.monthlyCreated < limit,
  };
}

/** True when the plan's own-voice creations are known and used up. */
export function isCloneCreationLimitReached(clone: CloneSlotInfo | null): boolean {
  const creations = cloneCreationsOf(clone);
  if (!creations) return false;
  return !creations.canCreate || (creations.limit !== null && creations.used >= creations.limit);
}

/**
 * Creations still left before the allowance is used up; null when unlimited
 * or unknown. Never below 0.
 */
export function cloneCreationsLeft(clone: CloneSlotInfo | null): number | null {
  const creations = cloneCreationsOf(clone);
  if (!creations || creations.limit === null) return null;
  return Math.max(0, creations.limit - creations.used);
}

/**
 * Whether a new clone may be started. Uses `clone.canCreate` plus the
 * creation allowance; older backends without the split fall back to the
 * shared `canCreate`. Unknown slots (null) let the attempt through; the
 * backend still enforces.
 */
export function canCreateCloneFromSlots(info: VoiceSlotInfo | null): boolean {
  if (!info) return true;
  if (!info.clone) return info.canCreate;
  return info.clone.canCreate && !isCloneCreationLimitReached(info.clone);
}

/** Whether a ready-made voice may be added (same fallback rules). */
export function canCreatePresetFromSlots(info: VoiceSlotInfo | null): boolean {
  if (!info) return true;
  if (!info.preset) return info.canCreate;
  return info.preset.canCreate;
}

export function parseVoiceSlotInfoFromJSON(json: unknown): VoiceSlotInfo {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid voice slot info data: expected object');
  }

  const data = json as Record<string, unknown>;

  // Backend uses different field names: totalSlots, usedSlots, availableSlots
  // Parse numbers with fallback to 0
  const used = typeof data.usedSlots === 'number' ? data.usedSlots :
               typeof data.usedSlots === 'string' ? parseInt(data.usedSlots, 10) :
               typeof data.used === 'number' ? data.used :
               typeof data.used === 'string' ? parseInt(data.used, 10) : 0;

  const limit = typeof data.totalSlots === 'number' ? data.totalSlots :
                typeof data.totalSlots === 'string' ? parseInt(data.totalSlots, 10) :
                typeof data.limit === 'number' ? data.limit :
                typeof data.limit === 'string' ? parseInt(data.limit, 10) : 0;

  const available = typeof data.availableSlots === 'number' ? data.availableSlots :
                    typeof data.availableSlots === 'string' ? parseInt(data.availableSlots, 10) :
                    typeof data.available === 'number' ? data.available :
                    typeof data.available === 'string' ? parseInt(data.available, 10) : 0;

  const plan = typeof data.plan === 'string' ? data.plan.toLowerCase() : 'free';

  // Parse canCreate with fallback
  const canCreate = typeof data.canCreate === 'boolean' ? data.canCreate : available > 0;

  // Validate parsed values
  if (isNaN(used) || isNaN(limit) || isNaN(available)) {
    console.error('Invalid slot values:', data);
    throw new Error('Invalid voice slot info data: numeric values are invalid');
  }

  return {
    used,
    limit,
    available,
    plan,
    canCreate,
    message: toTrimmedMessage(data.message),
    preset: parseKindSlot(data.preset),
    clone: parseCloneSlot(data.clone),
  };
}

export function hasAvailableVoiceSlots(slotInfo: VoiceSlotInfo): boolean {
  return slotInfo.canCreate;
}

export function isVoiceSlotLimitReached(slotInfo: VoiceSlotInfo): boolean {
  return slotInfo.used >= slotInfo.limit;
}

// ============================================================================
// Available Voice Models
// ============================================================================

export interface AvailableCartesiaVoice {
  readonly id: string;
  readonly voiceId: string; // Backward compatibility
  readonly name: string;
  readonly language: string;
  readonly languageCode: string;
  readonly gender: string;
  readonly description: string;
  readonly provider: string;
  readonly locale: string;
  /** Backend premium flag; null when an older backend omitted it. */
  readonly isPremium: boolean | null;
}

/**
 * A ready-made narrator of the catalogue
 * (`GET /voice-profiles/available-voices`). The catalogue is Google Chirp 3
 * HD voices only and every one of them is free for every plan: there is no
 * premium flag, lock or quality tier on a ready-made voice.
 */
export interface AvailableGoogleVoice {
  /** Provider voice id, "tr-TR-Chirp3-HD-Achernar". */
  readonly id: string;
  readonly voiceId: string; // Backward compatibility
  /** The bare voice name, "Achernar". */
  readonly name: string;
  readonly language: string;
  /** Google locale, "tr-TR". */
  readonly languageCode: string;
  /** Content language the voice narrates, "tr". Matches `story.language`. */
  readonly contentLanguage: string;
  /** 'female' | 'male', lower case; '' when the backend sent none. */
  readonly gender: string;
  readonly description: string;
  readonly provider: string;
}

const CHIRP3_HD_NAME = /-Chirp3-HD-([^-]+)$/i;

/** True for a Chirp 3 voice id ("tr-TR-Chirp3-HD-Achernar"). */
export function isChirp3VoiceId(voiceId: string | null | undefined): boolean {
  return /chirp3/i.test(voiceId ?? '');
}

/**
 * The bare name of a ready-made voice: "Achernar".
 *
 * The backend sends it bare. Older responses, and voice profiles created
 * from them, carry names such as "Chirp3 Achernar (HD)"; the voice id is the
 * most reliable source then, and the name is cleaned as a last resort.
 */
export function bareVoiceName(name: string, voiceId?: string | null): string {
  const fromId = CHIRP3_HD_NAME.exec(voiceId ?? '')?.[1];
  if (fromId) return fromId;
  const cleaned = name
    .replace(/\(\s*HD\s*\)/gi, ' ')
    .replace(/^[a-z]{2,3}-[A-Za-z]{2}-/, '')
    .replace(/chirp\s*-?\s*3/gi, ' ')
    .replace(/\bHD\b/g, ' ')
    .replace(/[-_\s]+/g, ' ')
    .trim();
  return cleaned || name.trim();
}

function parseIsPremium(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function parseAvailableCartesiaVoiceFromJSON(
  json: unknown,
): AvailableCartesiaVoice {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid cartesia voice data: expected object');
  }

  const data = json as Record<string, unknown>;

  // Backend uses 'id' field
  const id = typeof data.id === 'string' ? data.id : '';
  const voiceId = id || (typeof data.voiceId === 'string' ? data.voiceId : '');

  if (!voiceId) {
    throw new Error('Invalid cartesia voice data: missing or invalid id/voiceId');
  }
  if (typeof data.name !== 'string' || !data.name) {
    throw new Error('Invalid cartesia voice data: missing or invalid name');
  }

  return {
    id: voiceId,
    voiceId: voiceId,
    name: data.name,
    language: typeof data.language === 'string' ? data.language : 'Turkish',
    languageCode: typeof data.languageCode === 'string' ? data.languageCode : 'tr-TR',
    gender: typeof data.gender === 'string' ? data.gender : 'UNKNOWN',
    description: typeof data.description === 'string' ? data.description : '',
    provider: typeof data.provider === 'string' ? data.provider : 'CARTESIA',
    locale: typeof data.locale === 'string' ? data.locale : 'tr-TR',
    isPremium: parseIsPremium(data.isPremium),
  };
}

export function parseAvailableGoogleVoiceFromJSON(
  json: unknown,
): AvailableGoogleVoice {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid google voice data: expected object');
  }

  const data = json as Record<string, unknown>;

  // Backend uses 'id' field
  const id = typeof data.id === 'string' ? data.id : '';
  const voiceId = id || (typeof data.voiceId === 'string' ? data.voiceId : '');

  if (!voiceId) {
    throw new Error('Invalid google voice data: missing or invalid id/voiceId');
  }
  if (typeof data.name !== 'string' || !data.name) {
    throw new Error('Invalid google voice data: missing or invalid name');
  }

  // The locale: the backend's field, else the one the voice id starts with.
  const localeFromId = /^([a-z]{2,3}-[A-Za-z]{2})-/.exec(voiceId)?.[1] ?? '';
  const languageCode =
    typeof data.languageCode === 'string' && data.languageCode.trim()
      ? data.languageCode.trim()
      : localeFromId || 'tr-TR';
  const contentLanguage =
    languageCodeOf(data.contentLanguage) ||
    languageCodeOf(languageCode) ||
    DEFAULT_VOICE_LANGUAGE;

  return {
    id: voiceId,
    voiceId: voiceId,
    name: bareVoiceName(data.name, voiceId),
    language: typeof data.language === 'string' ? data.language : 'Turkish',
    languageCode,
    contentLanguage,
    gender: typeof data.gender === 'string' ? data.gender.trim().toLowerCase() : '',
    description: typeof data.description === 'string' ? data.description : '',
    provider: typeof data.provider === 'string' ? data.provider : 'GOOGLE',
  };
}

/**
 * The ready-made catalogue is Chirp 3 HD only. A backend that still lists
 * Standard or WaveNet voices has them dropped here.
 */
function pushCatalogueVoice(list: AvailableGoogleVoice[], json: unknown): void {
  try {
    const voice = parseAvailableGoogleVoiceFromJSON(json);
    if (isChirp3VoiceId(voice.voiceId)) list.push(voice);
  } catch (err) {
    console.warn('Failed to parse Google voice:', err);
  }
}

// ============================================================================
// Available Voices Response
// ============================================================================

export interface AvailableVoicesResponse {
  readonly cartesia: readonly AvailableCartesiaVoice[];
  readonly google: readonly AvailableGoogleVoice[];
}

export function parseAvailableVoicesResponseFromJSON(
  json: unknown,
): AvailableVoicesResponse {
  const cartesiaVoices: AvailableCartesiaVoice[] = [];
  const googleVoices: AvailableGoogleVoice[] = [];

  // Backend returns array of {provider: string, voices: []}
  if (Array.isArray(json)) {
    json.forEach((providerData: unknown) => {
      if (!providerData || typeof providerData !== 'object') return;

      const data = providerData as Record<string, unknown>;
      const provider = typeof data.provider === 'string' ? data.provider.toLowerCase() : '';
      const voices = Array.isArray(data.voices) ? data.voices : [];

      if (provider === 'cartesia') {
        voices.forEach((voiceJson: unknown) => {
          try {
            cartesiaVoices.push(parseAvailableCartesiaVoiceFromJSON(voiceJson));
          } catch (err) {
            console.warn('Failed to parse Cartesia voice:', err);
          }
        });
      } else if (provider === 'google') {
        voices.forEach((voiceJson: unknown) => pushCatalogueVoice(googleVoices, voiceJson));
      }
    });
  }
  // Fallback for object format {cartesia: [], google: []}
  else if (json && typeof json === 'object') {
    const data = json as Record<string, unknown>;

    if (Array.isArray(data.cartesia)) {
      data.cartesia.forEach(item => {
        try {
          cartesiaVoices.push(parseAvailableCartesiaVoiceFromJSON(item));
        } catch (err) {
          console.warn('Failed to parse Cartesia voice:', err);
        }
      });
    }

    if (Array.isArray(data.google)) {
      data.google.forEach(item => pushCatalogueVoice(googleVoices, item));
    }
  }

  console.log(`Parsed ${cartesiaVoices.length} Cartesia + ${googleVoices.length} Google voices`);

  return {
    cartesia: cartesiaVoices,
    google: googleVoices,
  };
}

export function getTotalVoiceCount(response: AvailableVoicesResponse): number {
  return response.cartesia.length + response.google.length;
}

// ============================================================================
// Voice Profile Status Response (GET /voice-profiles/:id/status)
// ============================================================================

export interface VoiceProfileStatusResponse {
  readonly id: string;
  readonly name: string;
  readonly status: VoiceProfileStatus;
  readonly progress: number;
  readonly provider: TTSProvider;
  readonly voiceId: string;
  /** Content language of the voice; null when the backend did not send it. */
  readonly contentLanguage: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly errorMessage: string | null;
}

export function parseVoiceProfileStatusResponseFromJSON(
  json: unknown,
): VoiceProfileStatusResponse {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid voice profile status data: expected object');
  }

  const data = json as Record<string, unknown>;

  // Defensive parse: if the backend returned an error-ish shape (e.g. 404 body
  // or validation error), surface that instead of a misleading "missing id".
  if ('statusCode' in data && typeof data.statusCode === 'number') {
    const msg = typeof data.message === 'string' ? data.message : 'unknown';
    throw new Error(
      `Voice profile status request failed (HTTP ${data.statusCode}): ${msg}`,
    );
  }

  // id is the only truly required field — without it we cannot reconcile which
  // profile this status belongs to. Everything else is best-effort.
  const id =
    typeof data.id === 'string' && data.id
      ? data.id
      : typeof (data as {voiceProfileId?: unknown}).voiceProfileId === 'string'
      ? ((data as {voiceProfileId: string}).voiceProfileId)
      : null;
  if (!id) {
    throw new Error('Invalid voice profile status data: missing or invalid id');
  }

  if (typeof data.status !== 'string') {
    throw new Error(
      'Invalid voice profile status data: missing or invalid status',
    );
  }

  // name/provider/voiceId/createdAt/updatedAt are tolerated with sensible
  // fallbacks — during training `voiceId` may legitimately be empty, and a
  // status endpoint should not need a full profile shape to function.
  const createdAt =
    typeof data.createdAt === 'string' ? new Date(data.createdAt) : new Date();
  const updatedAt =
    typeof data.updatedAt === 'string' ? new Date(data.updatedAt) : new Date();

  return {
    id,
    name: typeof data.name === 'string' ? data.name : '',
    status: data.status as VoiceProfileStatus,
    progress: typeof data.progress === 'number' ? data.progress : 0,
    provider:
      typeof data.provider === 'string'
        ? (data.provider as TTSProvider)
        : ('GOOGLE' as TTSProvider),
    voiceId: typeof data.voiceId === 'string' ? data.voiceId : '',
    contentLanguage: languageCodeOf(data.contentLanguage) || null,
    createdAt,
    updatedAt,
    errorMessage:
      typeof data.errorMessage === 'string' && data.errorMessage
        ? data.errorMessage
        : typeof (data as {error?: unknown}).error === 'string'
        ? ((data as {error: string}).error)
        : null,
  };
}

export function isVoiceProfileStatusComplete(
  status: VoiceProfileStatusResponse,
): boolean {
  return status.progress >= 100;
}

// ============================================================================
// Create Voice Profile Request
// ============================================================================

export interface CreateVoiceProfileRequest {
  readonly name: string;
  readonly provider: TTSProvider;
  readonly voiceId: string;
  readonly language: string;
}

export function createVoiceProfileRequestToJSON(
  request: CreateVoiceProfileRequest,
): Record<string, string> {
  return {
    name: request.name,
    provider: request.provider,
    voiceId: request.voiceId,
    language: request.language,
  };
}

// ============================================================================
// Voice Preview Response
// ============================================================================

export interface VoicePreviewResponse {
  readonly audioUrl: string;
  readonly voiceId: string;
  readonly provider: string;
  readonly cached: boolean;
}
