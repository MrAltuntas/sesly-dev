/**
 * Sample playback for the narrator sheet, the story page and the narrator
 * catalogue.
 *
 * Same sources as the voice list: the user's own voice plays the sample the
 * backend signs on request (`GET /voice-profiles/:id/sample`; the
 * `sampleAudioUrl` on the profile is a storage key, not a playable URL), a
 * ready-made narrator (added or still in the catalogue) plays the catalogue
 * preview of its voice (`POST /voice-profiles/preview`). One sample at a
 * time, through the app's single expo-audio player.
 *
 * The audio store owns the state (docs/release-pass/SPEC-audio.md 2.5): a
 * row plays while the store's `sampleKey` is its key, and it is busy while its
 * URL is fetched or the store waits for the sample to sound
 * (`previewPending`). A sample that ends or fails leaves the player, so its
 * row goes back to play by itself; nothing is acknowledged here. Stopping only
 * ever stops a sample this hook started (`stopPreview(key)`), never a story.
 *
 * Taps race: tap A (slow URL), then B (fast URL) plays B only. Every play and
 * stop takes a new token, and an answer for an older token is dropped; a
 * sample the player took over after its token went stale is stopped again.
 */

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { useVoiceProfile } from '../../hooks/useVoiceProfile';
import VoiceProfileService from '../../services/VoiceProfileService';
import { AvailableGoogleVoice, VoiceProfile, isCloneProfile } from '../../models/VoiceProfile';
import { getNarratorDisplay } from '../../models/Narrator';
import { presetPreviewKey } from '../voice/narratorRows';
import { showToast } from '../../utils/toast';

export interface NarratorPreview {
  /** Key of the sample that is playing: a profile id, or `presetPreviewKey(voice)`. */
  readonly playingId: string | null;
  /** Key of the sample that is being fetched or has not started to sound yet. */
  readonly loadingId: string | null;
  /** Play the sample of a narrator, or stop it when it is the one playing. */
  readonly toggle: (profile: VoiceProfile) => Promise<void>;
  /** The same for a catalogue narrator the user has not added. */
  readonly toggleVoice: (voice: AvailableGoogleVoice) => Promise<void>;
  /** Stop the sample this hook started, if one is in the player or on its way. */
  readonly stop: () => Promise<void>;
}

export function useNarratorPreview(): NarratorPreview {
  const { t } = useTranslation('detail');
  const audioPlayer = useAudioPlayer();
  const voiceProfileStore = useVoiceProfile();
  // The URL of this key is being fetched.
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  // Bumped by every play and stop: an older answer is stale.
  const tokenRef = useRef(0);
  // Keys this hook handed to the player (a sample started elsewhere is not ours).
  const ownKeys = useRef(new Set<string>());

  // Read from the store on every render (the screens using this are observers).
  const sampleKey = audioPlayer.sampleKey ?? null;
  const ours = sampleKey !== null && ownKeys.current.has(sampleKey) ? sampleKey : null;
  const pending = ours !== null && !!audioPlayer.previewPending;
  const playingId = ours !== null && !pending && audioPlayer.isPlaying ? ours : null;
  const loadingId = fetchingId ?? (pending ? ours : null);

  // The latest state for the callbacks, without re-creating them per render.
  const stateRef = useRef({ ours, fetchingId });
  stateRef.current = { ours, fetchingId };

  const stop = useCallback(async () => {
    tokenRef.current += 1;
    setFetchingId(null);
    const key = stateRef.current.ours;
    if (!key) return;
    try {
      await audioPlayer.stopPreview(key);
    } catch (error) {
      console.error('Stop narrator preview error:', error);
    }
  }, [audioPlayer]);

  const play = useCallback(
    async (key: string, title: string, loadUrl: () => Promise<string | null>) => {
      const { ours: current, fetchingId: fetching } = stateRef.current;
      // A second tap on the row that is playing or on its way stops it.
      const active = current === key || fetching === key;
      await stop();
      if (active) return;

      const token = ++tokenRef.current;
      setFetchingId(key);
      let handedOver = false;
      try {
        const url = await loadUrl();
        if (token !== tokenRef.current) return;
        if (!url) {
          showToast.error(t('narratorSheet.sampleMissing'));
          return;
        }
        ownKeys.current.add(key);
        handedOver = true;
        await audioPlayer.playFromUrl(url, { key, title });
        // Stopped (or another row tapped) while the player was still taking
        // it over (it pauses a story first): this sample must not play on.
        // Only this key is stopped, so a newer sample is never touched.
        if (token !== tokenRef.current) await audioPlayer.stopPreview(key);
      } catch (error) {
        if (token !== tokenRef.current) return;
        console.error('Narrator preview error:', error);
        // The player says itself when it cannot start a sample.
        if (!handedOver) showToast.error(t('narratorSheet.previewFailed'));
      } finally {
        if (token === tokenRef.current) setFetchingId(null);
      }
    },
    [audioPlayer, stop, t],
  );

  const toggle = useCallback(
    (profile: VoiceProfile) =>
      play(profile.id, getNarratorDisplay(profile)?.name ?? profile.name, async () =>
        isCloneProfile(profile)
          ? voiceProfileStore.getVoiceSample(profile.id)
          : (await VoiceProfileService.previewVoice(profile.voiceId, profile.provider))?.audioUrl ??
            null,
      ),
    [play, voiceProfileStore],
  );

  const toggleVoice = useCallback(
    (voice: AvailableGoogleVoice) =>
      play(
        presetPreviewKey(voice),
        voice.name,
        async () =>
          (await VoiceProfileService.previewVoice(voice.voiceId, voice.provider || 'GOOGLE'))
            ?.audioUrl ?? null,
      ),
    [play],
  );

  return { playingId, loadingId, toggle, toggleVoice, stop };
}
