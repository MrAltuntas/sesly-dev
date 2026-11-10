/**
 * StoryDetailScreen: "Masal detayı" (design/v4/playful, frame c).
 *
 *   - Hero (StoryHero): the cover full-bleed and wide from the very top of
 *     the screen, like the Home "Bugünün masalı" card but cut less at the
 *     bottom, a canvas gradient rising from the bottom and the Baloo 2 title
 *     on it (the screen's header).
 *   - Top bar over the picture, fixed while the page scrolls: the glass back
 *     button; save (the bookmark, filled when the tale is saved in any
 *     language, with the same "kaydedildi" message as the story cards) and
 *     "more" (the story options sheet) as glass buttons at the right. Once
 *     the picture has scrolled away the bar takes the canvas colour.
 *   - The tags: the category in its colour, age, content warnings, duration,
 *     language and level. An AI translation says so in the note under the
 *     summary (MachineTranslationNote), not with a badge.
 *   - The summary, then "Kimin sesiyle dinlesin?": three narrator cards with
 *     the parent's own voice first ("Tümü" opens the narrator sheet with
 *     every voice). Without any voice the first narrators of the catalogue
 *     are offered right there, with their samples. A voice of another
 *     language may read the story: an own voice is warned about in the
 *     narration confirmation ("Dil uyuşmuyor": it will sound accented); a
 *     ready-made narrator gets one quiet line under the cards, because the
 *     backend reads the story with that narrator's voice of the story's
 *     language.
 *   - The credits card (only the rows the story has data for), then the
 *     languages of the tale: one chip per language version and "Başka dilde
 *     iste", then "İlgili masallar" (RelatedSection: three shelf covers and
 *     "Tümü", which opens every related story grouped in a sheet; hidden
 *     when nothing is related), and last, at the very bottom, "Kaynak ve
 *     lisans" folded into one row (StorySourceSection).
 *   - Dock: the sample of the chosen narrator and the primary action, sized
 *     by its content above the system inset. A narration of this narrator
 *     that is ready makes the action "Dinle" (the player opens and plays);
 *     otherwise it prepares one once the narration confirmation
 *     (NarrationConfirmSheet: the story, the voice, the cost or the used-up
 *     allowance) has had "Seslendir", and says how many stories are left
 *     once three or fewer are. "Baştan hazırla" is confirmed the same way.
 *
 * What is drawn (docs/release-pass/PLAN.json W2-detail, ui-6, ui-7, perf-12):
 * the store's `currentStory` when it is this story (or the language version
 * being opened), else what this page showed last, else a cached detail, else
 * the list copy of the story (`peekStory`) with bones only where the detail
 * adds something the list copy says exists (the language versions). The
 * skeleton of the whole page
 * shows only when nothing of the story is known. The page tracks its own
 * request, so another list loading or another story page cannot turn it into
 * an error.
 *
 * Which narrator is chosen first: `pickInitialNarrator` (models/Narrator).
 * A tap is the user's choice and is never replaced by data arriving later.
 *
 * Until this story's narrations are known (`narrationsKnownFor`, or
 * `NARRATIONS_WAIT_MS` without an answer) the action is busy and says
 * nothing it might take back: a ready narration would turn "X anlatsın" into
 * "Dinle", and a tap meanwhile prepared a narration that exists (V3-04). A
 * READY narration of the newest page is enough for "Dinle" at once.
 *
 * The push is kept light (V3-03): what is not on screen when the page
 * opens waits for the end of the transition (`useTransitionSettled`): the
 * three sheets (a sheet opened before that mounts on demand, on the first
 * tap) and the credits and languages below the narrators (faded in). The
 * ready-made catalogue of the story's language is asked for then too, so
 * the narrator sheet's first open has it and opens at its final height. The
 * narrator cards, the sheets and the dock are memoised with stable
 * callbacks. The languages wait on bones only when the list copy says the
 * tale has other languages or can ask for one; the credits come with the
 * list copy (V3-05).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  LayoutChangeEvent,
  Linking,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { observer } from 'mobx-react-lite';
import { runInAction } from 'mobx';
import { useNavigation, useRoute, RouteProp, useIsFocused } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';

import {
  Bone,
  Button,
  Card,
  Chip,
  FadeIn,
  Icon,
  IconButton,
  SectionHeader,
  SkeletonPulse,
  Spinner,
  StateView,
  Tactile,
  Tag,
  TopAppBar,
  snackbar,
} from '../../components/design';
import type { IconName } from '../../components/design';
import { MachineTranslationNote } from '../../components/detail/MachineTranslationNote';
import { StoryHero, storyHeroHeight } from '../../components/detail/StoryHero';
import { StorySourceSection } from '../../components/detail/StorySourceSection';
import {
  RelatedSection,
  RelatedStoriesSheet,
  useRelatedStories,
} from '../../components/detail/RelatedStories';
import { usePremiumGate } from '../../components/story/usePremiumGate';
import { contentWarningLabel } from '../../models/contentWarnings';
import {
  CatalogueNarratorCards,
  NARRATOR_CARD_HEIGHT,
  NarratorCards,
  NarratorCardsSkeleton,
  pickNarratorCards,
} from '../../components/detail/NarratorCards';
import { NarratorSheet } from '../../components/detail/NarratorSheet';
import {
  NarrationConfirmRequest,
  NarrationConfirmSheet,
} from '../../components/detail/NarrationConfirmSheet';
import { StoryOption, StoryOptionsSheet } from '../../components/detail/StoryOptionsSheet';
import {
  TranslationRequestSheet,
  requestableLanguages,
} from '../../components/detail/TranslationRequestSheet';
import { useNarratorPreview } from '../../components/detail/useNarratorPreview';
import { loadLastNarrator, lastNarratorId, rememberLastNarrator } from '../../components/detail/lastNarrator';
import { useAddNarrator } from '../../components/voice/useAddNarrator';
import { announceSaveOutcome } from '../../components/story/saveFeedback';
import { SUPPORT_EMAIL } from '../../components/profile/support';
import type { AvailableGoogleVoice } from '../../models/VoiceProfile';
import {
  LIP,
  RADIUS,
  SCREEN_PAD_H,
  SPACE,
  Theme,
  dockBottom,
  textStylesFor,
  themedStyles,
  useT,
} from '../../theme/theme';
import { categoryColors, categorySlot } from '../../theme/palettes';
import { withAlpha } from '../../theme/color';
import i18n from '../../i18n';
import { msg } from '../../i18n/messages';
import { useStory } from '../../hooks/useStory';
import { useVoiceProfile } from '../../hooks/useVoiceProfile';
import { useSubscription } from '../../hooks/useSubscription';
import { contentLanguageLabel, useContentLanguage } from '../../hooks/useContentLanguage';
import { useDialog } from '../../hooks/useDialog';
import type { SaveOutcome } from '../../hooks/useDiscover';
import {
  Story,
  StoryCredit,
  StoryDetail,
  StoryTranslationRef,
  getStoryTranslationKind,
  isStorySaved,
} from '../../models/Story';
import { VoiceProfile, isCloneProfile } from '../../models/VoiceProfile';
import {
  getNarratorDisplay,
  narrationLanguageNotice,
  narratorsForStory,
  pickInitialNarrator,
} from '../../models/Narrator';
import { StoryNarration, isNarrationGenerating, isNarrationReady } from '../../models/Narration';
import {
  NarrationKind,
  QUOTA_CODES,
  QuotaBlock,
  describeQuotaBlock,
  narrationBucket,
  remainingNarrationsLine,
} from '../../models/Quota';
import { VoiceProfileStatus } from '../../types/enums';
import {
  NarrationMeta,
  metaFromNarration,
  playerStoryOf,
  rememberNarrationMeta,
} from '../../stores/narrationMeta';
import {
  addToQueueWithFeedback,
  isQueued,
  newestReadyNarration,
  removeFromQueueWithFeedback,
  withKnownStory,
} from '../../stores/queueActions';
import { storyAgeLabel, storyDurationLabel, storyShelfLabel } from '../../utils/storyLabels';
import { showToast } from '../../utils/toast';
import { navigateSingleton } from '../../navigation/navigateSingleton';
import { reasonForQuota } from '../subscription/subscriptionReason';
import { RootStackParamList } from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList, 'StoryDetail'>;
type Route = RouteProp<RootStackParamList, 'StoryDetail'>;

/** The address the app's "Bize ulaşın" row writes to. */
export { SUPPORT_EMAIL };

/** A glass button of the top bar: a 44dp face on its 2dp lip. */
const BAR_BUTTON = 44;
/** The top bar under the status bar: 8 on top, the button and its lip, 8 below. */
export const TOP_BAR_BODY = SPACE.sm + BAR_BUTTON + LIP.sm + SPACE.sm;
/** Over this much scroll before the picture leaves the bar, the bar takes the canvas colour. */
const BAR_FADE = 48;
/** The dock's sample button: a 52dp face on its lip, the lg button's height. */
const SAMPLE_SIZE = 52;
/** Dock above its bottom padding: paddingTop 8, the 52dp row, its 3dp lip. */
export const DOCK_BODY = SPACE.sm + SAMPLE_SIZE + LIP.md;
/** The voices are asked for again on focus at most this often (across story pages). */
export const VOICE_REFRESH_MS = 30 * 1000;
/**
 * The deferred parts mount this long after the page at the latest, when the
 * stack sends no `transitionEnd` (no animation, a route that was restored).
 */
export const TRANSITION_FALLBACK_MS = 600;
/**
 * The action waits this long for the story's narrations; then it goes on
 * with what is known, so a slow request never keeps it busy.
 */
export const NARRATIONS_WAIT_MS = 4000;

let lastVoiceRefreshAt = 0;

/** Tests only: forget when a story page last asked for the voices. */
export function resetVoiceRefreshForTests(): void {
  lastVoiceRefreshAt = 0;
}

/**
 * True once the push of this page has finished (`transitionEnd`), or after
 * `TRANSITION_FALLBACK_MS`, and from then on. What is not on screen when the
 * page opens mounts then, so the push is not held up by it.
 */
function useTransitionSettled(nav: Nav): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (settled) return undefined;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setSettled(true);
    };
    const unsubscribe = nav.addListener('transitionEnd', finish);
    const timer = setTimeout(finish, TRANSITION_FALLBACK_MS);
    return () => {
      done = true;
      unsubscribe();
      clearTimeout(timer);
    };
  }, [nav, settled]);
  return settled;
}

const noop = () => undefined;

/** The page's handlers as of its last render, for the stable callbacks of its memoised parts. */
interface PageHandlers {
  primary: () => void;
  sample: () => void;
  createVoice: () => void;
  pickReady: () => void;
  selectCatalogue: (voice: AvailableGoogleVoice) => void;
}

// ─────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────

/** "Düzey A2, temel"; '' when the story has no level. */
export function storyLevelLabel(level: string | null | undefined): string {
  const code = level?.trim().toUpperCase();
  if (!code) return '';
  const wordKey = `detail:levelWord.${code}`;
  return i18n.exists(wordKey)
    ? i18n.t('detail:level', { level: code, word: i18n.t(wordKey) })
    : i18n.t('detail:levelOnly', { level: code });
}

export type CreditRowKey = 'author' | 'collector' | 'translator' | 'adapter' | 'source';

export interface CreditRow {
  readonly key: CreditRowKey;
  readonly label: string;
  readonly value: string;
  /** Plain text after the value (", 1819"). */
  readonly suffix: string;
}

/**
 * The credit lines of the detail, in the mockup's order, only the ones the
 * story has data for. A folk tale without a named author says so.
 */
export function storyCreditRows(credit: StoryCredit): CreditRow[] {
  const rows: CreditRow[] = [];
  const push = (key: CreditRowKey, value: string | null, suffix = '') => {
    const text = value?.trim();
    if (!text) return;
    rows.push({ key, label: i18n.t(`detail:credit.${key}`), value: text, suffix });
  };
  push(
    'author',
    credit.authorName ??
      (credit.origin === 'FOLK_ANONYMOUS' ? i18n.t('detail:credit.anonymousFolk') : null),
  );
  push('collector', credit.collectorName);
  push('translator', credit.translatorName);
  push('adapter', credit.adaptedBy);
  const year = credit.editionYear ?? credit.firstPublishedYear;
  push('source', credit.sourceName, year ? `, ${year}` : '');
  return rows;
}

export type SourceRowKey = 'sourceUrl' | 'attribution' | 'license' | 'licenseUrl' | 'cover';

export interface SourceRow {
  readonly key: SourceRowKey;
  readonly label: string;
  readonly value: string;
}

/**
 * "Kaynak ve lisans": where the text comes from and under which licence,
 * then the credit of the cover picture ("Kapak resmi"), as information only.
 * Links are plain selectable text, never a tap that leaves the app (CC BY
 * allows giving the licence URL as text).
 */
export function storySourceRows(credit: StoryCredit): SourceRow[] {
  const rows: SourceRow[] = [];
  const push = (key: SourceRowKey, value: string | null) => {
    const text = value?.trim();
    if (text) rows.push({ key, label: i18n.t(`detail:source.${key}`), value: text });
  };
  push('sourceUrl', credit.sourceUrl);
  push('attribution', credit.attribution);
  push('license', credit.licenseName);
  push('licenseUrl', credit.licenseUrl);
  push('cover', credit.coverCredit);
  return rows;
}

/** `mailto:` link for a mistake in the text of a story. */
export function reportMailUrl(story: { id: string; title: string }): string {
  const subject = i18n.t('detail:report.subject', { title: story.title, id: story.id });
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

interface LanguageVersion {
  readonly language: string;
  /** Story id of that version; null for the version on screen. */
  readonly ref: StoryTranslationRef | null;
}

/** The page's own request for the story detail. */
interface DetailRequest {
  readonly id: string;
  readonly phase: 'loading' | 'failed';
  /** HTTP status of the failure (403 premium, 404 gone), null otherwise. */
  readonly status: number | null;
  readonly offline: boolean;
}

// ─────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────

export const StoryDetailScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const T = useT();
  const { t } = useTranslation('detail');
  const styles = stylesFor(T);
  const text = textStylesFor(T);
  const storyStore = useStory();
  const voiceProfileStore = useVoiceProfile();
  const subscriptionStore = useSubscription();
  const contentLanguage = useContentLanguage();
  const { showDialog } = useDialog();
  const isFocused = useIsFocused();
  const preview = useNarratorPreview();
  const narratorAdder = useAddNarrator();
  const [addingVoiceId, setAddingVoiceId] = useState<string | null>(null);

  const storyId = route.params?.storyId;
  const selectVoiceParam = route.params?.selectVoiceId;

  // The stored choice; what the page shows is `selectedVoiceId` below.
  const [pickedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [narratorOpen, setNarratorOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // The confirmation before a new narration; the request stays while it leaves.
  const [narrateOpen, setNarrateOpen] = useState(false);
  const [narrateRequest, setNarrateRequest] = useState<
    (NarrationConfirmRequest & { readonly voice: VoiceProfile }) | null
  >(null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [request, setRequest] = useState<DetailRequest | null>(null);
  const [lastPick, setLastPick] = useState<string | null>(lastNarratorId);
  const [dockHeight, setDockHeight] = useState(0);
  const [relatedOpen, setRelatedOpen] = useState(false);
  // A story tapped in the related sheet opens once the sheet has gone.
  const pendingRelated = useRef<Story | null>(null);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const premiumGate = usePremiumGate();
  // The page's scroll, on the native driver: the top bar takes the canvas
  // colour once the picture has gone under it.
  const scrollY = useRef(new Animated.Value(0)).current;
  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
    [scrollY],
  );

  // ─── Deferred parts (V3-03) ───
  const settled = useTransitionSettled(nav);
  // The sheets mount after the push, or at once when one is asked for
  // earlier; then they stay, so an exit always runs to its end.
  const sheetsMounted = useRef(false);
  if (settled || narratorOpen || optionsOpen || requestOpen || narrateOpen || relatedOpen) {
    sheetsMounted.current = true;
  }
  // The languages waited on bones: the versions that replace them fade in.
  const sawLanguageBones = useRef(false);

  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  // ─── Which copy of the story is drawn ───
  const current = storyStore.currentStory;
  const live =
    current && (current.id === storyId || (!!switchingTo && current.id === switchingTo))
      ? current
      : null;
  // What this page showed last: kept when another story page loads its own
  // story into the store, until the focus refetch below brings this one back.
  const lastShown = useRef<StoryDetail | null>(null);
  if (live && live.id === storyId) lastShown.current = live;
  // A story opened recently draws from the cache on the very first frame.
  const cached = useRef<{ id: string; detail: StoryDetail | null } | null>(null);
  if (storyId && cached.current?.id !== storyId) {
    cached.current = { id: storyId, detail: storyStore.cachedDetail(storyId) };
  }
  const detail: StoryDetail | null =
    live ??
    (lastShown.current?.id === storyId ? lastShown.current : null) ??
    (storyId && cached.current?.id === storyId ? cached.current.detail : null);
  // Without a detail, the list copy the tapped card came from.
  const peek: Story | null = !detail && storyId ? storyStore.peekStory(storyId) : null;
  const failed = request && request.id === storyId && request.phase === 'failed' ? request : null;
  // Gone or locked for this plan: no copy of it stays on screen.
  const blocked = !!failed && (failed.status === 403 || failed.status === 404);
  const story: Story | StoryDetail | null = blocked ? null : (detail ?? peek);
  /** The store's own copy is on screen: saving and the requests act on it. */
  const isCurrent = !!current && current.id === storyId;
  const storyLanguage = story?.language ?? null;
  // "İlgili masallar": asked for after the push, like the rest below the
  // fold, and only for a story the page can show.
  const related = useRelatedStories(story?.id ?? null, settled);

  const requestDetail = useCallback(
    async (id: string) => {
      setRequest({ id, phase: 'loading', status: null, offline: false });
      await storyStore.getStoryDetail(id, { showCached: true });
      if (!mounted.current) return;
      const fresh =
        storyStore.currentStory?.id === id ? storyStore.currentStory : storyStore.cachedDetail(id);
      if (fresh) {
        cached.current = { id, detail: fresh };
        setRequest(prev => (prev?.id === id ? null : prev));
        return;
      }
      setRequest(prev =>
        prev?.id === id
          ? {
              id,
              phase: 'failed',
              status: storyStore.storyDetailErrorStatus,
              offline: storyStore.detailErrorKind === 'offline',
            }
          : prev,
      );
    },
    [storyStore],
  );

  // ─── Narrations of this story ───
  const storyKey = story?.id ?? null;
  const byStory = storyKey ? storyStore.narrationsByStory.get(storyKey) : undefined;
  const userNarrations = storyStore.userNarrations;
  const storyNarrations: readonly StoryNarration[] = useMemo(
    () => (storyKey ? (byStory ?? userNarrations.filter(n => n.storyId === storyKey)) : []),
    [storyKey, byStory, userNarrations],
  );
  // Whether a narration of this story is ready is known only once its list
  // arrived (or failed). A request that takes too long stops being waited for.
  const narrationsKnown = !storyKey || storyStore.narrationsKnownFor(storyKey);
  const [narrationsWaitOver, setNarrationsWaitOver] = useState<string | null>(null);
  useEffect(() => {
    if (!storyKey || narrationsKnown) return undefined;
    const timer = setTimeout(() => setNarrationsWaitOver(storyKey), NARRATIONS_WAIT_MS);
    return () => clearTimeout(timer);
  }, [storyKey, narrationsKnown]);
  const narrationsSettled = narrationsKnown || narrationsWaitOver === storyKey;

  // ─── Focus: the detail when the store holds another story, this story's
  // narrations, the voices (at most every 30 s, from any story page, unless
  // a voice is training or the list was never loaded) and the allowance. ───
  useEffect(() => {
    if (!isFocused || !storyId) return;
    if (storyStore.currentStory?.id !== storyId) void requestDetail(storyId);
    void storyStore.loadNarrationsForStory(storyId);
    const training = voiceProfileStore.voiceProfiles.some(
      p => p.status === VoiceProfileStatus.PENDING || p.status === VoiceProfileStatus.PROCESSING,
    );
    const now = Date.now();
    if (training || !voiceProfileStore.hasLoadedProfiles || now - lastVoiceRefreshAt >= VOICE_REFRESH_MS) {
      lastVoiceRefreshAt = now;
      void voiceProfileStore.loadVoiceProfiles();
    }
    void subscriptionStore.loadUsageIfStale?.();
  }, [isFocused, storyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void contentLanguage.load();
  }, [contentLanguage]);

  useEffect(() => {
    let active = true;
    void loadLastNarrator().then(id => {
      if (active) setLastPick(id);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleRetryStory = () => {
    if (storyId) void requestDetail(storyId);
  };

  // The voices of the story's language first (own, then ready-made), then
  // the voices of other languages.
  const profiles = voiceProfileStore.voiceProfiles;
  const profilesLoading = !voiceProfileStore.hasLoadedProfiles && profiles.length === 0;
  const narrators = useMemo(
    () => narratorsForStory(profiles, storyLanguage),
    [profiles, storyLanguage],
  );

  // ─── The chosen narrator ───
  // A tap (or a voice added for this story) is the user's choice: data
  // arriving later never replaces it. Until then the page follows
  // `pickInitialNarrator` as the narrations, the voices and the last pick load.
  const userPicked = useRef(false);
  // The narrator carried over from the language version opened before.
  const carried = useRef<string | null>(null);
  const pickNarrator = useCallback((id: string) => {
    userPicked.current = true;
    rememberLastNarrator(id);
    setSelectedVoiceId(id);
  }, []);

  const cloneRemaining = subscriptionStore.usage?.buckets.cloneNarrations.remaining ?? null;
  // RB-2: the stored choice is set by the effect below, one commit after
  // the voices arrive. Until it lists a voice the render derives the same
  // pick itself, so the commit that first shows the narrator cards already
  // shows the chosen one and "Dinle", never "Anlatıcı seç" for a moment.
  const storedListed = !!pickedVoiceId && narrators.all.some(p => p.id === pickedVoiceId);
  const selectedVoiceId =
    storedListed || !storyKey
      ? pickedVoiceId
      : pickInitialNarrator({
          narrators,
          narrations: storyNarrations,
          lastNarratorId: carried.current ?? lastPick,
          cloneNarrationsRemaining: cloneRemaining,
        });

  const selectedVoice = useMemo(
    () => narrators.all.find(p => p.id === selectedVoiceId) ?? null,
    [narrators, selectedVoiceId],
  );

  // Another language version of the tale was opened: when the chosen voice
  // does not speak it but another voice of the same kind does (an own voice
  // for an own voice, a ready-made narrator for a ready-made one), move to
  // that one. Otherwise the chosen voice stays and reads across languages.
  // (Declared before the pick below, which reads what this one carries.)
  const languageOnScreen = useRef<string | null>(null);
  useEffect(() => {
    if (!storyLanguage || languageOnScreen.current === storyLanguage) return;
    const switched = languageOnScreen.current !== null;
    languageOnScreen.current = storyLanguage;
    if (!switched || !selectedVoice) return;
    let next = selectedVoice.id;
    if (narrationLanguageNotice(selectedVoice, storyLanguage) !== 'none') {
      const sameKind = isCloneProfile(selectedVoice) ? narrators.own : narrators.ready;
      if (sameKind.length > 0) next = sameKind[0].id;
    }
    if (userPicked.current) setSelectedVoiceId(next);
    else carried.current = next;
  }, [storyLanguage, selectedVoice, narrators]);

  useEffect(() => {
    if (!storyKey) return;
    if (userPicked.current && storedListed) return;
    // A chosen voice that is gone (deleted elsewhere) gives the choice back.
    userPicked.current = false;
    const next = pickInitialNarrator({
      narrators,
      narrations: storyNarrations,
      lastNarratorId: carried.current ?? lastPick,
      cloneNarrationsRemaining: cloneRemaining,
    });
    if (next !== pickedVoiceId) setSelectedVoiceId(next);
  }, [storyKey, narrators, storyNarrations, lastPick, cloneRemaining, pickedVoiceId, storedListed]);

  // A narrator added or recorded for this story comes back as
  // `selectVoiceId`: chosen once the voices list it, then the param is
  // cleared. One that is not listed yet asks for the voices again.
  const askedForVoice = useRef<string | null>(null);
  useEffect(() => {
    if (!selectVoiceParam || !voiceProfileStore.hasLoadedProfiles) return;
    if (narrators.all.some(p => p.id === selectVoiceParam)) {
      pickNarrator(selectVoiceParam);
      nav.setParams({ selectVoiceId: undefined });
      return;
    }
    if (askedForVoice.current === selectVoiceParam) return;
    askedForVoice.current = selectVoiceParam;
    void Promise.resolve(voiceProfileStore.loadVoiceProfiles({ fresh: true })).then(() => {
      if (!mounted.current) return;
      const listed = voiceProfileStore.voiceProfiles.some(
        p => p.id === selectVoiceParam && p.status === VoiceProfileStatus.READY,
      );
      // Still not usable (the voice failed): nothing to select.
      if (!listed) nav.setParams({ selectVoiceId: undefined });
    });
  }, [selectVoiceParam, narrators, voiceProfileStore.hasLoadedProfiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // The ready-made narrators of THIS story's language, asked for once the
  // push has finished (with the sheets, so the narrator sheet's first open
  // has them and opens at its final height), when the sheet opens without
  // them, when the user has no voice at all (the page offers the first ones
  // itself), and when a ready-made narrator of another language is chosen
  // (to know whether that narrator has a voice in this language). Quiet:
  // without them the page still works with the user's voices. The store
  // sends one request per language at a time.
  const selectedReadyOfOtherLanguage =
    !!selectedVoice &&
    !isCloneProfile(selectedVoice) &&
    narrationLanguageNotice(selectedVoice, storyLanguage) !== 'none';
  const noVoices = voiceProfileStore.hasLoadedProfiles && narrators.all.length === 0;
  const wantsCatalogue = (narratorOpen || selectedReadyOfOtherLanguage || noVoices) && !!storyLanguage;
  const prefetchCatalogue = settled && !!storyLanguage;
  const requestCatalogue = useCallback(() => {
    if (storyLanguage && !voiceProfileStore.catalogueFor(storyLanguage)) {
      void voiceProfileStore.loadAvailableVoices(storyLanguage, { quiet: true });
    }
  }, [storyLanguage, voiceProfileStore]);
  useEffect(() => {
    if (wantsCatalogue || prefetchCatalogue) requestCatalogue();
  }, [wantsCatalogue, prefetchCatalogue, requestCatalogue]);
  const loadedCatalogue = voiceProfileStore.catalogueFor(storyLanguage);
  const catalogue = useMemo(() => {
    const added = new Set(profiles.filter(p => !isCloneProfile(p)).map(p => p.voiceId));
    return (loadedCatalogue ?? []).filter(voice => !added.has(voice.voiceId));
  }, [loadedCatalogue, profiles]);
  // An added narrator names its voice like a catalogue row ("kadın sesi").
  const voiceGenders = useMemo(
    () => new Map((loadedCatalogue ?? []).filter(v => v.gender).map(v => [v.voiceId, v.gender] as const)),
    [loadedCatalogue],
  );
  // Wanted and neither listed nor failed counts as loading from the first
  // frame, before the effect above has sent the request: a user without a
  // voice never sees the fallback card flash ahead of the narrator bones.
  const catalogueLoading =
    loadedCatalogue === null &&
    (voiceProfileStore.isLoadingVoices ||
      (wantsCatalogue && !voiceProfileStore.catalogueErrorFor(storyLanguage)));

  const cards = useMemo(
    () => pickNarratorCards(narrators, selectedVoiceId),
    [narrators, selectedVoiceId],
  );

  const stopPreview = preview.stop;
  const closeNarratorSheet = useCallback(() => {
    setNarratorOpen(false);
    void stopPreview();
  }, [stopPreview]);

  // Stable callbacks for the memoised parts (cards, narrator sheet, dock):
  // the handlers they call are the ones of the last render (set below).
  const handlers = useRef<PageHandlers>({
    primary: noop,
    sample: noop,
    createVoice: noop,
    pickReady: noop,
    selectCatalogue: noop,
  });
  const onPrimary = useCallback(() => handlers.current.primary(), []);
  const onSample = useCallback(() => handlers.current.sample(), []);
  const onCreateVoice = useCallback(() => handlers.current.createVoice(), []);
  const onPickReady = useCallback(() => handlers.current.pickReady(), []);
  const onSelectCatalogue = useCallback(
    (voice: AvailableGoogleVoice) => handlers.current.selectCatalogue(voice),
    [],
  );
  const onSelectCard = useCallback((profile: VoiceProfile) => pickNarrator(profile.id), [pickNarrator]);
  const onSelectInSheet = useCallback(
    (profile: VoiceProfile) => {
      pickNarrator(profile.id);
      closeNarratorSheet();
    },
    [pickNarrator, closeNarratorSheet],
  );
  const { toggle: toggleSample, toggleVoice: toggleVoiceSample } = preview;
  const onTogglePreview = useCallback((profile: VoiceProfile) => void toggleSample(profile), [toggleSample]);
  const onToggleVoicePreview = useCallback(
    (voice: AvailableGoogleVoice) => void toggleVoiceSample(voice),
    [toggleVoiceSample],
  );
  // A catalogue that is still missing (its prefetch failed) is asked for in
  // the tap that opens the sheet: the store is loading before the sheet's
  // first frame, so the sheet opens on the bones of its final rows, never on
  // the fallback row that the narrators would then push down.
  const openNarratorSheet = useCallback(() => {
    requestCatalogue();
    setNarratorOpen(true);
  }, [requestCatalogue]);

  // A sample never keeps playing on another screen.
  useEffect(() => {
    if (!isFocused) void stopPreview();
  }, [isFocused, stopPreview]);

  // Messages rise above the dock while this page is on top.
  useEffect(() => {
    if (!isFocused || dockHeight <= 0) return;
    snackbar.setBottomInset(dockHeight);
    return () => {
      if (snackbar.getState().bottomInset === dockHeight) snackbar.setBottomInset(0);
    };
  }, [isFocused, dockHeight]);

  // What an option opens (another sheet, a dialog, a toast) runs once the
  // options sheet has gone (its `onClosed`).
  const pendingOption = useRef<(() => void) | null>(null);
  const afterOptions = (action: () => void) => () => {
    pendingOption.current = action;
    setOptionsOpen(false);
  };
  const handleOptionsClosed = useCallback(() => {
    const action = pendingOption.current;
    pendingOption.current = null;
    action?.();
  }, []);

  // The player and the queue draw the story of a narration from its meta;
  // the narrations of a story page come without their story.
  const metaFor = useCallback(
    (narration: StoryNarration, shown: Story | StoryDetail): NarrationMeta => {
      const known = withKnownStory(
        metaFromNarration(narration.storyId ? narration : { ...narration, storyId: shown.id }),
      );
      const voice =
        known.voiceProfile ?? profiles.find(p => p.id === narration.voiceProfileId) ?? null;
      return {
        ...known,
        story: known.story.title ? known.story : playerStoryOf(shown),
        voiceProfile: voice,
        narratorName: known.narratorName ?? getNarratorDisplay(voice)?.name ?? null,
        ownVoice: voice ? isCloneProfile(voice) : known.ownVoice,
      };
    },
    [profiles],
  );

  useEffect(() => {
    if (!story) return;
    for (const narration of storyNarrations) {
      if (isNarrationReady(narration)) rememberNarrationMeta(metaFor(narration, story));
    }
  }, [storyNarrations, story?.id, story?.title, metaFor]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDockLayout = useCallback((e: LayoutChangeEvent) => {
    setDockHeight(Math.round(e.nativeEvent.layout.height));
  }, []);

  const dockPad = { paddingBottom: dockBottom(insets.bottom) };
  const heroHeight = storyHeroHeight(windowWidth, windowHeight, insets.top);
  const barBottom = insets.top + TOP_BAR_BODY;
  const barFade = scrollY.interpolate({
    inputRange: [Math.max(heroHeight - barBottom - BAR_FADE, 0), Math.max(heroHeight - barBottom, 1)],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  // ─── Loading / error / guard ───
  if (!story) {
    let body: React.ReactNode;
    if (!!storyId && !failed) {
      // Nothing of the story is known yet: the page in its own shapes.
      return (
        <View style={styles.container}>
          <StoryDetailSkeleton styles={styles} heroWidth={windowWidth} heroHeight={heroHeight} />
          <View style={[styles.topBar, { paddingTop: insets.top + SPACE.sm }]} pointerEvents="box-none">
            <IconButton
              variant="glass"
              icon="back"
              pressDelay={0}
              onPress={() => nav.goBack()}
              accessibilityLabel={t('common:back')}
              testID="appbar-back"
            />
            <SkeletonPulse testID="story-detail-loading-actions" style={styles.topActions}>
              <Bone width={BAR_BUTTON} height={BAR_BUTTON} radius={RADIUS.md} lip={LIP.sm} />
              <Bone width={BAR_BUTTON} height={BAR_BUTTON} radius={RADIUS.md} lip={LIP.sm} />
            </SkeletonPulse>
          </View>
          <View style={[styles.dock, dockPad]} pointerEvents="none">
            <DockSkeleton styles={styles} testID="story-detail-loading-dock" />
          </View>
        </View>
      );
    } else if (failed?.status === 403) {
      // 403 from GET /stories/:id = a premium story for a plan without them.
      const copy = describeQuotaBlock({
        code: QUOTA_CODES.PREMIUM_STORY,
        planId: subscriptionStore.planId,
        limit: null,
        period: null,
        renewsAt: null,
      });
      body = (
        <StateView
          icon="lock"
          title={copy.title}
          message={copy.message}
          actionLabel={copy.offerPlans ? msg('quota.seePlans') : undefined}
          onAction={
            copy.offerPlans ? () => navigateSingleton(nav, 'Subscription', { reason: 'premiumStory' }) : undefined
          }
          testID="story-premium"
        />
      );
    } else if (failed?.status === 404 || !storyId) {
      body = <StateView icon="alert" title={t('loadError.notFound')} />;
    } else if (failed?.offline) {
      body = (
        <StateView
          icon="wifiOff"
          title={t('states:offline.title')}
          message={t('states:offline.message')}
          actionLabel={t('common:retry')}
          onAction={handleRetryStory}
        />
      );
    } else {
      body = (
        <StateView
          icon="alert"
          title={t('loadError.title')}
          message={t('loadError.message')}
          actionLabel={t('common:retry')}
          onAction={handleRetryStory}
        />
      );
    }
    return (
      <View style={styles.container}>
        <TopAppBar variant="back" onBack={() => nav.goBack()} />
        <View style={styles.centered}>{body}</View>
      </View>
    );
  }

  // ─── Derived view data ───
  const shown = story;
  // The detail adds the language versions and the requests; the list copy
  // waits for them on bones (or leaves them out once its request failed).
  const full: StoryDetail | null = detail && detail.id === shown.id ? detail : null;
  const awaitingDetail = !full && !failed;
  const saved = isStorySaved(shown);
  const translationKind = getStoryTranslationKind(shown);
  const levelCode = shown.languageLevel?.trim().toUpperCase() ?? '';
  const languageName = contentLanguage.nativeName(shown.language);
  const summary = shown.summary ?? shown.description;
  const creditRows = storyCreditRows(shown.credit);
  const sourceRows = storySourceRows(shown.credit);
  const category = categoryColors(T, shown.category);
  const hasCategory = !!categorySlot(shown.category);
  const categoryLabel = storyShelfLabel(shown.category);
  const ageLabel = storyAgeLabel(shown.ageGroup);
  const durationLabel = storyDurationLabel(shown.estimatedDuration);
  const versions: LanguageVersion[] = full
    ? [
        { language: full.language, ref: null },
        ...full.translations
          .filter(ref => ref.language !== full.language)
          .map(ref => ({ language: ref.language, ref })),
      ]
    : [];
  const missingLanguages = full
    ? requestableLanguages(contentLanguage.languages, full.availableLanguages)
    : [];
  const showLanguages = versions.length > 1 || missingLanguages.length > 0;
  // While the detail is on its way, the list copy says whether the tale has
  // other languages or can ask for one: only then do the languages wait on
  // bones (a story with neither shows nothing there, V3-05).
  const expectLanguages =
    shown.availableLanguages.length > 1 ||
    requestableLanguages(contentLanguage.languages, shown.availableLanguages).length > 0;
  const languageBones = settled && awaitingDetail && expectLanguages;
  if (languageBones) sawLanguageBones.current = true;
  const switching = !!switchingTo;

  const narrationsForVoice: StoryNarration[] = selectedVoice
    ? storyNarrations.filter(n => n.voiceProfileId === selectedVoice.id)
    : [];
  const isPreparing = narrationsForVoice.some(isNarrationGenerating);
  const readyForVoice = isPreparing ? null : newestReadyNarration(narrationsForVoice);
  // Not known yet whether a narration of this narrator is ready (V3-04):
  // the action is busy, with no label it might take back and no press. A
  // READY one of the newest page already says "Dinle".
  const ctaPending = !!selectedVoice && !narrationsSettled && !readyForVoice;
  const selectedDisplay = getNarratorDisplay(selectedVoice);
  const selectedName = selectedDisplay?.name ?? selectedVoice?.name ?? '';
  const selectedIsOwn = selectedVoice ? isCloneProfile(selectedVoice) : false;
  // What a voice of another language means for this story.
  const languageNotice = narrationLanguageNotice(selectedVoice, shown.language, loadedCatalogue);
  const languageNames = {
    voiceLanguage: selectedVoice ? contentLanguageLabel(selectedVoice.contentLanguage) : '',
    storyLanguage: contentLanguageLabel(shown.language),
  };
  const languageNote =
    languageNotice === 'native'
      ? t('narrator.nativeVoice', { language: languageNames.storyLanguage })
      : languageNotice === 'readyAccent'
        ? t('narrator.accentedVoice', languageNames)
        : '';

  // The allowance a new narration with the chosen voice draws from.
  const narrationKind: NarrationKind = selectedIsOwn ? 'clone' : 'preset';
  const usage = subscriptionStore.usage ?? null;
  const bucket = usage ? narrationBucket(usage, narrationKind) : null;
  const willGenerate = !!selectedVoice && !isPreparing && !readyForVoice && !ctaPending;
  const quotaLine = willGenerate && bucket ? remainingNarrationsLine(narrationKind, bucket) : null;

  // ─── Handlers ───

  // Another language version of the same tale: load it, then point the
  // route at it, so back still leaves the story and the screen never drops
  // to another state in between (the version being opened is drawn as soon
  // as it is current).
  const handleSwitchLanguage = async (ref: StoryTranslationRef) => {
    if (switchingTo) return;
    setSwitchingTo(ref.id);
    void stopPreview();
    try {
      await storyStore.getStoryDetail(ref.id);
      if (storyStore.currentStory?.id === ref.id) {
        nav.setParams({ storyId: ref.id });
      } else {
        // The version on screen stays; the store itself says nothing.
        showToast.error(t('languageSwitchFailed'));
      }
    } catch {
      showToast.error(t('languageSwitchFailed'));
    } finally {
      if (mounted.current) setSwitchingTo(null);
    }
  };

  const handleToggleSave = async () => {
    if (switching) return;
    const wasSaved = saved;
    const result = await storyStore.toggleFavorite(shown.id, { quiet: true });
    const outcome: SaveOutcome =
      result === 'failed'
        ? 'failed'
        : result === 'superseded'
          ? 'superseded'
          : wasSaved
            ? 'removed'
            : 'saved';
    announceSaveOutcome(
      outcome,
      shown,
      wasSaved,
      () => nav.popTo('Main', { screen: 'Library' }),
      () => storyStore.toggleFavorite(shown.id, { quiet: true }),
    );
  };

  const startGeneration = (voice: VoiceProfile, replace: boolean) => {
    void stopPreview();
    rememberLastNarrator(voice.id);
    nav.navigate('AudioGeneration', {
      storyId: shown.id,
      voiceProfileId: voice.id,
      replace,
    });
  };

  // Every new narration (the action, "Baştan hazırla") is confirmed first in
  // the sheet: the story, the voice, a voice of another language and the
  // cost, or why the allowance cannot pay for it (NarrationConfirmSheet).
  // The detail adds the part and the translation to the list copy.
  const askToNarrate = (voice: VoiceProfile, replace: boolean) => {
    void stopPreview();
    setNarrateRequest({ story: full ?? shown, voice, mode: replace ? 'regenerate' : 'new' });
    setNarrateOpen(true);
  };
  const handleNarrateConfirmed = () => {
    const asked = narrateRequest;
    if (asked) startGeneration(asked.voice, asked.mode === 'regenerate');
  };
  const handleNarratePlans = (block: QuotaBlock) => {
    navigateSingleton(nav, 'Subscription', { reason: reasonForQuota(block.code) });
  };

  // A narration of this narrator is ready: the player opens and plays it,
  // drawn at once from what this page knows (no dialog, nothing to prepare).
  const listen = (narration: StoryNarration) => {
    void stopPreview();
    if (selectedVoice) rememberLastNarrator(selectedVoice.id);
    rememberNarrationMeta(metaFor(narration, shown));
    nav.navigate('AudioPlayer', { narrationId: narration.id, autoplay: true });
  };

  const handlePrimary = () => {
    // The busy action takes no press: it could prepare a narration that exists.
    if (switching || ctaPending) return;
    // No narrator yet: the sheet lists every way to one.
    if (!selectedVoice) {
      openNarratorSheet();
      return;
    }

    // Already being prepared with this narrator: do not start a second one.
    // AudioGeneration receives the backend 409 (status GENERATING) and
    // follows the existing job until it is ready.
    if (isPreparing) {
      showDialog({
        title: t('inProgressDialog.title'),
        message: t('inProgressDialog.message', { name: selectedName }),
        buttons: [
          { text: t('inProgressDialog.showProgress'), onPress: () => startGeneration(selectedVoice, false) },
          { text: t('common:ok'), style: 'cancel' },
        ],
      });
      return;
    }

    if (readyForVoice) {
      listen(readyForVoice);
      return;
    }

    // A new narration: the confirmation says what it reads, with which
    // voice (an own voice of another language keeps its accent), what it
    // costs, and a used-up allowance instead of opening a screen the
    // backend would refuse. (Unknown usage goes on; the backend decides.)
    askToNarrate(selectedVoice, false);
  };

  // "Baştan hazırla" (the options): a new narration replaces the ready one
  // and uses the allowance, so it is confirmed like the first one.
  const confirmRegenerate = () => {
    if (!selectedVoice) return;
    askToNarrate(selectedVoice, true);
  };

  // The own-voice flow: check the clone slots (clone.canCreate + monthly
  // cap) first so a full allowance is explained here, over the narrator
  // sheet when it is open. Started from this story, the flow ends on it.
  const handleCreateVoice = async () => {
    // The intro's texts load while the slots are checked, so its steps and
    // language card are there when it opens (V5) instead of arriving after.
    if (!voiceProfileStore.cloneConfig && !voiceProfileStore.isLoadingCloneConfig) {
      void voiceProfileStore.loadCloneConfig(contentLanguage.effective);
    }
    if (!(await voiceProfileStore.checkCanCreate('clone'))) {
      const block = voiceProfileStore.slotBlock('clone', subscriptionStore.planId);
      showDialog({
        title: block.title,
        message: block.message,
        buttons: block.showPaywall
          ? [
              { text: t('common:cancel'), style: 'cancel' },
              {
                text: t('slotDialog.seePlans'),
                onPress: () => {
                  closeNarratorSheet();
                  navigateSingleton(nav, 'Subscription', { reason: 'voices' });
                },
              },
            ]
          : [{ text: t('common:ok') }],
      });
      return;
    }
    closeNarratorSheet();
    nav.navigate('CreateVoiceProfile', { returnToStoryId: shown.id });
  };

  // Every ready-made narrator of the story's language; `pickForStory`
  // comes back here with the added narrator as `selectVoiceId`.
  const handlePickReadyVoice = () => {
    closeNarratorSheet();
    nav.navigate('NarratorCatalogue', {
      pickForStory: true,
      language: storyLanguage ?? undefined,
      storyId: shown.id,
    });
  };

  // A catalogue narrator is added to the user's voices, then chosen.
  const handleSelectCatalogue = async (voice: AvailableGoogleVoice) => {
    if (addingVoiceId) return;
    setAddingVoiceId(voice.voiceId);
    try {
      await stopPreview();
      const created = await narratorAdder.add(voice, { beforeLeave: closeNarratorSheet });
      if (created) {
        pickNarrator(created.id);
        closeNarratorSheet();
      }
    } finally {
      if (mounted.current) setAddingVoiceId(null);
    }
  };

  // There is no report endpoint: a mail to the support address the app uses
  // for "Bize ulaşın", with the story named in the subject.
  const handleReport = () => {
    Linking.openURL(reportMailUrl(shown)).catch(() => {
      showDialog({
        title: t('report.noMailTitle'),
        message: t('report.noMailMessage', { email: SUPPORT_EMAIL }),
        buttons: [{ text: t('common:ok') }],
      });
    });
  };

  const handleRequestedChange = (requestedLanguages: string[]) => {
    runInAction(() => {
      const copy = storyStore.currentStory;
      if (copy?.id === shown.id) {
        storyStore.currentStory = { ...copy, requestedLanguages };
      }
    });
  };

  const handleTranslationPublished = () => {
    setRequestOpen(false);
    void requestDetail(shown.id);
  };

  // A related story opens its own page on top of this one (back returns
  // here); one the plan does not play explains the plans instead.
  const openRelated = (target: Story) => {
    void stopPreview();
    if (premiumGate.isLocked(target)) premiumGate.showPlans();
    else nav.push('StoryDetail', { storyId: target.id });
  };
  const pickRelatedInSheet = (target: Story) => {
    pendingRelated.current = target;
    setRelatedOpen(false);
  };
  const handleRelatedClosed = () => {
    const target = pendingRelated.current;
    pendingRelated.current = null;
    if (target) openRelated(target);
  };

  const options: StoryOption[] = [];
  if (narrators.all.length > 0) {
    options.push({
      key: 'narrator',
      title: t('more.narrator'),
      icon: 'mic',
      onPress: afterOptions(openNarratorSheet),
    });
  }
  if (readyForVoice) {
    const ready = readyForVoice;
    const queued = isQueued(ready.id);
    options.push({
      key: 'queue',
      title: t(queued ? 'player:queue.removeAction' : 'player:queue.add'),
      subtitle: t('library:row.narrator', { name: selectedName }),
      icon: queued ? 'close' : 'queue',
      onPress: afterOptions(() => {
        if (queued) removeFromQueueWithFeedback(ready.id);
        else addToQueueWithFeedback(metaFor(ready, shown));
      }),
    });
    options.push({
      key: 'regenerate',
      title: t('more.regenerate'),
      subtitle: t(bucket && bucket.limit === null ? 'more.regenerateHintUnlimited' : 'more.regenerateHint'),
      icon: 'redo',
      onPress: afterOptions(confirmRegenerate),
    });
  }
  if (missingLanguages.length > 0) {
    options.push({
      key: 'language',
      title: t('requestLanguage'),
      icon: 'language',
      onPress: afterOptions(() => setRequestOpen(true)),
    });
  }
  options.push({
    key: 'report',
    title: t('report.question'),
    subtitle: t('report.hint'),
    icon: 'mail',
    onPress: afterOptions(handleReport),
  });

  // A busy action has no icon: the button shows only its spinner, and its
  // (hidden) label is the neutral "Dinle" for screen readers.
  const cta: { label: string; icon: IconName | undefined } = !selectedVoice
    ? { label: t('cta.noNarrator'), icon: 'mic' }
    : ctaPending
      ? { label: t('cta.listen'), icon: undefined }
      : isPreparing
        ? { label: t('cta.inProgress'), icon: 'clock' }
        : readyForVoice
          ? { label: t('cta.listen'), icon: 'play' }
          : selectedIsOwn
            ? { label: t('cta.listenOwn'), icon: 'play' }
            : { label: t('cta.listenWith', { name: selectedName }), icon: 'play' };

  const samplePlaying = !!selectedVoice && preview.playingId === selectedVoice.id;
  const sampleLoading = !!selectedVoice && preview.loadingId === selectedVoice.id;
  const scrollEnd = (dockHeight > 0 ? dockHeight : DOCK_BODY + dockBottom(insets.bottom)) + SPACE.xxl;

  // What the memoised parts call (see the stable callbacks above).
  handlers.current = {
    primary: handlePrimary,
    sample: () => {
      if (selectedVoice) void preview.toggle(selectedVoice);
    },
    createVoice: () => void handleCreateVoice(),
    pickReady: handlePickReadyVoice,
    selectCatalogue: voice => void handleSelectCatalogue(voice),
  };

  let narratorBody: React.ReactNode;
  if (profilesLoading) {
    narratorBody = <NarratorCardsSkeleton />;
  } else if (cards.length > 0) {
    narratorBody = (
      <NarratorCards
        cards={cards}
        selectedId={selectedVoiceId}
        storyLanguage={shown.language}
        onSelect={onSelectCard}
        onAddOwnVoice={onCreateVoice}
      />
    );
  } else if (catalogue.length > 0 || catalogueLoading) {
    // No voice yet: the first narrators of the catalogue, one tap away.
    narratorBody = (
      <View testID="narrator-empty">
        {catalogue.length > 0 ? (
          <CatalogueNarratorCards
            voices={catalogue}
            onSelect={onSelectCatalogue}
            onTogglePreview={onToggleVoicePreview}
            previewPlayingKey={preview.playingId}
            previewLoadingKey={preview.loadingId}
            addingVoiceId={addingVoiceId}
          />
        ) : (
          <NarratorCardsSkeleton samples testID="narrator-catalogue-cards-loading" />
        )}
        <Text style={[text.bodySmall, styles.emptyHint]}>{t('noNarrator.catalogueHint')}</Text>
        <Button
          label={t('noNarrator.addOwn')}
          variant="text"
          icon="mic"
          onPress={onCreateVoice}
          testID="narrator-empty-add-own"
          style={styles.emptyText}
        />
      </View>
    );
  } else {
    // Neither a voice nor a catalogue (it could not be loaded): both ways
    // in, the faster one as the card's action.
    narratorBody = (
      <Card testID="narrator-empty" contentStyle={styles.emptyCard}>
        <Text style={text.subheading}>{t('noNarrator.title')}</Text>
        <Text style={[text.bodySmall, styles.emptyMessage]}>{t('noNarrator.message')}</Text>
        <Button
          label={t('noNarrator.pickReady')}
          icon="plus"
          block
          onPress={onPickReady}
          testID="narrator-empty-pick-ready"
          style={styles.emptyAction}
        />
        <Button
          label={t('noNarrator.addOwn')}
          variant="text"
          icon="mic"
          block
          onPress={onCreateVoice}
          testID="narrator-empty-add-own"
        />
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: scrollEnd }}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        testID="story-scroll"
      >
        {/* The picture, full-bleed, with the title on its shade */}
        <StoryHero
          story={shown}
          title={shown.title}
          width={windowWidth}
          height={heroHeight}
          insetTop={insets.top}
        />

        <View style={styles.body}>
        <View style={styles.tags}>
          {categoryLabel ? (
            <Tag
              label={categoryLabel}
              color={hasCategory ? category.color : undefined}
              testID="story-tag-category"
            />
          ) : null}
          {ageLabel ? <Tag label={ageLabel} testID="story-tag-age" /> : null}
          {/* Content warnings: calm, next to the age group. */}
          {shown.contentWarnings.map(key => (
            <Tag key={key} label={contentWarningLabel(key)} icon="info" testID={`story-tag-warning-${key}`} />
          ))}
          {durationLabel ? <Tag label={durationLabel} testID="story-tag-duration" /> : null}
          <View
            accessible
            accessibilityLabel={[languageName, storyLevelLabel(levelCode)].filter(Boolean).join(', ')}
          >
            <Tag label={[languageName, levelCode].filter(Boolean).join(' ')} testID="story-tag-language" />
          </View>
        </View>

        {summary ? <Text style={[text.body, styles.summary]}>{summary}</Text> : null}

        {/* A text we translated with AI says so, with a way to its original. */}
        {translationKind === 'machine' ? (
          <MachineTranslationNote
            fromLanguage={full?.translation?.fromLanguage ?? shown.credit.originalLanguage}
            original={full?.translation?.original ?? null}
            opening={!!full?.translation?.original && switchingTo === full.translation.original.id}
            disabled={switching}
            onOpenOriginal={original => void handleSwitchLanguage(original)}
          />
        ) : null}

        {/* Who reads it: three cards, the own voice first */}
        <SectionHeader
          size="sub"
          title={t('cards.title')}
          linkLabel={!profilesLoading ? t('cards.all') : undefined}
          onLinkPress={openNarratorSheet}
          testID="narrator-heading"
          style={styles.subhead}
        />
        {narratorBody}
        {languageNote ? (
          <View style={styles.note}>
            {/* Centred on the first 19dp line of the note. */}
            <View style={styles.noteIcon}>
              <Icon name="info" size={16} color={T.text3} />
            </View>
            <Text style={[text.bodySmall, styles.noteText]} testID="narrator-language-note">
              {languageNote}
            </Text>
          </View>
        ) : null}

        {/* Below the narrators, mostly under the fold: after the push. */}
        {settled ? (
          <FadeIn testID="story-detail-more">
            {/* Credits (the list copy carries them too) */}
            {creditRows.length > 0 ? (
              <Card radius={RADIUS.lg} style={styles.credits} contentStyle={styles.creditsContent} testID="story-credits">
                <View accessible accessibilityLabel={t('credit.label')} style={styles.creditList}>
                  {creditRows.map(row => (
                    <View key={row.key} style={styles.creditRow} testID={`credit-${row.key}`}>
                      <Text style={styles.creditLabel}>{row.label}</Text>
                      <Text style={styles.creditValue}>
                        {row.value}
                        {row.suffix}
                      </Text>
                    </View>
                  ))}
                </View>
              </Card>
            ) : null}

            {/* Languages of the tale */}
            {awaitingDetail ? (
              languageBones ? (
                // The list copy says there are languages: the versions follow.
                <SkeletonPulse testID="story-detail-more-loading">
                  <Bone width={160} height={18} radius={RADIUS.xs} style={styles.subhead} />
                  <View style={styles.chips}>
                    {[84, 76].map(width => (
                      <Bone key={width} width={width} height={36} radius={RADIUS.sm} lip={LIP.sm} />
                    ))}
                  </View>
                </SkeletonPulse>
              ) : null
            ) : showLanguages ? (
              <FadeIn skip={!sawLanguageBones.current} testID="story-languages">
                <SectionHeader size="sub" title={t('languages.title')} style={styles.subhead} />
                <View accessibilityRole="radiogroup" accessibilityLabel={t('languageChoice')} style={styles.chips}>
                  {versions.map(version => {
                    const opening = !!version.ref && version.ref.id === switchingTo;
                    return (
                      <Chip
                        key={version.language}
                        kind="choice"
                        label={contentLanguage.nativeName(version.language)}
                        selected={!version.ref}
                        disabled={switching && !!version.ref}
                        leading={opening ? <Spinner size={16} color={T.text2} testID="language-chip-opening" /> : undefined}
                        onPress={version.ref ? () => void handleSwitchLanguage(version.ref!) : undefined}
                        testID={`language-chip-${version.language}`}
                      />
                    );
                  })}
                </View>
                {missingLanguages.length > 0 ? (
                  <Button
                    label={t('requestLanguage')}
                    variant="secondary"
                    size="sm"
                    icon="language"
                    onPress={() => setRequestOpen(true)}
                    testID="story-request-language"
                    style={styles.request}
                  />
                ) : null}
              </FadeIn>
            ) : null}

            {/* More to read: other languages, other parts, the same kind */}
            <RelatedSection
              state={related}
              isLocked={premiumGate.isLocked}
              onOpen={openRelated}
              onSeeAll={() => setRelatedOpen(true)}
            />

            {/* Always last: source and licence, folded; information only */}
            <StorySourceSection key={shown.id} rows={sourceRows} />
          </FadeIn>
        ) : null}
        </View>
      </Animated.ScrollView>

      {/* Over the picture, fixed while the page scrolls */}
      <View style={[styles.topBar, { paddingTop: insets.top + SPACE.sm }]} pointerEvents="box-none">
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.topBarFill, { opacity: barFade }]}
          testID="story-topbar-fill"
        />
        <IconButton
          variant="glass"
          icon="back"
          pressDelay={0}
          onPress={() => nav.goBack()}
          accessibilityLabel={t('common:back')}
          testID="appbar-back"
        />
        <View style={styles.topActions}>
          <IconButton
            variant="glass"
            icon={saved ? 'bookmarkOn' : 'bookmark'}
            size={20}
            color={saved ? T.action : T.text}
            pressDelay={0}
            // The store's copy, or the live list copy, is on screen: the
            // bookmark shows what a tap changes. Not while a version opens.
            disabled={switching || (!isCurrent && !peek)}
            onPress={() => void handleToggleSave()}
            accessibilityLabel={t(saved ? 'unsave' : 'save')}
            testID="story-save"
          />
          <IconButton
            variant="glass"
            icon="more"
            size={20}
            pressDelay={0}
            // Its rows act on the version on screen, which is being replaced.
            disabled={switching}
            onPress={() => setOptionsOpen(true)}
            accessibilityLabel={t('more.a11y')}
            testID="story-more"
          />
        </View>
      </View>

      {/* Dock: the chosen narrator's sample, then the action */}
      <StoryDock
        loading={profilesLoading}
        bottom={dockBottom(insets.bottom)}
        hasVoice={!!selectedVoice}
        sampleLabel={
          selectedVoice
            ? t(samplePlaying ? 'narratorSheet.stopPreview' : 'narratorSheet.preview', { name: selectedName })
            : t('noNarrator.title')
        }
        samplePlaying={samplePlaying}
        sampleLoading={sampleLoading}
        switching={switching}
        ctaLabel={cta.label}
        ctaIcon={cta.icon}
        ctaBusy={ctaPending}
        quotaLine={quotaLine}
        onSample={onSample}
        onPrimary={onPrimary}
        onLayout={onDockLayout}
      />

      {/* Not on screen when the page opens: mounted after the push, or by
          the first tap that opens one (see sheetsMounted). */}
      {sheetsMounted.current ? (
        <>
          <StoryOptionsSheet
            visible={optionsOpen}
            onClose={() => {
              pendingOption.current = null;
              setOptionsOpen(false);
            }}
            onClosed={handleOptionsClosed}
            options={options}
            // Named like the menus of a story elsewhere (Library, cards).
            title={shown.title}
          />

          <NarratorSheet
            visible={narratorOpen}
            onClose={closeNarratorSheet}
            ownVoices={narrators.own}
            otherVoices={narrators.other}
            hasOwnVoice={narrators.hasOwnVoice}
            readyNarrators={narrators.ready}
            selectedId={selectedVoiceId}
            storyLanguage={shown.language}
            onSelect={onSelectInSheet}
            onAddOwnVoice={onCreateVoice}
            onAddReadyNarrator={onPickReady}
            catalogue={catalogue}
            voiceGenders={voiceGenders}
            catalogueLoading={catalogueLoading}
            onSelectCatalogue={onSelectCatalogue}
            onToggleCataloguePreview={onToggleVoicePreview}
            addingVoiceId={addingVoiceId}
            onTogglePreview={onTogglePreview}
            previewPlayingId={preview.playingId}
            previewLoadingId={preview.loadingId}
          />

          <NarrationConfirmSheet
            visible={narrateOpen}
            onClose={() => setNarrateOpen(false)}
            request={narrateRequest}
            usage={subscriptionStore.usage ?? null}
            planId={subscriptionStore.planId}
            catalogue={loadedCatalogue}
            onConfirm={handleNarrateConfirmed}
            onSeePlans={handleNarratePlans}
          />

          <RelatedStoriesSheet
            visible={relatedOpen}
            onClose={() => {
              pendingRelated.current = null;
              setRelatedOpen(false);
            }}
            onClosed={handleRelatedClosed}
            related={related.related}
            isLocked={premiumGate.isLocked}
            onOpen={pickRelatedInSheet}
          />

          {full ? (
            <TranslationRequestSheet
              visible={requestOpen}
              onClose={() => setRequestOpen(false)}
              storyId={full.id}
              languages={missingLanguages}
              requestedLanguages={full.requestedLanguages}
              onRequestedChange={handleRequestedChange}
              onAlreadyAvailable={handleTranslationPublished}
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
});

type Styles = ReturnType<typeof stylesFor>;

/**
 * The page while nothing of the story is known: the picture band full-bleed
 * with the title's bones at its foot, then tags, text and narrators.
 */
const StoryDetailSkeleton: React.FC<{ styles: Styles; heroWidth: number; heroHeight: number }> = ({
  styles,
  heroWidth,
  heroHeight,
}) => (
  <SkeletonPulse testID="story-detail-loading">
    <View testID="story-detail-loading-hero">
      <Bone width={heroWidth} height={heroHeight} radius={0}>
        <View style={styles.skeletonHeroTitle}>
          <Bone width="70%" height={22} radius={RADIUS.xs} tone="line" />
          <Bone width="45%" height={22} radius={RADIUS.xs} tone="line" />
        </View>
      </Bone>
    </View>
    <View style={styles.body}>
    <View style={styles.tags}>
      {[78, 64, 56, 84].map(width => (
        <Bone key={width} width={width} height={28} radius={RADIUS.sm} />
      ))}
    </View>
    <View style={styles.skeletonCenter}>
      <Bone width="100%" height={12} radius={RADIUS.xs} />
      <Bone width="92%" height={12} radius={RADIUS.xs} />
      <Bone width="60%" height={12} radius={RADIUS.xs} />
    </View>
    <Bone width={180} height={18} radius={RADIUS.xs} style={styles.subhead} />
    <View style={styles.skeletonCards}>
      {[0, 1, 2].map(i => (
        <Bone key={i} height={NARRATOR_CARD_HEIGHT} radius={RADIUS.lg} lip={LIP.md} style={styles.skeletonCard} />
      ))}
    </View>
    </View>
  </SkeletonPulse>
);

/** The dock's sample button and action in their shapes. */
const DockSkeleton: React.FC<{ styles: Styles; testID: string }> = ({ styles, testID }) => (
  <SkeletonPulse testID={testID} style={styles.dockRow}>
    <Bone width={SAMPLE_SIZE} height={SAMPLE_SIZE} radius={RADIUS.lg} lip={LIP.md} />
    <Bone height={SAMPLE_SIZE} radius={RADIUS.lg} lip={LIP.md} style={styles.cta} />
  </SkeletonPulse>
);

interface StoryDockProps {
  /** The voices are loading: the dock in its shapes. */
  loading: boolean;
  /** Bottom padding (`dockBottom` of the inset). */
  bottom: number;
  /** A narrator is chosen (its sample can play). */
  hasVoice: boolean;
  sampleLabel: string;
  samplePlaying: boolean;
  sampleLoading: boolean;
  /** A language version is opening: nothing acts on the one leaving. */
  switching: boolean;
  ctaLabel: string;
  /** No icon on a busy action: the button shows its spinner alone. */
  ctaIcon: IconName | undefined;
  ctaBusy: boolean;
  quotaLine: string | null;
  onSample: () => void;
  onPrimary: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
}

/**
 * The dock: the chosen narrator's sample and the action, sized by its
 * content. Memoised: drawn again only when what it shows changes.
 */
const StoryDock = React.memo(function StoryDock({
  loading,
  bottom,
  hasVoice,
  sampleLabel,
  samplePlaying,
  sampleLoading,
  switching,
  ctaLabel,
  ctaIcon,
  ctaBusy,
  quotaLine,
  onSample,
  onPrimary,
  onLayout,
}: StoryDockProps) {
  const T = useT();
  const styles = stylesFor(T);
  const text = textStylesFor(T);
  return (
    <LinearGradient
      pointerEvents="box-none"
      colors={[withAlpha(T.bg, 0), T.bg]}
      locations={[0, 0.22]}
      style={[styles.dock, { paddingBottom: bottom }]}
      onLayout={onLayout}
      testID="story-dock"
    >
      {loading ? (
        <DockSkeleton styles={styles} testID="story-dock-loading" />
      ) : (
        <View style={styles.dockRow}>
          <Tactile
            color={T.surface}
            lipColor={T.lip}
            lip={LIP.md}
            radius={RADIUS.lg}
            pressDelay={0}
            onPress={hasVoice ? onSample : undefined}
            disabled={!hasVoice || sampleLoading || switching}
            dimWhenDisabled={!hasVoice}
            accessibilityLabel={sampleLabel}
            accessibilityState={{ busy: sampleLoading }}
            testID="story-sample"
            faceStyle={styles.sample}
          >
            {sampleLoading ? (
              <Spinner size={22} color={T.text} />
            ) : (
              <Icon name={samplePlaying ? 'pause' : 'wave'} size={24} color={samplePlaying ? T.action : T.text} />
            )}
          </Tactile>
          <Button
            label={ctaLabel}
            icon={ctaIcon}
            size="lg"
            singleLine
            pressDelay={0}
            disabled={switching}
            loading={ctaBusy}
            onPress={onPrimary}
            testID="story-cta"
            style={styles.cta}
          />
        </View>
      )}
      {quotaLine && !loading ? (
        <Text style={[text.meta, styles.quotaLine]} testID="story-quota-left">
          {quotaLine}
        </Text>
      ) : null}
    </LinearGradient>
  );
});

const stylesFor = themedStyles((T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    // Over the picture: 8 under the status bar, the glass buttons at the
    // screen's gutters, 8 under them (TOP_BAR_BODY).
    topBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: SCREEN_PAD_H,
      paddingBottom: SPACE.sm,
    },
    topBarFill: { backgroundColor: T.bg },
    topActions: { flexDirection: 'row', gap: SPACE.sm },
    scroll: { flex: 1 },
    body: { paddingHorizontal: SCREEN_PAD_H },
    skeletonHeroTitle: {
      position: 'absolute',
      left: SCREEN_PAD_H,
      right: SCREEN_PAD_H,
      bottom: SPACE.md,
      alignItems: 'center',
      gap: SPACE.md,
    },
    tags: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      alignItems: 'center',
      gap: SPACE.tight,
      marginTop: SPACE.md,
    },
    summary: { textAlign: 'center', marginTop: SPACE.md },
    noteIcon: { paddingTop: 1.5 }, // geometry: centres the 16dp icon on the 19dp line
    skeletonCenter: { alignItems: 'center', gap: SPACE.md, marginTop: SPACE.lg },
    skeletonCards: { flexDirection: 'row', gap: SPACE.sm },
    skeletonCard: { flex: 1 },

    // Detail sections are blocks of one screen: 20 apart, 12 to their content.
    subhead: { marginTop: SPACE.xl, marginBottom: SPACE.md },
    emptyCard: { padding: SPACE.lg },
    emptyMessage: { marginTop: SPACE.xs },
    emptyAction: { marginTop: SPACE.lg, marginBottom: SPACE.xs },
    emptyHint: { marginTop: SPACE.md, textAlign: 'center' },
    emptyText: { alignSelf: 'center', marginTop: SPACE.xs },
    note: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm, marginTop: SPACE.md },
    noteText: { flex: 1 },

    credits: { marginTop: SPACE.xl },
    // A content card: padding 16 (SPEC-design 1.5).
    creditsContent: { padding: SPACE.lg },
    creditList: { gap: SPACE.xs },
    creditRow: { flexDirection: 'row', alignItems: 'flex-start' },
    creditLabel: {
      // At least the column width; a long label at a large font widens it
      // instead of breaking mid-word.
      minWidth: 72,
      marginRight: SPACE.sm,
      fontFamily: T.fontBody,
      fontSize: 13,
      lineHeight: 20,
      color: T.text3,
    },
    creditValue: {
      flex: 1,
      minWidth: 0,
      fontFamily: T.fontBody,
      fontSize: 13,
      lineHeight: 20,
      color: T.text,
    },

    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
    request: { marginTop: SPACE.md },

    // Sized by its content: 8 on top, the 55dp row, then the system inset
    // (dockBottom), plus the allowance line when it shows.
    dock: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingTop: SPACE.sm,
      paddingHorizontal: SCREEN_PAD_H,
    },
    dockRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
    sample: { width: SAMPLE_SIZE, height: SAMPLE_SIZE, alignItems: 'center', justifyContent: 'center' },
    // A row: never stretched to the dock's height (its lip would grow).
    cta: { flex: 1, alignSelf: 'center' },
    // Under the action, centred on it.
    quotaLine: {
      color: T.text2,
      textAlign: 'center',
      marginTop: SPACE.xs,
      marginLeft: SAMPLE_SIZE + SPACE.md,
    },
  }),
);

export default StoryDetailScreen;
