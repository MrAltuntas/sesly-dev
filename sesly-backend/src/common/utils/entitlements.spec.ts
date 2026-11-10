import { extractStorageKey } from './storage-key';
import { resolveEffectivePlan, STORE_RENEWAL_GRACE_MS } from './subscription-plan';
import { isPremiumVoice } from './voice-tier';
import { canCreateVoiceProfile, getTotalVoiceSlots, VOICE_SLOTS } from '../constants/voice-slots.constants';

describe('extractStorageKey', () => {
  it.each([
    ['voice-samples/u/p.mp3', 'voice-samples/u/p.mp3'],
    ['gs://sesly-bucket/audio/a/full.mp3', 'audio/a/full.mp3'],
    ['https://storage.googleapis.com/sesly-bucket/avatars/u/1-me.jpg', 'avatars/u/1-me.jpg'],
    ['https://storage.googleapis.com/sesly-bucket/avatars/u/my%20photo.jpg', 'avatars/u/my photo.jpg'],
    ['https://sesly-bucket.storage.googleapis.com/stories/cover/x.png', 'stories/cover/x.png'],
    ['https://storage.googleapis.com/sesly-bucket/audio/a/full.mp3?X-Goog-Signature=abc', 'audio/a/full.mp3'],
  ])('%s -> %s', (input, expected) => {
    expect(extractStorageKey(input)).toBe(expected);
  });

  it.each([
    [null],
    [''],
    ['https://lh3.googleusercontent.com/a/photo.jpg'],
    ['https://s3.amazonaws.com/other-bucket/x.jpg'],
  ])('returns null for %s', (input) => {
    expect(extractStorageKey(input as any)).toBeNull();
  });
});

describe('resolveEffectivePlan', () => {
  const now = new Date('2026-09-27T12:00:00Z');
  const past = new Date('2026-09-20T12:00:00Z');
  const future = new Date('2026-10-20T12:00:00Z');

  it('no subscription -> FREE', () => {
    expect(resolveEffectivePlan(null, now)).toBe('FREE');
  });

  it('active paid plan without end date -> plan', () => {
    expect(resolveEffectivePlan({ plan: 'CREATOR', status: 'ACTIVE' }, now)).toBe('CREATOR');
  });

  it('admin grant within period -> plan', () => {
    expect(
      resolveEffectivePlan({ plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: future }, now),
    ).toBe('PRO');
  });

  it('admin grant past currentPeriodEnd -> FREE (no grace without store billing)', () => {
    expect(
      resolveEffectivePlan({ plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: past }, now),
    ).toBe('FREE');
  });

  it('store-billed subscription keeps a renewal grace window', () => {
    const justExpired = new Date(now.getTime() - STORE_RENEWAL_GRACE_MS / 2);
    expect(
      resolveEffectivePlan(
        { plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: justExpired, appleTransactionId: 't' },
        now,
      ),
    ).toBe('PRO');
    expect(
      resolveEffectivePlan(
        { plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: past, appleTransactionId: 't' },
        now,
      ),
    ).toBe('FREE');
  });

  it('EXPIRED status -> FREE', () => {
    expect(resolveEffectivePlan({ plan: 'PRO', status: 'EXPIRED' }, now)).toBe('FREE');
  });
});

describe('isPremiumVoice', () => {
  it.each([
    [{ provider: 'CARTESIA', voiceId: 'abc' }, true],
    [{ provider: 'GOOGLE', voiceId: 'tr-TR-Chirp3-HD-Achernar' }, false],
    [{ provider: 'GOOGLE', voiceId: 'tr-TR-Chirp3-HD-Achernar', kind: 'CLONE' }, true],
    [{ provider: 'GOOGLE', voiceId: 'tr-TR-Wavenet-A' }, false],
    [{ provider: 'GOOGLE', voiceId: 'x', voiceCloningKey: 'key' }, true],
  ])('%j -> %s', (voice, expected) => {
    expect(isPremiumVoice(voice)).toBe(expected);
  });
});

describe('voice slots', () => {
  it('covers FREE, PRO and CREATOR with CREATOR >= PRO', () => {
    expect(VOICE_SLOTS.CREATOR).toBeGreaterThanOrEqual(VOICE_SLOTS.PRO);
    expect(getTotalVoiceSlots('CREATOR')).toBe(VOICE_SLOTS.CREATOR);
    expect(getTotalVoiceSlots('PRO', 5)).toBe(VOICE_SLOTS.PRO + 5);
    expect(getTotalVoiceSlots('UNKNOWN')).toBe(VOICE_SLOTS.FREE);
  });

  it('canCreate is true only below the limit', () => {
    expect(canCreateVoiceProfile('FREE', 0, VOICE_SLOTS.FREE - 1)).toBe(true);
    expect(canCreateVoiceProfile('FREE', 0, VOICE_SLOTS.FREE)).toBe(false);
  });
});
