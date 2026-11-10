/**
 * AudioGenerationScreen: shown while the backend generates the audio of a
 * narration (no frame of its own in design/v4/playful; drawn in the system
 * of the story detail).
 *
 * The heavy lifting (create, status poll, socket `narration_status`) lives
 * in the `useAudioPlayer` MobX store; this screen draws its progress: the
 * cover centred on a glow of the story's category colour, a Baloo 2 title
 * with the story and narrator under it, a fat bar in the action colour that
 * eases to each new percentage (indeterminate while the backend reports
 * none, so the percentage is hidden at 0), and a stage name derived from
 * that percentage (the backend sends a number, not a stage text); an
 * accepted job reads as voicing after `TEXT_STAGE_MS`, since a one-part story
 * stays at 0 % until READY.
 *
 * The first frame already draws the story: the copy the app holds (the
 * story detail has just loaded it, `storyStore.peekStory`) gives the right
 * cover, glow and subtitle at once, and the job starts without fetching it.
 * Only a story the app does not hold is fetched; its cover is a bone until
 * then.
 *
 * States: generating (slow after a few minutes: it says so and still offers
 * the background), "this pair is already being prepared" (the store follows
 * the running job), "already narrated" (409 with a READY narration: listen
 * or prepare again), generation limit (a used-up allowance: the plans and,
 * for an own voice, a ready-made narrator; never a retry), error (offline or
 * another failure: retry or go back). When the narration is READY
 * (`generationReadyId`) the screen replaces itself with the player, which
 * plays it; while another story is playing it does not cut that story off
 * and offers "Dinle" instead. Before the player opens (also for "Dinle" on
 * an already narrated pair) the narration's meta is remembered from the job,
 * so the player draws the story at once (SPEC-audio D6). The store's job
 * fields (`generatingStory`, `generatingVoiceProfile`) are what it draws,
 * never the loaded story.
 *
 * Every dock action is md and block, the primary one on top (SPEC-design
 * 3.22); the back arrow, hardware back and "Arka planda devam et" all return
 * to where the user came from (the story detail), the job going on. That
 * label is `singleLine` on a block face: one line at its own size and full
 * width (no font auto-fit, which on Android drew it as "Arka planda devam"
 * with "et" on a clipped second line, NL-03).
 *
 * Route: `AudioGeneration: { storyId, voiceProfileId, replace? }`.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { observer } from 'mobx-react-lite';
import {
  CommonActions,
  useNavigation,
  useRoute,
  RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { useStory } from '../../hooks/useStory';
import { useVoiceProfile } from '../../hooks/useVoiceProfile';
import { useSubscription } from '../../hooks/useSubscription';
import StoryService from '../../services/StoryService';
import { ensurePushPermission } from '../../services/PushNotificationService';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { navigateSingleton } from '../../navigation/navigateSingleton';
import { getNarratorDisplay } from '../../models/Narrator';
import { describeQuotaBlock } from '../../models/Quota';
import { reasonForQuota } from '../subscription/subscriptionReason';
import type { Story } from '../../models/Story';
import { contentNoteText } from '../../models/contentWarnings';
import { isCloneProfile, type VoiceProfile } from '../../models/VoiceProfile';
import {
  getNarrationMeta,
  playerStoryOf,
  rememberNarrationMeta,
  type NarrationMeta,
} from '../../stores/narrationMeta';
import {
  Bone,
  Button,
  PictureCover,
  ProgressBar,
  SkeletonPulse,
  StateView,
  TopAppBar,
  coverLip,
} from '../../components/design';
import { CategoryGlow } from '../../components/detail/CategoryGlow';
import {
  NarrationConfirmRequest,
  NarrationConfirmSheet,
} from '../../components/detail/NarrationConfirmSheet';
import {
  RADIUS,
  SCREEN_PAD_H,
  SPACE,
  Theme,
  dockBottom,
  textStylesFor,
  themedStyles,
  useT,
  useTextStyles,
} from '../../theme/theme';
import { categoryColors } from '../../theme/palettes';
import { failureCopy } from '../home/failureState';

/** The cover (as on the story detail) and the glow behind it. */
const COVER_WIDTH = 144;
const COVER_HEIGHT = 216;
const GLOW_SIZE = 270;

type Nav = NativeStackNavigationProp<RootStackParamList>;
type GenerationRoute = RouteProp<RootStackParamList, 'AudioGeneration'>;

export type GenerationStage = 'starting' | 'text' | 'voicing' | 'merging' | 'finishing' | 'done';

/**
 * How long an accepted job reads "Metin hazırlanıyor" before "Seslendiriliyor".
 * The backend splits the text at once and spends the job on the voice, but it
 * reports 0 % until READY for a one-part story, so the percentage alone would
 * keep the text stage up for the whole generation.
 */
export const TEXT_STAGE_MS = 4000;

/**
 * Stage name for a progress percentage. The backend reports a number only;
 * the bands are the ones the store has always used for its status text.
 * 'starting' lasts until the backend has accepted the job (`accepted`);
 * from then on a job still at 0 is preparing its text, until `voicing` (the
 * job has been accepted for `TEXT_STAGE_MS`): from then on the text band
 * reads as voicing, so the stage never goes back.
 */
export function generationStage(
  progress: number,
  finished: boolean,
  accepted = false,
  voicing = false,
): GenerationStage {
  if (finished) return 'done';
  if (!(progress > 0)) return !accepted ? 'starting' : voicing ? 'voicing' : 'text';
  if (progress < 30) return voicing ? 'voicing' : 'text';
  if (progress < 60) return 'voicing';
  if (progress < 90) return 'merging';
  return 'finishing';
}

/**
 * What the player draws for a narration of this screen's pair (the job that
 * became READY, or the one the backend says is already narrated), so it opens
 * on it at once instead of fetching it first (SPEC-audio D6). Null while the
 * story is not known: the player then fetches the narration.
 */
export function pairNarrationMeta(
  narrationId: string,
  story: Story | null,
  voice: VoiceProfile | null,
  voiceProfileId: string | null = null,
): NarrationMeta | null {
  if (!narrationId || !story?.id || !story.title) return null;
  return {
    narrationId,
    storyId: story.id,
    voiceProfileId: voice?.id ?? voiceProfileId,
    story: playerStoryOf(story),
    voiceProfile: voice,
    narratorName: getNarratorDisplay(voice)?.name ?? null,
    ownVoice: voice ? isCloneProfile(voice) : false,
    // The job's length is not known yet; the player measures it.
    estimateMs: 0,
  };
}

const AudioGenerationScreen: React.FC = observer(() => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<GenerationRoute>();
  const audioPlayer = useAudioPlayer();
  const voiceProfileStore = useVoiceProfile();
  const storyStore = useStory();
  const subscriptionStore = useSubscription();
  const { t } = useTranslation('generation');
  const T = useT();
  const text = useTextStyles();
  const styles = stylesFor(T);
  const insets = useSafeAreaInsets();

  const storyId = route.params?.storyId;
  const voiceProfileId = route.params?.voiceProfileId;
  const replaceExisting = route.params?.replace ?? false;

  // The story as the app already holds it, read once: the first frame draws
  // it and the job starts without a request for it.
  const knownStory = useMemo(
    () => (storyId ? storyStore.peekStory(storyId) : null),
    [storyStore, storyId],
  );
  // The story the job was started with (known, or fetched once), so
  // "Yeniden hazırla" never fetches it again.
  const storyRef = useRef<Story | null>(knownStory);

  // false once the user declined notifications: "haber veririz" would not be true.
  const [notifyAllowed, setNotifyAllowed] = useState<boolean | null>(null);

  // Back where the user came from (the story detail), or Main without
  // history. A job keeps running in the store and the user is notified.
  const leave = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Main' }],
      }),
    );
  };

  // Hardware back does what the app bar arrow does.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // A screen opened above this one (the plans) goes back by itself.
      if (!navigation.isFocused()) return false;
      leave();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kick off generation if we've been given params and nothing is in flight.
  const kickedOffRef = useRef(false);

  /**
   * Resolve the voice and the story, then ask the store to generate. The
   * caller has already flipped the store into its "generating" session.
   */
  const generate = async (replace: boolean, failureKey: 'startFailed' | 'regenerateFailed') => {
    if (!storyId || !voiceProfileId) return;
    try {
      // GET /voice-profiles/:id doesn't exist on the backend. Look the
      // profile up in the already-loaded store; if not found, refresh the
      // list first, then filter.
      let voice = voiceProfileStore.voiceProfiles.find(p => p.id === voiceProfileId);
      if (!voice) {
        await voiceProfileStore.loadVoiceProfiles();
        voice = voiceProfileStore.voiceProfiles.find(p => p.id === voiceProfileId);
      }
      if (!voice) {
        // Not shown: the store reports the generic start failure.
        throw new Error(`Voice profile not found: ${voiceProfileId}`);
      }

      let story = storyRef.current;
      if (!story) {
        story = await StoryService.getStoryById(storyId);
        storyRef.current = story;
      }
      await audioPlayer.generateAudio(story, voice, { replace });
    } catch (err) {
      console.error('Narration generation could not start:', err);
      // The error state (or the limit state) instead of a frozen progress
      // screen.
      audioPlayer.failGeneration(err, t(`error.${failureKey}`));
    }
  };

  const startGeneration = async () => {
    if (!storyId || !voiceProfileId) return;
    // Flip to "generating" before any await so the auto-navigate effect
    // below cannot fire on a previous narration's finished state.
    audioPlayer.beginGenerationSession();
    // In-context push permission ask (only the first time ever), so "Arka
    // planda devam et" can end with a "masalın hazır" notification.
    void ensurePushPermission().then(setNotifyAllowed, () => undefined);
    await generate(replaceExisting, 'startFailed');
  };

  useEffect(() => {
    if (kickedOffRef.current) return;
    if (!storyId || !voiceProfileId) return;
    // Re-entering the screen for the job that is already running (e.g. after
    // "Arka planda devam et"): just show its progress. Any other state, even
    // a previously played narration still loaded in the player, starts fresh.
    const sameJobRunning =
      audioPlayer.isGenerating &&
      audioPlayer.generatingStory?.id === storyId &&
      audioPlayer.generatingVoiceProfile?.id === voiceProfileId;
    kickedOffRef.current = true;
    if (sameJobRunning) {
      // A poll that gave up on a long job follows it again; the note knows
      // whether a notification will come (asked when the job started).
      audioPlayer.resumeGenerationPoll();
      void ensurePushPermission().then(setNotifyAllowed, () => undefined);
      return;
    }
    void startGeneration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, voiceProfileId, audioPlayer, voiceProfileStore]);

  const handleRetry = async () => {
    audioPlayer.clearError();
    audioPlayer.clearConflict();
    kickedOffRef.current = true; // we're about to call again
    await startGeneration();
  };

  /**
   * Before the player opens on a narration of this pair: remember its meta,
   * read live from the job (its story and voice) or the copies the screen
   * holds, so the player draws it at once (SPEC-audio D6). A fuller meta the
   * app already knows (a story detail row, with its length) is kept.
   */
  const rememberPairNarration = (narrationId: string) => {
    if (getNarrationMeta(narrationId)?.story.title) return;
    const jobStory =
      audioPlayer.generatingStory && audioPlayer.generatingStory.id === storyId
        ? audioPlayer.generatingStory
        : null;
    const jobVoice =
      audioPlayer.generatingVoiceProfile && audioPlayer.generatingVoiceProfile.id === voiceProfileId
        ? audioPlayer.generatingVoiceProfile
        : null;
    const meta = pairNarrationMeta(
      narrationId,
      jobStory ?? storyRef.current ?? knownStory,
      jobVoice ?? voiceProfileStore.voiceProfiles.find(p => p.id === voiceProfileId) ?? null,
      voiceProfileId ?? null,
    );
    if (meta) rememberNarrationMeta(meta);
  };

  const handleListenExisting = () => {
    const existingId = audioPlayer.conflictExistingNarrationId;
    if (!existingId) return;
    audioPlayer.clearConflict();
    // "Dinle": the player opens playing it, like a ready job.
    rememberPairNarration(existingId);
    navigation.replace('AudioPlayer', { narrationId: existingId, autoplay: true });
  };

  // "Yeniden hazırla" makes a new narration that replaces the ready one: it
  // is confirmed first, like every new narration (NarrationConfirmSheet).
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [regenerateRequest, setRegenerateRequest] = useState<NarrationConfirmRequest | null>(null);

  const handleRegenerateReplace = async () => {
    audioPlayer.clearConflict();
    if (!storyId || !voiceProfileId) return;
    audioPlayer.beginGenerationSession();
    await generate(true, 'regenerateFailed');
  };

  // The job of this screen that became READY while another story was
  // playing: the screen waits for "Dinle" instead of cutting that story off.
  const [readyToListen, setReadyToListen] = useState<string | null>(null);

  // The player opens drawing the story (its meta is known), never on the
  // full-screen loading line.
  const openReady = (narrationId: string) => {
    rememberPairNarration(narrationId);
    navigation.replace('AudioPlayer', { narrationId, autoplay: true });
  };

  // When the backend reports READY: open the player and play it, unless a
  // story is playing (decided once, when it becomes ready).
  const readyId = audioPlayer.generationReadyId;
  useEffect(() => {
    // Read live, not from the render: a fresh session started by the
    // kick-off effect above has already cleared a previous job's id.
    const narrationId = audioPlayer.generationReadyId;
    if (!narrationId || audioPlayer.hasError || audioPlayer.quotaBlock) {
      // A new session (retry, prepare again) is not ready yet.
      setReadyToListen(null);
      return undefined;
    }
    if (audioPlayer.isStoryLoaded && audioPlayer.isPlaying) {
      setReadyToListen(narrationId);
      return undefined;
    }
    // A moment on "Hazır" before the player takes over.
    const timer = setTimeout(() => openReady(narrationId), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyId, audioPlayer.hasError, navigation]);

  // The job whose text stage is over (accepted `TEXT_STAGE_MS` ago): from
  // then on it reads "Seslendiriliyor" while the backend still reports 0. A
  // job that was already running when the screen opened (back from "Arka
  // planda devam et") is past it at once.
  const acceptedId = audioPlayer.generatingNarrationId;
  const [voicingId, setVoicingId] = useState<string | null>(() =>
    audioPlayer.isGenerating ? audioPlayer.generatingNarrationId : null,
  );
  useEffect(() => {
    if (!acceptedId || voicingId === acceptedId) return undefined;
    const timer = setTimeout(() => setVoicingId(acceptedId), TEXT_STAGE_MS);
    return () => clearTimeout(timer);
  }, [acceptedId, voicingId]);

  // 409 NARRATION_EXISTS with GENERATING/PENDING: the store follows the
  // existing job instead of creating a second one.
  const isFollowingExisting =
    audioPlayer.conflictExistingNarrationStatus === 'GENERATING' ||
    audioPlayer.conflictExistingNarrationStatus === 'PENDING';

  // The job's own story once it has one, else the copy the app held when the
  // screen opened. A previous job's story (another route) is never shown.
  const story =
    (audioPlayer.generatingStory && audioPlayer.generatingStory.id === storyId
      ? audioPlayer.generatingStory
      : null) ?? knownStory;
  const voice =
    (audioPlayer.generatingVoiceProfile && audioPlayer.generatingVoiceProfile.id === voiceProfileId
      ? audioPlayer.generatingVoiceProfile
      : null) ??
    voiceProfileStore.voiceProfiles.find(p => p.id === voiceProfileId) ??
    null;
  const narrator = getNarratorDisplay(voice);
  // Always laid out (an empty line while unknown), so nothing below moves.
  const subtitle = story
    ? narrator
      ? t('subtitle', { story: story.title, narrator: narrator.name })
      : story.title
    : '';

  const percent = Math.round(Math.max(0, Math.min(100, audioPlayer.generationProgress)));
  const finished = !audioPlayer.isGenerating && percent >= 100;
  const stage = generationStage(
    percent,
    finished,
    !!acceptedId,
    !!acceptedId && voicingId === acceptedId,
  );
  const slow = audioPlayer.isGenerating && audioPlayer.generationSlow;
  const noPush = notifyAllowed === false;
  const note = slow ? t(noPush ? 'slowNoPush' : 'slow') : t(noPush ? 'noteNoPush' : 'note');
  // The parent knows before listening: the age group and the content warnings.
  const contentNote = story ? contentNoteText(story.ageGroup, story.contentWarnings) : '';
  // Neutral until the story of this route is known.
  const glowColor = categoryColors(T, story?.category).color;

  const bar = <TopAppBar variant="back" onBack={leave} />;
  const dockStyle = [styles.dock, { paddingBottom: dockBottom(insets.bottom) }];

  // ─── "Already narrated": listen to it or prepare it again ───
  if (audioPlayer.conflictExistingNarrationId) {
    const askToRegenerate = () => {
      const pairStory = storyRef.current ?? story;
      if (!pairStory || !voice) {
        // Not reachable: the job that answered 409 had both.
        void handleRegenerateReplace();
        return;
      }
      setRegenerateRequest({ story: pairStory, voice, mode: 'regenerate' });
      setRegenerateOpen(true);
    };
    const pairLanguage = (storyRef.current ?? story)?.language ?? null;
    return (
      <View style={styles.screen}>
        {bar}
        <View style={styles.center}>
          <StateView
            icon="book"
            title={t('exists.title')}
            message={t('exists.message')}
            testID="generation-exists"
          />
        </View>
        <View style={dockStyle}>
          <Button
            label={t('exists.listen')}
            variant="primary"
            size="md"
            block
            icon="play"
            onPress={handleListenExisting}
            testID="generation-listen-existing"
          />
          <Button
            label={t('exists.regenerate')}
            variant="secondary"
            size="md"
            block
            icon="redo"
            onPress={askToRegenerate}
            testID="generation-regenerate"
          />
          <Button label={t('goBack')} variant="text" block onPress={leave} testID="generation-go-back" />
        </View>
        <NarrationConfirmSheet
          visible={regenerateOpen}
          onClose={() => setRegenerateOpen(false)}
          request={regenerateRequest}
          usage={subscriptionStore.usage ?? null}
          planId={subscriptionStore.planId}
          catalogue={voiceProfileStore.catalogueFor?.(pairLanguage) ?? null}
          onConfirm={() => void handleRegenerateReplace()}
          onSeePlans={block =>
            navigateSingleton(navigation, 'Subscription', { reason: reasonForQuota(block.code) })
          }
        />
      </View>
    );
  }

  // ─── Generation limit: a used-up allowance, never a retry ───
  const block = audioPlayer.quotaBlock;
  if (block) {
    const copy = describeQuotaBlock(block);
    return (
      <View style={styles.screen}>
        {bar}
        <View style={styles.center}>
          <StateView icon="lock" title={copy.title} message={copy.message} testID="generation-limit" />
        </View>
        <View style={dockStyle}>
          {copy.offerPlans ? (
            <Button
              label={t('messages:quota.seePlans')}
              variant="primary"
              size="md"
              block
              onPress={() => navigateSingleton(navigation, 'Subscription', { reason: reasonForQuota(block.code) })}
              testID="generation-plans"
            />
          ) : null}
          <Button
            label={copy.offerReadyMade ? t('messages:quota.readyMade') : t('common:ok')}
            variant={copy.offerPlans ? 'secondary' : 'primary'}
            size="md"
            block
            onPress={leave}
            testID={copy.offerReadyMade ? 'generation-ready-made' : 'generation-limit-ok'}
          />
        </View>
      </View>
    );
  }

  // ─── Error ───
  if (audioPlayer.hasError) {
    const kind = audioPlayer.errorKind;
    const copy = failureCopy(kind, {
      title: t('error.title'),
      message: audioPlayer.errorMessage || t('error.message'),
    });
    return (
      <View style={styles.screen}>
        {bar}
        <View style={styles.center}>
          <StateView
            icon={copy.icon}
            title={copy.title}
            message={kind === 'offline' ? t('error.offlineMessage') : copy.message}
            testID="generation-error"
          />
        </View>
        <View style={dockStyle}>
          <Button
            label={t('common:retry')}
            variant="primary"
            size="md"
            block
            icon="redo"
            onPress={handleRetry}
            testID="generation-retry"
          />
          <Button label={t('goBack')} variant="text" block onPress={leave} testID="generation-go-back" />
        </View>
      </View>
    );
  }

  // ─── Generating ───
  return (
    <View style={styles.screen}>
      {bar}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View testID="generation-art" style={styles.stage}>
          <CategoryGlow
            color={glowColor}
            size={GLOW_SIZE}
            style={styles.glow}
            testID="generation-glow"
          />
          {story ? (
            <PictureCover
              story={story}
              title={story.title}
              width={COVER_WIDTH}
              radius={RADIUS.xl}
              testID="generation-cover"
            />
          ) : (
            <SkeletonPulse testID="generation-cover-loading">
              <Bone
                width={COVER_WIDTH}
                height={COVER_HEIGHT}
                radius={RADIUS.xl}
                lip={coverLip(COVER_WIDTH)}
              />
            </SkeletonPulse>
          )}
        </View>

        <Text accessibilityRole="header" style={[text.displayM, styles.title]}>
          {t('title')}
        </Text>
        <Text testID="generation-subtitle" numberOfLines={2} style={styles.subtitle}>
          {subtitle}
        </Text>

        <ProgressBar
          value={percent > 0 ? percent / 100 : undefined}
          animated
          height={12}
          accessibilityLabel={t('progressA11y')}
          testID="generation-bar"
          style={styles.bar}
        />
        <View style={styles.progressRow}>
          <Text testID="generation-stage" style={[text.label, styles.stageText]}>
            {t(`stage.${stage}`)}
          </Text>
          <Text testID="generation-percent" style={styles.percent}>
            {percent > 0 ? t('percent', { value: percent }) : ''}
          </Text>
        </View>

        {audioPlayer.isGenerating && isFollowingExisting ? (
          <Text style={[text.bodySmall, styles.note]}>{t('alreadyRunning')}</Text>
        ) : null}
        {contentNote ? (
          <Text testID="generation-content-note" style={[text.bodySmall, styles.note]}>
            {contentNote}
          </Text>
        ) : null}
        <Text testID="generation-note" style={[text.bodySmall, styles.note]}>
          {note}
        </Text>
      </ScrollView>

      <View style={dockStyle}>
        {readyToListen ? (
          <Button
            label={t('listen')}
            variant="primary"
            size="md"
            block
            icon="play"
            onPress={() => openReady(readyToListen)}
            testID="generation-listen"
          />
        ) : (
          <Button
            label={t('background')}
            variant="secondary"
            size="md"
            block
            singleLine
            icon="clock"
            onPress={leave}
            testID="generation-background"
          />
        )}
      </View>
    </View>
  );
});

const makeStyles = (T: Theme) => {
  const body = textStylesFor(T).body;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: T.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll: { flex: 1 },
    content: {
      alignItems: 'center',
      paddingHorizontal: SCREEN_PAD_H,
      paddingTop: SPACE.xxl,
      paddingBottom: SPACE.lg,
    },
    // Full width like the story detail's stage, so the glow's 50% is the
    // screen's centre (a stage as narrow as the cover put it off-centre).
    stage: { alignSelf: 'stretch', alignItems: 'center' },
    glow: {
      position: 'absolute',
      top: -(GLOW_SIZE - COVER_HEIGHT) / 2,
      left: '50%',
      marginLeft: -GLOW_SIZE / 2,
    },
    title: { marginTop: SPACE.xxl, textAlign: 'center' },
    // One line reserved before the story is known; two at most after.
    subtitle: { ...body, marginTop: SPACE.xs, minHeight: body.lineHeight, textAlign: 'center' },
    bar: { alignSelf: 'stretch', marginTop: SPACE.xxl },
    progressRow: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: SPACE.md,
      marginTop: SPACE.sm,
      // The percentage line, also while it is hidden at 0.
      minHeight: 23,
    },
    stageText: { flex: 1, color: T.text2 },
    percent: {
      fontFamily: T.fontDisplay,
      fontSize: 17,
      lineHeight: 23,
      color: T.text,
      fontVariant: ['tabular-nums'],
    },
    note: { marginTop: SPACE.lg, maxWidth: 300, textAlign: 'center' },
    dock: { paddingHorizontal: SCREEN_PAD_H, paddingTop: SPACE.sm, gap: SPACE.sm },
  });
};

const stylesFor = themedStyles(makeStyles);

export default AudioGenerationScreen;
