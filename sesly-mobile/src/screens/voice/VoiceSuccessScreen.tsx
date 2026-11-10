/**
 * VoiceSuccessScreen (playful design, in the system of frame e "Sesim"):
 * final step of the clone flow. Reached from Processing only when the
 * profile is READY, so the voice can be used right away.
 *
 *   - No back button, gesture disabled at the navigator level.
 *   - The big own-voice badge (own colour, wave glyph, on its lip),
 *     "Sesin hazır".
 *   - A card with the voice's name over the sample player: plays the test
 *     sample (GET /voice-profiles/:id/sample) through the app player's
 *     sample path (`playFromUrl` with SUCCESS_SAMPLE_KEY, same native
 *     player, no extra instance). Its state is the store's: it plays while
 *     the store's `sampleKey` is ours, it is loading while the store still
 *     waits for it to sound (`previewPending`), and it is over when the store
 *     drops the key (ended, failed, stopped). Stopped when the screen
 *     unmounts. The time is shown only while the sample plays, because its
 *     length is not known before.
 *   - "Bir masalda dinle": resets to Main on the stories tab. Started from a
 *     story (`returnToStoryId`), it reads "Bu masalda dinle" and resets to
 *     that story with the new voice selected.
 *     "Sesim'e dön": resets to Main on the Sesim tab.
 */

import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { observer } from 'mobx-react-lite';
import {
  useNavigation,
  useRoute,
  RouteProp,
  CommonActions,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { Button, Card } from '../../components/design';
import { FlowAvatar, FlowDock, SamplePlayer, formatClock } from '../../components/voiceflow';
import { Theme, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { useVoiceRecording } from '../../hooks/useVoiceRecording';
import { useVoiceProfile } from '../../hooks/useVoiceProfile';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { showToast } from '../../utils/toast';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'VoiceSuccess'>;

/** The key this screen's sample carries in the app player. */
export const SUCCESS_SAMPLE_KEY = 'voice-success-sample';

export const VoiceSuccessScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const insets = useSafeAreaInsets();
  const recordingStore = useVoiceRecording();
  const voiceProfileStore = useVoiceProfile();
  const audioPlayer = useAudioPlayer();
  const { t } = useTranslation('voiceFlow');
  const T = useT();
  const text = textStylesFor(T);
  const styles = stylesFor(T);

  const profileId = route.params?.profileId ?? null;
  const returnToStoryId = route.params?.returnToStoryId;
  const profile = profileId
    ? voiceProfileStore.voiceProfiles.find(p => p.id === profileId) ?? null
    : null;

  const [isLoadingSample, setIsLoadingSample] = useState(false);

  // Hardware back: leave to Main (never back into Processing).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goToVoices();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stop our sample when leaving the screen (a story is never touched).
  useEffect(() => {
    return () => {
      void audioPlayer.stopPreview(SUCCESS_SAMPLE_KEY);
    };
  }, [audioPlayer]);

  // ─── State from the store ───
  const isPreviewing = audioPlayer.sampleKey === SUCCESS_SAMPLE_KEY;
  // Started, not sounding yet: the button spins instead of flickering
  // stop / play while the sample loads.
  const pending = isPreviewing && audioPlayer.previewPending;
  const playing = isPreviewing && audioPlayer.isPlaying && !pending;
  const previewFailed = audioPlayer.previewFailed;

  // Our sample failed to start (the store has shown the message and dropped
  // the key, so the button is back on play): acknowledge it, as every screen
  // that starts a sample does.
  const wasPreviewing = useRef(false);
  useEffect(() => {
    if (wasPreviewing.current && !isPreviewing && previewFailed) {
      audioPlayer.acknowledgePreviewFailure();
    }
    wasPreviewing.current = isPreviewing;
  }, [isPreviewing, previewFailed, audioPlayer]);

  const handleListen = async () => {
    if (isLoadingSample || pending) return;
    if (playing) {
      await audioPlayer.stopPreview(SUCCESS_SAMPLE_KEY);
      return;
    }
    if (!profileId) {
      showToast.error(t('success.sampleMissing'));
      return;
    }
    setIsLoadingSample(true);
    try {
      const url = await voiceProfileStore.getVoiceSample(profileId);
      if (!url) {
        showToast.info(t('success.sampleNotReady'));
        return;
      }
      await audioPlayer.playFromUrl(url, {
        key: SUCCESS_SAMPLE_KEY,
        title: profile?.name ?? t('success.sampleTitle'),
      });
    } catch (error) {
      // The player has shown the message; the button reads the store.
      console.warn('Voice sample playback failed:', error);
    } finally {
      setIsLoadingSample(false);
    }
  };

  /** Done with the flow: the sample stops and the recording scratch state goes. */
  const finishFlow = () => {
    void audioPlayer.stopPreview(SUCCESS_SAMPLE_KEY);
    recordingStore.reset();
  };

  const leaveToTab = (tab: 'Stories' | 'Voices') => {
    finishFlow();
    nav.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Main', params: { screen: tab } }],
      }),
    );
  };

  const goToVoices = () => leaveToTab('Voices');

  const handleListenInStory = () => {
    if (!returnToStoryId) {
      leaveToTab('Stories');
      return;
    }
    // Back to the story the flow was started from, with the new voice picked.
    finishFlow();
    nav.dispatch(
      CommonActions.reset({
        index: 1,
        routes: [
          { name: 'Main' },
          {
            name: 'StoryDetail',
            params: {
              storyId: returnToStoryId,
              ...(profileId ? { selectVoiceId: profileId } : null),
            },
          },
        ],
      }),
    );
  };

  // Position and length are the app player's, and only ours while the
  // sample is the thing it plays.
  const durationMs = isPreviewing ? audioPlayer.totalDurationMs : 0;
  const positionMs = isPreviewing ? audioPlayer.currentPositionMs : 0;
  const progress = durationMs > 0 ? Math.min(positionMs / durationMs, 1) : 0;
  // Digits only, the same in every language.
  const timeLabel =
    durationMs > 0
      ? `${formatClock(positionMs / 1000)} / ${formatClock(durationMs / 1000)}`
      : null;
  // The voice's own name over its sample ("Annem"), else "Senin sesin".
  const voiceName = profile?.name ?? recordingStore.profileName ?? t('success.sampleTitle');

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Scrolls on a short phone at a large font instead of clipping. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <FlowAvatar icon="wave" />
        <Text accessibilityRole="header" style={[text.displayL, styles.title]}>
          {t('success.title')}
        </Text>
        <Text style={[text.body, styles.lead]}>{t('success.body')}</Text>

        <Card testID="voice-sample-card" radius={28} style={styles.card}>
          <Text numberOfLines={1} style={text.subheading}>
            {voiceName}
          </Text>
          <SamplePlayer
            // The press stops the sample (the next one starts from the top),
            // so the glyph is the stop square, not pause.
            icon={playing ? 'stop' : 'play'}
            onPress={handleListen}
            busy={isLoadingSample || pending}
            accessibilityLabel={playing ? t('success.stop') : t('success.play')}
            progress={progress}
            timeLabel={timeLabel}
            bars={34}
            seed={5}
            testID="voice-sample"
            style={styles.player}
          />
        </Card>
      </ScrollView>

      <FlowDock variant="plain">
        <Button
          label={returnToStoryId ? t('success.listenInThisStory') : t('success.listenInStory')}
          size="lg"
          block
          icon="play"
          pressDelay={0}
          onPress={handleListenInStory}
          testID="voice-success-listen"
        />
        <Button
          label={t('success.backToVoices')}
          variant="text"
          block
          pressDelay={0}
          onPress={goToVoices}
          style={styles.secondary}
          testID="voice-success-back"
        />
      </FlowDock>
    </View>
  );
});

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    scroll: { flex: 1 },
    body: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: T.screenPadH,
      paddingBottom: T.space.xxl,
    },
    title: { marginTop: T.space.xl, textAlign: 'center' },
    lead: { marginTop: T.space.sm, textAlign: 'center' },
    card: { marginTop: T.space.xxl },
    player: { marginTop: T.space.md },
    secondary: { marginTop: T.space.sm },
  });

const stylesFor = themedStyles(makeStyles);

export default VoiceSuccessScreen;
