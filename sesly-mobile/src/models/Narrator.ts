/**
 * Narrator display data.
 *
 * The design names ready-made narrators with friendly names (Defne, Kerem,
 * Elif, Emma, Oliver) and one-line descriptions ("Türkçe, sıcak ve sakin").
 * The backend does not have these yet: a ready-made narrator is a Google
 * Chirp 3 HD voice and is called by its bare voice name ("Achernar"). This
 * module is the single place the UI asks "what do I call this narrator", so
 * the swap is one function when the API delivers friendly names.
 *
 * It also answers "who can read this story". Every voice has a language
 * (`contentLanguage`) and any voice may read any story: the voices of the
 * story's language come first, the others are offered as voices of another
 * language. What the listener gets then depends on the kind of voice, see
 * `narrationLanguageNotice`; which narrator a story page starts with is
 * `pickInitialNarrator`.
 */

import {
  bareVoiceName,
  isCloneProfile,
  isVoiceProfileReady,
  languageCodeOf,
  voiceMatchesLanguage,
} from './VoiceProfile';
import type { VoiceProfile } from './VoiceProfile';
import type { StoryNarration } from './Narration';
import { NarrationStatus } from '../types/enums';

export interface NarratorDisplay {
  /** Name shown in "X anlatıyor". */
  readonly name: string;
  /**
   * BACKEND PLACEHOLDER: one-line description of a ready-made narrator.
   * Always null until the voice catalogue returns it.
   */
  readonly description: string | null;
}

/**
 * BACKEND PLACEHOLDER (friendly narrator names). For the user's cloned voice
 * the name is the one they typed, which is final. For a ready-made voice it
 * is the bare voice name: profiles added before the catalogue sent bare
 * names carry "Chirp3 Achernar (HD)", which is cleaned here (from the voice
 * id when there is one). Read a display name field here when it exists.
 *
 * Pass the whole profile: without `kind` / `provider` the name is taken to
 * be a typed one and returned as it is.
 */
export function getNarratorDisplay(
  profile:
    | {
        readonly name: string;
        readonly kind?: string | null;
        readonly provider?: string | null;
        readonly voiceId?: string | null;
      }
    | null
    | undefined,
): NarratorDisplay | null {
  const name = profile?.name?.trim();
  if (!profile || !name) return null;
  const knowsKind = profile.kind != null || profile.provider != null;
  if (knowsKind && !isCloneProfile(profile)) {
    return { name: bareVoiceName(name, profile.voiceId), description: null };
  }
  return { name, description: null };
}

/** "tr-TR" and "TR" both become "tr"; '' for an empty value. */
export function languageBase(code: string | null | undefined): string {
  return (code ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

export interface StoryNarrators {
  /** The user's own READY voices of the story's language, in list order. */
  readonly own: readonly VoiceProfile[];
  /** READY ready-made narrators of the story's language. */
  readonly ready: readonly VoiceProfile[];
  /**
   * READY voices of another language ("Başka dildeki sesler"): the user's
   * own voices first, then the ready-made narrators they added.
   */
  readonly other: readonly VoiceProfile[];
  /** The user has an own READY voice, in whatever language. */
  readonly hasOwnVoice: boolean;
  /**
   * `own`, `ready`, then `other`: the order the narrator sheet lists them
   * in. The first one is the default narrator, so a voice of the story's
   * language is preferred whenever there is one.
   */
  readonly all: readonly VoiceProfile[];
}

/**
 * The narrators a story can be listened to with: the voices of its language
 * first (own voices before ready-made ones), then the voices of other
 * languages. Nothing is left out.
 */
export function narratorsForStory(
  profiles: readonly VoiceProfile[],
  storyLanguage: string | null | undefined,
): StoryNarrators {
  const usable = profiles.filter(isVoiceProfileReady);
  const matches = (profile: VoiceProfile) => voiceMatchesLanguage(profile, storyLanguage);
  const ownAll = usable.filter(profile => isCloneProfile(profile));
  const readyAll = usable.filter(profile => !isCloneProfile(profile));
  const own = ownAll.filter(matches);
  const ready = readyAll.filter(matches);
  const other = [
    ...ownAll.filter(profile => !matches(profile)),
    ...readyAll.filter(profile => !matches(profile)),
  ];
  return { own, ready, other, hasOwnVoice: ownAll.length > 0, all: [...own, ...ready, ...other] };
}

/**
 * What a listener should be told before a story is read by a voice of
 * another language.
 *
 *   - 'none': the voice speaks the story's language (or a language is unknown).
 *   - 'accent': the user's own voice of another language reads it. It keeps
 *     its accent, so the story detail asks first ("Dil uyuşmuyor").
 *   - 'native': a ready-made narrator of another language. The backend reads
 *     the story with the same narrator's voice of the story's language, so
 *     one quiet line says so and nothing is asked.
 *   - 'readyAccent': a ready-made narrator of another language whose name is
 *     known NOT to exist in the story's language (the catalogue of that
 *     language is loaded and does not list it): its own voice reads, accented.
 */
export type NarrationLanguageNotice = 'none' | 'accent' | 'native' | 'readyAccent';

/** What `pickInitialNarrator` reads of a narration of the story. */
export type NarrationForPick = Pick<StoryNarration, 'voiceProfileId' | 'status' | 'createdAt' | 'completedAt'>;

export interface InitialNarratorInput {
  readonly narrators: StoryNarrators;
  /** The narrations of this story (any status, any order). */
  readonly narrations: readonly NarrationForPick[];
  /** The narrator chosen last on any story (null when none is known). */
  readonly lastNarratorId?: string | null;
  /**
   * Own-voice narrations left in the user's allowance; null or undefined
   * when the plan has no limit there or the usage is not known. At 0 an own
   * voice is not picked for a new narration.
   */
  readonly cloneNarrationsRemaining?: number | null;
}

const narrationTime = (narration: NarrationForPick): number => {
  const time = (narration.completedAt ?? narration.createdAt)?.getTime?.();
  return typeof time === 'number' && Number.isFinite(time) ? time : 0;
};

/**
 * The narrator a story page starts with, null without any usable voice:
 *
 *   1. the voice of the newest READY narration of this story (listening to it
 *      costs nothing, whatever the allowance);
 *   2. the narrator chosen last, when it can read this story (an own voice
 *      only while own-voice narrations are left);
 *   3. the first narrator of the list (the story's language first), skipping
 *      own voices while their allowance is used up; when every voice is an
 *      own voice the first one stays, and the story page explains the limit.
 */
export function pickInitialNarrator({
  narrators,
  narrations,
  lastNarratorId,
  cloneNarrationsRemaining,
}: InitialNarratorInput): string | null {
  const usable = new Map(narrators.all.map(profile => [profile.id, profile] as const));
  if (usable.size === 0) return null;
  const ownUsedUp = cloneNarrationsRemaining === 0;

  let newest: NarrationForPick | null = null;
  for (const narration of narrations) {
    if (narration.status !== NarrationStatus.READY) continue;
    if (!narration.voiceProfileId || !usable.has(narration.voiceProfileId)) continue;
    if (!newest || narrationTime(narration) > narrationTime(newest)) newest = narration;
  }
  if (newest?.voiceProfileId) return newest.voiceProfileId;

  const last = lastNarratorId ? usable.get(lastNarratorId) : undefined;
  if (last && !(ownUsedUp && isCloneProfile(last))) return last.id;

  const first = ownUsedUp ? narrators.all.find(profile => !isCloneProfile(profile)) : undefined;
  return (first ?? narrators.all[0]).id;
}

export function narrationLanguageNotice(
  profile:
    | Pick<VoiceProfile, 'kind' | 'provider' | 'contentLanguage' | 'name' | 'voiceId'>
    | null
    | undefined,
  storyLanguage: string | null | undefined,
  /**
   * The ready-made narrators of the story's language when that catalogue is
   * loaded; null or undefined while it is not known.
   */
  storyLanguageCatalogue?: readonly { readonly name: string }[] | null,
): NarrationLanguageNotice {
  if (!profile || !languageCodeOf(storyLanguage)) return 'none';
  if (voiceMatchesLanguage(profile, storyLanguage)) return 'none';
  if (isCloneProfile(profile)) return 'accent';
  if (storyLanguageCatalogue) {
    const name = bareVoiceName(profile.name, profile.voiceId).toLowerCase();
    const twin = storyLanguageCatalogue.some(voice => voice.name.toLowerCase() === name);
    if (!twin) return 'readyAccent';
  }
  return 'native';
}
