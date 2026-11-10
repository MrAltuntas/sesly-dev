/**
 * pickInitialNarrator: which narrator a story page starts with
 * (docs/release-pass/PLAN.json W2-detail, ux-7). The rest of models/Narrator
 * is covered in components/detail/detail.test.tsx.
 */

import { NarrationForPick, narratorsForStory, pickInitialNarrator } from './Narrator';
import { VoiceProfile } from './VoiceProfile';
import { NarrationStatus, TTSProvider, VoiceProfileStatus } from '../types/enums';

function voice(id: string, kind: 'CLONE' | 'PRESET', language = 'tr', status = VoiceProfileStatus.READY): VoiceProfile {
  return {
    id,
    name: id,
    status,
    provider: kind === 'CLONE' ? TTSProvider.CARTESIA : TTSProvider.GOOGLE,
    voiceId: `${id}-voice`,
    language: language === 'tr' ? 'tr-TR' : 'en-US',
    contentLanguage: language,
    sampleAudioUrl: null,
    errorMessage: null,
    voiceModelId: null,
    kind,
    consentAt: null,
    createdAt: new Date(2026, 9, 1),
    updatedAt: new Date(2026, 9, 1),
  };
}

function narration(
  voiceProfileId: string | null,
  status: NarrationStatus,
  createdAt: string,
  completedAt: string | null = null,
): NarrationForPick {
  return {
    voiceProfileId,
    status,
    createdAt: new Date(createdAt),
    completedAt: completedAt ? new Date(completedAt) : null,
  };
}

const OWN = voice('own', 'CLONE');
const DENIZ = voice('deniz', 'PRESET');
const AYLA = voice('ayla', 'PRESET');
const EMMA = voice('emma', 'PRESET', 'en');
const OWN_EN = voice('own-en', 'CLONE', 'en');

const pick = (
  profiles: VoiceProfile[],
  rest: Partial<Omit<Parameters<typeof pickInitialNarrator>[0], 'narrators'>> = {},
  storyLanguage = 'tr',
) =>
  pickInitialNarrator({
    narrators: narratorsForStory(profiles, storyLanguage),
    narrations: rest.narrations ?? [],
    lastNarratorId: rest.lastNarratorId,
    cloneNarrationsRemaining: rest.cloneNarrationsRemaining,
  });

describe('pickInitialNarrator', () => {
  it('has nothing to pick without a usable voice', () => {
    expect(pick([])).toBeNull();
    expect(pick([voice('wip', 'CLONE', 'tr', VoiceProfileStatus.PROCESSING)])).toBeNull();
    // A READY narration of a voice that is gone does not invent one.
    expect(pick([], { narrations: [narration('gone', NarrationStatus.READY, '2026-10-01')] })).toBeNull();
  });

  it('1: the voice of the newest READY narration of the story wins', () => {
    const narrations = [
      narration('deniz', NarrationStatus.READY, '2026-10-01T10:00:00Z'),
      // Newer by its completion, though created earlier.
      narration('ayla', NarrationStatus.READY, '2026-09-30T10:00:00Z', '2026-10-02T10:00:00Z'),
      // Not ready: neither a failed nor a running one counts.
      narration('own', NarrationStatus.GENERATING, '2026-10-05T10:00:00Z'),
      narration('own', NarrationStatus.FAILED, '2026-10-06T10:00:00Z'),
    ];
    expect(pick([OWN, DENIZ, AYLA], { narrations, lastNarratorId: 'deniz' })).toBe('ayla');
  });

  it('1: listening to a ready own-voice narration costs nothing, so a used-up allowance does not matter', () => {
    const narrations = [narration('own', NarrationStatus.READY, '2026-10-01')];
    expect(pick([OWN, DENIZ], { narrations, cloneNarrationsRemaining: 0 })).toBe('own');
  });

  it('1: a READY narration of a voice the user no longer has is skipped', () => {
    const narrations = [
      narration('deleted', NarrationStatus.READY, '2026-10-03'),
      narration('deniz', NarrationStatus.READY, '2026-10-01'),
      narration(null, NarrationStatus.READY, '2026-10-04'),
    ];
    expect(pick([OWN, DENIZ], { narrations })).toBe('deniz');
  });

  it('2: then the narrator chosen last, when it is still there', () => {
    expect(pick([OWN, DENIZ, AYLA], { lastNarratorId: 'ayla' })).toBe('ayla');
    // A voice of another language still reads the story (it is in the list).
    expect(pick([OWN, DENIZ, EMMA], { lastNarratorId: 'emma' })).toBe('emma');
    // Gone (deleted, or another account's): the next rule decides.
    expect(pick([OWN, DENIZ], { lastNarratorId: 'missing' })).toBe('own');
  });

  it('2: the own voice chosen last is passed over while its allowance is used up', () => {
    expect(pick([OWN, DENIZ], { lastNarratorId: 'own', cloneNarrationsRemaining: 0 })).toBe('deniz');
    // Some left, unlimited or unknown: it stays.
    expect(pick([OWN, DENIZ], { lastNarratorId: 'own', cloneNarrationsRemaining: 2 })).toBe('own');
    expect(pick([OWN, DENIZ], { lastNarratorId: 'own', cloneNarrationsRemaining: null })).toBe('own');
    expect(pick([OWN, DENIZ], { lastNarratorId: 'own' })).toBe('own');
  });

  it('3: else the first narrator, the story language first, own voices first', () => {
    expect(pick([DENIZ, OWN])).toBe('own');
    expect(pick([OWN_EN, DENIZ])).toBe('deniz');
    expect(pick([EMMA, OWN_EN])).toBe('own-en');
    expect(pick([OWN, EMMA], {}, 'en')).toBe('emma');
  });

  it('3: skips own voices while their allowance is used up, and keeps one when it is all there is', () => {
    expect(pick([OWN, OWN_EN, DENIZ], { cloneNarrationsRemaining: 0 })).toBe('deniz');
    expect(pick([OWN, EMMA], { cloneNarrationsRemaining: 0 })).toBe('emma');
    // Only own voices: the first stays, the story page explains the limit.
    expect(pick([OWN, OWN_EN], { cloneNarrationsRemaining: 0 })).toBe('own');
  });
});
