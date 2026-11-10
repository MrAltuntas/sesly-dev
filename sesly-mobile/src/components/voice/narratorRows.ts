/**
 * Pure helpers of the Sesim tab: which voices are the user's own, how the
 * ready-made narrator list is put together, and small formatters.
 */

import {
  AvailableGoogleVoice,
  VoiceProfile,
  isCloneProfile,
  languageCodeOf,
  voiceMatchesLanguage,
} from '../../models/VoiceProfile';
import { getNarratorDisplay } from '../../models/Narrator';
import { contentLanguageNativeName } from '../../hooks/useContentLanguage';
import i18n from '../../i18n';
import type { CategoryKey } from '../../theme/palettes';

export type NarratorRowModel =
  /** A ready-made narrator the user already added (a PRESET voice profile). */
  | { readonly kind: 'added'; readonly key: string; readonly profile: VoiceProfile }
  /** A narrator of the catalogue that is not in the user's list yet. */
  | { readonly kind: 'catalogue'; readonly key: string; readonly voice: AvailableGoogleVoice };

/** Preview keys: a profile plays under its id, a catalogue voice under this. */
export const presetPreviewKey = (voice: Pick<AvailableGoogleVoice, 'voiceId'>): string =>
  `preset:${voice.voiceId}`;

export function ownVoices(profiles: readonly VoiceProfile[]): VoiceProfile[] {
  return profiles.filter(isCloneProfile);
}

export function addedNarrators(profiles: readonly VoiceProfile[]): VoiceProfile[] {
  return profiles.filter(profile => !isCloneProfile(profile));
}

/**
 * The "Hazır anlatıcılar" list: the narrators the user added first (they can
 * be removed there), then the rest of the catalogue in the backend's order.
 * Every ready-made narrator is free for every plan, so there is no locked
 * group and no plan-dependent order. A catalogue voice that is already added
 * is listed once, as the added row.
 *
 * With `language` (the Sesim tab's language filter) only the added
 * narrators of that content language are listed, next to the catalogue of
 * the same language. Without it every added narrator is.
 *
 * `keepInPlace` holds profile ids the user added during this visit: those
 * rows stay at their catalogue position instead of jumping to the top, so
 * nothing moves under the finger. The next visit lists them first again.
 */
export function buildNarratorRows(
  profiles: readonly VoiceProfile[],
  catalogue: readonly AvailableGoogleVoice[],
  language?: string | null,
  options: { readonly keepInPlace?: ReadonlySet<string> } = {},
): NarratorRowModel[] {
  const wanted = languageCodeOf(language);
  const added = addedNarrators(profiles).filter(
    profile => !wanted || voiceMatchesLanguage(profile, wanted),
  );
  const addedVoiceIds = new Set(added.map(profile => profile.voiceId));
  const listed = new Set(catalogue.map(voice => voice.voiceId));
  // One profile per catalogue voice stays in place (a duplicate leads).
  const inPlace = new Map<string, VoiceProfile>();
  const keep = options.keepInPlace;
  if (keep && keep.size > 0) {
    for (const profile of added) {
      if (keep.has(profile.id) && listed.has(profile.voiceId) && !inPlace.has(profile.voiceId)) {
        inPlace.set(profile.voiceId, profile);
      }
    }
  }
  const placed = new Set(inPlace.values());
  const addedRow = (profile: VoiceProfile): NarratorRowModel => ({
    kind: 'added',
    key: profile.id,
    profile,
  });
  const rows: NarratorRowModel[] = added.filter(profile => !placed.has(profile)).map(addedRow);
  for (const voice of catalogue) {
    const kept = inPlace.get(voice.voiceId);
    if (kept) rows.push(addedRow(kept));
    else if (!addedVoiceIds.has(voice.voiceId)) {
      rows.push({ kind: 'catalogue', key: presetPreviewKey(voice), voice });
    }
  }
  return rows;
}

/**
 * The languages of the Sesim tab's narrator filter: the enabled content
 * languages in catalogue order, then the language of any narrator the user
 * added that is not among them (so no added narrator becomes unreachable).
 */
export function narratorFilterLanguages(
  contentLanguages: readonly string[],
  profiles: readonly VoiceProfile[],
): string[] {
  const codes: string[] = [];
  const push = (value: string | null | undefined) => {
    const code = languageCodeOf(value);
    if (code && !codes.includes(code)) codes.push(code);
  };
  contentLanguages.forEach(push);
  addedNarrators(profiles).forEach(profile => push(profile.contentLanguage));
  return codes;
}

/** "Türkçe": the language a voice speaks, in its own name. '' when unknown. */
export function voiceLanguageName(code: string | null | undefined): string {
  const language = languageCodeOf(code);
  return language ? contentLanguageNativeName(language) : '';
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "kadın sesi" / "erkek sesi"; '' when the catalogue gave no gender. */
export function voiceGenderLabel(gender: string | null | undefined): string {
  const key = (gender ?? '').trim().toLowerCase();
  return key === 'female' || key === 'male' ? i18n.t(`common:voiceGender.${key}`) : '';
}

/**
 * "Türkçe, kadın sesi": the language of the voice in its own name, then
 * what tells one narrator from the next. That is the description when
 * `getNarratorDisplay` has one (a backend placeholder today), else the
 * gender the catalogue sends. An added profile carries neither, so its line
 * is the language alone.
 */
export function narratorLine(
  source: {
    readonly name: string;
    /** Content language of the voice ("en"); wins over `languageCode`. */
    readonly contentLanguage?: string | null;
    /** Locale of the voice ("en-US"), used when no content language is given. */
    readonly languageCode?: string | null;
    readonly gender?: string | null;
  },
  _t?: Translate,
): string {
  const language =
    voiceLanguageName(source.contentLanguage) || voiceLanguageName(source.languageCode);
  const description =
    getNarratorDisplay(source)?.description ?? voiceGenderLabel(source.gender);
  return [language, description].filter(Boolean).join(', ');
}

/** "12 Ekim kaydı"; '' for an invalid date. */
export function recordedOnLabel(date: Date | null | undefined, t: Translate): string {
  if (!date || isNaN(date.getTime())) return '';
  return t('voices:own.recorded', {
    day: date.getDate(),
    month: t(`voices:months.${date.getMonth() + 1}`),
  });
}

/** "0:12" for a sample length in milliseconds; '' when unknown. */
export function sampleDurationLabel(durationMs: number | null | undefined): string {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) return '';
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/** Stable waveform seed for a voice, so its sample always draws the same shape. */
export function waveformSeed(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % 997 + 1;
}

/**
 * Colour slot of the avatar of the narrator at `index` in the list. The
 * mockup gives neighbouring narrators different category colours (Deniz
 * turk, Ayla dunya, Lale egitici, Emma uyku); cycling through the four in
 * that order keeps any two neighbours apart. A narrator has no category of
 * its own, so this is decoration, not meaning.
 */
const NARRATOR_AVATAR_SLOTS: readonly CategoryKey[] = ['turk', 'dunya', 'egitici', 'uyku'];

export function narratorAvatarSlot(index: number): CategoryKey {
  const i = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
  return NARRATOR_AVATAR_SLOTS[i % NARRATOR_AVATAR_SLOTS.length];
}

/**
 * The avatar colour slot of one narrator, from its voice id: the same on the
 * Sesim tab, in the catalogue and in the narrator sheet, and unchanged when
 * another narrator is added above it. Prefer this over `narratorAvatarSlot`.
 */
export function narratorAvatarSlotFor(voiceId: string | null | undefined): CategoryKey {
  return NARRATOR_AVATAR_SLOTS[waveformSeed(voiceId ?? '') % NARRATOR_AVATAR_SLOTS.length];
}

/**
 * The full catalogue of one language for the "Hazır anlatıcılar" screen.
 * Unlike `buildNarratorRows` the catalogue keeps its own order: a narrator
 * the user adds is marked in place ("Eklendi") instead of moving to the top,
 * so the list never shifts under the finger. Added narrators of the language
 * the catalogue does not list (any more) come last, so none is unreachable.
 */
export function buildCatalogueRows(
  profiles: readonly VoiceProfile[],
  catalogue: readonly AvailableGoogleVoice[],
  language: string | null | undefined,
): NarratorRowModel[] {
  const wanted = languageCodeOf(language);
  const added = addedNarrators(profiles).filter(
    profile => !wanted || voiceMatchesLanguage(profile, wanted),
  );
  const byVoiceId = new Map(added.map(profile => [profile.voiceId, profile] as const));
  const rows: NarratorRowModel[] = catalogue.map(voice => {
    const profile = byVoiceId.get(voice.voiceId);
    return profile
      ? { kind: 'added' as const, key: profile.id, profile }
      : { kind: 'catalogue' as const, key: presetPreviewKey(voice), voice };
  });
  const listed = new Set(catalogue.map(voice => voice.voiceId));
  added
    .filter(profile => !listed.has(profile.voiceId))
    .forEach(profile => rows.push({ kind: 'added', key: profile.id, profile }));
  return rows;
}
