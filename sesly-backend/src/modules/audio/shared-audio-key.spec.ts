import {
  SHARED_AUDIO_CACHE_VERSION,
  audioStoragePrefix,
  buildSharedAudioParams,
  contentHash,
  isShareableVoice,
  sharedAudioKey,
  withSegmentationVersion,
} from './shared-audio-key';
import { createSettingsStub } from '../../test-utils/settings-stub';

const story = { id: 'story-1', content: 'Bir varmış bir yokmuş.', language: 'tr', segmentationVersion: 3 };
const chirp = { provider: 'GOOGLE', kind: 'PRESET', voiceId: 'tr-TR-Chirp3-HD-Achernar', language: 'tr-TR' };

describe('shared-audio-key', () => {
  it('only ready-made Google voices are shareable, clones never', () => {
    expect(isShareableVoice({ provider: 'GOOGLE', kind: 'PRESET' })).toBe(true);
    expect(isShareableVoice({ provider: 'GOOGLE', kind: null })).toBe(true);
    expect(isShareableVoice({ provider: 'GOOGLE', kind: 'CLONE' })).toBe(false);
    expect(isShareableVoice({ provider: 'CARTESIA', kind: 'CLONE' })).toBe(false);
    expect(isShareableVoice({ provider: null, kind: 'PRESET' })).toBe(false);
  });

  it('parameters: segmentation version, text hash, synthesis voice, language, rate; no pitch for Chirp', () => {
    const params = buildSharedAudioParams(story, chirp, createSettingsStub(), true);
    expect(params).toEqual({
      cacheVersion: SHARED_AUDIO_CACHE_VERSION,
      storyId: 'story-1',
      segmentation: 'v3',
      contentHash: contentHash(story.content),
      provider: 'GOOGLE',
      voiceId: 'tr-TR-Chirp3-HD-Achernar',
      language: 'tr',
      speakingRate: expect.any(Number),
      pitch: null,
      grouped: true,
    });
    expect(buildSharedAudioParams(story, chirp, createSettingsStub(), false).segmentation).toBe('lazy-v3');
  });

  it('a Turkish voice on an English story is keyed by the en-US voice it is read with', () => {
    const en = { ...story, language: 'en' };
    const params = buildSharedAudioParams(en, chirp, createSettingsStub(), true);
    expect(params.voiceId).toBe('en-US-Chirp3-HD-Achernar');
    // The en-US profile of the same narrator gets the same key.
    const enProfile = { ...chirp, voiceId: 'en-US-Chirp3-HD-Achernar', language: 'en-US' };
    expect(sharedAudioKey(buildSharedAudioParams(en, enProfile, createSettingsStub(), true))).toBe(
      sharedAudioKey(params),
    );
  });

  it('a non-Chirp Google voice keys on the pitch too', () => {
    const wavenet = { ...chirp, voiceId: 'tr-TR-Wavenet-A' };
    expect(buildSharedAudioParams(story, wavenet, createSettingsStub({ 'tts.google.pitch': 2 }), true).pitch).toBe(2);
  });

  it('the key is stable and changes with every parameter that changes the audio', () => {
    const settings = createSettingsStub();
    const base = buildSharedAudioParams(story, chirp, settings, true);
    const key = sharedAudioKey(base);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(sharedAudioKey({ ...base })).toBe(key);
    // Key order does not matter.
    const reversed = Object.fromEntries(Object.entries(base).reverse()) as typeof base;
    expect(sharedAudioKey(reversed)).toBe(key);

    const variants = [
      buildSharedAudioParams({ ...story, segmentationVersion: 4 }, chirp, settings, true),
      buildSharedAudioParams({ ...story, content: 'Başka metin.' }, chirp, settings, true),
      buildSharedAudioParams(story, { ...chirp, voiceId: 'tr-TR-Chirp3-HD-Aoede' }, settings, true),
      buildSharedAudioParams(story, chirp, createSettingsStub({ 'tts.google.speakingRate': 1.1 }), true),
      buildSharedAudioParams(story, chirp, createSettingsStub({ 'tts.groupSegments': false }), true),
      buildSharedAudioParams(story, chirp, settings, false),
      { ...base, cacheVersion: base.cacheVersion + 1 },
    ];
    for (const v of variants) expect(sharedAudioKey(v)).not.toBe(key);
  });

  it('withSegmentationVersion moves a lazy key onto the stored version', () => {
    const settings = createSettingsStub();
    const lazy = buildSharedAudioParams({ ...story, segmentationVersion: 0 }, chirp, settings, false);
    const stored = buildSharedAudioParams({ ...story, segmentationVersion: 1 }, chirp, settings, true);
    expect(sharedAudioKey(withSegmentationVersion(lazy, 1))).toBe(sharedAudioKey(stored));
  });

  it('storage prefix: shared audio under shared-audio/, owned audio unchanged', () => {
    expect(audioStoragePrefix({ id: 'a1', shared: true })).toBe('shared-audio/a1');
    expect(audioStoragePrefix({ id: 'a1', shared: false })).toBe('audio/a1');
    expect(audioStoragePrefix({ id: 'a1' })).toBe('audio/a1');
  });
});
