/**
 * The pieces of the story detail (design/v4/playful, frame c): the narrator
 * rules of models/Narrator, NarratorAvatar, NarratorCards, the sheets and
 * TranslationRequestSheet on their own. The screen test covers them wired to
 * the stores.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { AvailableGoogleVoice, VoiceProfile } from '../../models/VoiceProfile';
import {
  getNarratorDisplay,
  languageBase,
  narrationLanguageNotice,
  narratorsForStory,
} from '../../models/Narrator';
import { TTSProvider, VoiceProfileStatus } from '../../types/enums';
import { apiErrorFromResponse } from '../../services/ApiError';
import { showToast } from '../../utils/toast';
import { NarratorAvatar, narratorColors } from './NarratorAvatar';
import * as NarratorAvatarModule from './NarratorAvatar';
import {
  NarratorSheet,
  NarratorSheetProps,
  SHEET_READY_ROWS,
  recordingDateLabel,
  sheetCatalogueRows,
} from './NarratorSheet';
import {
  CatalogueNarratorCards,
  NARRATOR_CARD_HEIGHT,
  NarratorCards,
  NarratorCardsSkeleton,
  pickNarratorCards,
} from './NarratorCards';
import { Bone, RowSkeleton } from '../design';
import { CategoryGlow, GLOW_STOPS } from './CategoryGlow';
import {
  CheckBadge,
  SAMPLE_BUTTON_SIZE,
  SHEET_ROW_MIN_HEIGHT,
  SampleButton,
  SheetRow,
  sheetRowHeight,
} from './SheetRow';
import { StoryOptionsSheet } from './StoryOptionsSheet';
import {
  TranslationRequestSheet,
  TranslationRequestSheetProps,
  requestableLanguages,
  requestedToggleFace,
} from './TranslationRequestSheet';
import { useNarratorPreview } from './useNarratorPreview';
import { narratorAvatarSlotFor, presetPreviewKey } from '../voice/narratorRows';
import { PALETTE_KEYS } from '../../theme/palettes';
import { contrastRatio } from '../../theme/color';
import * as Reanimated from 'react-native-reanimated';
import { resetSheetPresence } from '../design/sheetPresence';

jest.setTimeout(60000);

const mockRequestTranslation = jest.fn();
const mockCancelTranslationRequest = jest.fn();

jest.mock('../../services/StoryService', () => ({
  __esModule: true,
  default: {
    requestTranslation: (...args: unknown[]) => mockRequestTranslation(...args),
    cancelTranslationRequest: (...args: unknown[]) => mockCancelTranslationRequest(...args),
  },
}));
jest.mock('../../utils/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

/** The sample state of the audio store (SPEC-audio 2.5), observable like the real one. */
interface AudioMock {
  source: 'none' | 'sample' | 'story';
  sampleKey: string | null;
  isPlaying: boolean;
  previewPending: boolean;
  playFromUrl: jest.Mock;
  stopPreview: jest.Mock;
  stopAndCleanup: jest.Mock;
}
let mockAudio: AudioMock;
const mockPreviewVoice = jest.fn();
const mockGetVoiceSample = jest.fn();

jest.mock('../../hooks/useAudioPlayer', () => ({ useAudioPlayer: () => mockAudio }));
jest.mock('../../hooks/useVoiceProfile', () => ({
  useVoiceProfile: () => ({ getVoiceSample: (...args: unknown[]) => mockGetVoiceSample(...args) }),
}));
jest.mock('../../services/VoiceProfileService', () => ({
  __esModule: true,
  default: { previewVoice: (...args: unknown[]) => mockPreviewVoice(...args) },
}));

function makeAudioMock(): AudioMock {
  const state: AudioMock = observable(
    {
      source: 'none' as AudioMock['source'],
      sampleKey: null as string | null,
      isPlaying: false,
      previewPending: false,
      playFromUrl: jest.fn(async (_url: string, meta: { key: string }) => {
        runInAction(() => {
          state.source = 'sample';
          state.sampleKey = meta.key;
          state.isPlaying = true;
        });
      }),
      stopPreview: jest.fn(async (key?: string) => {
        if (state.source !== 'sample') return;
        if (key !== undefined && key !== state.sampleKey) return;
        runInAction(() => {
          state.source = 'none';
          state.sampleKey = null;
          state.isPlaying = false;
        });
      }),
      stopAndCleanup: jest.fn(async () => undefined),
    },
    { playFromUrl: false, stopPreview: false, stopAndCleanup: false },
  );
  return state;
}

/** A promise the test resolves by hand. */
function deferred<V>() {
  let resolve: (value: V) => void = () => undefined;
  const promise = new Promise<V>(r => (resolve = r));
  return { promise, resolve };
}

function voice(
  id: string,
  name: string,
  kind: 'CLONE' | 'PRESET' | null,
  patch: Partial<VoiceProfile> = {},
): VoiceProfile {
  return {
    id,
    name,
    status: VoiceProfileStatus.READY,
    provider: kind === 'PRESET' ? TTSProvider.GOOGLE : TTSProvider.CARTESIA,
    voiceId: `${id}-voice`,
    language: 'tr-TR',
    contentLanguage: 'tr',
    sampleAudioUrl: null,
    errorMessage: null,
    voiceModelId: null,
    kind,
    consentAt: null,
    createdAt: new Date(2026, 9, 12, 9, 30, 0),
    updatedAt: new Date(2026, 9, 12, 9, 30, 0),
    ...patch,
  };
}

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(`detail:${key}`, options ?? {});

beforeEach(() => {
  mockRequestTranslation.mockReset();
  mockRequestTranslation.mockResolvedValue({});
  mockCancelTranslationRequest.mockReset();
  mockCancelTranslationRequest.mockResolvedValue({});
  mockAudio = makeAudioMock();
  mockPreviewVoice.mockReset();
  mockPreviewVoice.mockResolvedValue({ audioUrl: 'https://cdn.test/preset.mp3' });
  mockGetVoiceSample.mockReset();
  mockGetVoiceSample.mockResolvedValue('https://cdn.test/own.wav');
});

afterEach(() => resetSheetPresence());

/**
 * Holds every `withTiming` of the sheets, so a test sees a sheet during its
 * exit (the default mock runs the animation to its end at once).
 */
function holdTimings(): { callback?: (finished?: boolean) => void }[] {
  const held: { callback?: (finished?: boolean) => void }[] = [];
  jest.spyOn(Reanimated, 'withTiming').mockImplementation(((
    toValue: number,
    _config?: unknown,
    callback?: (finished?: boolean) => void,
  ) => {
    held.push({ callback });
    return toValue;
  }) as unknown as typeof Reanimated.withTiming);
  return held;
}

describe('models/Narrator', () => {
  const OWN = voice('own', 'Zeynep', 'CLONE');
  const TR = voice('tr', 'Defne', 'PRESET');
  const EN = voice('en', 'Emma', 'PRESET', { language: 'en-US', contentLanguage: 'en' });
  const OWN_EN = voice('own-en', 'Mom', 'CLONE', { language: 'en-US', contentLanguage: 'en' });

  it('reduces a locale to its language', () => {
    expect(languageBase('tr-TR')).toBe('tr');
    expect(languageBase('EN_us')).toBe('en');
    expect(languageBase(' de ')).toBe('de');
    expect(languageBase(null)).toBe('');
  });

  it('lists the voices of the story language first, then the voices of other languages, and leaves out unfinished voices', () => {
    const processing = voice('p', 'Yeni', 'CLONE', { status: VoiceProfileStatus.PROCESSING });
    const failed = voice('f', 'Bozuk', 'PRESET', { status: VoiceProfileStatus.FAILED });
    const result = narratorsForStory([TR, EN, processing, OWN_EN, OWN, failed], 'tr');
    expect(result.own.map(p => p.id)).toEqual(['own']);
    expect(result.ready.map(p => p.id)).toEqual(['tr']);
    // Nothing is hidden: own voices of another language, then ready-made ones.
    expect(result.other.map(p => p.id)).toEqual(['own-en', 'en']);
    expect(result.all.map(p => p.id)).toEqual(['own', 'tr', 'own-en', 'en']);
    expect(result.hasOwnVoice).toBe(true);

    const english = narratorsForStory([TR, EN, OWN], 'en');
    expect(english.own).toEqual([]);
    expect(english.ready.map(p => p.id)).toEqual(['en']);
    expect(english.other.map(p => p.id)).toEqual(['own', 'tr']);
    // The default narrator is the first one: a voice of the story language.
    expect(english.all[0].id).toBe('en');
    expect(english.hasOwnVoice).toBe(true);

    // An unknown story language puts nobody in the other group.
    expect(narratorsForStory([TR, EN, OWN], null).other).toEqual([]);
    expect(narratorsForStory([], 'tr')).toEqual({
      own: [],
      ready: [],
      other: [],
      hasOwnVoice: false,
      all: [],
    });
  });

  it('says what a voice of another language means for a story', () => {
    // Same language, an unknown story language or no voice: nothing to say.
    expect(narrationLanguageNotice(OWN, 'tr')).toBe('none');
    expect(narrationLanguageNotice(EN, 'EN')).toBe('none');
    expect(narrationLanguageNotice(OWN, null)).toBe('none');
    expect(narrationLanguageNotice(null, 'en')).toBe('none');
    // The user's own voice keeps its accent: the story detail asks first.
    expect(narrationLanguageNotice(OWN, 'en')).toBe('accent');
    expect(narrationLanguageNotice(OWN_EN, 'tr')).toBe('accent');
    // Older payloads without `kind`: Cartesia was the cloning provider.
    expect(narrationLanguageNotice(voice('old', 'Eski', null), 'en')).toBe('accent');
    // A ready-made narrator is read by its voice of the story language.
    expect(narrationLanguageNotice(TR, 'en')).toBe('native');
    expect(narrationLanguageNotice(TR, 'en', null)).toBe('native');
    expect(narrationLanguageNotice(TR, 'en', [{ name: 'defne' }])).toBe('native');
    // Unless the catalogue of that language is known not to have the narrator.
    expect(narrationLanguageNotice(TR, 'ru', [])).toBe('readyAccent');
    expect(narrationLanguageNotice(TR, 'en', [{ name: 'Emma' }])).toBe('readyAccent');
  });

  it('keeps the friendly name placeholder in one place', () => {
    expect(getNarratorDisplay(TR)).toEqual({ name: 'Defne', description: null });
    expect(getNarratorDisplay({ name: '  ' })).toBeNull();
    expect(getNarratorDisplay(null)).toBeNull();
  });
});

describe('recordingDateLabel', () => {
  it('prints the day and the month name in the UI language', async () => {
    expect(recordingDateLabel(new Date(2026, 9, 12), t)).toBe('12 Ekim kaydı');
    expect(recordingDateLabel(new Date(2026, 0, 3), t)).toBe('3 Ocak kaydı');
    expect(recordingDateLabel(new Date('nope'), t)).toBe('');
    expect(recordingDateLabel(null, t)).toBe('');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(recordingDateLabel(new Date(2026, 9, 12), t)).toBe('Recorded on 12 October');
  });
});

describe('NarratorAvatar', () => {
  it.each(['gece-mavisi', 'kitaplik'] as const)('colours the own voice and the narrators from the %s palette', scheme => {
    const T = themes[scheme];
    renderWithProviders(
      <>
        <NarratorAvatar name="zeynep" tone="own" testID="own" />
        <NarratorAvatar name="Defne" tone="ready" testID="ready" />
        <NarratorAvatar name="ışıl" colorKey="tr-TR-Chirp3-HD-Isil" testID="keyed" shape="rounded" size={46} />
      </>,
      { theme: scheme },
    );
    // The own voice: the own-voice colour with the wave, no initial.
    expect(flatStyle(screen.getByTestId('own')).backgroundColor).toBe(T.own);
    expect(screen.getByTestId('icon-wave', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('Z')).toBeNull();
    // A narrator: its initial on a category colour, stable per key.
    expect(flatStyle(screen.getByTestId('ready')).backgroundColor).toBe(narratorColors(T, 'Defne').color);
    expect(flatStyle(screen.getByTestId('keyed'))).toMatchObject({
      backgroundColor: narratorColors(T, 'tr-TR-Chirp3-HD-Isil').color,
      width: 46,
      borderRadius: 16,
    });
    expect(flatStyle(screen.getByText('D')).color).toBe(T.onCat);
    // Turkish casing for the initial.
    expect(screen.getByText('I')).toBeTruthy();
  });

  it('wears the colour the Sesim tab and the catalogue give the same voice (narratorAvatarSlotFor)', () => {
    const T = themes['gece-mavisi'];
    const ids = ['tr-TR-Chirp3-HD-Achernar', 'tr-TR-Chirp3-HD-Achird', 'tr-TR-Chirp3-HD-Algenib', 'Puck', 'Kore'];
    for (const id of ids) {
      expect(narratorColors(T, id)).toBe(T.cat[narratorAvatarSlotFor(id)]);
    }
    // Stable per voice, and neighbours do not all share one colour.
    expect(narratorColors(T, 'Puck')).toBe(narratorColors(T, 'Puck'));
    expect(new Set(ids.map(id => narratorColors(T, id).color)).size).toBeGreaterThan(1);
  });
});

describe('CategoryGlow', () => {
  it('draws a radial glow of the given colour that fades out at the rim', () => {
    const T = themes.kitaplik;
    renderWithProviders(<CategoryGlow color={T.cat.dunya.color} size={236} testID="glow" />);
    const glow = screen.getByTestId('glow', { includeHiddenElements: true });
    expect(flatStyle(glow)).toMatchObject({ width: 236, height: 236 });
    expect(glow.props.pointerEvents).toBe('none');
    expect(GLOW_STOPS.map(stop => stop.opacity)).toEqual([0.42, 0.18, 0]);
  });
});

describe('SampleButton and CheckBadge', () => {
  it.each(['gece-mavisi', 'kitaplik'] as const)('use the %s palette', scheme => {
    const T = themes[scheme];
    const onPress = jest.fn();
    renderWithProviders(
      <>
        <SampleButton playing={false} onPress={onPress} accessibilityLabel="idle" testID="idle" />
        <SampleButton playing onPress={onPress} accessibilityLabel="playing" testID="playing" />
        <CheckBadge testID="badge" />
      </>,
      { theme: scheme },
    );
    // Idle: the sheet colour on a raised row; playing: the action colour.
    expect(flatStyle(screen.getByTestId('idle-face')).backgroundColor).toBe(T.surface);
    expect(flatStyle(screen.getByTestId('playing-face')).backgroundColor).toBe(T.action);
    expect(flatStyle(screen.getByTestId('badge')).backgroundColor).toBe(T.action);
    fireEvent.press(screen.getByRole('button', { name: 'idle' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('NarratorSheet', () => {
  const OWN = voice('own', 'Zeynep', 'CLONE');
  const DEFNE = voice('defne', 'Defne', 'PRESET');
  const KEREM = voice('kerem', 'Kerem', 'PRESET');
  const catalogueVoice = (name: string, gender = 'female'): AvailableGoogleVoice => ({
    id: `tr-TR-Chirp3-HD-${name}`,
    voiceId: `tr-TR-Chirp3-HD-${name}`,
    name,
    language: 'Turkish',
    languageCode: 'tr-TR',
    contentLanguage: 'tr',
    gender,
    description: '',
    provider: 'GOOGLE',
  });
  /** A language's catalogue: 30 narrators, like Chirp 3 HD in Turkish. */
  const THIRTY = Array.from({ length: 30 }, (_, i) => catalogueVoice(`Voice${String(i).padStart(2, '0')}`));

  function renderSheet(patch: Partial<NarratorSheetProps> = {}, theme: 'gece-mavisi' | 'kitaplik' = 'gece-mavisi') {
    const props: NarratorSheetProps = {
      visible: true,
      onClose: jest.fn(),
      ownVoices: [OWN],
      readyNarrators: [DEFNE, KEREM],
      selectedId: 'own',
      storyLanguage: 'tr',
      onSelect: jest.fn(),
      onAddOwnVoice: jest.fn(),
      onAddReadyNarrator: jest.fn(),
      onTogglePreview: jest.fn(),
      ...patch,
    };
    renderWithProviders(<NarratorSheet {...props} />, { theme });
    return props;
  }

  it('draws the sections, the own voice with its recording date, narrators, the add row and the note', () => {
    renderSheet();
    // Baloo 2 sub-heads, no uppercase labels.
    expect(screen.getByRole('header', { name: 'Senin sesin' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Hazır anlatıcılar' })).toBeOnTheScreen();
    // Every row names the language of its voice on its second line.
    expect(screen.getByText('Türkçe, 12 Ekim kaydı')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Zeynep, Türkçe, 12 Ekim kaydı' })).toBeSelected();
    expect(screen.getByRole('radio', { name: 'Defne, Türkçe' })).not.toBeSelected();
    expect(screen.getByRole('radio', { name: 'Kerem, Türkçe' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Yeni ses ekle' })).toBeOnTheScreen();
    expect(screen.getByText('Hazır anlatıcılar bu masalı Türkçe okur.')).toBeOnTheScreen();
    // No voice of another language: no such section.
    expect(screen.queryByTestId('narrator-other-languages')).toBeNull();
    // Only the selected row carries the check.
    expect(screen.getAllByTestId('icon-check', { includeHiddenElements: true })).toHaveLength(1);
  });

  it('opens on its first section, not on two headings in a row; the list is named for screen readers (V3-10)', () => {
    renderSheet({ otherVoices: [voice('emma', 'Emma', 'PRESET', { language: 'en-US', contentLanguage: 'en' })] });
    // No sheet title above "Senin sesin": the sections are the structure.
    expect(screen.queryByTestId('sheet-title')).toBeNull();
    expect(screen.queryByRole('header', { name: 'Anlatıcı' })).toBeNull();
    expect(screen.getAllByRole('header').map(node => node.props.children)).toEqual([
      'Senin sesin',
      'Hazır anlatıcılar',
      'Başka dildeki sesler',
    ]);
    // The narrators are one radio group named "Anlatıcı".
    const list = screen.getByTestId('narrator-sheet-list');
    expect(list.props.accessibilityRole).toBe('radiogroup');
    expect(list.props.accessibilityLabel).toBe('Anlatıcı');
    expect(within(list).getAllByRole('radio')).toHaveLength(4);
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('rows are raised cards, the chosen one ringed, in the %s theme', scheme => {
    const T = themes[scheme];
    renderSheet({}, scheme);
    expect(flatStyle(screen.getByTestId('narrator-sheet')).backgroundColor).toBe(T.surface);
    // Every row is surface-2 on its lip (the sheet itself is surface).
    expect(flatStyle(screen.getByTestId('narrator-row-own-face'))).toMatchObject({
      backgroundColor: T.surface2,
      borderColor: T.action,
      borderWidth: 2,
    });
    expect(flatStyle(screen.getByTestId('narrator-row-own-lip')).backgroundColor).toBe(T.actionLip);
    // The ring is always there (clear when not chosen): choosing never moves the content.
    expect(flatStyle(screen.getByTestId('narrator-row-defne-face'))).toMatchObject({
      backgroundColor: T.surface2,
      borderColor: 'transparent',
      borderWidth: 2,
    });
    const padding = (id: string) => {
      const face = flatStyle(screen.getByTestId(id));
      return [face.paddingVertical, face.paddingHorizontal];
    };
    expect(padding('narrator-row-own-face')).toEqual(padding('narrator-row-defne-face'));
    expect(flatStyle(screen.getByTestId('narrator-row-defne-lip')).backgroundColor).toBe(T.lip);
    // The own voice is the wave on the own-voice colour; narrators wear a category colour.
    expect(flatStyle(screen.getByTestId('narrator-avatar-own')).backgroundColor).toBe(T.own);
    expect(flatStyle(screen.getByTestId('narrator-avatar-defne')).backgroundColor).toBe(
      narratorColors(T, 'defne-voice').color,
    );
    expect(screen.getByTestId('narrator-check-own')).toBeOnTheScreen();
    // The sample button stands out on the raised row.
    expect(flatStyle(screen.getByTestId('narrator-preview-defne-face')).backgroundColor).toBe(T.surface);
  });

  it('puts the check on the avatar corner, so every sample button stays in one column', () => {
    renderSheet();
    const check = screen.getByTestId('narrator-check-own');
    expect(flatStyle(check)).toMatchObject({ position: 'absolute', width: 20 });
    // The chosen row's trailing slot holds only its sample button, like the others.
    const row = screen.getByTestId('narrator-row-own-face');
    expect(within(row).getAllByRole('button')).toHaveLength(1);
    expect(within(row).getByTestId('narrator-preview-own')).toBeOnTheScreen();
  });

  it('names the voice of an added narrator like the catalogue rows', () => {
    renderSheet({ voiceGenders: new Map([['defne-voice', 'female'], ['kerem-voice', 'male']]) });
    expect(screen.getByRole('radio', { name: 'Defne, Türkçe, kadın sesi' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Kerem, Türkçe, erkek sesi' })).toBeOnTheScreen();
    // The own voice keeps its recording date.
    expect(screen.getByRole('radio', { name: 'Zeynep, Türkçe, 12 Ekim kaydı' })).toBeOnTheScreen();
  });

  it('keeps the new choice drawn while the sheet leaves', () => {
    const held = holdTimings();
    const props: NarratorSheetProps = {
      visible: true,
      onClose: jest.fn(),
      ownVoices: [OWN],
      readyNarrators: [DEFNE, KEREM],
      selectedId: 'own',
      storyLanguage: 'tr',
      onSelect: jest.fn(),
      onAddOwnVoice: jest.fn(),
      onAddReadyNarrator: jest.fn(),
      onTogglePreview: jest.fn(),
    };
    const onClosed = jest.fn();
    const view = renderWithProviders(<NarratorSheet {...props} onClosed={onClosed} />);
    fireEvent(screen.getByTestId('narrator-sheet'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 520 } },
    });

    // The tap that selects also closes: the sheet is still leaving.
    view.rerender(<NarratorSheet {...props} visible={false} selectedId="defne" onClosed={onClosed} />);
    expect(screen.getByTestId('narrator-sheet')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Defne, Türkçe' })).toBeSelected();
    expect(screen.getByRole('radio', { name: 'Zeynep, Türkçe, 12 Ekim kaydı' })).not.toBeSelected();
    expect(screen.getByTestId('narrator-check-defne')).toBeOnTheScreen();
    expect(onClosed).not.toHaveBeenCalled();

    act(() => held[held.length - 1].callback?.(true));
    expect(screen.queryByTestId('narrator-sheet')).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('selects a narrator and toggles a sample without selecting', () => {
    const props = renderSheet({ previewPlayingId: 'kerem' });
    fireEvent.press(screen.getByRole('radio', { name: 'Defne' }));
    expect(props.onSelect).toHaveBeenCalledWith(DEFNE);

    fireEvent.press(screen.getByRole('button', { name: 'Defne örneğini dinle' }));
    expect(props.onTogglePreview).toHaveBeenCalledWith(DEFNE);
    fireEvent.press(screen.getByRole('button', { name: 'Kerem örneğini durdur' }));
    expect(props.onTogglePreview).toHaveBeenLastCalledWith(KEREM);
    expect(props.onSelect).toHaveBeenCalledTimes(1);
  });

  it('shows the sample of a narrator as busy while it loads', () => {
    renderSheet({ previewLoadingId: 'defne' });
    expect(screen.getByTestId('narrator-preview-defne')).toBeDisabled();
    expect(screen.getByTestId('narrator-preview-kerem')).toBeEnabled();
  });

  it('offers "Kendi sesini ekle" in place of the own voice, and no second add row', () => {
    const props = renderSheet({ ownVoices: [], selectedId: 'defne' });
    expect(screen.queryByRole('button', { name: 'Yeni ses ekle' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Kendi sesini ekle' }));
    expect(props.onAddOwnVoice).toHaveBeenCalledTimes(1);
  });

  it('leads to the catalogue when no ready-made narrator reads the language', () => {
    const props = renderSheet({ readyNarrators: [], storyLanguage: 'en' });
    expect(screen.getByText('Hazır anlatıcılar bu masalı İngilizce okur.')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Hazır anlatıcı ekle' }));
    expect(props.onAddReadyNarrator).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole('button', { name: 'Yeni ses ekle' }));
    expect(props.onAddOwnVoice).toHaveBeenCalledTimes(1);
  });

  it('lists the voices of other languages last, under their own heading, with their language', () => {
    const OWN_EN = voice('own-en', 'Mom', 'CLONE', { language: 'en-US', contentLanguage: 'en' });
    const EMMA = voice('emma', 'Emma', 'PRESET', { language: 'en-US', contentLanguage: 'en' });
    const props = renderSheet({ otherVoices: [OWN_EN, EMMA], hasOwnVoice: true });

    expect(screen.getByRole('header', { name: 'Başka dildeki sesler' })).toBeOnTheScreen();
    const own = screen.getByRole('radio', { name: 'Mom, English, 12 Ekim kaydı' });
    const ready = screen.getByRole('radio', { name: 'Emma, English' });
    expect(own).not.toBeSelected();
    // They come after every voice of the story's language.
    const ids = screen
      .getAllByRole('radio')
      .map(node => node.props.testID as string);
    expect(ids).toEqual([
      'narrator-row-own',
      'narrator-row-defne',
      'narrator-row-kerem',
      'narrator-row-own-en',
      'narrator-row-emma',
    ]);

    // They are not hidden and not disabled: choosing one applies at once.
    fireEvent.press(own);
    expect(props.onSelect).toHaveBeenCalledWith(OWN_EN);
    fireEvent.press(ready);
    expect(props.onSelect).toHaveBeenLastCalledWith(EMMA);
  });

  it('offers a new recording, not a first one, when the only own voice is of another language', () => {
    const OWN_EN = voice('own-en', 'Mom', 'CLONE', { language: 'en-US', contentLanguage: 'en' });
    const props = renderSheet({
      ownVoices: [],
      otherVoices: [OWN_EN],
      hasOwnVoice: true,
      selectedId: 'own-en',
    });
    expect(screen.queryByRole('button', { name: 'Kendi sesini ekle' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Yeni ses ekle' }));
    expect(props.onAddOwnVoice).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('radio', { name: 'Mom, English, 12 Ekim kaydı' })).toBeSelected();
  });

  it('names the language of a catalogue narrator before its gender', () => {
    renderSheet({
      readyNarrators: [],
      storyLanguage: 'en',
      catalogue: [
        {
          id: 'en-US-Chirp3-HD-Orus',
          voiceId: 'en-US-Chirp3-HD-Orus',
          name: 'Orus',
          language: 'English',
          languageCode: 'en-US',
          contentLanguage: 'en',
          gender: 'male',
          description: '',
          provider: 'GOOGLE',
        },
      ],
    });
    expect(screen.getByRole('radio', { name: 'Orus, English, erkek sesi' })).toBeOnTheScreen();
  });

  describe('a long catalogue (V3-02)', () => {
    const CATALOGUE_ROW = /^narrator-catalogue-tr-TR-Chirp3-HD-Voice\d\d$/;

    it('sheetCatalogueRows fills the ready-made section up to six rows', () => {
      expect(SHEET_READY_ROWS).toBe(6);
      expect(sheetCatalogueRows(2, THIRTY)).toEqual({ shown: THIRTY.slice(0, 4), more: true });
      expect(sheetCatalogueRows(0, THIRTY.slice(0, 6))).toEqual({ shown: THIRTY.slice(0, 6), more: false });
      expect(sheetCatalogueRows(9, THIRTY)).toEqual({ shown: [], more: true });
      expect(sheetCatalogueRows(9, [])).toEqual({ shown: [], more: false });
    });

    it('mounts only the first rows and ends the section with "Tümünü gör", which opens the whole catalogue', () => {
      const props = renderSheet({ catalogue: THIRTY });
      // The two added narrators, then four of the catalogue: six rows, not 32.
      expect(screen.getAllByRole('radio').map(node => node.props.testID as string)).toEqual([
        'narrator-row-own',
        'narrator-row-defne',
        'narrator-row-kerem',
        ...THIRTY.slice(0, 4).map(v => `narrator-catalogue-${v.voiceId}`),
      ]);
      expect(screen.queryByTestId(`narrator-catalogue-${THIRTY[4].voiceId}`)).toBeNull();
      // After the rows it stands for, before the way to a new recording.
      expect(
        screen
          .getAllByTestId(/^narrator-(catalogue-tr-TR-Chirp3-HD-Voice\d\d|see-all|add-new)$/)
          .map(node => node.props.testID as string)
          .slice(-3),
      ).toEqual([`narrator-catalogue-${THIRTY[3].voiceId}`, 'narrator-see-all', 'narrator-add-new']);
      // It names how many narrators the language has.
      const seeAll = screen.getByRole('button', { name: 'Tümünü gör, 32 hazır anlatıcı' });
      fireEvent.press(seeAll);
      expect(props.onAddReadyNarrator).toHaveBeenCalledTimes(1);
      expect(props.onSelect).not.toHaveBeenCalled();
    });

    it('has the row geometry: the 40dp tile on 12dp corners and the chevron in the sample column', () => {
      renderSheet({ catalogue: THIRTY });
      expect(flatStyle(screen.getByTestId('narrator-see-all-tile'))).toMatchObject({ width: 40, borderRadius: 12 });
      expect(flatStyle(screen.getByTestId('narrator-see-all-face'))).toMatchObject({
        minHeight: SHEET_ROW_MIN_HEIGHT,
        paddingVertical: 12,
        borderWidth: 2,
      });
      expect(
        within(screen.getByTestId('narrator-see-all')).getByTestId('icon-chevronRight', { includeHiddenElements: true }),
      ).toBeOnTheScreen();
    });

    it('lists the added narrators first: with six of them only "Tümünü gör" leads to the rest', () => {
      const added = Array.from({ length: 6 }, (_, i) => voice(`r${i}`, `R${i}`, 'PRESET'));
      renderSheet({ readyNarrators: added, catalogue: THIRTY, selectedId: 'r5' });
      expect(screen.getAllByTestId(/^narrator-row-r\d$/)).toHaveLength(6);
      // The chosen one is an added narrator, so it is always listed.
      expect(screen.getByTestId('narrator-check-r5')).toBeOnTheScreen();
      expect(screen.queryAllByTestId(CATALOGUE_ROW)).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Tümünü gör, 36 hazır anlatıcı' })).toBeOnTheScreen();
    });

    it('lists a short catalogue whole, without "Tümünü gör"', () => {
      renderSheet({ catalogue: THIRTY.slice(0, 4) });
      expect(screen.getAllByTestId(CATALOGUE_ROW)).toHaveLength(4);
      expect(screen.queryByTestId('narrator-see-all')).toBeNull();
    });

    it('waits with "Tümünü gör" while a narrator is being added', () => {
      const props = renderSheet({ catalogue: THIRTY, addingVoiceId: THIRTY[0].voiceId, onSelectCatalogue: jest.fn() });
      expect(screen.getByTestId(`narrator-catalogue-adding-${THIRTY[0].voiceId}`)).toBeOnTheScreen();
      expect(screen.getByTestId(`narrator-catalogue-${THIRTY[1].voiceId}`)).toBeDisabled();
      fireEvent.press(screen.getByTestId('narrator-see-all'));
      expect(props.onAddReadyNarrator).not.toHaveBeenCalled();
    });

    it('draws again only the rows whose state changed, and calls the newest callbacks', () => {
      const avatar = jest.spyOn(NarratorAvatarModule, 'NarratorAvatar');
      const base: NarratorSheetProps = {
        visible: true,
        onClose: jest.fn(),
        ownVoices: [OWN],
        readyNarrators: [DEFNE, KEREM],
        catalogue: THIRTY,
        selectedId: 'own',
        storyLanguage: 'tr',
        onSelect: jest.fn(),
        onAddOwnVoice: jest.fn(),
        onAddReadyNarrator: jest.fn(),
        onTogglePreview: jest.fn(),
        onSelectCatalogue: jest.fn(),
        onToggleCataloguePreview: jest.fn(),
      };
      const view = renderWithProviders(<NarratorSheet {...base} />);
      // One avatar per row: own, two added, four of the catalogue.
      const mounted = avatar.mock.calls.length;
      expect(mounted).toBe(7);

      // The page draws again with new functions and the same data: no row is drawn again.
      const onSelect = jest.fn();
      const onToggleCataloguePreview = jest.fn();
      const next = { ...base, onSelect, onToggleCataloguePreview, onTogglePreview: jest.fn() };
      view.rerender(<NarratorSheet {...next} />);
      expect(avatar.mock.calls.length).toBe(mounted);

      // A sample starts: only its row is drawn again.
      view.rerender(<NarratorSheet {...next} previewPlayingId="defne" />);
      expect(avatar.mock.calls.length).toBe(mounted + 1);
      expect(screen.getByRole('button', { name: 'Defne örneğini durdur' })).toBeOnTheScreen();

      // The rows call the functions of the last render.
      fireEvent.press(screen.getByRole('radio', { name: 'Kerem, Türkçe' }));
      expect(onSelect).toHaveBeenCalledWith(KEREM);
      expect(base.onSelect).not.toHaveBeenCalled();
      fireEvent.press(screen.getByRole('button', { name: `${THIRTY[0].name} örneğini dinle` }));
      expect(onToggleCataloguePreview).toHaveBeenCalledWith(THIRTY[0]);
    });
  });

  it('closes on the scrim and renders nothing while hidden', () => {
    const props = renderSheet();
    fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
    expect(props.onClose).toHaveBeenCalledTimes(1);

    screen.unmount();
    renderSheet({ visible: false });
    expect(screen.queryByTestId('narrator-sheet')).toBeNull();
  });

  it('is translated', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    renderSheet({
      readyNarrators: [DEFNE],
      catalogue: Array.from({ length: 8 }, (_, i) => catalogueVoice(`Voice${i}`)),
    });
    expect(screen.getByTestId('narrator-sheet-list').props.accessibilityLabel).toBe('Narrator');
    expect(screen.getByRole('button', { name: 'See all, 9 ready-made narrators' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Your voice' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Ready-made narrators' })).toBeOnTheScreen();
    // The language of a voice is in its own name in every UI language.
    expect(screen.getByText('Türkçe, Recorded on 12 October')).toBeOnTheScreen();
    expect(
      screen.getByText('Ready-made narrators read this story in Turkish.'),
    ).toBeOnTheScreen();
  });
});

describe('pickNarratorCards', () => {
  const OWN = voice('own', 'Annem', 'CLONE');
  const OWN_EN = voice('own-en', 'Mom', 'CLONE', { language: 'en-US', contentLanguage: 'en' });
  const DENIZ = voice('deniz', 'Deniz', 'PRESET');
  const AYLA = voice('ayla', 'Ayla', 'PRESET');
  const LALE = voice('lale', 'Lale', 'PRESET');
  const EMMA = voice('emma', 'Emma', 'PRESET', { language: 'en-US', contentLanguage: 'en' });
  const ids = (cards: ReturnType<typeof pickNarratorCards>) =>
    cards.map(card => (card.kind === 'addOwn' ? 'add-own' : card.profile?.id));

  it('puts the own voice first, then the narrators, three cards at most', () => {
    const narrators = narratorsForStory([DENIZ, AYLA, LALE, OWN], 'tr');
    expect(ids(pickNarratorCards(narrators, 'own'))).toEqual(['own', 'deniz', 'ayla']);
  });

  it('keeps the chosen narrator on a card', () => {
    const narrators = narratorsForStory([DENIZ, AYLA, LALE, OWN, EMMA], 'tr');
    expect(ids(pickNarratorCards(narrators, 'emma'))).toEqual(['own', 'deniz', 'emma']);
    expect(ids(pickNarratorCards(narrators, 'missing'))).toEqual(['own', 'deniz', 'ayla']);
  });

  it('shows an own voice of another language first too, and the way to record one without any', () => {
    expect(ids(pickNarratorCards(narratorsForStory([DENIZ, OWN_EN], 'tr'), 'deniz'))).toEqual([
      'own-en',
      'deniz',
    ]);
    expect(ids(pickNarratorCards(narratorsForStory([DENIZ, AYLA, LALE], 'tr'), 'deniz'))).toEqual([
      'add-own',
      'deniz',
      'ayla',
    ]);
    expect(pickNarratorCards(narratorsForStory([], 'tr'), null)).toEqual([]);
  });
});

describe('NarratorCards', () => {
  const OWN = voice('own', 'Annem', 'CLONE');
  const DENIZ = voice('deniz', 'Deniz', 'PRESET');
  const EMMA = voice('emma', 'Emma', 'PRESET', { language: 'en-US', contentLanguage: 'en' });

  function renderCards(selectedId: string, profiles: VoiceProfile[], theme: 'gece-mavisi' | 'kitaplik' = 'gece-mavisi') {
    const onSelect = jest.fn();
    const onAddOwnVoice = jest.fn();
    const narrators = narratorsForStory(profiles, 'tr');
    renderWithProviders(
      <NarratorCards
        cards={pickNarratorCards(narrators, selectedId)}
        selectedId={selectedId}
        storyLanguage="tr"
        onSelect={onSelect}
        onAddOwnVoice={onAddOwnVoice}
      />,
      { theme },
    );
    return { onSelect, onAddOwnVoice };
  }

  it.each(['gece-mavisi', 'kitaplik'] as const)('raises and rings the chosen card in the %s palette', scheme => {
    const T = themes[scheme];
    renderCards('own', [OWN, DENIZ], scheme);
    expect(flatStyle(screen.getByTestId('narrator-card-own-face'))).toMatchObject({
      backgroundColor: T.surface2,
      borderColor: T.action,
      minHeight: 96,
    });
    expect(flatStyle(screen.getByTestId('narrator-card-own-lip')).backgroundColor).toBe(T.actionLip);
    expect(flatStyle(screen.getByTestId('narrator-card-deniz-face')).backgroundColor).toBe(T.surface);
    expect(flatStyle(screen.getByTestId('narrator-card-avatar-own')).backgroundColor).toBe(T.own);
    expect(flatStyle(screen.getByTestId('narrator-card-avatar-deniz')).backgroundColor).toBe(
      narratorColors(T, 'deniz-voice').color,
    );
    expect(flatStyle(screen.getByTestId('narrator-card-check')).backgroundColor).toBe(T.action);
    // Never text-3 on surface-2: the chosen card's hint is text-2.
    expect(flatStyle(screen.getByText('Senin sesin')).color).toBe(T.text2);
    expect(flatStyle(screen.getByText('Hazır anlatıcı')).color).toBe(T.text3);
  });

  it('chooses a narrator, names a voice of another language by its language, and records an own voice', () => {
    const { onSelect } = renderCards('deniz', [DENIZ, EMMA]);
    expect(screen.getByRole('radio', { name: 'Deniz, Hazır anlatıcı' })).toBeSelected();
    expect(screen.getByRole('radio', { name: 'Emma, English' })).not.toBeSelected();
    fireEvent.press(screen.getByRole('radio', { name: 'Emma, English' }));
    expect(onSelect).toHaveBeenCalledWith(EMMA);

    screen.unmount();
    const { onAddOwnVoice } = renderCards('deniz', [DENIZ]);
    fireEvent.press(screen.getByRole('button', { name: 'Sesini ekle, Senin sesin' }));
    expect(onAddOwnVoice).toHaveBeenCalledTimes(1);
  });

  it('keeps every card content in place: the ring is always drawn', () => {
    renderCards('own', [OWN, DENIZ]);
    expect(flatStyle(screen.getByTestId('narrator-card-deniz-face'))).toMatchObject({
      borderWidth: 2,
      borderColor: 'transparent',
    });
    expect(flatStyle(screen.getByTestId('narrator-card-own-face')).paddingVertical).toBe(
      flatStyle(screen.getByTestId('narrator-card-deniz-face')).paddingVertical,
    );
  });

  it('fits the English add card on a 360dp phone', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    renderCards('deniz', [DENIZ]);
    expect(screen.getByRole('button', { name: 'Add voice, Your own voice' })).toBeOnTheScreen();
  });
});

describe('StoryOptionsSheet', () => {
  it('lists the options as rows and runs the one tapped', () => {
    const report = jest.fn();
    renderWithProviders(
      <StoryOptionsSheet
        visible
        onClose={jest.fn()}
        options={[
          { key: 'narrator', title: 'Anlatıcıyı değiştir', icon: 'mic', onPress: jest.fn() },
          { key: 'report', title: 'Metinde hata mı var?', subtitle: 'E-postayla bize bildir', icon: 'mail', onPress: report },
        ]}
      />,
      { theme: 'kitaplik' },
    );
    expect(screen.getByRole('header', { name: 'Masal' })).toBeOnTheScreen();
    expect(flatStyle(screen.getByTestId('story-option-report-face')).backgroundColor).toBe(themes.kitaplik.surface2);
    fireEvent.press(screen.getByRole('button', { name: 'Metinde hata mı var?, E-postayla bize bildir' }));
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('takes a title of its own and extra rows after the options', () => {
    renderWithProviders(
      <StoryOptionsSheet
        visible
        onClose={jest.fn()}
        title="Parmak Kız"
        options={[{ key: 'queue', title: 'Sıraya ekle', subtitle: 'Kerem anlatıyor', icon: 'queue', onPress: jest.fn() }]}
      >
        <SheetRow title="Masalın sayfası" onPress={jest.fn()} testID="story-option-open" />
      </StoryOptionsSheet>,
    );
    expect(screen.getByRole('header', { name: 'Parmak Kız' })).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Masal' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sıraya ekle, Kerem anlatıyor' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Masalın sayfası' })).toBeOnTheScreen();
  });

  it('shows a disabled option dimmed and does not run it', () => {
    const regenerate = jest.fn();
    renderWithProviders(
      <StoryOptionsSheet
        visible
        onClose={jest.fn()}
        options={[{ key: 'regenerate', title: 'Baştan hazırla', icon: 'redo', onPress: regenerate, disabled: true }]}
      />,
    );
    const row = screen.getByTestId('story-option-regenerate');
    expect(row).toBeDisabled();
    expect(row.props.needsOffscreenAlphaCompositing).toBe(true);
    fireEvent.press(row);
    expect(regenerate).not.toHaveBeenCalled();
  });

  it('reports the end of its exit through onClosed, once', () => {
    const held = holdTimings();
    const onClosed = jest.fn();
    const options = [{ key: 'report', title: 'Metinde hata mı var?', icon: 'mail' as const, onPress: jest.fn() }];
    const view = renderWithProviders(
      <StoryOptionsSheet visible onClose={jest.fn()} onClosed={onClosed} options={options} />,
    );
    fireEvent(screen.getByTestId('story-options-sheet'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 300 } },
    });
    view.rerender(<StoryOptionsSheet visible={false} onClose={jest.fn()} onClosed={onClosed} options={options} />);
    expect(onClosed).not.toHaveBeenCalled();
    act(() => held[held.length - 1].callback?.(true));
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('story-options-sheet')).toBeNull();
  });
});

describe('NarratorSheet row geometry', () => {
  const props: NarratorSheetProps = {
    visible: true,
    onClose: jest.fn(),
    ownVoices: [voice('own', 'Zeynep', 'CLONE')],
    readyNarrators: [voice('defne', 'Defne', 'PRESET')],
    selectedId: 'defne',
    storyLanguage: 'tr',
    onSelect: jest.fn(),
    onAddOwnVoice: jest.fn(),
    onAddReadyNarrator: jest.fn(),
    onTogglePreview: jest.fn(),
  };

  it('rows lead with the 40dp tile on 12dp corners, the add row too', () => {
    renderWithProviders(<NarratorSheet {...props} ownVoices={[]} />);
    expect(flatStyle(screen.getByTestId('narrator-avatar-defne'))).toMatchObject({ width: 40, borderRadius: 12 });
    expect(flatStyle(screen.getByTestId('narrator-row-defne-face'))).toMatchObject({
      minHeight: SHEET_ROW_MIN_HEIGHT,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderWidth: 2,
    });
    expect(flatStyle(screen.getByTestId('narrator-add-own-tile'))).toMatchObject({ width: 40, borderRadius: 12 });
  });

  it('the loading rows have the face height of the real ones: the sample button on its lip, the padding and the ring', () => {
    expect(SAMPLE_BUTTON_SIZE).toBe(42);
    // 42 + its 2dp lip, 2 x 12 padding, 2 x 2 ring.
    expect(sheetRowHeight(SAMPLE_BUTTON_SIZE + 2, 2)).toBe(72);
    expect(sheetRowHeight(20, 2)).toBe(SHEET_ROW_MIN_HEIGHT);
    renderWithProviders(<NarratorSheet {...props} readyNarrators={[]} catalogue={[]} catalogueLoading />);
    // The final geometry (NEW-2): six catalogue rows, then "Tümünü gör"
    // (its 40dp tile is its tallest part), each on the rows' 12dp margin.
    const bones = screen.UNSAFE_getAllByType(RowSkeleton);
    expect(bones).toHaveLength(7);
    bones.slice(0, 6).forEach(bone =>
      expect(bone.props).toMatchObject({ height: 72, radius: 20, lip: 3, leadingSize: 40, leadingRadius: 12 }),
    );
    expect(bones[6].props).toMatchObject({ height: 68, radius: 20, lip: 3, leadingSize: 40, trailing: false });
    bones.forEach(bone => expect(flatStyle(bone).marginBottom).toBe(12));
  });
});

describe('SheetRow', () => {
  it('a dimmed row fades as one layer and still takes its tap', () => {
    const onPress = jest.fn();
    renderWithProviders(<SheetRow title="Puck" dimmed onPress={onPress} testID="row" />);
    const row = screen.getByTestId('row');
    expect(row.props.needsOffscreenAlphaCompositing).toBe(true);
    expect(flatStyle(row).opacity).toBe(0.5);
    fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a plain row is opaque and keeps the same padding as a chosen one', () => {
    renderWithProviders(
      <>
        <SheetRow title="A" testID="plain" onPress={jest.fn()} />
        <SheetRow title="B" testID="chosen" selected onPress={jest.fn()} />
      </>,
    );
    expect(flatStyle(screen.getByTestId('plain')).opacity).toBe(1);
    const face = (id: string) => flatStyle(screen.getByTestId(`${id}-face`));
    expect(face('plain')).toMatchObject({ borderWidth: 2, borderColor: 'transparent', borderRadius: 20 });
    expect(face('chosen')).toMatchObject({ borderWidth: 2, borderColor: themes['gece-mavisi'].action });
    expect(face('plain').paddingVertical).toBe(face('chosen').paddingVertical);
  });
});

describe('CatalogueNarratorCards', () => {
  const catalogueVoice = (name: string, gender = 'female') => ({
    id: `tr-TR-Chirp3-HD-${name}`,
    voiceId: `tr-TR-Chirp3-HD-${name}`,
    name,
    language: 'Turkish',
    languageCode: 'tr-TR',
    contentLanguage: 'tr',
    gender,
    description: '',
    provider: 'GOOGLE',
  });
  const VOICES = ['Achernar', 'Puck', 'Kore', 'Orus'].map(name => catalogueVoice(name));

  it('offers the first three narrators as cards, each with its sample', () => {
    const onSelect = jest.fn();
    const onTogglePreview = jest.fn();
    renderWithProviders(
      <CatalogueNarratorCards voices={VOICES} onSelect={onSelect} onTogglePreview={onTogglePreview} />,
    );
    const radios = screen.getAllByRole('radio');
    expect(radios.map(node => node.props.accessibilityLabel)).toEqual([
      'Achernar, Hazır anlatıcı',
      'Puck, Hazır anlatıcı',
      'Kore, Hazır anlatıcı',
    ]);
    fireEvent.press(screen.getByRole('button', { name: 'Puck örneğini dinle' }));
    expect(onTogglePreview).toHaveBeenCalledWith(VOICES[1]);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.press(radios[2]);
    expect(onSelect).toHaveBeenCalledWith(VOICES[2]);
  });

  it('shows the playing sample and the one being added; the others wait', () => {
    const T = themes['gece-mavisi'];
    renderWithProviders(
      <CatalogueNarratorCards
        voices={VOICES}
        onSelect={jest.fn()}
        onTogglePreview={jest.fn()}
        previewPlayingKey={presetPreviewKey(VOICES[0])}
        addingVoiceId={VOICES[1].voiceId}
      />,
    );
    expect(screen.getByRole('button', { name: 'Achernar örneğini durdur' })).toBeOnTheScreen();
    expect(screen.getByTestId(`narrator-catalogue-card-adding-${VOICES[1].voiceId}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`narrator-catalogue-card-${VOICES[0].voiceId}`)).toBeDisabled();
    expect(screen.getByTestId(`narrator-catalogue-card-${VOICES[2].voiceId}`).props.needsOffscreenAlphaCompositing).toBe(true);
    // A card on the canvas, its avatar in the narrator's own colour.
    expect(flatStyle(screen.getByTestId(`narrator-catalogue-card-${VOICES[0].voiceId}-face`)).backgroundColor).toBe(T.surface);
    // The sample button stands out on the canvas (surface-2), unlike a sheet row's.
    expect(flatStyle(screen.getByTestId(`narrator-catalogue-card-preview-${VOICES[2].voiceId}-face`)).backgroundColor).toBe(T.surface2);
  });

  it('loads in its own shape: a card and its sample button per narrator', () => {
    const { UNSAFE_getAllByType, rerender } = renderWithProviders(<NarratorCardsSkeleton samples testID="bones" />);
    // Three card bones and three round 36dp bones on a 2dp lip under them.
    const samples = UNSAFE_getAllByType(Bone).filter(bone => bone.props.width === 36);
    expect(samples).toHaveLength(3);
    for (const bone of samples) expect(bone.props).toMatchObject({ height: 36, radius: 18, lip: 2 });
    expect(UNSAFE_getAllByType(Bone).filter(bone => bone.props.height === NARRATOR_CARD_HEIGHT)).toHaveLength(3);

    // The narrator row of the user's voices has no sample buttons.
    rerender(<NarratorCardsSkeleton testID="bones" />);
    expect(UNSAFE_getAllByType(Bone)).toHaveLength(3);
  });
});

describe('useNarratorPreview', () => {
  let api: ReturnType<typeof useNarratorPreview>;
  const Probe = observer(() => {
    api = useNarratorPreview();
    return <Text testID="probe">{`${api.playingId ?? '-'}|${api.loadingId ?? '-'}`}</Text>;
  });
  const state = () => screen.getByTestId('probe').props.children as string;
  const A = voice('a', 'Achernar', 'PRESET');
  const B = voice('b', 'Puck', 'PRESET');

  it('tapping B while A is still loading plays only B', async () => {
    const slowA = deferred<{ audioUrl: string }>();
    const fastB = deferred<{ audioUrl: string }>();
    mockPreviewVoice.mockImplementation((voiceId: string) => (voiceId === 'a-voice' ? slowA.promise : fastB.promise));
    renderWithProviders(<Probe />);

    let tapA: Promise<void> = Promise.resolve();
    let tapB: Promise<void> = Promise.resolve();
    await act(async () => {
      tapA = api.toggle(A);
    });
    expect(state()).toBe('-|a');
    await act(async () => {
      tapB = api.toggle(B);
    });
    expect(state()).toBe('-|b');

    await act(async () => {
      fastB.resolve({ audioUrl: 'https://cdn.test/b.mp3' });
      await tapB;
    });
    await act(async () => {
      slowA.resolve({ audioUrl: 'https://cdn.test/a.mp3' });
      await tapA;
    });

    expect(mockAudio.playFromUrl).toHaveBeenCalledTimes(1);
    expect(mockAudio.playFromUrl).toHaveBeenCalledWith('https://cdn.test/b.mp3', { key: 'b', title: 'Puck' });
    // A's late answer neither plays nor clears B's state.
    expect(state()).toBe('b|-');
  });

  it('a sample stopped while the player still takes it over does not play on', async () => {
    // The player pauses a playing story before the sample is its own.
    const handover = deferred<void>();
    mockAudio.playFromUrl.mockImplementationOnce(async (_url: string, meta: { key: string }) => {
      await handover.promise;
      runInAction(() => {
        mockAudio.source = 'sample';
        mockAudio.sampleKey = meta.key;
        mockAudio.isPlaying = true;
      });
    });
    renderWithProviders(<Probe />);

    let tapA: Promise<void> = Promise.resolve();
    await act(async () => {
      tapA = api.toggle(A);
    });
    expect(mockAudio.playFromUrl).toHaveBeenCalledTimes(1);
    // The page leaves (or the sheet closes) before the player has it.
    await act(async () => {
      await api.stop();
    });
    expect(mockAudio.stopPreview).not.toHaveBeenCalled();

    await act(async () => {
      handover.resolve();
      await tapA;
    });
    expect(mockAudio.stopPreview).toHaveBeenCalledWith('a');
    expect(mockAudio.sampleKey).toBeNull();
    expect(state()).toBe('-|-');
  });

  it('follows the store: busy until the sample sounds, back to play when it ends', async () => {
    renderWithProviders(<Probe />);
    await act(async () => {
      await api.toggle(A);
    });
    expect(state()).toBe('a|-');

    act(() => {
      runInAction(() => {
        mockAudio.previewPending = true;
      });
    });
    expect(state()).toBe('-|a');
    act(() => {
      runInAction(() => {
        mockAudio.previewPending = false;
      });
    });
    expect(state()).toBe('a|-');

    // The sample ended (or failed): the store left it; nothing to acknowledge.
    act(() => {
      runInAction(() => {
        mockAudio.source = 'none';
        mockAudio.sampleKey = null;
        mockAudio.isPlaying = false;
      });
    });
    expect(state()).toBe('-|-');
  });

  it('stop calls stopPreview with its key, and a second tap on the playing one stops it', async () => {
    renderWithProviders(<Probe />);
    await act(async () => {
      await api.toggle(A);
    });
    await act(async () => {
      await api.stop();
    });
    expect(mockAudio.stopPreview).toHaveBeenCalledWith('a');
    expect(state()).toBe('-|-');

    await act(async () => {
      await api.toggle(B);
    });
    await act(async () => {
      await api.toggle(B);
    });
    expect(mockAudio.stopPreview).toHaveBeenLastCalledWith('b');
    expect(mockAudio.playFromUrl).toHaveBeenCalledTimes(2);
    expect(state()).toBe('-|-');
  });

  it('nothing here stops a playing story, and a sample started elsewhere is not its own', async () => {
    renderWithProviders(<Probe />);
    act(() => {
      runInAction(() => {
        mockAudio.source = 'story';
        mockAudio.isPlaying = true;
      });
    });
    await act(async () => {
      await api.stop();
    });
    expect(mockAudio.stopPreview).not.toHaveBeenCalled();
    expect(mockAudio.stopAndCleanup).not.toHaveBeenCalled();
    expect(state()).toBe('-|-');

    // Sesim's sample of the same voice is not shown as playing here.
    act(() => {
      runInAction(() => {
        mockAudio.source = 'sample';
        mockAudio.sampleKey = 'a';
      });
    });
    expect(state()).toBe('-|-');
    await act(async () => {
      await api.stop();
    });
    expect(mockAudio.stopPreview).not.toHaveBeenCalled();
  });

  it('plays the own voice from its signed sample and says when there is none', async () => {
    const OWN = voice('own', 'Annem', 'CLONE');
    renderWithProviders(<Probe />);
    await act(async () => {
      await api.toggle(OWN);
    });
    expect(mockGetVoiceSample).toHaveBeenCalledWith('own');
    expect(mockAudio.playFromUrl).toHaveBeenCalledWith('https://cdn.test/own.wav', { key: 'own', title: 'Annem' });

    mockGetVoiceSample.mockResolvedValueOnce(null);
    await act(async () => {
      await api.stop();
    });
    await act(async () => {
      await api.toggle(OWN);
    });
    expect(showToast.error).toHaveBeenCalledWith('Bu sesin örneği bulunamadı.');
    expect(state()).toBe('-|-');
  });

  it('a sample that cannot be fetched resets and says so; a player failure is said once, by the player', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockPreviewVoice.mockRejectedValueOnce(new Error('offline'));
    renderWithProviders(<Probe />);
    await act(async () => {
      await api.toggle(A);
    });
    expect(showToast.error).toHaveBeenCalledWith('Örnek çalınamadı.');
    expect(state()).toBe('-|-');

    (showToast.error as jest.Mock).mockClear();
    mockAudio.playFromUrl.mockRejectedValueOnce(new Error('decode'));
    await act(async () => {
      await api.toggle(B);
    });
    expect(showToast.error).not.toHaveBeenCalled();
    expect(state()).toBe('-|-');
  });

  it('a catalogue narrator plays under its preset key', async () => {
    const puck = {
      id: 'tr-TR-Chirp3-HD-Puck',
      voiceId: 'tr-TR-Chirp3-HD-Puck',
      name: 'Puck',
      language: 'Turkish',
      languageCode: 'tr-TR',
      contentLanguage: 'tr',
      gender: 'male',
      description: '',
      provider: '',
    };
    renderWithProviders(<Probe />);
    await act(async () => {
      await api.toggleVoice(puck);
    });
    expect(mockPreviewVoice).toHaveBeenCalledWith('tr-TR-Chirp3-HD-Puck', 'GOOGLE');
    expect(state()).toBe(`${presetPreviewKey(puck)}|-`);
  });
});

describe('requestableLanguages', () => {
  it('keeps the catalogue order and drops the published languages', () => {
    const catalogue = [
      { code: 'tr', nativeName: 'Türkçe' },
      { code: 'en', nativeName: 'English' },
      { code: 'de', nativeName: 'Deutsch' },
    ];
    expect(requestableLanguages(catalogue, ['TR', 'de']).map(l => l.code)).toEqual(['en']);
    expect(requestableLanguages(catalogue, ['tr', 'en', 'de'])).toEqual([]);
    expect(requestableLanguages([], ['tr'])).toEqual([]);
  });
});

describe('TranslationRequestSheet', () => {
  const LANGUAGES = [
    { code: 'de', nativeName: 'Deutsch' },
    { code: 'fr', nativeName: 'Français' },
    { code: 'ar', nativeName: 'العربية' },
  ];

  /** Holds the requested list the way the screen does, so rollbacks show. */
  const Harness: React.FC<Partial<TranslationRequestSheetProps> & { initial?: string[] }> = ({
    initial = ['de'],
    onRequestedChange,
    ...rest
  }) => {
    const [requested, setRequested] = React.useState<string[]>(initial);
    return (
      <TranslationRequestSheet
        visible
        onClose={jest.fn()}
        storyId="s-1"
        languages={LANGUAGES}
        requestedLanguages={requested}
        onAlreadyAvailable={jest.fn()}
        {...rest}
        onRequestedChange={next => {
          setRequested(next);
          onRequestedChange?.(next);
        }}
      />
    );
  };

  it('draws frame 4b: native names, "Çeviri iste", the requested one and the note', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole('header', { name: 'Başka dilde iste' })).toBeOnTheScreen();
    expect(screen.getByText('Deutsch')).toBeOnTheScreen();
    expect(screen.getByText('Français')).toBeOnTheScreen();
    expect(screen.getByText('العربية')).toBeOnTheScreen();
    expect(screen.getAllByText('Çeviri iste')).toHaveLength(2);
    expect(screen.getAllByText('İstendi')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Deutsch isteğini geri al' })).toBeSelected();
    expect(screen.getAllByTestId('icon-check', { includeHiddenElements: true })).toHaveLength(1);
    expect(
      screen.getByText(
        'İsteğin kaydedilir. Çeviri yayımlanınca masal o dilde de açılır. Ne zaman olacağını söyleyemiyoruz.',
      ),
    ).toBeOnTheScreen();
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('draws raised rows and chunky toggles in the %s theme', scheme => {
    const T = themes[scheme];
    renderWithProviders(<Harness />, { theme: scheme });
    expect(flatStyle(screen.getByTestId('translation-row-de-face')).backgroundColor).toBe(T.surface2);
    // The language code on a small tile.
    expect(screen.getByText('DE')).toBeOnTheScreen();
    // "Çeviri iste" on the sheet colour, "İstendi" on the opaque ready tint.
    expect(flatStyle(screen.getByTestId('translation-request-fr-face')).backgroundColor).toBe(T.surface);
    expect(flatStyle(screen.getAllByText('Çeviri iste')[0]).color).toBe(T.text);
    const requested = flatStyle(screen.getByTestId('translation-request-de-face')).backgroundColor;
    expect(requested).toBe(requestedToggleFace(T));
    expect(requested).toMatch(/^#[0-9a-f]{6}$/i);
    expect(flatStyle(screen.getByText('İstendi')).color).toBe(T.chipOkFg);
    // The toggle: 36 tall, radius 12, a 2dp lip; its label stops growing at 1.3.
    expect(flatStyle(screen.getByTestId('translation-request-de-face'))).toMatchObject({
      minHeight: 36,
      borderRadius: 12,
    });
    expect(flatStyle(screen.getByTestId('translation-request-de-lip')).top).toBe(2);
    expect(screen.getByText('İstendi').props.maxFontSizeMultiplier).toBe(1.3);
  });

  it('the requested ink reads at 4.5:1 on the requested face in every palette', () => {
    for (const key of PALETTE_KEYS) {
      const T = themes[key];
      const face = requestedToggleFace(T);
      expect(face).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrastRatio(T.chipOkFg, face)).toBeGreaterThanOrEqual(4.5);
    }
    // Orijinal keeps the stronger tint of its chipOkBg.
    expect(requestedToggleFace(themes.orijinal)).not.toBe(requestedToggleFace({ ...themes.orijinal, name: 'erik' }));
  });

  it('requests at once and reports the new list', async () => {
    const onRequestedChange = jest.fn();
    renderWithProviders(<Harness onRequestedChange={onRequestedChange} />);

    fireEvent.press(screen.getByRole('button', { name: 'Français çevirisi iste' }));
    // Optimistic: shown before the request resolves.
    expect(screen.getAllByText('İstendi')).toHaveLength(2);
    expect(onRequestedChange).toHaveBeenCalledWith(['de', 'fr']);
    await waitFor(() => expect(mockRequestTranslation).toHaveBeenCalledWith('s-1', 'fr'));
    await act(async () => undefined);
    expect(onRequestedChange).toHaveBeenCalledTimes(1);
    expect(showToast.error).not.toHaveBeenCalled();
  });

  it('withdraws a request by tapping "İstendi"', async () => {
    const onRequestedChange = jest.fn();
    renderWithProviders(<Harness onRequestedChange={onRequestedChange} />);

    fireEvent.press(screen.getByRole('button', { name: 'Deutsch isteğini geri al' }));
    expect(screen.queryByText('İstendi')).toBeNull();
    expect(onRequestedChange).toHaveBeenCalledWith([]);
    await waitFor(() => expect(mockCancelTranslationRequest).toHaveBeenCalledWith('s-1', 'de'));
    await act(async () => undefined);
  });

  it('ignores a second tap on a language while its request is out', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    mockRequestTranslation.mockReturnValueOnce(new Promise(r => (resolve = r)));
    renderWithProviders(<Harness />);

    fireEvent.press(screen.getByRole('button', { name: 'Français çevirisi iste' }));
    fireEvent.press(screen.getByRole('button', { name: 'Français isteğini geri al' }));
    expect(mockCancelTranslationRequest).not.toHaveBeenCalled();
    expect(screen.getAllByText('İstendi')).toHaveLength(2);

    await act(async () => {
      resolve({});
    });
    fireEvent.press(screen.getByRole('button', { name: 'Français isteğini geri al' }));
    await waitFor(() => expect(mockCancelTranslationRequest).toHaveBeenCalledWith('s-1', 'fr'));
    await act(async () => undefined);
  });

  it('rolls a failed request back and shows the error snackbar', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRequestTranslation.mockRejectedValueOnce(apiErrorFromResponse(429, { message: 'slow down' }));
    const onRequestedChange = jest.fn();
    const onAlreadyAvailable = jest.fn();
    renderWithProviders(
      <Harness onRequestedChange={onRequestedChange} onAlreadyAvailable={onAlreadyAvailable} />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Français çevirisi iste' }));
    await waitFor(() =>
      expect(showToast.error).toHaveBeenCalledWith('İstek kaydedilemedi. Tekrar dene.'),
    );
    expect(onRequestedChange).toHaveBeenLastCalledWith(['de']);
    expect(screen.getAllByText('İstendi')).toHaveLength(1);
    expect(onAlreadyAvailable).not.toHaveBeenCalled();
  });

  it('rolls a failed withdrawal back', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCancelTranslationRequest.mockRejectedValueOnce(new Error('offline'));
    renderWithProviders(<Harness />);

    fireEvent.press(screen.getByRole('button', { name: 'Deutsch isteğini geri al' }));
    await waitFor(() =>
      expect(showToast.error).toHaveBeenCalledWith('İstek geri alınamadı. Tekrar dene.'),
    );
    expect(screen.getAllByText('İstendi')).toHaveLength(1);
  });

  it('a 409 TRANSLATION_ALREADY_AVAILABLE hands over to the caller instead of an error', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRequestTranslation.mockRejectedValueOnce(
      apiErrorFromResponse(409, { statusCode: 409, code: 'TRANSLATION_ALREADY_AVAILABLE', message: 'var' }),
    );
    const onAlreadyAvailable = jest.fn();
    renderWithProviders(<Harness onAlreadyAvailable={onAlreadyAvailable} />);

    fireEvent.press(screen.getByRole('button', { name: 'Français çevirisi iste' }));
    await waitFor(() => expect(onAlreadyAvailable).toHaveBeenCalledWith('fr'));
    expect(showToast.info).toHaveBeenCalledWith('Bu masalın Fransızca çevirisi yayımlanmış.');
    expect(showToast.error).not.toHaveBeenCalled();
    expect(screen.getAllByText('İstendi')).toHaveLength(1);
  });

  it('another 409 is an ordinary failure', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRequestTranslation.mockRejectedValueOnce(
      apiErrorFromResponse(409, { statusCode: 409, code: 'SOMETHING_ELSE', message: 'x' }),
    );
    const onAlreadyAvailable = jest.fn();
    renderWithProviders(<Harness onAlreadyAvailable={onAlreadyAvailable} />);

    fireEvent.press(screen.getByRole('button', { name: 'Français çevirisi iste' }));
    await waitFor(() => expect(showToast.error).toHaveBeenCalled());
    expect(onAlreadyAvailable).not.toHaveBeenCalled();
  });

  it('is translated', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    renderWithProviders(<Harness />);
    expect(screen.getByRole('header', { name: 'Ask for another language' })).toBeOnTheScreen();
    // Short enough to leave the language name its room at 360dp.
    expect(screen.getAllByText('Request')).toHaveLength(2);
    expect(screen.getByText('Requested')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Withdraw the Deutsch request' })).toBeOnTheScreen();
  });
});

describe('getNarratorDisplay: ready-made narrators are called by their bare voice name', () => {
  const base = { kind: 'PRESET', provider: 'GOOGLE' };

  it('cleans the names profiles got from the old catalogue', () => {
    expect(
      getNarratorDisplay({ ...base, name: 'Chirp3 Achernar (HD)', voiceId: 'tr-TR-Chirp3-HD-Achernar' })?.name,
    ).toBe('Achernar');
    expect(getNarratorDisplay({ ...base, name: 'Kore (HD)', voiceId: '' })?.name).toBe('Kore');
    expect(getNarratorDisplay({ ...base, name: 'Achernar' })?.name).toBe('Achernar');
  });

  it("never touches a name the user typed for their own voice, or a name of unknown origin", () => {
    expect(
      getNarratorDisplay({ kind: 'CLONE', provider: 'CARTESIA', name: 'Annem (HD)', voiceId: 'c-1' })?.name,
    ).toBe('Annem (HD)');
    expect(getNarratorDisplay({ name: 'Chirp3 Deneme' })?.name).toBe('Chirp3 Deneme');
    expect(getNarratorDisplay({ name: '   ' })).toBeNull();
    expect(getNarratorDisplay(null)).toBeNull();
  });
});
