import { isPremiumVoice } from './voice-tier';

// Core cases live in entitlements.spec.ts; this file locks the rest of the matrix.
describe('isPremiumVoice', () => {
  it.each([
    // every clone is premium, regardless of provider
    [{ provider: 'GOOGLE', voiceId: 'tr-TR-Standard-A', kind: 'CLONE' }, true],
    [{ provider: 'CARTESIA', kind: 'CLONE' }, true],
    // Cartesia is clone-only, so a Cartesia voice is a clone (provider is case-insensitive)
    [{ provider: 'cartesia', voiceId: null }, true],
    [{ provider: 'Cartesia', kind: 'READY_MADE' }, true],
    // legacy rows: a cloning key means clone
    [{ provider: 'GOOGLE', voiceId: 'tr-TR-Standard-A', voiceCloningKey: 'k' }, true],
    // ready-made voices are free for everyone, whatever the family
    [{ provider: 'GOOGLE', voiceId: 'tr-TR-Chirp3-HD-Achernar' }, false],
    [{ provider: 'GOOGLE', voiceId: 'tr-TR-Chirp3-HD-Achernar', kind: 'PRESET' }, false],
    [{ provider: 'GOOGLE', voiceId: 'en-US-Chirp3-HD-Kore', kind: 'PRESET' }, false],
    [{ provider: 'GOOGLE', voiceId: 'en-US-Studio-HD-O' }, false],
    [{ provider: 'GOOGLE', voiceId: 'en-US-Chirp-HD-F' }, false],
    [{ provider: 'GOOGLE', voiceId: 'tr-TR-Standard-A' }, false],
    [{ provider: 'GOOGLE', voiceId: 'tr-TR-Wavenet-E', kind: 'READY_MADE' }, false],
    [{ provider: 'GOOGLE', voiceId: 'tr-TR-Neural2-A' }, false],
    // missing data
    [{ provider: 'GOOGLE', voiceId: null, voiceCloningKey: null }, false],
    [{ provider: 'GOOGLE' }, false],
    [{ provider: '' }, false],
    [{ provider: 'GOOGLE', voiceId: 'x', voiceCloningKey: '' }, false],
  ])('%j -> %s', (voice, expected) => {
    expect(isPremiumVoice(voice)).toBe(expected);
  });

  it('tolerates a missing provider', () => {
    expect(isPremiumVoice({ provider: undefined as unknown as string, voiceId: 'tr-TR-Standard-A' })).toBe(false);
  });
});
