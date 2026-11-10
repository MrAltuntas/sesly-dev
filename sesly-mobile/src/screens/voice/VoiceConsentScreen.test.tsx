/**
 * VoiceConsentScreen (playful design): consent step of the clone flow.
 *
 * Uses the real VoiceProfileStore so the clone-config parse + error mapping
 * chain is exercised; only the service, socket and toast layers are mocked.
 */

import React from 'react';
import { act, fireEvent, screen, userEvent } from '@testing-library/react-native';
import { runInAction } from 'mobx';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { VoiceProfileStore } from '../../hooks/useVoiceProfile';
import { CloneConfig, parseCloneConfigFromJSON } from '../../models/VoiceClone';
import { apiErrorFromResponse } from '../../services/ApiError';
import { VoiceConsentScreen } from './VoiceConsentScreen';

// The first render in a cold Jest cache lazily transforms React Native
// internals (plus coverage instrumentation); on a loaded machine that took
// well over the 5 s default (and once over 30 s) in parallel runs.
// Warm runs stay well under 1 s per test.
jest.setTimeout(60000);

const mockGetCloneConfig = jest.fn();

jest.mock('../../services/VoiceProfileService', () => ({
  __esModule: true,
  default: {
    getCloneConfig: (...args: unknown[]) => mockGetCloneConfig(...args),
    getMyVoiceProfiles: jest.fn(() => Promise.resolve([])),
  },
}));
jest.mock('../../services/WebSocketService', () => ({
  __esModule: true,
  default: {
    addVoiceStatusListener: jest.fn(),
    setVoiceStatusFallback: jest.fn(),
  },
}));
jest.mock('../../utils/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

let mockVoiceStore: VoiceProfileStore;
jest.mock('../../hooks/useVoiceProfile', () => {
  const actual = jest.requireActual('../../hooks/useVoiceProfile');
  return { ...actual, useVoiceProfile: () => mockVoiceStore };
});

const mockNav = {
  navigate: jest.fn(),
  goBack: jest.fn(),
};
let mockRouteParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockRouteParams }),
}));

const CONSENT_JSON = {
  enabled: true,
  minSeconds: 15,
  targetSeconds: 30,
  maxSeconds: 60,
  scriptTitle: 'Okuma metni',
  script: 'Bir varmis bir yokmus.',
  consentVersion: 'kvkk-2026-09',
  consentTitle: 'Ses kaydi acik riza metni',
  consentText: 'Birinci paragraf.\n\nIkinci paragraf.',
};

const CONTINUE = 'Onayla ve devam et';
const CHECK_LABEL = 'Metni okudum, açık rızamı veriyorum.';

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

// Renders and lets the mount-time async work settle
// inside act (otherwise a sync test logs an act() warning).
async function renderScreen(theme: 'gece-mavisi' | 'kitaplik' = 'gece-mavisi') {
  const utils = renderWithProviders(<VoiceConsentScreen />, { theme });
  await act(async () => undefined);
  return utils;
}

function config(overrides: Record<string, unknown> = {}): CloneConfig {
  return parseCloneConfigFromJSON({ ...CONSENT_JSON, ...overrides });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = { name: 'Annem' };
  mockGetCloneConfig.mockReset();
  mockVoiceStore = new VoiceProfileStore();
});

describe('VoiceConsentScreen', () => {
  it('shows the served consent text and keeps the button disabled until the box is checked', async () => {
    mockGetCloneConfig.mockResolvedValue(config());
    await renderScreen();

    expect(await screen.findByText('Ses kaydi acik riza metni')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Açık rıza' })).toBeOnTheScreen();
    expect(
      screen.getByText('Sesin kişisel verin. Kayıttan önce metni oku ve onayla.'),
    ).toBeOnTheScreen();
    // A Turkish voice in the Turkish app needs no language line.
    expect(screen.queryByTestId('consent-language-note')).toBeNull();
    // The served document, not a summary written in the app.
    expect(screen.getByText('Birinci paragraf.')).toBeOnTheScreen();
    expect(screen.getByText('Ikinci paragraf.')).toBeOnTheScreen();

    const cta = screen.getByRole('button', { name: CONTINUE });
    expect(cta).toBeDisabled();
    // userEvent drives the real Pressable; fireEvent would walk up to the
    // composite Button and call its onPress prop even while disabled.
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.press(cta);
    expect(mockNav.navigate).not.toHaveBeenCalled();

    const checkbox = screen.getByRole('checkbox', { name: CHECK_LABEL });
    expect(checkbox).not.toBeChecked();
    fireEvent.press(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByRole('button', { name: CONTINUE })).toBeEnabled();
  });

  it('navigates to VoiceRecording with the served consent version once accepted', async () => {
    mockGetCloneConfig.mockResolvedValue(config());
    await renderScreen();

    fireEvent.press(await screen.findByRole('checkbox', { name: CHECK_LABEL }));
    fireEvent.press(screen.getByRole('button', { name: CONTINUE }));

    expect(mockNav.navigate).toHaveBeenCalledWith('VoiceRecording', {
      name: 'Annem',
      consentVersion: 'kvkk-2026-09',
      resumeTake: false,
      // The language the consent was shown in travels with its version.
      language: 'tr',
    });
  });

  it('shows the consent of the chosen voice language and hands its version on', async () => {
    mockRouteParams = { name: 'Mom', language: 'en' };
    mockGetCloneConfig.mockResolvedValue(
      config({
        language: 'en',
        locale: 'en-US',
        consentVersion: 'en-2026-10',
        consentTitle: 'Voice recording consent',
        consentText: 'First paragraph.',
      }),
    );
    await renderScreen();

    expect(await screen.findByText('Voice recording consent')).toBeOnTheScreen();
    expect(mockGetCloneConfig).toHaveBeenCalledWith('en');
    // The app speaks Turkish: one Turkish line says which language the text
    // is in, naming it in Turkish (inside a sentence, not the native name).
    expect(screen.getByTestId('consent-language-note')).toHaveTextContent(
      'Bu metin, kaydedeceğin sesin dilinde: İngilizce.',
    );

    fireEvent.press(screen.getByRole('checkbox', { name: CHECK_LABEL }));
    fireEvent.press(screen.getByRole('button', { name: CONTINUE }));
    expect(mockNav.navigate).toHaveBeenCalledWith('VoiceRecording', {
      name: 'Mom',
      consentVersion: 'en-2026-10',
      resumeTake: false,
      language: 'en',
    });
  });

  it('does not show the consent of another language: it loads the chosen one', async () => {
    // The intro step left the Turkish texts in the store.
    mockGetCloneConfig.mockResolvedValueOnce(config());
    await mockVoiceStore.loadCloneConfig('tr');
    mockRouteParams = { name: 'Mom', language: 'en' };
    mockGetCloneConfig.mockReturnValue(new Promise(() => undefined));
    await renderScreen();

    expect(screen.queryByText('Ses kaydi acik riza metni')).toBeNull();
    expect(screen.getByText('Onay metni yükleniyor...')).toBeOnTheScreen();
    expect(mockGetCloneConfig).toHaveBeenLastCalledWith('en');
  });

  it('offers a retry when the chosen language could only be answered in another one', async () => {
    // 400 for English, then the default (Turkish) texts.
    mockRouteParams = { name: 'Mom', language: 'en' };
    mockGetCloneConfig
      .mockRejectedValueOnce(apiErrorFromResponse(400, { code: 'VOICE_LANGUAGE_NOT_SUPPORTED' }))
      .mockResolvedValueOnce(config());
    await renderScreen();

    expect(await screen.findByTestId('consent-error')).toBeOnTheScreen();
    expect(screen.queryByText('Ses kaydi acik riza metni')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('keeps resumeTake on the way back to the recording after a re-consent', async () => {
    mockRouteParams = { name: 'Annem', resumeTake: true };
    mockGetCloneConfig.mockResolvedValue(config({ consentVersion: 'kvkk-2026-10' }));
    await renderScreen();

    fireEvent.press(await screen.findByRole('checkbox', { name: CHECK_LABEL }));
    fireEvent.press(screen.getByRole('button', { name: CONTINUE }));

    expect(mockNav.navigate).toHaveBeenCalledWith('VoiceRecording', {
      name: 'Annem',
      consentVersion: 'kvkk-2026-10',
      resumeTake: true,
      language: 'tr',
    });
  });

  it('passes the story the flow was started from on to the recording', async () => {
    mockRouteParams = { name: 'Annem', language: 'tr', returnToStoryId: 'story-7' };
    mockGetCloneConfig.mockResolvedValue(config());
    await renderScreen();

    fireEvent.press(await screen.findByRole('checkbox', { name: CHECK_LABEL }));
    fireEvent.press(screen.getByRole('button', { name: CONTINUE }));

    expect(mockNav.navigate).toHaveBeenCalledWith('VoiceRecording', {
      name: 'Annem',
      consentVersion: 'kvkk-2026-09',
      resumeTake: false,
      language: 'tr',
      returnToStoryId: 'story-7',
    });
  });

  it('fades the text at both card edges, with the bottom padding equal to its fade', async () => {
    mockGetCloneConfig.mockResolvedValue(config());
    await renderScreen();
    await screen.findByText('Birinci paragraf.');

    const scroll = screen.getByTestId('consent-scroll');
    // The scrollbar shows while scrolling only: a persistent one read as a
    // notch cut into the card edge.
    expect(scroll.props.persistentScrollbar).toBeFalsy();
    const content = Object.assign({}, ...[scroll.props.contentContainerStyle].flat(4).filter(Boolean));
    expect(content).toMatchObject({ padding: 16, paddingBottom: 32 });
    expect(flatStyle(screen.getByTestId('consent-fade-bottom'))).toMatchObject({ bottom: 0, height: 32 });
    // A line scrolled under the top edge fades instead of being cut flush.
    expect(flatStyle(screen.getByTestId('consent-fade-top'))).toMatchObject({ top: 0, height: 16 });
  });

  it('drops the acceptance when a new consent version arrives', async () => {
    mockGetCloneConfig.mockResolvedValue(config());
    await renderScreen();

    fireEvent.press(await screen.findByRole('checkbox', { name: CHECK_LABEL }));
    expect(screen.getByRole('button', { name: CONTINUE })).toBeEnabled();

    act(() => {
      runInAction(() => {
        mockVoiceStore.cloneConfig = config({ consentVersion: 'kvkk-2026-10' });
      });
    });

    expect(screen.getByRole('checkbox', { name: CHECK_LABEL })).not.toBeChecked();
    expect(screen.getByRole('button', { name: CONTINUE })).toBeDisabled();
  });

  it('toggles the checkbox from its label and falls back to the default name', async () => {
    mockRouteParams = {};
    mockGetCloneConfig.mockResolvedValue(config());
    await renderScreen();

    await screen.findByRole('checkbox', { name: CHECK_LABEL });
    // The visible label is hidden from screen readers (the box carries it).
    fireEvent.press(screen.getByText(CHECK_LABEL, { includeHiddenElements: true }));
    expect(screen.getByRole('checkbox', { name: CHECK_LABEL })).toBeChecked();
    fireEvent.press(screen.getByRole('button', { name: CONTINUE }));

    expect(mockNav.navigate).toHaveBeenCalledWith(
      'VoiceRecording',
      expect.objectContaining({ name: 'Benim Sesim' }),
    );
  });

  it('shows a loading state while the clone config is being fetched', async () => {
    mockGetCloneConfig.mockReturnValue(new Promise(() => undefined));
    await renderScreen();

    expect(screen.getByText('Onay metni yükleniyor...')).toBeOnTheScreen();
    // A spinner with its line, announced as a busy progress indicator.
    const loading = screen.getByTestId('consent-loading');
    expect(loading.props.accessibilityRole).toBe('progressbar');
    expect(loading.props.accessibilityLabel).toBe('Onay metni yükleniyor...');
    expect(screen.queryByRole('button', { name: CONTINUE })).toBeNull();
    expect(mockGetCloneConfig).toHaveBeenCalledTimes(1);
  });

  it('refuses to proceed when the served consent text is missing, and retries', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // Real parser: blank consent text is a CloneConfigError.
    mockGetCloneConfig.mockImplementationOnce(async () =>
      parseCloneConfigFromJSON({ ...CONSENT_JSON, consentText: '   ' }),
    );
    await renderScreen();

    expect(await screen.findByText('Onay metni yüklenemedi')).toBeOnTheScreen();
    expect(
      screen.getByText('Onay metni şu an yüklenemedi. Lütfen biraz sonra tekrar dene.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: CONTINUE })).toBeNull();

    mockGetCloneConfig.mockResolvedValueOnce(config());
    fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));

    expect(await screen.findByText('Ses kaydi acik riza metni')).toBeOnTheScreen();
    expect(mockGetCloneConfig).toHaveBeenCalledTimes(2);
  });

  it('explains that recording is closed when the config is disabled', async () => {
    mockGetCloneConfig.mockResolvedValue(config({ enabled: false }));
    await renderScreen();

    expect(await screen.findByText('Ses kaydı şimdilik kapalı')).toBeOnTheScreen();
    expect(screen.queryByRole('checkbox')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Geri dön' }));
    expect(mockNav.goBack).toHaveBeenCalledTimes(1);
  });

  it('goes back from the app bar', async () => {
    mockGetCloneConfig.mockResolvedValue(config());
    await renderScreen();
    await screen.findByText('Birinci paragraf.');

    fireEvent.press(screen.getByRole('button', { name: 'Geri' }));
    expect(mockNav.goBack).toHaveBeenCalledTimes(1);
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', async scheme => {
    mockGetCloneConfig.mockResolvedValue(config());
    await renderScreen(scheme);
    const T = themes[scheme];

    // The served document in a surface card on its lip, no outline.
    const card = flatStyle(await screen.findByTestId('consent-card-face'));
    expect(card.backgroundColor).toBe(T.surface);
    // The card's 2dp ring is always there, transparent unless selected.
    expect(card.borderColor).toBe('transparent');
    expect(flatStyle(screen.getByTestId('consent-card-lip')).backgroundColor).toBe(T.lip);
    expect(flatStyle(screen.getByText('Ses kaydi acik riza metni'))).toMatchObject({
      fontFamily: T.fontDisplay,
      color: T.text,
    });
    expect(flatStyle(screen.getByText('Birinci paragraf.')).color).toBe(T.text2);

    // Step 2 of 3.
    expect(screen.getByLabelText('Adım 2, toplam 3 adım')).toBeOnTheScreen();
    expect(screen.getAllByTestId('consent-steps-on')).toHaveLength(2);
    expect(flatStyle(screen.getAllByTestId('consent-steps-on')[0]).backgroundColor).toBe(T.action);

    // The agreement card: neutral until checked, then ringed in the action colour.
    expect(flatStyle(screen.getByTestId('consent-check-face')).backgroundColor).toBe(T.surface);
    fireEvent.press(screen.getByRole('checkbox', { name: CHECK_LABEL }));
    expect(flatStyle(screen.getByTestId('consent-check-face'))).toMatchObject({
      backgroundColor: T.surface2,
      borderColor: T.action,
    });

    expect(flatStyle(screen.getByTestId('consent-dock')).backgroundColor).toBe(T.bg);
    expect(flatStyle(screen.getByTestId('consent-accept-face')).backgroundColor).toBe(T.action);
  });

  it('is translated into English, while the served text stays as served', async () => {
    await i18n.changeLanguage('en');
    mockGetCloneConfig.mockResolvedValue(config());
    await renderScreen();

    expect(await screen.findByRole('header', { name: 'Explicit consent' })).toBeOnTheScreen();
    expect(screen.getByText('Birinci paragraf.')).toBeOnTheScreen();
    expect(
      screen.getByRole('checkbox', {
        name: 'I have read the text and I give my explicit consent.',
      }),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Accept and continue' })).toBeDisabled();
    // The served Turkish text in the English app: the note names it in English.
    expect(screen.getByTestId('consent-language-note')).toHaveTextContent(
      'This text is in the language of the voice you will record: Turkish.',
    );
  });
});
