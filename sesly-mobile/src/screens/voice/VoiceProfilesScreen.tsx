/**
 * VoiceProfilesScreen: the "Sesim" tab (design/v4/playful, frame e).
 *
 *   1. "Kendi seslerin", the own (cloned) voices as slots. Cloning costs
 *      money, so nothing here promotes it (owner feedback): no hero card
 *      and no big "Yeni ses" button.
 *      - The allowance card (`OwnVoiceLimitsCard`, numbers from GET /usage,
 *        see `ownVoiceLimits`): "Ses yuvası 1/3" (voices held of the
 *        plan's slots) and "Bu ay yeni ses hakkı 2/5" ("Toplam" on the free
 *        plan, whose one creation never renews), each with a bar, and that
 *        a delete never gives a new voice back.
 *      - One compact slot card per own voice (`OwnVoiceSlot`): the name,
 *        "Varsayılan" on the first ready one (stories start with it) or its
 *        state, its language and recording date, the sample button and
 *        delete. A failed voice gives its reason and offers "Tekrar dene";
 *        a voice whose recording never reached the backend (PENDING) says
 *        so and offers "Baştan başla" (both discard it and record again).
 *      - Then one modest dashed row (`EmptyVoiceSlot`): "Ses ekle" while a
 *        new voice can be recorded (the normal add-voice flow), else why not
 *        (`newVoiceBlock`: cloning closed, every slot taken, the new voices
 *        of the period used up) with "Planları gör" when a bigger plan
 *        helps. No purchase of extra slots is offered.
 *      The delete dialog says what a delete leaves of the allowance, and
 *      that it gives no new voice back (`cloneDeleteMessage`).
 *   2. "Hazır anlatıcılar": a language filter (one `.fc` chip per content
 *      language, default "Masal dili"), then the narrators of the chosen
 *      language as `.nr` cards: the ones the user already added (PRESET
 *      voice profiles, marked "Eklendi", removable) and the rest of
 *      `GET /voice-profiles/available-voices?language=`. Tapping a catalogue
 *      row adds that language's narrator as a voice profile (preset slot
 *      check); a narrator added during this visit keeps its place, and every
 *      narrator keeps its avatar colour (by voice id). The round button
 *      plays a sample. The tab shows the first rows; "Tümü" opens
 *      NarratorCatalogue, the full list of that language.
 *
 * Samples: the audio store says which sample is in the player
 * (`sampleKey`), so a story that replaces a sample, a sample that ends or
 * fails, resets its button by itself; nothing here ever stops or unloads a
 * story (opening the catalogue, adding a narrator), and a sample over a
 * playing story pauses it at its position (the store does that). The screen
 * never reads the player position.
 *
 * Mounted twice: as the "Voices" tab of MainScaffold (Baloo 2 title, sub
 * line and avatar) and as the "VoiceProfiles" stack screen (back app bar).
 * While the voices or a catalogue load, skeletons of the slots and rows
 * hold their place; the content cross-fades in over them in place
 * (`SkeletonSwap`). A cold load draws one slot skeleton per own voice the
 * account had at its last visit (`ownVoiceMemory`) and the "Ses ekle"
 * row's, so "Hazır anlatıcılar" never moves. A
 * delete hides its row at once and brings it back when it fails.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { comparer, reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import {
  RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute,
  useScrollToTop,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Chip,
  SectionHeader,
  SkeletonPulse,
  TopAppBar,
  useScrollEdge,
} from '../../components/design';
import { SkeletonSwap } from '../../components/design/Skeleton';
import { RADIUS, SPACE, Theme, themedStyles, useT, useTextStyles } from '../../theme/theme';
import { withAlpha } from '../../theme/color';
import { languageCodeLabel } from '../../i18n/text';
import { useVoiceProfile } from '../../hooks/useVoiceProfile';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { useSubscription } from '../../hooks/useSubscription';
import { useDialog } from '../../hooks/useDialog';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { navigateSingleton } from '../../navigation/navigateSingleton';
import {
  AvailableGoogleVoice,
  VoiceProfile,
  isCloneProfile,
  isVoiceProfileFailed,
  isVoiceProfilePending,
  isVoiceProfileProcessing,
  isVoiceProfileReady,
  languageCodeOf,
} from '../../models/VoiceProfile';
import { getNarratorDisplay } from '../../models/Narrator';
import VoiceProfileService from '../../services/VoiceProfileService';
import { FALLBACK_CLONE_DURATIONS } from '../../models/VoiceClone';
import { contentLanguageLabel, useContentLanguage } from '../../hooks/useContentLanguage';
import { useAddNarrator } from '../../components/voice/useAddNarrator';
import { useMiniPlayerInset } from '../../components/audio/useMiniPlayerInset';
import { showToast } from '../../utils/toast';
import { TopBarAccount } from '../../components/common/TopBarAccount';
import {
  EmptyVoiceSlot,
  EmptyVoiceSlotSkeleton,
  NarratorRow,
  NarratorRowSkeleton,
  OwnVoiceLimitsCard,
  OwnVoiceSlot,
  OwnVoiceSlotSkeleton,
  OwnVoiceState,
  narratorSlotsLine,
} from '../../components/voice/VoiceCards';
import {
  addedNarrators,
  buildNarratorRows,
  narratorAvatarSlotFor,
  narratorFilterLanguages,
  narratorLine,
  ownVoices,
  presetPreviewKey,
  recordedOnLabel,
  sampleDurationLabel,
  voiceLanguageName,
} from '../../components/voice/narratorRows';
import { cloneDeleteMessage, newVoiceBlock, ownVoiceLimits } from '../../components/voice/cloneAllowance';
import {
  loadOwnVoiceCount,
  rememberOwnVoiceCount,
  rememberedOwnVoiceCount,
} from '../../components/voice/ownVoiceMemory';
import { getSessionUserId } from '../../stores/session';

type Nav = NativeStackNavigationProp<RootStackParamList>;
// Also rendered as the 'Voices' tab, where params are undefined.
type Rt = RouteProp<RootStackParamList, 'VoiceProfiles'>;

// Ready-made narrators shown on the tab; "Tümü" opens all of them (a
// catalogue language has dozens).
const COLLAPSED_NARRATOR_ROWS = 6;
/** Own-voice slot skeletons a cold load draws at most (from the remembered count). */
const MAX_OWN_SKELETONS = 5;

/**
 * The samples this screen starts are named in the audio store with this
 * prefix (`sampleKey`), so the screen knows its own sample from another
 * screen's.
 */
const SAMPLE_KEY_PREFIX = 'sesim:';
const sampleKeyOf = (key: string): string => `${SAMPLE_KEY_PREFIX}${key}`;
/** The screen's key of a sample in the player, null for anything else. */
const screenKeyOf = (sampleKey: string | null | undefined): string | null =>
  sampleKey && sampleKey.startsWith(SAMPLE_KEY_PREFIX)
    ? sampleKey.slice(SAMPLE_KEY_PREFIX.length)
    : null;

const NO_IDS: ReadonlySet<string> = new Set();

function ownVoiceState(profile: VoiceProfile): OwnVoiceState {
  if (isVoiceProfileReady(profile)) return 'ready';
  // A PENDING clone is not being prepared: its recording never arrived.
  if (isVoiceProfilePending(profile)) return 'waiting';
  if (isVoiceProfileProcessing(profile)) return 'preparing';
  if (isVoiceProfileFailed(profile)) return 'failed';
  return 'waiting';
}

function withId(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (ids.has(id)) return ids;
  const next = new Set(ids);
  next.add(id);
  return next;
}

function withoutId(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!ids.has(id)) return ids;
  const next = new Set(ids);
  next.delete(id);
  return next;
}

export const VoiceProfilesScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const insets = useSafeAreaInsets();
  const voiceProfileStore = useVoiceProfile();
  const audioPlayer = useAudioPlayer();
  const subscriptionStore = useSubscription();
  const T = useT();
  const { t } = useTranslation('voices');
  const styles = stylesFor(T);
  const text = useTextStyles();
  const { showDialog } = useDialog();
  const contentLanguage = useContentLanguage();
  const narratorAdder = useAddNarrator();
  const miniPlayerInset = useMiniPlayerInset();
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);
  // Cards scrolled under the bar fade out under it instead of cutting flush (V18).
  const edge = useScrollEdge();

  const [refreshing, setRefreshing] = useState(false);
  // The sample whose URL is being fetched (screen key). Once it is handed to
  // the player, the store says whether it sounds.
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);
  // Sample lengths the player has reported, by screen key. Nothing is shown
  // for a sample that was never played: the profile carries no duration.
  const [sampleDurations, setSampleDurations] = useState<Record<string, number>>({});
  // Voices being deleted: hidden at once, back when the delete fails.
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(NO_IDS);
  const deletingRef = useRef(new Set<string>());
  // Voice ids of narrators added during this visit: they keep their place.
  const [keptVoiceIds, setKeptVoiceIds] = useState<ReadonlySet<string>>(NO_IDS);
  // Bumped by every sample tap, by leaving the screen and by a delete: a
  // slower earlier fetch never plays over a newer tap, and a sample stopped
  // while it was on its way never starts.
  const previewToken = useRef(0);
  // The latest start (its token and screen key); a stop only takes a token.
  const lastStart = useRef<{ token: number; key: string } | null>(null);
  // The account's own voices at its last visit: the skeleton of a cold load
  // takes their shape (V5-03). Null until known (a new account: the add card).
  const accountId = getSessionUserId();
  const [rememberedOwn, setRememberedOwn] = useState(() => rememberedOwnVoiceCount(accountId));

  const planId = subscriptionStore.planId;
  // Mini and the free plan are offered the plans (Premium has more own-voice places).
  const offersPlans = !subscriptionStore.isPremiumPlan;

  // Stack entry (notification tap) vs the 'Voices' tab. Optional reads: the
  // tab route has no params.
  const showBack = (route?.name as string | undefined) === 'VoiceProfiles';

  // Which narrators are listed: those of the language picked in the filter;
  // until the user picks one, those of the route's language, else those of
  // the content language ("Masal dili").
  const [pickedLanguage, setPickedLanguage] = useState<string | null>(null);
  const catalogueLanguage =
    pickedLanguage ?? (languageCodeOf(route?.params?.language) || contentLanguage.selectable);

  // "Yaklaşık N saniyelik" on the add card: served target, else fallback.
  const cloneConfig = voiceProfileStore.cloneConfig;
  const cloneTargetSeconds = Math.ceil(
    cloneConfig?.targetSeconds ?? FALLBACK_CLONE_DURATIONS.targetSeconds,
  );
  // The backend can close cloning for a while; the tab does not invite then.
  const cloningOpen = cloneConfig?.enabled !== false;

  // ─── Effects ───
  useEffect(() => {
    if (voiceProfileStore.voiceProfiles.length === 0) {
      void voiceProfileStore.loadVoiceProfiles();
    }
    void voiceProfileStore.loadVoiceSlots();
    // The slot and new-voice numbers of the allowance card.
    void subscriptionStore.loadUsageIfStale();
    let cancelled = false;
    void (async () => {
      await contentLanguage.load();
      // Whether cloning is open and the served recording length, in the
      // language the clone flow will ask in (it reloads it there).
      if (!cancelled && !voiceProfileStore.cloneConfig) {
        void voiceProfileStore.loadCloneConfig(contentLanguage.effective);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Mount only: the stores are singletons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceProfileStore, contentLanguage]);

  // Back on the tab (a voice made or deleted elsewhere): fresh numbers.
  useFocusEffect(
    useCallback(() => {
      void subscriptionStore.loadUsageIfStale();
    }, [subscriptionStore]),
  );

  // A cold load: the remembered own-voice count of the account, read once,
  // gives the skeleton its shape if the list has not arrived meanwhile.
  useEffect(() => {
    if (rememberedOwn !== null || !accountId || voiceProfileStore.hasLoadedProfiles) return undefined;
    let alive = true;
    void loadOwnVoiceCount(accountId).then(count => {
      if (alive && count !== null) setRememberedOwn(count);
    });
    return () => {
      alive = false;
    };
    // Once per account: a later count is remembered below, not read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // The catalogue of the listed language; asked again when it changes.
  useEffect(() => {
    if (!voiceProfileStore.catalogueFor(catalogueLanguage)) {
      void voiceProfileStore.loadAvailableVoices(catalogueLanguage);
    }
  }, [voiceProfileStore, catalogueLanguage]);

  // The player could not start a sample of this screen: the store has shown
  // the message and left the sample (its button is play again), and this
  // screen acknowledges it. A failed sample of another screen is not this
  // screen's to acknowledge.
  useEffect(
    () =>
      reaction(
        () => audioPlayer.sampleKey,
        (key, previous) => {
          if (key === null && screenKeyOf(previous) && audioPlayer.previewFailed) {
            audioPlayer.acknowledgePreviewFailure();
          }
        },
      ),
    [audioPlayer],
  );

  // Remember the length of a sample of this screen once the player knows it.
  // A reaction, so the screen never re-renders for the player's numbers; a
  // story never counts (its sampleKey is null).
  useEffect(
    () =>
      reaction(
        () => {
          const key = screenKeyOf(audioPlayer.sampleKey);
          if (!key) return null;
          const ms = audioPlayer.totalDurationMs ?? 0;
          return ms > 0 ? { key, ms } : null;
        },
        sample => {
          if (!sample) return;
          setSampleDurations(prev =>
            prev[sample.key] === sample.ms ? prev : { ...prev, [sample.key]: sample.ms },
          );
        },
        { equals: comparer.structural, fireImmediately: true },
      ),
    [audioPlayer],
  );

  // Leaving the tab (another tab, a pushed screen) stops a sample of this
  // screen, also one whose URL is still on its way, and the next visit lists
  // the added narrators first again.
  useFocusEffect(
    useCallback(
      () => () => {
        previewToken.current += 1;
        setLoadingPreviewId(null);
        const playingKey = audioPlayer.sampleKey;
        if (screenKeyOf(playingKey) && playingKey) void audioPlayer.stopPreview(playingKey);
        setKeptVoiceIds(NO_IDS);
      },
      [audioPlayer],
    ),
  );

  const loadedCatalogue = voiceProfileStore.catalogueFor(catalogueLanguage);
  const catalogueError = voiceProfileStore.catalogueErrorFor(catalogueLanguage);
  const catalogue = loadedCatalogue ?? [];

  // ─── Samples ───
  // The card state comes from the store: the sample in the player is ours
  // and sounds, or ours and has not sounded yet (the button spins).
  const isPlayingKey = (key: string) =>
    audioPlayer.sampleKey === sampleKeyOf(key) && audioPlayer.isPlaying && !audioPlayer.previewPending;
  const isLoadingKey = (key: string) =>
    loadingPreviewId === key ||
    (audioPlayer.sampleKey === sampleKeyOf(key) && audioPlayer.previewPending);

  // Stops a sample in the player; never a story.
  const stopActivePreview = () => audioPlayer.stopPreview();

  const togglePreview = async (
    key: string,
    title: string,
    loadUrl: () => Promise<string | null>,
  ) => {
    const token = ++previewToken.current;
    if (isPlayingKey(key) || isLoadingKey(key)) {
      setLoadingPreviewId(null);
      await stopActivePreview();
      return;
    }
    // The previous sample stops at once, so only one button is busy.
    void stopActivePreview();
    lastStart.current = { token, key };
    setLoadingPreviewId(key);
    let url: string | null = null;
    try {
      url = await loadUrl();
    } catch (err) {
      console.error('Voice preview error:', err);
      if (token === previewToken.current) {
        setLoadingPreviewId(null);
        showToast.error(t('toasts.previewFailed'));
      }
      return;
    }
    // A newer tap won meanwhile.
    if (token !== previewToken.current) return;
    if (!url) {
      setLoadingPreviewId(null);
      showToast.error(t('toasts.sampleMissing'));
      return;
    }
    try {
      await audioPlayer.playFromUrl(url, { key: sampleKeyOf(key), title });
      // Stopped while the player took it (the user left, the voice was
      // deleted) and no newer sample was asked for: it does not play on.
      if (token !== previewToken.current && lastStart.current?.token === token) {
        void audioPlayer.stopPreview(sampleKeyOf(key));
      }
    } catch (err) {
      // The store has shown why.
      console.error('Voice preview error:', err);
    } finally {
      if (token === previewToken.current) setLoadingPreviewId(null);
    }
  };

  // sampleAudioUrl on the profile is a raw storage key, not a playable URL:
  // /voice-profiles/:id/sample signs a fresh one.
  const handlePlayProfilePreview = (profile: VoiceProfile) =>
    togglePreview(profile.id, profile.name, () => voiceProfileStore.getVoiceSample(profile.id));

  const handlePlayPresetPreview = (voice: AvailableGoogleVoice) =>
    togglePreview(presetPreviewKey(voice), voice.name, async () => {
      const response = await VoiceProfileService.previewVoice(voice.voiceId, voice.provider || 'GOOGLE');
      return response?.audioUrl ?? null;
    });

  // ─── Handlers ───
  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      voiceProfileStore.loadVoiceProfiles(),
      voiceProfileStore.loadAvailableVoices(catalogueLanguage),
      voiceProfileStore.loadVoiceSlots(),
      subscriptionStore.loadUsage(),
    ]);
    setRefreshing(false);
  };

  const showCloneBlock = () => {
    const block = voiceProfileStore.slotBlock('clone', planId);
    narratorAdder.showBlock(block.title, block.message, block.showPaywall);
  };

  // The flow opens at once: its first step checks GET /voice-profiles/slots
  // again before anything is recorded. Slots already known to be full say
  // so here. After a delete (`fresh`) the slots are asked first, since the
  // delete may have freed the place.
  const handleAddVoice = async (fresh = false) => {
    const allowed = fresh
      ? await voiceProfileStore.checkCanCreate('clone')
      : voiceProfileStore.canCreateClone;
    if (!allowed) {
      showCloneBlock();
      return;
    }
    nav.navigate('CreateVoiceProfile');
  };

  /** Hides the voice, deletes it, and brings it back when that fails. */
  const deleteVoice = async (profile: VoiceProfile, quiet = false): Promise<boolean> => {
    if (deletingRef.current.has(profile.id)) return false;
    deletingRef.current.add(profile.id);
    setDeletingIds(prev => withId(prev, profile.id));
    // Its sample stops, also one whose URL is still on its way.
    if (lastStart.current?.key === profile.id) {
      previewToken.current += 1;
      setLoadingPreviewId(null);
    }
    void audioPlayer.stopPreview(sampleKeyOf(profile.id));
    const clone = isCloneProfile(profile);
    const deletion = voiceProfileStore.deleteVoiceProfile(profile.id).then(
      result => result === true,
      () => false,
    );
    if (!clone && !quiet) {
      // A ready-made narrator says so in the frame its row goes (VR-04),
      // with "Geri al" (V11): it is added again from its catalogue entry
      // once the delete went. A failed delete brings the row back and the
      // store's message replaces this one.
      const voice = catalogueVoiceOf(profile);
      showToast.success(
        t('toasts.removed'),
        undefined,
        voice
          ? {
              label: t('common:undo'),
              onPress: () => {
                void deletion.then(gone => {
                  if (gone) void narratorAdder.add(voice);
                });
              },
            }
          : undefined,
      );
    }
    let deleted = false;
    try {
      deleted = await deletion;
    } finally {
      deletingRef.current.delete(profile.id);
      setDeletingIds(prev => withoutId(prev, profile.id));
    }
    // An own voice cannot come back: it is confirmed once it is gone. Its
    // slot is free now; the allowance card reads the backend again.
    if (deleted && clone) subscriptionStore.loadUsageSoon();
    if (deleted && clone && !quiet) showToast.success(t('toasts.deleted'));
    return deleted;
  };

  /** The catalogue entry of an added narrator: its language's list, else the one on screen. */
  const catalogueVoiceOf = (profile: VoiceProfile): AvailableGoogleVoice | null => {
    const lists = [
      voiceProfileStore.catalogueFor(profile.contentLanguage),
      voiceProfileStore.catalogueFor(catalogueLanguage),
    ];
    for (const list of lists) {
      const voice = list?.find(item => item.voiceId === profile.voiceId);
      if (voice) return voice;
    }
    return null;
  };

  const handleDeleteVoice = (profile: VoiceProfile) => {
    // An own voice also lives at the voice provider; the backend deletes it
    // there in the same request. The dialog says both go, in plain words,
    // and what the delete leaves of the creation allowance (the free plan's
    // only voice can never be recorded again). A PENDING clone used nothing.
    const clone = isCloneProfile(profile);
    const copy = clone ? 'dialogs.delete' : 'dialogs.remove';
    const name = getNarratorDisplay(profile)?.name ?? profile.name;
    const message = !clone
      ? t('dialogs.remove.message')
      : isVoiceProfilePending(profile)
        ? t('dialogs.delete.messagePlain')
        : cloneDeleteMessage(
            voiceProfileStore.voiceSlotInfo,
            t,
            subscriptionStore.usage?.buckets.cloneCreations ?? null,
          );
    showDialog({
      title: t(`${copy}.title`, { name }),
      message,
      buttons: [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t(`${copy}.confirm`),
          style: 'destructive',
          onPress: () => {
            void deleteVoice(profile);
          },
        },
      ],
    });
  };

  // A FAILED clone cannot be uploaded again (the backend answers 409) and a
  // PENDING one never got its recording, so both start over: discard the
  // voice and record a new one.
  const handleRetry = (profile: VoiceProfile) => {
    showDialog({
      title: t('dialogs.retry.title'),
      message: t(isVoiceProfilePending(profile) ? 'dialogs.retryPending.message' : 'dialogs.retry.message', {
        name: profile.name,
      }),
      buttons: [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('dialogs.retry.confirm'),
          onPress: async () => {
            if (await deleteVoice(profile, true)) await handleAddVoice(true);
          },
        },
      ],
    });
  };

  // Every ready-made narrator is free for every plan: a tap adds it as a
  // voice profile so it can be picked for a story (slot limits still apply).
  // The row keeps its place: the voice is marked before the profile arrives.
  const handlePresetPress = async (voice: AvailableGoogleVoice) => {
    if (!voiceProfileStore.voiceProfiles.some(profile => profile.voiceId === voice.voiceId)) {
      setKeptVoiceIds(prev => withId(prev, voice.voiceId));
    }
    const created = await narratorAdder.add(voice);
    if (!created) return;
    showToast.success(t('toasts.added'));
  };

  const openCatalogue = () => {
    nav.navigate('NarratorCatalogue', { language: catalogueLanguage });
  };

  // ─── Render ───
  const profiles = voiceProfileStore.voiceProfiles;
  const visibleProfiles =
    deletingIds.size > 0 ? profiles.filter(profile => !deletingIds.has(profile.id)) : profiles;
  const own = ownVoices(visibleProfiles);
  // The filter is offered once there is more than one language to pick.
  const filterLanguages = narratorFilterLanguages(
    contentLanguage.languages.map(language => language.code),
    visibleProfiles,
  );
  const showLanguageFilter = filterLanguages.length > 1;
  const keepInPlace =
    keptVoiceIds.size > 0
      ? new Set(
          addedNarrators(visibleProfiles)
            .filter(profile => keptVoiceIds.has(profile.voiceId))
            .map(profile => profile.id),
        )
      : undefined;
  const narratorRows = buildNarratorRows(
    visibleProfiles,
    catalogue,
    showLanguageFilter ? catalogueLanguage : null,
    { keepInPlace },
  );
  // An added narrator's line names its gender too, from the catalogue.
  const catalogueVoice = (voiceId: string) => catalogue.find(voice => voice.voiceId === voiceId);
  // Loaded and empty: this language has no ready-made narrator (not a failure).
  const catalogueKnownEmpty = loadedCatalogue !== null && catalogue.length === 0;
  // "Not known yet" until the first list load settled; a later load or a
  // mutation never turns the hero back into a skeleton.
  const isInitialLoading = !voiceProfileStore.hasLoadedProfiles && profiles.length === 0;
  // Until the catalogue of the language is loaded or failed: no error flash
  // in the frame before the load starts, on a chip switch, nor while a pull
  // to refresh asks again after a failure.
  const isLoadingPresets = loadedCatalogue === null && !catalogueError;
  const catalogueFailed = loadedCatalogue === null && !!catalogueError;

  // The tab shows the first rows; "Tümü" opens the full list.
  const narratorsCollapsed = narratorRows.length > COLLAPSED_NARRATOR_ROWS;
  // How full the list of ready-made narrators is, before an add is refused.
  // With the adds and removals still on their way, so it moves with the rows.
  const narratorSlots = narratorSlotsLine(voiceProfileStore.presetSlots, t);
  const visibleNarratorRows = narratorsCollapsed
    ? narratorRows.slice(0, COLLAPSED_NARRATOR_ROWS)
    : narratorRows;
  // Stories start with the user's own voice (StoryDetail picks the first
  // narrator, own voices first): the first ready one is the default.
  const defaultOwnId = own.find(profile => isVoiceProfileReady(profile))?.id ?? null;
  // The slots and new voices: the voices on screen take their slots (a
  // failed one takes none, as the backend counts), the rest from GET /usage.
  const held = voiceProfileStore.hasLoadedProfiles
    ? own.filter(profile => !isVoiceProfileFailed(profile)).length
    : null;
  const limits = ownVoiceLimits({
    usage: subscriptionStore.usage,
    slotInfo: voiceProfileStore.voiceSlotInfo,
    planId,
    held,
  });
  // Null while a new own voice may be recorded; else why not.
  const block = newVoiceBlock(
    limits,
    { cloningOpen, canCreate: voiceProfileStore.canCreateClone, offersPlans },
    t,
  );
  // A bigger plan helps with full slots and used-up new voices, not with
  // closed cloning.
  const seePlans =
    block && block.reason !== 'closed' && offersPlans
      ? () => navigateSingleton(nav, 'Subscription', { reason: 'voices' })
      : undefined;

  // The own voices of the account once the list is known, for the skeleton
  // of the next cold load.
  const loadedOwnCount = voiceProfileStore.hasLoadedProfiles ? ownVoices(profiles).length : null;
  useEffect(() => {
    if (loadedOwnCount !== null) rememberOwnVoiceCount(accountId, loadedOwnCount);
  }, [accountId, loadedOwnCount]);

  return (
    <View style={styles.container}>
      {showBack ? (
        <TopAppBar variant="back" title={t('title')} onBack={() => nav.goBack()} scrolled={edge.scrolled} />
      ) : (
        <TopAppBar
          variant="tab"
          title={t('title')}
          subtitle={t('subtitle')}
          trailing={<TopBarAccount testIDPrefix="voices" />}
          scrolled={edge.scrolled}
        />
      )}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.content,
          {
            // The navigation bar only sits under the stack instance; the tab
            // leaves room for the mini player while it shows.
            paddingBottom: showBack
              ? insets.bottom + SPACE.xxl
              : T.tabBarReservedHeight + miniPlayerInset,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={T.action}
            colors={[T.action]}
            progressBackgroundColor={T.surface}
          />
        }
        showsVerticalScrollIndicator={false}
        onScroll={edge.onScroll}
        scrollEventThrottle={16}
        testID="voices-scroll"
      >
        {/* OWN VOICES: the allowance card, a slot per voice, then "Ses ekle"
            (or why not). A cold load holds the place with skeletons of the
            slots that will come, and the slots cross-fade in over them in
            place (V5-03). */}
        <View testID="voices-own-section">
          <SectionHeader title={t('slots.title')} testID="own-voices-header" />
          <View style={styles.limits}>
            <OwnVoiceLimitsCard limits={limits} />
          </View>
          <SkeletonSwap
            loading={isInitialLoading}
            skeleton={
              <SkeletonPulse testID="voices-loading" label={t('own.loading')} style={styles.ownList}>
                {Array.from({ length: Math.min(rememberedOwn ?? 0, MAX_OWN_SKELETONS) }, (_, i) => (
                  <OwnVoiceSlotSkeleton key={i} />
                ))}
                <EmptyVoiceSlotSkeleton />
              </SkeletonPulse>
            }
            testID="voices-own"
          >
            {isInitialLoading ? null : (
              <View style={styles.ownList} testID="own-voice-slots">
                {own.map(profile => (
                  <OwnVoiceSlot
                    key={profile.id}
                    id={profile.id}
                    name={profile.name}
                    state={ownVoiceState(profile)}
                    isDefault={profile.id === defaultOwnId}
                    recordedLabel={[
                      voiceLanguageName(profile.contentLanguage),
                      recordedOnLabel(profile.createdAt, t),
                    ]
                      .filter(Boolean)
                      .join(', ')}
                    playing={isPlayingKey(profile.id)}
                    loadingSample={isLoadingKey(profile.id)}
                    durationLabel={sampleDurationLabel(sampleDurations[profile.id])}
                    errorMessage={profile.errorMessage}
                    onToggleSample={() => void handlePlayProfilePreview(profile)}
                    onDelete={() => handleDeleteVoice(profile)}
                    onRetry={() => handleRetry(profile)}
                  />
                ))}
                <EmptyVoiceSlot
                  seconds={cloneTargetSeconds}
                  block={block?.message ?? null}
                  onAdd={() => void handleAddVoice()}
                  onSeePlans={seePlans}
                />
              </View>
            )}
          </SkeletonSwap>
        </View>

        {/* READY-MADE NARRATORS */}
        <View testID="voice-presets-section" style={styles.presets}>
          <SectionHeader
            title={t('sections.narrators')}
            linkLabel={narratorsCollapsed ? t('common:seeAll') : undefined}
            linkAccessibilityLabel={t('narrators.allA11y')}
            onLinkPress={narratorsCollapsed ? openCatalogue : undefined}
            testID="narrators-header"
          />
          {showLanguageFilter ? (
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={t('narrators.languageFilter')}
              style={styles.languages}
              testID="narrator-language-filter"
            >
              {filterLanguages.map(code => {
                const selected = code === catalogueLanguage;
                return (
                  <Chip
                    key={code}
                    kind="choice"
                    label={contentLanguage.nativeName(code)}
                    selected={selected}
                    leading={
                      <View
                        style={[styles.chipCode, selected ? styles.chipCodeOn : null]}
                        testID={`narrator-language-${code}-code`}
                      >
                        <Text
                          style={[styles.chipCodeText, { color: selected ? T.onAction : T.text }]}
                        >
                          {languageCodeLabel(code)}
                        </Text>
                      </View>
                    }
                    onPress={() => setPickedLanguage(code)}
                    testID={`narrator-language-${code}`}
                  />
                );
              })}
            </View>
          ) : null}
          <SkeletonSwap
            loading={isLoadingPresets}
            skeleton={
              <SkeletonPulse testID="narrators-loading" label={t('narrators.loading')} style={styles.narratorList}>
                {[0, 1, 2, 3].map(i => (
                  <NarratorRowSkeleton key={i} />
                ))}
              </SkeletonPulse>
            }
            testID="voices-narrators"
          >
            {isLoadingPresets ? null : narratorRows.length === 0 && !catalogueFailed ? (
              <Text style={[text.bodySmall, styles.emptyText]} testID="narrators-empty">
                {catalogueKnownEmpty
                  ? t('narrators.emptyLanguage', { language: contentLanguageLabel(catalogueLanguage) })
                  : t('narrators.empty')}
              </Text>
            ) : (
              <>
                {narratorRows.length > 0 ? (
                  <>
                    <Text style={[text.meta, styles.hint]} testID="narrators-hint">
                      {[t('narrators.hint'), narratorSlots].filter(Boolean).join(' ')}
                    </Text>
                    <View style={styles.narratorList}>
                      {visibleNarratorRows.map(row => {
                        if (row.kind === 'added') {
                          const profile = row.profile;
                          const ready = isVoiceProfileReady(profile);
                          return (
                            <NarratorRow
                              key={row.key}
                              id={profile.id}
                              name={getNarratorDisplay(profile)?.name ?? profile.name}
                              line={narratorLine(
                                catalogueVoice(profile.voiceId) ?? {
                                  name: profile.name,
                                  contentLanguage: profile.contentLanguage,
                                },
                                t,
                              )}
                              languageCode={showLanguageFilter ? profile.contentLanguage : null}
                              avatarSlot={narratorAvatarSlotFor(profile.voiceId)}
                              added
                              statusLabel={
                                ready
                                  ? undefined
                                  : isVoiceProfileFailed(profile)
                                    ? t('own.failed')
                                    : t('own.preparing')
                              }
                              playing={isPlayingKey(profile.id)}
                              loadingPreview={isLoadingKey(profile.id)}
                              onTogglePreview={() => void handlePlayProfilePreview(profile)}
                              onRemove={() => handleDeleteVoice(profile)}
                            />
                          );
                        }
                        const voice = row.voice;
                        // Added from the tap on (VR-03): no plus, no busy row;
                        // the remove button comes with the profile.
                        const optimistic = voiceProfileStore.isAddingPreset(voice.voiceId);
                        return (
                          <NarratorRow
                            key={row.key}
                            id={voice.voiceId}
                            name={voice.name}
                            line={narratorLine(voice, t)}
                            languageCode={
                              showLanguageFilter ? voice.contentLanguage || voice.languageCode : null
                            }
                            avatarSlot={narratorAvatarSlotFor(voice.voiceId)}
                            added={optimistic}
                            playing={isPlayingKey(row.key)}
                            loadingPreview={isLoadingKey(row.key)}
                            adding={!optimistic && narratorAdder.addingId === voice.voiceId}
                            onPress={optimistic ? undefined : () => void handlePresetPress(voice)}
                            onTogglePreview={() => void handlePlayPresetPreview(voice)}
                          />
                        );
                      })}
                    </View>
                  </>
                ) : null}
                {catalogueFailed ? (
                  <View style={styles.failed} testID="narrators-error">
                    <Text style={[text.bodySmall, styles.failedText]}>{t('narrators.empty')}</Text>
                    <Button
                      variant="text"
                      icon="restart"
                      label={t('common:retry')}
                      onPress={() => void voiceProfileStore.loadAvailableVoices(catalogueLanguage)}
                      testID="narrators-retry"
                    />
                  </View>
                ) : null}
              </>
            )}
          </SkeletonSwap>
        </View>
      </ScrollView>
    </View>
  );
});

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    content: { paddingHorizontal: T.screenPadH, paddingTop: SPACE.lg },
    limits: { marginTop: SPACE.md },
    ownList: { marginTop: SPACE.md, gap: SPACE.md },
    presets: { marginTop: SPACE.xxl },
    emptyText: { paddingVertical: SPACE.xl, textAlign: 'center' },
    hint: { marginTop: SPACE.sm },
    narratorList: { marginTop: SPACE.md, gap: SPACE.md },
    failed: { alignItems: 'center', paddingTop: SPACE.xl, gap: SPACE.xs },
    failedText: { textAlign: 'center' },
    languages: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.md },
    // `.fc .lg`: the language code inside a filter chip.
    chipCode: {
      minHeight: 16,
      paddingHorizontal: SPACE.xs,
      borderRadius: RADIUS.xs,
      justifyContent: 'center',
      backgroundColor: withAlpha(T.text, 0.12),
    },
    chipCodeOn: { backgroundColor: withAlpha(T.onAction, 0.16) },
    chipCodeText: { fontFamily: T.fontLabel, fontSize: 10, lineHeight: 14, letterSpacing: 0.3 },
  });

const stylesFor = themedStyles(makeStyles);

export default VoiceProfilesScreen;
