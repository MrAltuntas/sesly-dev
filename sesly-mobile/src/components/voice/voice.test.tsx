/**
 * Pieces of the Sesim tab (design/v4/playful, frame e): the narrator list
 * model, the formatters, the own-voice slot, the "Ses ekle" row, the
 * allowance card and the narrator row, in several palettes.
 */

import React from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { LIP, RADIUS, themes } from '../../theme/theme';
import { PRESS_DELAY_MS } from '../../theme/motion';
import { RowSkeleton } from '../design';
import { AvailableGoogleVoice, VoiceProfile } from '../../models/VoiceProfile';
import { TTSProvider, VoiceProfileStatus } from '../../types/enums';
import {
  addedNarrators,
  buildNarratorRows,
  narratorAvatarSlot,
  narratorFilterLanguages,
  narratorLine,
  voiceLanguageName,
  voiceGenderLabel,
  ownVoices,
  presetPreviewKey,
  recordedOnLabel,
  sampleDurationLabel,
  waveformSeed,
} from './narratorRows';
import {
  EMPTY_VOICE_SLOT_HEIGHT,
  EmptyVoiceSlot,
  EmptyVoiceSlotSkeleton,
  NarratorRow,
  NarratorRowSkeleton,
  OWN_VOICE_SLOT_HEIGHT,
  OwnVoiceLimitsCard,
  OwnVoiceSlot,
  OwnVoiceSlotSkeleton,
  VoiceAvatar,
  narratorSlotsLine,
} from './VoiceCards';
import type { OwnVoiceLimits } from './cloneAllowance';

jest.setTimeout(60000);


const t = i18n.t.bind(i18n) as (key: string, options?: Record<string, unknown>) => string;

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

function profile(id: string, name: string, patch: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    id,
    name,
    status: VoiceProfileStatus.READY,
    provider: TTSProvider.CARTESIA,
    voiceId: `voice-${id}`,
    language: 'tr',
    contentLanguage: 'tr',
    sampleAudioUrl: null,
    errorMessage: null,
    voiceModelId: null,
    kind: 'CLONE',
    consentAt: null,
    createdAt: new Date(2026, 9, 12, 10, 0, 0),
    updatedAt: new Date(2026, 9, 12, 10, 0, 0),
    ...patch,
  };
}

// `_legacyPremium` is what the old catalogue called a premium voice. It no
// longer changes anything: every ready-made narrator is free.
function preset(name: string, _legacyPremium: boolean, languageCode = 'tr-TR'): AvailableGoogleVoice {
  const voiceId = `${languageCode}-Chirp3-HD-${name}`;
  return {
    id: voiceId,
    voiceId,
    name,
    language: 'Turkish',
    languageCode,
    contentLanguage: languageCode.slice(0, 2).toLowerCase(),
    gender: 'female',
    description: '',
    provider: 'GOOGLE',
  };
}

describe('narrator list model', () => {
  const zeynep = profile('vp-1', 'Zeynep');
  const cem = preset('Cem', false);
  const addedCem = profile('vp-2', 'Cem', {
    kind: 'PRESET',
    provider: TTSProvider.GOOGLE,
    voiceId: cem.voiceId,
    language: 'tr-TR',
  });
  const catalogue = [preset('Ada', true), cem, preset('Bora', true), preset('Deniz', false)];

  it('separates own voices from added narrators', () => {
    expect(ownVoices([zeynep, addedCem]).map(p => p.id)).toEqual(['vp-1']);
    expect(addedNarrators([zeynep, addedCem]).map(p => p.id)).toEqual(['vp-2']);
  });

  it('lists added narrators first and each catalogue voice once', () => {
    const rows = buildNarratorRows([zeynep, addedCem], catalogue);
    expect(rows.map(row => (row.kind === 'added' ? `+${row.profile.name}` : row.voice.name))).toEqual([
      '+Cem',
      'Ada',
      'Bora',
      'Deniz',
    ]);
    expect(rows[1].key).toBe(presetPreviewKey(catalogue[0]));
  });

  it('keeps the backend order: no plan decides it, every narrator is free', () => {
    const names = buildNarratorRows([], catalogue).map(row =>
      row.kind === 'catalogue' ? row.voice.name : '',
    );
    expect(names).toEqual(['Ada', 'Cem', 'Bora', 'Deniz']);
  });

  it('describes a narrator by its language and the gender of the voice', () => {
    expect(narratorLine(preset('Ada', false))).toBe('Türkçe, kadın sesi');
    expect(narratorLine({ ...preset('Orus', false, 'en-US'), gender: 'male' })).toBe(
      'English, erkek sesi',
    );
    // An added profile carries no gender: the language alone.
    expect(narratorLine({ name: 'Ada', languageCode: 'tr-TR' })).toBe('Türkçe');
    expect(voiceGenderLabel('UNKNOWN')).toBe('');
    expect(voiceGenderLabel(null)).toBe('');
  });

  it('keeps an added narrator that left the catalogue', () => {
    const rows = buildNarratorRows([addedCem], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('added');
  });
});

describe('formatters', () => {
  it('names the language of the voice in its own name; the description placeholder adds nothing', () => {
    expect(narratorLine({ name: 'Cem', languageCode: 'tr-TR' }, t)).toBe('Türkçe');
    expect(narratorLine({ name: 'Emma', languageCode: 'en-US' }, t)).toBe('English');
    expect(narratorLine({ name: 'Emma', languageCode: '' }, t)).toBe('');
    // The content language of a voice profile wins over a locale.
    expect(narratorLine({ name: 'Emma', contentLanguage: 'en', languageCode: 'tr-TR' }, t)).toBe(
      'English',
    );
    expect(voiceLanguageName('tr')).toBe('Türkçe');
    expect(voiceLanguageName('en-US')).toBe('English');
    expect(voiceLanguageName(null)).toBe('');
  });

  it('filters the added narrators by the language of the filter', () => {
    const emma = profile('emma', 'Emma', {
      kind: 'PRESET',
      provider: TTSProvider.GOOGLE,
      voiceId: 'en-US-Chirp3-HD-Emma',
      language: 'en-US',
      contentLanguage: 'en',
    });
    const ada = profile('ada', 'Ada', {
      kind: 'PRESET',
      provider: TTSProvider.GOOGLE,
      voiceId: 'tr-TR-Chirp3-HD-Ada',
      language: 'tr-TR',
    });
    const own = profile('own', 'Annem');
    const keys = (language?: string | null) =>
      buildNarratorRows([own, emma, ada], [], language).map(row => row.key);
    // Without a language every added narrator is listed (never an own voice).
    expect(keys()).toEqual(['emma', 'ada']);
    expect(keys(null)).toEqual(['emma', 'ada']);
    expect(keys('en')).toEqual(['emma']);
    expect(keys('tr-TR')).toEqual(['ada']);
    expect(keys('de')).toEqual([]);

    // The filter offers the content languages, then the language of an added
    // narrator that is not among them; own voices add nothing.
    expect(narratorFilterLanguages(['tr', 'de'], [own, emma, ada])).toEqual(['tr', 'de', 'en']);
    expect(narratorFilterLanguages(['TR', 'tr-TR', 'en'], [])).toEqual(['tr', 'en']);
    expect(narratorFilterLanguages([], [own])).toEqual([]);
  });

  it('writes the recording date with the month name', () => {
    expect(recordedOnLabel(new Date(2026, 9, 12), t)).toBe('12 Ekim kaydı');
    expect(recordedOnLabel(new Date('nope'), t)).toBe('');
    expect(recordedOnLabel(null, t)).toBe('');
  });

  it('writes the English recording date in lower case, as it follows the language', async () => {
    await i18n.changeLanguage('en');
    try {
      const label = recordedOnLabel(new Date(2026, 9, 12), t);
      expect(label).toBe('recorded October 12');
      expect([voiceLanguageName('en'), label].join(', ')).toBe('English, recorded October 12');
    } finally {
      await i18n.changeLanguage('tr');
    }
  });

  it('formats a sample length and hides an unknown one', () => {
    expect(sampleDurationLabel(12300)).toBe('0:12');
    expect(sampleDurationLabel(65000)).toBe('1:05');
    expect(sampleDurationLabel(0)).toBe('');
    expect(sampleDurationLabel(undefined)).toBe('');
  });

  it('derives a stable positive waveform seed', () => {
    expect(waveformSeed('vp-1')).toBe(waveformSeed('vp-1'));
    expect(waveformSeed('vp-1')).toBeGreaterThan(0);
    expect(waveformSeed('')).toBe(1);
  });
});

describe('narratorSlotsLine', () => {
  it('names the places of the list, says what to do when it is full, and nothing while unknown', async () => {
    expect(narratorSlotsLine({ used: 1, limit: 3 }, t)).toBe('Listende 1/3 anlatıcı var.');
    expect(narratorSlotsLine({ used: 3, limit: 3 }, t)).toBe(
      'Listen dolu (3/3). Yeni bir anlatıcı için önce birini kaldır.',
    );
    // More than the plan's places (a downgrade) still reads as full.
    expect(narratorSlotsLine({ used: 5, limit: 3 }, t)).toMatch(/^Listen dolu \(5\/3\)/);
    expect(narratorSlotsLine(null, t)).toBeNull();
    expect(narratorSlotsLine(undefined, t)).toBeNull();
    // A backend without a preset limit says nothing.
    expect(narratorSlotsLine({ used: 0, limit: 0 }, t)).toBeNull();
    await i18n.changeLanguage('en');
    try {
      expect(narratorSlotsLine({ used: 1, limit: 10 }, t)).toBe('Your list has 1/10 narrators.');
    } finally {
      await i18n.changeLanguage('tr');
    }
  });
});

describe('narratorAvatarSlot', () => {
  it('cycles the four category colours so neighbours never match', () => {
    expect([0, 1, 2, 3, 4].map(narratorAvatarSlot)).toEqual([
      'turk',
      'dunya',
      'egitici',
      'uyku',
      'turk',
    ]);
    expect(narratorAvatarSlot(-1)).toBe('dunya');
    expect(narratorAvatarSlot(Number.NaN)).toBe('turk');
  });
});

describe('OwnVoiceSlot', () => {
  const handlers = () => ({
    onToggleSample: jest.fn(),
    onDelete: jest.fn(),
    onRetry: jest.fn(),
  });

  it('a ready voice: the name, "Varsayılan", the language and day with the length, the sample and delete', () => {
    const h = handlers();
    renderWithProviders(
      <OwnVoiceSlot
        id="vp-1"
        name="Annemin sesi"
        state="ready"
        isDefault
        recordedLabel="Türkçe, 12 Ekim kaydı"
        durationLabel="0:12"
        {...h}
      />,
    );
    expect(screen.getByText('Annemin sesi')).toBeOnTheScreen();
    expect(screen.getByText('Varsayılan')).toBeOnTheScreen();
    // A ready voice needs no state tag.
    expect(screen.queryByText('Hazır')).toBeNull();
    expect(screen.getByText('Türkçe, 12 Ekim kaydı, 0:12')).toBeOnTheScreen();
    // Nothing invites a new recording from a voice.
    expect(screen.queryByText('Yeni ses kaydet')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Annemin sesi örneğini dinle' }));
    expect(h.onToggleSample).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole('button', { name: 'Annemin sesi sesini sil' }));
    expect(h.onDelete).toHaveBeenCalledTimes(1);
    expect(h.onRetry).not.toHaveBeenCalled();
  });

  it('is a compact row card: the slot height, 20dp corners, the 3dp own-voice lip, a 44dp mic tile', () => {
    renderWithProviders(<OwnVoiceSlot id="vp-1" name="Zeynep" state="ready" {...handlers()} />);
    expect(flatStyle(screen.getByTestId('own-voice-vp-1-face'))).toMatchObject({
      minHeight: OWN_VOICE_SLOT_HEIGHT,
      borderRadius: RADIUS.lg,
      overflow: 'hidden',
    });
    expect(flatStyle(screen.getByTestId('own-voice-vp-1-lip'))).toMatchObject({ top: LIP.md });
    expect(flatStyle(screen.getByTestId('own-voice-avatar-vp-1'))).toMatchObject({ width: 44 });
    // The tallest piece is the delete button's 48dp target, with 12dp above and below.
    expect(OWN_VOICE_SLOT_HEIGHT).toBe(72);
    expect(blockHeight(screen.getByTestId('own-voice-vp-1'))).toBe(OWN_VOICE_SLOT_HEIGHT + LIP.md);
  });

  it('offers stop while the sample plays and spins while it loads', () => {
    const { rerender } = renderWithProviders(
      <OwnVoiceSlot id="vp-1" name="Zeynep" state="ready" playing {...handlers()} />,
    );
    expect(screen.getByRole('button', { name: 'Zeynep örneğini durdur' })).toBeOnTheScreen();
    rerender(<OwnVoiceSlot id="vp-1" name="Zeynep" state="ready" loadingSample {...handlers()} />);
    expect(screen.getByTestId('own-voice-sample-vp-1-spinner')).toBeOnTheScreen();
  });

  it('has no "Varsayılan" tag unless it is the default', () => {
    renderWithProviders(<OwnVoiceSlot id="vp-1" name="Zeynep" state="ready" {...handlers()} />);
    expect(screen.queryByText('Varsayılan')).toBeNull();
  });

  it('a voice in preparation says so and has no sample button', () => {
    renderWithProviders(
      <OwnVoiceSlot id="vp-1" name="Zeynep" state="preparing" isDefault {...handlers()} />,
    );
    expect(screen.getByText('Hazırlanıyor')).toBeOnTheScreen();
    expect(screen.queryByText('Varsayılan')).toBeNull();
    expect(screen.queryByTestId('own-voice-sample-vp-1')).toBeNull();
    expect(screen.getByTestId('own-voice-delete-vp-1')).toBeOnTheScreen();
  });

  it('a failed voice gives the backend reason in the Turkish UI and offers "Tekrar dene"', () => {
    const h = handlers();
    renderWithProviders(
      <OwnVoiceSlot id="vp-1" name="Zeynep" state="failed" errorMessage="Ortam çok gürültülü" {...h} />,
    );
    expect(screen.getByText('Hazırlanamadı')).toBeOnTheScreen();
    expect(screen.getByTestId('own-voice-error-vp-1')).toHaveTextContent('Ortam çok gürültülü');
    fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(h.onRetry).toHaveBeenCalledTimes(1);
  });

  it("a failed voice without a reason says it in the app's words, and the English UI never shows the Turkish one", async () => {
    const { unmount } = renderWithProviders(
      <OwnVoiceSlot id="vp-1" name="Zeynep" state="failed" errorMessage={null} {...handlers()} />,
    );
    expect(screen.getByTestId('own-voice-error-vp-1')).toHaveTextContent(t('voiceFlow:processing.failedMessage'));
    unmount();
    await i18n.changeLanguage('en');
    try {
      renderWithProviders(
        <OwnVoiceSlot id="vp-1" name="Zeynep" state="failed" errorMessage="Ortam çok gürültülü" {...handlers()} />,
      );
      expect(screen.queryByText('Ortam çok gürültülü')).toBeNull();
    } finally {
      await act(() => i18n.changeLanguage('tr'));
    }
  });

  it('a recording that never arrived says so and starts over through "Baştan başla"', () => {
    const h = handlers();
    renderWithProviders(<OwnVoiceSlot id="vp-1" name="Zeynep" state="waiting" {...h} />);
    expect(screen.getByText('Beklemede')).toBeOnTheScreen();
    expect(screen.getByTestId('own-voice-waiting-vp-1')).toHaveTextContent(t('voices:own.waitingNote'));
    fireEvent.press(screen.getByRole('button', { name: 'Baştan başla' }));
    expect(h.onRetry).toHaveBeenCalledTimes(1);
  });

  it.each(['gece-mavisi', 'kitaplik', 'erik'] as const)('is a plain row card in the %s palette, the mic in the own colour', scheme => {
    renderWithProviders(<OwnVoiceSlot id="vp-1" name="Zeynep" state="ready" isDefault {...handlers()} />, {
      theme: scheme,
    });
    const T = themes[scheme];
    // The face and lip of the narrator rows, not the own-voice wash.
    expect(flatStyle(screen.getByTestId('own-voice-vp-1-face')).backgroundColor).toBe(T.surface);
    expect(flatStyle(screen.getByTestId('own-voice-vp-1-lip')).backgroundColor).toBe(T.lip);
    // The quiet own-voice mark: a neutral tile with the mic in the own colour, no lip of its own.
    expect(flatStyle(screen.getByTestId('own-voice-avatar-vp-1')).backgroundColor).toBe(T.surface2);
    const mic = within(screen.getByTestId('own-voice-avatar-vp-1'))
      .getByTestId('icon-mic', { includeHiddenElements: true })
      .findAll((node: { type: unknown }) => node.type === 'Text')[0];
    expect(flatStyle(mic).color).toBe(T.own);
    expect(screen.queryByTestId('own-voice-avatar-vp-1-lip', { includeHiddenElements: true })).toBeNull();
    expect(flatStyle(screen.getByTestId('own-voice-default-vp-1')).backgroundColor).toBe(T.chipActBg);
    expect(flatStyle(screen.getByText('Varsayılan')).color).toBe(T.chipActFg);
    // The sample button is the neutral circle of the narrator rows.
    expect(flatStyle(screen.getByTestId('own-voice-sample-vp-1-face'))).toMatchObject({
      width: 42,
      backgroundColor: T.surface2,
    });
  });
});

describe('OwnVoiceSlot has no glow (owner feedback)', () => {
  const noop = () => undefined;
  const states = ['ready', 'preparing', 'failed', 'waiting'] as const;

  it.each(states)('a %s slot draws no gradient, shine, wash, shadow or ring', state => {
    renderWithProviders(
      <OwnVoiceSlot id="vp-1" name="Zeynep" state={state} isDefault onToggleSample={noop} onDelete={noop} onRetry={noop} />,
    );
    const T = themes['gece-mavisi'];
    expect(screen.UNSAFE_queryAllByType(LinearGradient)).toHaveLength(0);
    expect(screen.queryByTestId('own-voice-vp-1-gradient', { includeHiddenElements: true })).toBeNull();
    const face = flatStyle(screen.getByTestId('own-voice-vp-1-face'));
    expect([T.ownA, T.ownB, T.ownC, T.own]).not.toContain(face.backgroundColor);
    for (const key of ['shadowColor', 'shadowOpacity', 'shadowRadius', 'elevation', 'borderWidth', 'boxShadow']) {
      expect(face[key]).toBeUndefined();
    }
    // Every layer under the face is the slot's own content: no absolute
    // overlay (a highlight left over from the old hero card).
    const layers = hostChildren(screen.getByTestId('own-voice-vp-1-face'));
    for (const layer of layers) expect(flatStyle(layer).position).not.toBe('absolute');
  });

  it('looks like a narrator row: the same face, lip and corners', () => {
    renderWithProviders(
      <>
        <OwnVoiceSlot id="vp-1" name="Zeynep" state="ready" onToggleSample={noop} onDelete={noop} onRetry={noop} />
        <NarratorRow id="v-1" name="Ada" line="Türkçe" added onTogglePreview={noop} />
      </>,
    );
    const pick = (id: string) => {
      const { backgroundColor, borderRadius } = flatStyle(screen.getByTestId(id));
      return { backgroundColor, borderRadius };
    };
    expect(pick('own-voice-vp-1-face')).toEqual(pick('narrator-v-1-face'));
    expect(pick('own-voice-vp-1-lip')).toEqual(pick('narrator-v-1-lip'));
  });
});

describe('EmptyVoiceSlot', () => {
  it('"Ses ekle": a modest dashed row with what a recording takes; the whole row opens the flow', () => {
    const onAdd = jest.fn();
    renderWithProviders(<EmptyVoiceSlot seconds={30} block={null} onAdd={onAdd} />);
    const row = screen.getByRole('button', { name: 'Ses ekle, Yaklaşık 30 saniyelik bir kayıt yeterli.' });
    fireEvent.press(row);
    expect(onAdd).toHaveBeenCalledTimes(1);
    const face = hostChildren(screen.getByTestId('own-voice-add-slot'))[0];
    // No fill and no lip: never a call to action of its own.
    expect(flatStyle(face)).toMatchObject({
      borderStyle: 'dashed',
      minHeight: EMPTY_VOICE_SLOT_HEIGHT,
      borderRadius: RADIUS.lg,
    });
    expect(flatStyle(face).backgroundColor).toBeUndefined();
    expect(screen.queryByTestId('own-voice-add-slot-lip')).toBeNull();
    expect(screen.queryByText('Planları gör')).toBeNull();
  });

  it('blocked: the lock and why, "Planları gör" when a bigger plan helps, and the row opens nothing', () => {
    const onAdd = jest.fn();
    const onSeePlans = jest.fn();
    renderWithProviders(
      <EmptyVoiceSlot seconds={30} block="Ses yuvaların dolu." onAdd={onAdd} onSeePlans={onSeePlans} />,
    );
    expect(screen.getByTestId('own-voice-add-block')).toHaveTextContent('Ses yuvaların dolu.');
    expect(screen.getByTestId('icon-lock', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Ses ekle/ })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Planları gör' }));
    expect(onSeePlans).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('blocked with no bigger plan: the reason alone', () => {
    renderWithProviders(
      <EmptyVoiceSlot seconds={30} block="Ses yuvaların dolu. Yeni bir ses için önce birini sil." onAdd={jest.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Planları gör' })).toBeNull();
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('draws its dash in the line colour in %s', scheme => {
    renderWithProviders(<EmptyVoiceSlot seconds={30} block={null} onAdd={jest.fn()} />, { theme: scheme });
    const T = themes[scheme];
    expect(flatStyle(hostChildren(screen.getByTestId('own-voice-add-slot'))[0]).borderColor).toBe(T.line);
  });

  it('its skeleton and the filled slot skeleton keep the rows\' heights', () => {
    renderWithProviders(
      <>
        <OwnVoiceSlotSkeleton />
        <EmptyVoiceSlotSkeleton />
      </>,
    );
    const rows = screen.UNSAFE_getAllByType(RowSkeleton);
    expect(rows[0].props).toMatchObject({ height: OWN_VOICE_SLOT_HEIGHT, radius: RADIUS.lg, lip: LIP.md });
    expect(blockHeight(screen.getByTestId('own-voice-add-skeleton'))).toBe(EMPTY_VOICE_SLOT_HEIGHT);
  });
});

describe('OwnVoiceLimitsCard', () => {
  const limits = (patch: Partial<OwnVoiceLimits> = {}): OwnVoiceLimits => ({
    slots: { used: 1, limit: 3 },
    creations: { used: 2, limit: 5, period: 'month', renewsAt: new Date(2026, 10, 1) },
    ...patch,
  });

  it('"Ses yuvası 1/3" and "Bu ay yeni ses hakkı 2/5", each with a bar, the renewal and no refund', () => {
    renderWithProviders(<OwnVoiceLimitsCard limits={limits()} />);
    expect(screen.getByText('Ses yuvası')).toBeOnTheScreen();
    expect(screen.getByTestId('own-voice-limits-slots-value')).toHaveTextContent('1/3');
    expect(screen.getByText('Bu ay yeni ses hakkı')).toBeOnTheScreen();
    expect(screen.getByTestId('own-voice-limits-creations-value')).toHaveTextContent('2/5');
    expect(screen.getByTestId('own-voice-limits-slots-bar').props.accessibilityValue.now).toBe(33);
    expect(screen.getByTestId('own-voice-limits-creations-bar').props.accessibilityValue.now).toBe(40);
    expect(screen.getByTestId('own-voice-limits-caption')).toHaveTextContent(
      "1 Kasım'da yenilenir. Bir sesi silmek yeni ses hakkını geri vermez.",
    );
    expect(screen.getByTestId('own-voice-limits-creations').props.accessibilityLabel).toBe(
      'Bu ay yeni ses hakkı, 5 haktan 2 tanesi kullanıldı',
    );
  });

  it('the free plan says "Toplam" and that it never renews', () => {
    renderWithProviders(
      <OwnVoiceLimitsCard
        limits={limits({
          slots: { used: 0, limit: 1 },
          creations: { used: 1, limit: 1, period: 'lifetime', renewsAt: null },
        })}
      />,
    );
    expect(screen.getByText('Toplam yeni ses hakkı')).toBeOnTheScreen();
    expect(screen.getByTestId('own-voice-limits-creations-value')).toHaveTextContent('1/1');
    expect(screen.getByTestId('own-voice-limits-caption')).toHaveTextContent(
      'Bu hak yenilenmez. Bir sesi silmek yeni ses hakkını geri vermez.',
    );
  });

  it('an unknown use shows the plan amount without a bar; an unlimited one says so', () => {
    const { rerender } = renderWithProviders(
      <OwnVoiceLimitsCard
        limits={limits({ creations: { used: null, limit: 2, period: 'month', renewsAt: null } })}
      />,
    );
    expect(screen.getByTestId('own-voice-limits-creations-value')).toHaveTextContent('2 hak');
    expect(screen.queryByTestId('own-voice-limits-creations-bar')).toBeNull();
    rerender(
      <OwnVoiceLimitsCard limits={limits({ creations: { used: 4, limit: null, period: 'month', renewsAt: null } })} />,
    );
    expect(screen.getByTestId('own-voice-limits-creations-value')).toHaveTextContent('Sınırsız');
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    try {
      renderWithProviders(<OwnVoiceLimitsCard limits={limits()} />);
      expect(screen.getByText('Voice slots')).toBeOnTheScreen();
      expect(screen.getByText('New voices this month')).toBeOnTheScreen();
      expect(screen.getByTestId('own-voice-limits-slots').props.accessibilityLabel).toBe('Voice slots, 1 of 3 in use');
    } finally {
      await act(() => i18n.changeLanguage('tr'));
    }
  });
});

type HostNode = ReturnType<typeof screen.getByTestId>;

/** The nearest host (native view) descendants of a node. */
function hostChildren(node: HostNode): HostNode[] {
  const out: HostNode[] = [];
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    if (typeof child.type === 'string') out.push(child);
    else out.push(...hostChildren(child));
  }
  return out;
}

/**
 * A column layout model of a rendered block, one line per text: fixed and
 * minimum heights, paddings, margins and gaps, a row as tall as its tallest
 * child, absolute layers left out. Two blocks built of the same pieces with
 * the same texts measure the same here exactly when they do on a phone.
 */
function blockHeight(node: HostNode): number {
  const style = flatStyle(node);
  if (style.position === 'absolute') return 0;
  const marginTop = style.marginTop ?? style.marginVertical ?? style.margin ?? 0;
  const marginBottom = style.marginBottom ?? style.marginVertical ?? style.margin ?? 0;
  let box: number;
  if (typeof style.height === 'number') {
    box = style.height;
  } else {
    const padTop = style.paddingTop ?? style.paddingVertical ?? style.padding ?? 0;
    const padBottom = style.paddingBottom ?? style.paddingVertical ?? style.padding ?? 0;
    let content: number;
    if (node.type === 'Text') {
      content = style.lineHeight ?? style.fontSize ?? 0;
    } else {
      const kids = hostChildren(node).filter(kid => flatStyle(kid).position !== 'absolute');
      const heights = kids.map(blockHeight);
      content =
        style.flexDirection === 'row'
          ? Math.max(0, ...heights)
          : heights.reduce((sum, height) => sum + height, 0) +
            (style.rowGap ?? style.gap ?? 0) * Math.max(0, kids.length - 1);
    }
    box = Math.max(style.minHeight ?? 0, padTop + content + padBottom);
  }
  return marginTop + box + marginBottom;
}

describe('VoiceAvatar', () => {
  it('uses the Turkish initial and the own colour for an own voice', () => {
    renderWithProviders(<VoiceAvatar name="irem" tone="accent" testID="avatar" />, {
      theme: 'gece-mavisi',
    });
    const T = themes['gece-mavisi'];
    expect(screen.getByText('İ', { includeHiddenElements: true })).toBeOnTheScreen();
    // The 40dp tile of a row card, on the 12dp corner of the scale.
    expect(
      flatStyle(screen.getByTestId('avatar-tile', { includeHiddenElements: true })),
    ).toMatchObject({ backgroundColor: T.own, width: 40, borderRadius: RADIUS.sm });
    expect(flatStyle(screen.getByText('İ', { includeHiddenElements: true })).color).toBe(T.onCat);
  });

  it('a tonal avatar without a colour is the raised surface with light text', () => {
    renderWithProviders(<VoiceAvatar name="Cem" testID="avatar" />, { theme: 'murekkep' });
    const T = themes.murekkep;
    expect(
      flatStyle(screen.getByTestId('avatar-tile', { includeHiddenElements: true })).backgroundColor,
    ).toBe(T.surface2);
    expect(flatStyle(screen.getByText('C', { includeHiddenElements: true })).color).toBe(T.text);
  });
});

describe('NarratorRow', () => {
  it('a catalogue narrator is added by its row and previewed by its button', () => {
    const onPress = jest.fn();
    const onTogglePreview = jest.fn();
    renderWithProviders(
      <NarratorRow
        id="v-1"
        name="Deniz"
        line="Türkçe, kadın sesi"
        languageCode="tr"
        onPress={onPress}
        onTogglePreview={onTogglePreview}
      />,
    );
    expect(screen.getByText('Türkçe, kadın sesi')).toBeOnTheScreen();
    expect(screen.getByText('TR')).toBeOnTheScreen();
    expect(screen.queryByText('Eklendi')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Deniz anlatıcısını ekle' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole('button', { name: 'Deniz örneğini dinle' }));
    expect(onTogglePreview).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('writes the code of a locale and draws no badge without one', () => {
    renderWithProviders(
      <>
        <NarratorRow id="v-1" name="Emma" line="English" languageCode="en-US" onTogglePreview={jest.fn()} />
        <NarratorRow id="v-2" name="Cem" line="" onTogglePreview={jest.fn()} />
      </>,
    );
    expect(screen.getByText('EN')).toBeOnTheScreen();
    expect(screen.queryByTestId('narrator-code-v-2')).toBeNull();
  });

  it('an added narrator is marked, removable and not addable again', () => {
    const onRemove = jest.fn();
    renderWithProviders(
      <NarratorRow
        id="vp-2"
        name="Cem"
        line="Türkçe"
        added
        onTogglePreview={jest.fn()}
        onRemove={onRemove}
      />,
      { theme: 'kitaplik' },
    );
    expect(screen.getByText('Eklendi')).toBeOnTheScreen();
    expect(flatStyle(screen.getByText('Eklendi')).color).toBe(themes.kitaplik.chipOkFg);
    // The state and the line read as one: "Eklendi, Türkçe".
    expect(screen.getByText('Eklendi, Türkçe')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Cem anlatıcısını ekle' })).toBeNull();
    // Only an addable row has the plus.
    expect(screen.queryByTestId('narrator-plus-vp-2')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Cem anlatıcısını kaldır' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('an addable row shows its plus; while it is being added it takes no taps and its plus spins', () => {
    const onPress = jest.fn();
    const onTogglePreview = jest.fn();
    const { rerender } = renderWithProviders(
      <NarratorRow id="v-1" name="Deniz" line="Türkçe" onPress={onPress} onTogglePreview={onTogglePreview} />,
    );
    expect(screen.getByTestId('narrator-plus-v-1')).toBeOnTheScreen();
    const add = screen.getByRole('button', { name: 'Deniz anlatıcısını ekle' });
    expect(add).toBeEnabled();
    // The row waits like every pressable in a scrolling list.
    const delays = screen
      .UNSAFE_getAllByProps({ testID: 'narrator-add-v-1' })
      .map(node => node.props.unstable_pressDelay)
      .filter(delay => delay !== undefined);
    expect(delays).toEqual([PRESS_DELAY_MS]);

    rerender(
      <NarratorRow id="v-1" name="Deniz" line="Türkçe" adding onPress={onPress} onTogglePreview={onTogglePreview} />,
    );
    const busy = screen.getByRole('button', { name: 'Deniz anlatıcısını ekle' });
    expect(busy).toBeDisabled();
    expect(busy.props.accessibilityState).toMatchObject({ busy: true });
    fireEvent.press(busy);
    expect(onPress).not.toHaveBeenCalled();
    // The add is busy in its own place: a spinner of the plus's size where
    // the plus was (V5-04).
    const plus = screen.getByTestId('narrator-plus-v-1');
    expect(within(plus).getByTestId('narrator-adding-v-1')).toBeOnTheScreen();
    expect(flatStyle(screen.getByTestId('narrator-adding-v-1'))).toMatchObject({ width: 20, height: 20 });
    expect(within(plus).queryByTestId('icon-plus', { includeHiddenElements: true })).toBeNull();
    // The sample button is left alone: no spinner there (it would read as the
    // sample loading), and it still plays the sample.
    const sample = screen.getByRole('button', { name: 'Deniz örneğini dinle' });
    expect(sample).toBeEnabled();
    expect(sample.props.accessibilityState?.busy).not.toBe(true);
    expect(within(sample).queryByTestId('spinner-indicator')).toBeNull();
    fireEvent.press(sample);
    expect(onTogglePreview).toHaveBeenCalledTimes(1);

    rerender(
      <NarratorRow id="v-1" name="Deniz" line="Türkçe" onPress={onPress} onTogglePreview={onTogglePreview} />,
    );
    fireEvent.press(screen.getByRole('button', { name: 'Deniz anlatıcısını ekle' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('narrator-adding-v-1')).toBeNull();
  });

  it('has no lock, plan badge or quality tier: a ready-made narrator is free', () => {
    renderWithProviders(
      <NarratorRow id="v-1" name="Achernar" line="Türkçe, kadın sesi" onPress={jest.fn()} onTogglePreview={jest.fn()} />,
    );
    expect(screen.getByText('Achernar')).toBeOnTheScreen();
    expect(screen.queryByTestId('narrator-lock-v-1')).toBeNull();
    expect(screen.queryByTestId('icon-lock', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByText(/Premium|Ücretsiz|Standart|Yüksek kalite|HD/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Achernar anlatıcısını ekle' })).toBeOnTheScreen();
  });

  it('shows the state of an added narrator that is not ready, and stop in the action colour while playing', () => {
    renderWithProviders(
      <NarratorRow
        id="vp-2"
        name="Cem"
        line="Türkçe"
        added
        statusLabel="Hazırlanıyor"
        playing
        onTogglePreview={jest.fn()}
      />,
      { theme: 'kitaplik' },
    );
    expect(screen.getByText('Hazırlanıyor')).toBeOnTheScreen();
    expect(screen.queryByText('Eklendi')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cem örneğini durdur' })).toBeOnTheScreen();
    expect(flatStyle(screen.getByTestId('narrator-preview-vp-2-face')).backgroundColor).toBe(
      themes.kitaplik.action,
    );
  });

  it('its skeleton has the row\'s height, corners, lip and tile', () => {
    renderWithProviders(<NarratorRowSkeleton />);
    expect(screen.UNSAFE_getByType(RowSkeleton).props).toMatchObject({
      height: 64,
      radius: RADIUS.lg,
      lip: LIP.md,
      leadingSize: 40,
      leadingRadius: RADIUS.sm,
    });
  });

  it('spins while the preview loads', () => {
    renderWithProviders(
      <NarratorRow id="v-1" name="Cem" line="Türkçe" loadingPreview onTogglePreview={jest.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Cem örneğini dinle' })).toBeDisabled();
  });

  it.each(['gece-mavisi', 'orman', 'orijinal'] as const)('is a `.nr` card of the %s palette', scheme => {
    renderWithProviders(
      <NarratorRow
        id="v-1"
        name="Ayla"
        line="Türkçe"
        languageCode="tr"
        avatarSlot="dunya"
        onPress={jest.fn()}
        onTogglePreview={jest.fn()}
      />,
      { theme: scheme },
    );
    const T = themes[scheme];
    // A row card: the 40dp tile plus 12dp padding, 20dp corners, the 3dp lip.
    expect(flatStyle(screen.getByTestId('narrator-v-1-face'))).toMatchObject({
      minHeight: 64,
      borderRadius: RADIUS.lg,
      paddingHorizontal: 12,
      backgroundColor: T.surface,
    });
    expect(flatStyle(screen.getByTestId('narrator-v-1-lip'))).toMatchObject({
      top: LIP.md,
      borderRadius: RADIUS.lg,
      backgroundColor: T.lip,
    });
    // The 40dp rounded avatar in the slot's category colour, dark initial.
    expect(
      flatStyle(screen.getByTestId('narrator-avatar-v-1-tile', { includeHiddenElements: true })),
    ).toMatchObject({ width: 40, borderRadius: RADIUS.sm, backgroundColor: T.cat.dunya.color });
    expect(flatStyle(screen.getByText('A', { includeHiddenElements: true })).color).toBe(T.onCat);
    // `.lg` badge and the neutral 42dp play button.
    expect(flatStyle(screen.getByTestId('narrator-code-v-1')).backgroundColor).toBe(T.line);
    expect(flatStyle(screen.getByText('TR')).color).toBe(T.text2);
    expect(flatStyle(screen.getByTestId('narrator-preview-v-1-face'))).toMatchObject({
      width: 42,
      backgroundColor: T.surface2,
    });
    expect(flatStyle(screen.getByText('Türkçe')).color).toBe(T.text3);
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(
      <NarratorRow id="vp-2" name="Emma" line="English" added onTogglePreview={jest.fn()} />,
    );
    expect(screen.getByText('Added')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Play the sample of Emma' })).toBeOnTheScreen();
    await act(() => i18n.changeLanguage('tr'));
  });
});
