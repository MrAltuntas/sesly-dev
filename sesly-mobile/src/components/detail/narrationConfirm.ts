/**
 * What the narration confirmation sheet says before a NEW narration is
 * generated (`NarrationConfirmSheet`): the story (title, part, language,
 * length, age group, content warnings, the AI-translation mark), the voice
 * (name, kind, language and what a language mismatch means) and the cost in
 * plain words from the plan and GET /usage.
 *
 * Pure: it reads i18n for the words and nothing else, so the sheet and the
 * tests share one answer.
 */

import i18n from '../../i18n';
import { contentLanguageLabel, contentLanguageNativeName } from '../../hooks/useContentLanguage';
import { contentWarningLabel, parseContentWarnings, type ContentWarning } from '../../models/contentWarnings';
import { getNarratorDisplay, narrationLanguageNotice } from '../../models/Narrator';
import { PLANS, type PlanId } from '../../models/Plans';
import {
  blockForUsedUpBucket,
  narrationBucket,
  type NarrationKind,
  type QuotaBlock,
  type UsageSummary,
} from '../../models/Quota';
import {
  getStoryTranslationKind,
  type Story,
  type StoryPart,
  type StoryTranslationSource,
} from '../../models/Story';
import { isCloneProfile, languageCodeOf, type VoiceProfile } from '../../models/VoiceProfile';
import { TTSProvider } from '../../types/enums';
import type { CoverSubject } from '../design/covers';
import { storyAgeLabel, storyDurationLabel } from '../../utils/storyLabels';

/** A list copy or a detail of the story: the detail adds the part and the translation. */
export type ConfirmStory = CoverSubject &
  Pick<Story, 'id' | 'title' | 'ageGroup' | 'estimatedDuration' | 'language' | 'contentWarnings' | 'credit'> & {
    readonly isMachineTranslation?: boolean;
    readonly part?: StoryPart | null;
    readonly translation?: StoryTranslationSource | null;
  };

/** A voice as the screens hold it (the generation screen may know only id and name). */
export type ConfirmVoice = Pick<VoiceProfile, 'id' | 'name'> &
  Partial<Pick<VoiceProfile, 'kind' | 'provider' | 'voiceId' | 'contentLanguage'>>;

/** 'new': a first narration of this pair; 'regenerate': a new one replaces the ready one. */
export type NarrationConfirmMode = 'new' | 'regenerate';

/**
 * The cost of one narration: nothing to say (unlimited), the allowance it
 * draws from ("Bu seslendirme hazır anlatıcı hakkından 1 kullanır (bu ay
 * 4/20)."), or the allowance is used up (the block, with the plans).
 */
export type NarrationCost =
  | { readonly state: 'free' }
  | { readonly state: 'uses'; readonly line: string }
  | { readonly state: 'usedUp'; readonly block: QuotaBlock };

/**
 * The cost from GET /usage when it answered, else from the plan (without
 * counts). An unlimited bucket costs nothing worth saying.
 */
export function narrationCost(
  kind: NarrationKind,
  usage: UsageSummary | null | undefined,
  planId: PlanId,
): NarrationCost {
  if (usage) {
    const bucket = narrationBucket(usage, kind);
    if (bucket.limit === null) return { state: 'free' };
    const block = blockForUsedUpBucket(kind, bucket, planId);
    if (block) return { state: 'usedUp', block };
    const period = bucket.period === 'lifetime' ? 'Lifetime' : 'Month';
    return {
      state: 'uses',
      line: i18n.t(`detail:confirm.cost.${kind}${period}`, {
        used: Math.max(0, Math.min(bucket.used, bucket.limit)),
        limit: bucket.limit,
      }),
    };
  }
  const plan = PLANS[planId];
  const limit = kind === 'clone' ? plan.clonedNarrations : plan.presetNarrations;
  if (limit.amount === null) return { state: 'free' };
  return { state: 'uses', line: i18n.t(`detail:confirm.cost.${kind}`) };
}

/** What a voice of another language means here; null when the languages match. */
export interface ConfirmLanguageNote {
  /** 'warning' for an own voice (it keeps its accent), 'info' for a ready-made narrator. */
  readonly tone: 'warning' | 'info';
  readonly title: string | null;
  readonly text: string;
}

export interface NarrationConfirmModel {
  readonly mode: NarrationConfirmMode;
  readonly title: string;
  /** "Yenisi eskisinin yerini alır." for a regenerate, else null. */
  readonly replaceLine: string | null;
  readonly storyTitle: string;
  /** "Bölüm 2 / 3", or null for a single-part story. */
  readonly partLabel: string | null;
  /** "Türkçe, yaklaşık 6 dk, 3-6 yaş": only the parts that are known. */
  readonly storyLine: string;
  readonly warnings: readonly { readonly key: ContentWarning; readonly label: string }[];
  readonly machineTranslation: boolean;
  readonly voiceName: string;
  readonly ownVoice: boolean;
  /** "Hazır anlatıcı, Türkçe" / "Kendi sesin, English". */
  readonly voiceLine: string;
  readonly languageNote: ConfirmLanguageNote | null;
  readonly cost: NarrationCost;
}

export interface NarrationConfirmInput {
  readonly story: ConfirmStory;
  readonly voice: ConfirmVoice;
  readonly mode: NarrationConfirmMode;
  readonly usage: UsageSummary | null | undefined;
  readonly planId: PlanId;
  /** The ready-made narrators of the story's language, when that catalogue is loaded. */
  readonly catalogue?: readonly { readonly name: string }[] | null;
}

function languageNoteFor(
  voice: ConfirmVoice,
  storyLanguage: string,
  catalogue: readonly { readonly name: string }[] | null | undefined,
): ConfirmLanguageNote | null {
  const notice = narrationLanguageNotice(
    {
      kind: voice.kind ?? null,
      // Unknown kind and provider: a ready-made narrator, as isCloneProfile reads it.
      provider: voice.provider ?? TTSProvider.GOOGLE,
      contentLanguage: voice.contentLanguage ?? '',
      name: voice.name,
      voiceId: voice.voiceId ?? '',
    },
    storyLanguage,
    catalogue,
  );
  if (notice === 'none') return null;
  const names = {
    voiceLanguage: contentLanguageLabel(languageCodeOf(voice.contentLanguage) || 'tr'),
    storyLanguage: contentLanguageLabel(storyLanguage),
  };
  if (notice === 'accent') {
    return {
      tone: 'warning',
      title: i18n.t('detail:mismatchDialog.title'),
      text: i18n.t('detail:mismatchDialog.message', names),
    };
  }
  return {
    tone: 'info',
    title: null,
    text:
      notice === 'native'
        ? i18n.t('detail:narrator.nativeVoice', { language: names.storyLanguage })
        : i18n.t('detail:narrator.accentedVoice', names),
  };
}

export function narrationConfirmModel({
  story,
  voice,
  mode,
  usage,
  planId,
  catalogue,
}: NarrationConfirmInput): NarrationConfirmModel {
  const own = isCloneProfile({ kind: voice.kind ?? null, provider: voice.provider ?? null });
  const language = languageCodeOf(story.language);
  const duration = storyDurationLabel(story.estimatedDuration);
  const storyLine = [
    language ? contentLanguageNativeName(language) : '',
    duration ? i18n.t('detail:confirm.about', { duration }) : '',
    storyAgeLabel(story.ageGroup),
  ]
    .filter(Boolean)
    .join(', ');
  const voiceLanguage = languageCodeOf(voice.contentLanguage);
  const part = story.part ?? null;
  return {
    mode,
    title: i18n.t(mode === 'regenerate' ? 'detail:confirm.titleRegenerate' : 'detail:confirm.title'),
    replaceLine: mode === 'regenerate' ? i18n.t('detail:confirm.replaces') : null,
    storyTitle: story.title,
    partLabel: part ? i18n.t('detail:confirm.part', { number: part.number, total: part.total }) : null,
    storyLine,
    warnings: parseContentWarnings(story.contentWarnings).map(key => ({ key, label: contentWarningLabel(key) })),
    machineTranslation:
      getStoryTranslationKind(story) === 'machine' || story.translation?.isMachineTranslation === true,
    voiceName: getNarratorDisplay(voice)?.name ?? voice.name,
    ownVoice: own,
    voiceLine: [
      i18n.t(own ? 'detail:confirm.ownVoice' : 'detail:confirm.readyVoice'),
      voiceLanguage ? contentLanguageNativeName(voiceLanguage) : '',
    ]
      .filter(Boolean)
      .join(', '),
    languageNote: language ? languageNoteFor(voice, language, catalogue) : null,
    cost: narrationCost(own ? 'clone' : 'preset', usage, planId),
  };
}
