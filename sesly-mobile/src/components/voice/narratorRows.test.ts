/**
 * The narrator list model of the Sesim tab: added narrators first, the rest
 * of the catalogue in its order, narrators added during this visit kept at
 * their catalogue position, and a stable avatar colour per voice.
 */

import type { AvailableGoogleVoice, VoiceProfile } from '../../models/VoiceProfile';
import { TTSProvider, VoiceProfileStatus } from '../../types/enums';
import {
  buildNarratorRows,
  narratorAvatarSlot,
  narratorAvatarSlotFor,
  presetPreviewKey,
} from './narratorRows';

const NAMES = ['Achernar', 'Aoede', 'Charon', 'Fenrir', 'Kore', 'Puck'];

function voice(name: string, locale = 'tr-TR'): AvailableGoogleVoice {
  const voiceId = `${locale}-Chirp3-HD-${name}`;
  return {
    id: voiceId,
    voiceId,
    name,
    language: locale === 'tr-TR' ? 'Turkish' : 'English',
    languageCode: locale,
    contentLanguage: locale.slice(0, 2),
    gender: 'female',
    description: '',
    provider: 'GOOGLE',
  };
}

function preset(id: string, voiceId: string, contentLanguage = 'tr'): VoiceProfile {
  return {
    id,
    name: voiceId.split('-').pop() ?? id,
    status: VoiceProfileStatus.READY,
    provider: TTSProvider.GOOGLE,
    voiceId,
    language: 'tr-TR',
    contentLanguage,
    sampleAudioUrl: null,
    errorMessage: null,
    voiceModelId: null,
    kind: 'PRESET',
    consentAt: null,
    createdAt: new Date(2026, 9, 1),
    updatedAt: new Date(2026, 9, 1),
  };
}

const catalogue = NAMES.map(name => voice(name));
const keys = (rows: ReturnType<typeof buildNarratorRows>) => rows.map(row => row.key);

describe('buildNarratorRows keepInPlace', () => {
  it('without the option, added narrators lead (the next visit order)', () => {
    const added = preset('vp-charon', catalogue[2].voiceId);
    expect(keys(buildNarratorRows([added], catalogue))).toEqual([
      'vp-charon',
      presetPreviewKey(catalogue[0]),
      presetPreviewKey(catalogue[1]),
      presetPreviewKey(catalogue[3]),
      presetPreviewKey(catalogue[4]),
      presetPreviewKey(catalogue[5]),
    ]);
  });

  it('a narrator added during the visit stays at its catalogue index', () => {
    const added = preset('vp-charon', catalogue[2].voiceId);
    const rows = buildNarratorRows([added], catalogue, 'tr', {
      keepInPlace: new Set(['vp-charon']),
    });
    expect(rows).toHaveLength(catalogue.length);
    expect(rows[2]).toEqual({ kind: 'added', key: 'vp-charon', profile: added });
    expect(rows[0].kind).toBe('catalogue');
    expect(rows[1].kind).toBe('catalogue');
    expect(rows[3].kind).toBe('catalogue');
  });

  it('earlier narrators still lead; only the ones added now stay in place', () => {
    const before = preset('vp-puck', catalogue[5].voiceId);
    const now = preset('vp-aoede', catalogue[1].voiceId);
    expect(
      keys(buildNarratorRows([before, now], catalogue, 'tr', { keepInPlace: new Set(['vp-aoede']) })),
    ).toEqual([
      'vp-puck',
      presetPreviewKey(catalogue[0]),
      'vp-aoede',
      presetPreviewKey(catalogue[2]),
      presetPreviewKey(catalogue[3]),
      presetPreviewKey(catalogue[4]),
    ]);
  });

  it('a kept narrator the catalogue does not list leads like any added one', () => {
    const unlisted = preset('vp-zephyr', 'tr-TR-Chirp3-HD-Zephyr');
    const rows = buildNarratorRows([unlisted], catalogue, 'tr', {
      keepInPlace: new Set(['vp-zephyr']),
    });
    expect(rows[0].key).toBe('vp-zephyr');
    expect(rows).toHaveLength(catalogue.length + 1);
  });

  it('a duplicate profile of the same voice is listed once in place and once leading', () => {
    const first = preset('vp-kore-1', catalogue[4].voiceId);
    const second = preset('vp-kore-2', catalogue[4].voiceId);
    const rows = buildNarratorRows([first, second], catalogue, 'tr', {
      keepInPlace: new Set(['vp-kore-1', 'vp-kore-2']),
    });
    expect(keys(rows).filter(key => key.startsWith('vp-kore'))).toEqual(['vp-kore-2', 'vp-kore-1']);
    expect(rows[5].key).toBe('vp-kore-1');
    // No catalogue row of Kore next to its added rows.
    expect(keys(rows)).not.toContain(presetPreviewKey(catalogue[4]));
  });

  it('the language filter applies to kept narrators too', () => {
    const english = preset('vp-en', 'en-US-Chirp3-HD-Achernar', 'en');
    const rows = buildNarratorRows([english], catalogue, 'tr', { keepInPlace: new Set(['vp-en']) });
    expect(keys(rows)).not.toContain('vp-en');
  });
});

describe('narratorAvatarSlotFor', () => {
  it('is the same for a voice before and after an add above it', () => {
    const aoede = 'tr-TR-Chirp3-HD-Aoede';
    const before = buildNarratorRows([], catalogue).map(row =>
      row.kind === 'catalogue' ? narratorAvatarSlotFor(row.voice.voiceId) : null,
    );
    const added = preset('vp-puck', catalogue[5].voiceId);
    const after = buildNarratorRows([added], catalogue);
    const aoedeAfter = after.find(row => row.kind === 'catalogue' && row.voice.voiceId === aoede);
    expect(aoedeAfter && aoedeAfter.kind === 'catalogue' && narratorAvatarSlotFor(aoedeAfter.voice.voiceId)).toBe(
      before[1],
    );
    // The index-based slot shifts with the add; the voice-based one does not.
    expect(narratorAvatarSlot(1)).not.toBe(narratorAvatarSlot(2));
    expect(narratorAvatarSlotFor(aoede)).toBe(narratorAvatarSlotFor(aoede));
  });

  it('spreads voices over the four colours and tolerates a missing id', () => {
    const slots = new Set(NAMES.map(name => narratorAvatarSlotFor(voice(name).voiceId)));
    expect(slots.size).toBeGreaterThan(1);
    for (const slot of slots) expect(['turk', 'dunya', 'egitici', 'uyku']).toContain(slot);
    expect(narratorAvatarSlotFor(null)).toBe(narratorAvatarSlotFor(''));
    expect(narratorAvatarSlotFor(undefined)).toBe(narratorAvatarSlotFor(''));
  });
});
