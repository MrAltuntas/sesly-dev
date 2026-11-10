/**
 * CreateVoiceProfileScreen (playful design): intro step of the clone flow.
 *
 * The voice profile store is a plain object so each test pins the served
 * clone config (with or without `introSteps`). The voice language step runs
 * against the real store, with only the service mocked.
 */

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n, { resources } from '../../i18n';
import { dockBottom, themes } from '../../theme/theme';
import { CloneConfig, parseCloneConfigFromJSON } from '../../models/VoiceClone';
import type { PlanId } from '../../models/Plans';
import type { UsageBucket, UsageSummary } from '../../models/Quota';
import { apiErrorFromResponse } from '../../services/ApiError';
import { showToast } from '../../utils/toast';
import type { DialogOptions } from '../../hooks/useDialog';
import { CreateVoiceProfileScreen, freePlanLine } from './CreateVoiceProfileScreen';

// Cold-cache first renders can exceed the 5 s default (see the other
// voice screen tests).
jest.setTimeout(60000);

interface VoiceStoreMock {
  cloneConfig: CloneConfig | null;
  cloneLanguage: string | null;
  isLoadingCloneConfig: boolean;
  cloneConfigError: string | null;
  loadCloneConfig: jest.Mock;
  checkCanCreate: jest.Mock;
  slotBlock: jest.Mock;
  voiceProfiles: unknown[];
}

// Either the plain mock above or a real VoiceProfileStore (language step).
let mockVoiceStore: unknown;
const mockShowDialog = jest.fn();
const mockGetCloneConfig = jest.fn();

jest.mock('../../services/VoiceProfileService', () => ({
  __esModule: true,
  default: {
    getCloneConfig: (...args: unknown[]) => mockGetCloneConfig(...args),
    getMyVoiceProfiles: jest.fn(() => Promise.resolve([])),
    getVoiceSlots: jest.fn(() =>
      Promise.resolve({
        used: 0,
        limit: 1,
        available: 1,
        plan: 'free',
        canCreate: true,
        message: null,
        preset: null,
        clone: null,
      }),
    ),
  },
}));
jest.mock('../../utils/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));
jest.mock('../../hooks/useVoiceProfile', () => ({
  ...jest.requireActual('../../hooks/useVoiceProfile'),
  useVoiceProfile: () => mockVoiceStore,
}));
// "Masal dili": the language the flow starts in.
const mockContentLanguage = { effective: 'tr', load: jest.fn(() => Promise.resolve()) };
jest.mock('../../hooks/useContentLanguage', () => ({
  ...jest.requireActual('../../hooks/useContentLanguage'),
  useContentLanguage: () => mockContentLanguage,
}));
// The plan and its live allowance (GET /usage).
const mockSubscription: {
  planId: PlanId;
  usage: UsageSummary | null;
  loadUsageIfStale: jest.Mock;
} = { planId: 'free', usage: null, loadUsageIfStale: jest.fn(() => Promise.resolve()) };
jest.mock('../../hooks/useSubscription', () => ({
  useSubscription: () => mockSubscription,
}));
jest.mock('../../hooks/useDialog', () => ({
  useDialog: () => ({ showDialog: mockShowDialog, hideDialog: jest.fn() }),
}));

const mockNav = {
  navigate: jest.fn(),
  goBack: jest.fn(),
};
let mockRouteParams: Record<string, unknown> | undefined;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockRouteParams }),
}));

const bucket = (limit: number | null): UsageBucket => ({
  limit,
  used: 0,
  remaining: limit,
  period: 'lifetime',
  renewsAt: null,
});

function usageWith(cloneCreations: number | null, cloneNarrations: number | null): UsageSummary {
  return {
    planId: 'free',
    buckets: {
      presetNarrations: bucket(20),
      cloneNarrations: bucket(cloneNarrations),
      cloneCreations: bucket(cloneCreations),
    },
    voiceSlots: { preset: { used: 0, limit: 3 }, clone: { used: 0, limit: 1 } },
    features: { backgroundPlayback: false, premiumStories: false },
  };
}

const BASE_JSON = {
  enabled: true,
  minSeconds: 20,
  targetSeconds: 45,
  maxSeconds: 90,
  scriptTitle: 'Okuma metni',
  script: 'Bir varmis bir yokmus.',
  consentVersion: 'kvkk-2026-09',
  consentText: 'Onay metni.',
};

function makeVoiceStore(cloneConfig: CloneConfig | null): VoiceStoreMock {
  return {
    cloneConfig,
    cloneLanguage: cloneConfig?.language ?? null,
    isLoadingCloneConfig: false,
    cloneConfigError: null,
    loadCloneConfig: jest.fn(() => Promise.resolve(cloneConfig)),
    checkCanCreate: jest.fn(() => Promise.resolve(true)),
    slotBlock: jest.fn(),
    voiceProfiles: [],
  };
}

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

async function renderScreen(theme: 'gece-mavisi' | 'kitaplik' = 'gece-mavisi') {
  const utils = renderWithProviders(<CreateVoiceProfileScreen />, { theme });
  await act(async () => undefined);
  return utils;
}

/** The plain store of the tests that pin a config. */
const plainStore = () => mockVoiceStore as VoiceStoreMock;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCloneConfig.mockReset();
  mockContentLanguage.effective = 'tr';
  mockRouteParams = undefined;
  mockSubscription.planId = 'free';
  mockSubscription.usage = null;
  mockSubscription.loadUsageIfStale = jest.fn(() => Promise.resolve());
  mockVoiceStore = makeVoiceStore(parseCloneConfigFromJSON(BASE_JSON));
});

describe('CreateVoiceProfileScreen', () => {
  it('names the screen and shows the built-in steps with the served durations', async () => {
    await renderScreen();

    // The config is asked for in the content language.
    await waitFor(() => expect(plainStore().loadCloneConfig).toHaveBeenCalledWith('tr'));
    expect(plainStore().loadCloneConfig).toHaveBeenCalledTimes(1);
    // A backend that offers no choice of language: no language step.
    expect(screen.queryByTestId('voice-language-step')).toBeNull();
    expect(screen.getByRole('header', { name: 'Kendi sesin' })).toBeOnTheScreen();
    expect(screen.getByText('Üç adımda\nkendi sesin')).toBeOnTheScreen();
    expect(screen.getByText('Sessiz bir oda bul')).toBeOnTheScreen();
    expect(
      screen.getByText('Çevren ne kadar sessiz olursa Sesly sesini o kadar temiz öğrenir.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Yaklaşık 45 saniyelik bir masal oku')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Sana kısa bir masal metni göstereceğiz. En az 20 saniye okuman gerekiyor; daha uzun kayıt aksanını daha iyi korur.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText('Sesin hazırlansın')).toBeOnTheScreen();
    expect(screen.getByText('3')).toBeOnTheScreen();
    expect(screen.getByText('Sesin adı')).toBeOnTheScreen();
  });

  it('draws the steps card as a skeleton until the first config load settles', async () => {
    mockVoiceStore = makeVoiceStore(null);
    plainStore().isLoadingCloneConfig = true;
    await renderScreen();

    // No built-in copy that the served steps would then swap out.
    expect(screen.getByTestId('voice-intro-steps-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('voice-intro-steps-card')).toBeNull();
    expect(screen.queryByText('Sessiz bir oda bul')).toBeNull();
    // The name and "Devam" are there already.
    expect(screen.getByDisplayValue('Benim Sesim')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Devam' })).toBeEnabled();
  });

  it('falls back to the built-in steps when the config could not be loaded', async () => {
    mockVoiceStore = makeVoiceStore(null);
    plainStore().cloneConfigError = 'Kayıt bilgileri şu an yüklenemedi.';
    await renderScreen();

    expect(screen.queryByTestId('voice-intro-steps-loading')).toBeNull();
    expect(screen.getByText('Sessiz bir oda bul')).toBeOnTheScreen();
    // Local fallback: 30 s target, 15 s minimum.
    expect(screen.getByText('Yaklaşık 30 saniyelik bir masal oku')).toBeOnTheScreen();
    expect(screen.getByText(/En az 15 saniye okuman gerekiyor/)).toBeOnTheScreen();
  });

  it('shows only the closed state while cloning is switched off', async () => {
    mockVoiceStore = makeVoiceStore(parseCloneConfigFromJSON({ ...BASE_JSON, enabled: false }));
    await renderScreen();

    expect(screen.getByTestId('intro-closed')).toBeOnTheScreen();
    expect(screen.getByText('Ses kaydı şimdilik kapalı')).toBeOnTheScreen();
    // Nothing to type and nothing to continue to.
    expect(screen.queryByTestId('voice-name-field')).toBeNull();
    expect(screen.queryByTestId('voice-intro-continue')).toBeNull();
    expect(screen.queryByTestId('voice-intro-dock')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Geri dön' }));
    expect(mockNav.goBack).toHaveBeenCalledTimes(1);
    expect(plainStore().checkCanCreate).not.toHaveBeenCalled();
  });

  it("keeps the app's own steps when the config serves steps of its own", async () => {
    mockVoiceStore = makeVoiceStore(
      parseCloneConfigFromJSON({
        ...BASE_JSON,
        introSteps: [
          { title: 'Rahat bir yer seç', body: 'Kapıyı kapat, televizyonu kapat.' },
          { title: 'Masalı oku', body: 'Ekrandaki metni sesli oku.' },
          { title: 'Eksik adım' },
          { title: 'Hazır olunca haber veririz', body: 'Bildirim göndereceğiz.' },
          { title: 'Son adım', body: 'Masalları dinle.' },
        ],
      }),
    );
    await renderScreen();

    // The served steps come in the voice language: one source, the app's.
    expect(screen.getByText('Sessiz bir oda bul')).toBeOnTheScreen();
    expect(screen.getByText('Yaklaşık 45 saniyelik bir masal oku')).toBeOnTheScreen();
    expect(screen.getByText('Sesin hazırlansın')).toBeOnTheScreen();
    expect(screen.getByText('3')).toBeOnTheScreen();
    expect(screen.queryByText('4')).toBeNull();
    for (const served of ['Rahat bir yer seç', 'Masalı oku', 'Hazır olunca haber veririz', 'Son adım']) {
      expect(screen.queryByText(served)).toBeNull();
    }
  });

  it('checks the clone slots and continues to consent with the trimmed name', async () => {
    await renderScreen();

    fireEvent.changeText(screen.getByPlaceholderText('Benim Sesim'), '  Annem  ');
    fireEvent.press(screen.getByRole('button', { name: 'Devam' }));

    await waitFor(() =>
      expect(mockNav.navigate).toHaveBeenCalledWith('VoiceConsent', {
        name: 'Annem',
        language: 'tr',
      }),
    );
    expect(plainStore().checkCanCreate).toHaveBeenCalledWith('clone');
  });

  it('starts with the default name and refuses a name shorter than two letters', async () => {
    await renderScreen();

    expect(screen.getByDisplayValue('Benim Sesim')).toBeOnTheScreen();
    fireEvent.changeText(screen.getByPlaceholderText('Benim Sesim'), ' A ');
    expect(screen.getByRole('button', { name: 'Devam' })).toBeDisabled();

    fireEvent(screen.getByPlaceholderText('Benim Sesim'), 'submitEditing');
    await act(async () => undefined);
    expect(plainStore().checkCanCreate).not.toHaveBeenCalled();
    expect(mockNav.navigate).not.toHaveBeenCalled();
  });

  it('continues from the keyboard when the name is valid', async () => {
    await renderScreen();

    fireEvent(screen.getByPlaceholderText('Benim Sesim'), 'submitEditing');

    await waitFor(() =>
      expect(mockNav.navigate).toHaveBeenCalledWith('VoiceConsent', {
        name: 'Benim Sesim',
        language: 'tr',
      }),
    );
  });

  it('passes the story it was started from on to the consent step', async () => {
    mockRouteParams = { returnToStoryId: 'story-7' };
    await renderScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Devam' }));

    await waitFor(() =>
      expect(mockNav.navigate).toHaveBeenCalledWith('VoiceConsent', {
        name: 'Benim Sesim',
        language: 'tr',
        returnToStoryId: 'story-7',
      }),
    );
  });

  it('offers the plans in the same block dialog as Sesim when the allowance is used up', async () => {
    plainStore().checkCanCreate.mockResolvedValue(false);
    plainStore().slotBlock.mockReturnValue({
      title: 'Kendi ses hakkını kullandın',
      message: 'Yeni bir ses için Mini ya da Premium plana geçebilirsin.',
      showPaywall: true,
    });
    await renderScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Devam' }));
    await waitFor(() => expect(mockShowDialog).toHaveBeenCalledTimes(1));

    // The block copy is the plan's (Mini is a paid plan, not a legacy isPro).
    expect(plainStore().slotBlock).toHaveBeenCalledWith('clone', 'free');
    const dialog = mockShowDialog.mock.calls[0][0] as DialogOptions;
    expect(dialog.title).toBe('Kendi ses hakkını kullandın');
    // The way out first, then the plans, as everywhere else.
    expect(dialog.buttons?.map(b => b.text)).toEqual(['Vazgeç', 'Planları gör']);
    expect(dialog.buttons?.[0].style).toBe('cancel');
    dialog.buttons?.[1].onPress?.();
    expect(mockNav.navigate).toHaveBeenCalledWith('Subscription', { reason: 'voices' }, { pop: true });
    expect(mockNav.navigate).not.toHaveBeenCalledWith('VoiceConsent', expect.anything());
  });

  it('asks for the block copy of a Mini plan by its plan id', async () => {
    mockSubscription.planId = 'mini';
    plainStore().checkCanCreate.mockResolvedValue(false);
    plainStore().slotBlock.mockReturnValue({ title: 'Doldu', message: 'Mesaj.', showPaywall: true });
    await renderScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Devam' }));
    await waitFor(() => expect(plainStore().slotBlock).toHaveBeenCalledWith('clone', 'mini'));
  });

  it('only informs when the slots are full and no plan would help', async () => {
    plainStore().checkCanCreate.mockResolvedValue(false);
    plainStore().slotBlock.mockReturnValue({
      title: 'Bu ayki hakkın doldu',
      message: 'Yeni ay başlayınca tekrar dene.',
      showPaywall: false,
    });
    await renderScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Devam' }));
    await waitFor(() => expect(mockShowDialog).toHaveBeenCalledTimes(1));

    const dialog = mockShowDialog.mock.calls[0][0] as DialogOptions;
    expect(dialog.buttons?.map(b => b.text)).toEqual(['Tamam']);
  });

  it('goes back from the app bar', async () => {
    await renderScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Geri' }));
    expect(mockNav.goBack).toHaveBeenCalledTimes(1);
  });

  describe('free plan', () => {
    it('says what the free plan allows, from the plan until GET /usage answers, with the plans', async () => {
      await renderScreen();

      // The usage is asked for when it is missing or old.
      expect(mockSubscription.loadUsageIfStale).toHaveBeenCalledTimes(1);
      const note = screen.getByTestId('voice-intro-free-plan');
      expect(
        within(note).getByText(
          'Ücretsiz planda sesini bir kez kaydedebilir, kendi sesinle bir masal dinleyebilirsin.',
        ),
      ).toBeOnTheScreen();

      fireEvent.press(within(note).getByRole('button', { name: 'Planları gör' }));
      // The plans screen exists once in the stack.
      expect(mockNav.navigate).toHaveBeenCalledWith('Subscription', { reason: 'voices' }, { pop: true });
    });

    it('uses the live numbers of GET /usage', async () => {
      mockSubscription.usage = usageWith(1, 3);
      await renderScreen();

      expect(
        screen.getByText(
          'Ücretsiz planda sesini bir kez kaydedebilir, kendi sesinle 3 masal dinleyebilirsin.',
        ),
      ).toBeOnTheScreen();
    });

    it.each(['mini', 'premium'] as const)('shows no free-plan line on %s', async plan => {
      mockSubscription.planId = plan;
      await renderScreen();

      expect(screen.queryByTestId('voice-intro-free-plan')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Planları gör' })).toBeNull();
    });

    it('builds the sentence from the numbers, with the one-variants at 1', () => {
      const t = i18n.getFixedT('tr');
      expect(freePlanLine(t, null)).toBe(
        'Ücretsiz planda sesini bir kez kaydedebilir, kendi sesinle bir masal dinleyebilirsin.',
      );
      expect(freePlanLine(t, usageWith(2, 1))).toBe(
        'Ücretsiz planda sesini 2 kez kaydedebilir, kendi sesinle bir masal dinleyebilirsin.',
      );
      expect(freePlanLine(t, usageWith(2, 4))).toBe(
        'Ücretsiz planda sesini 2 kez kaydedebilir, kendi sesinle 4 masal dinleyebilirsin.',
      );
      // An unlimited bucket on the free plan is not a number to show: the
      // plan's own figure stands in.
      expect(freePlanLine(t, usageWith(null, null))).toBe(freePlanLine(t, null));
      expect(freePlanLine(i18n.getFixedT('en'), usageWith(1, 3))).toBe(
        'On the free plan you can record your voice once and listen to 3 stories in your own voice.',
      );
    });
  });

  describe('keyboard', () => {
    it('keeps the dock on the keyboard and the focused field above the dock', async () => {
      await renderScreen();

      const sticky = screen.getByTestId('voice-intro-sticky');
      // The dock rides inside the sticky view...
      expect(within(sticky).getByTestId('voice-intro-dock')).toBeOnTheScreen();
      expect(within(sticky).getByRole('button', { name: 'Devam' })).toBeOnTheScreen();
      // ...which, with the keyboard open, drops the navigation inset: 12dp stay.
      expect(sticky.props.offset).toEqual({ closed: 0, opened: dockBottom(0) - 12 });

      // The scroll keeps the field 16dp above the part of the dock over the keyboard.
      const scroll = screen.getByTestId('voice-intro-scroll');
      const opened = dockBottom(0) - 12;
      // Before the dock is measured: 8 + 52 + 3 + dockBottom.
      expect(scroll.props.bottomOffset).toBe(8 + 55 + dockBottom(0) - opened + 16);
      fireEvent(screen.getByTestId('voice-intro-dock'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 120 } },
      });
      expect(screen.getByTestId('voice-intro-scroll').props.bottomOffset).toBe(120 - opened + 16);
      // The name field is in the keyboard-aware scroll.
      expect(within(scroll).getByTestId('voice-name-field')).toBeOnTheScreen();
    });
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', async scheme => {
    await renderScreen(scheme);
    const T = themes[scheme];
    // Step 1 of 3 of the flow, as the onboarding segments.
    expect(screen.getByLabelText('Adım 1, toplam 3 adım')).toBeOnTheScreen();
    expect(screen.getAllByTestId('voice-intro-steps-on')).toHaveLength(1);
    expect(screen.getAllByTestId('voice-intro-steps-off')).toHaveLength(2);
    expect(flatStyle(screen.getAllByTestId('voice-intro-steps-on')[0]).backgroundColor).toBe(T.action);
    expect(flatStyle(screen.getAllByTestId('voice-intro-steps-off')[0]).backgroundColor).toBe(T.line);

    // The display title is Baloo 2.
    expect(flatStyle(screen.getByText('Üç adımda\nkendi sesin'))).toMatchObject({
      fontFamily: T.fontDisplay,
      fontSize: 32,
      color: T.text,
    });
    // The steps sit in a surface card, each number on an own-voice badge.
    expect(flatStyle(screen.getByTestId('voice-intro-steps-card-face')).backgroundColor).toBe(T.surface);
    expect(flatStyle(screen.getByTestId('voice-intro-steps-card-lip')).backgroundColor).toBe(T.lip);
    expect(flatStyle(screen.getByTestId('voice-intro-step-1-badge')).backgroundColor).toBe(T.own);
    expect(flatStyle(screen.getByText('1')).color).toBe(T.onCat);
    expect(flatStyle(screen.getByText('Sessiz bir oda bul')).color).toBe(T.text);
    expect(
      flatStyle(screen.getByText('Çevren ne kadar sessiz olursa Sesly sesini o kadar temiz öğrenir.')).color,
    ).toBe(T.text2);

    // The dock is the canvas (no hairline), the button the action colour on its lip.
    const dock = flatStyle(screen.getByTestId('voice-intro-dock'));
    expect(dock.backgroundColor).toBe(T.bg);
    expect(dock.borderTopWidth).toBeUndefined();
    expect(flatStyle(screen.getByTestId('voice-intro-continue-face')).backgroundColor).toBe(T.action);
    expect(flatStyle(screen.getByTestId('voice-intro-continue-lip')).backgroundColor).toBe(T.actionLip);
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    await renderScreen();

    expect(screen.getByRole('header', { name: 'Your own voice' })).toBeOnTheScreen();
    expect(screen.getByText('Read a story for about 45 seconds')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('My voice')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeOnTheScreen();
  });
});

describe('CreateVoiceProfileScreen: voice language', () => {
  const { VoiceProfileStore } = jest.requireActual('../../hooks/useVoiceProfile');
  const LANGUAGES = [
    { code: 'tr', locale: 'tr-TR', nativeName: 'Türkçe', englishName: 'Turkish' },
    { code: 'en', locale: 'en-US', nativeName: 'English', englishName: 'English' },
  ];
  const TURKISH = {
    ...BASE_JSON,
    language: 'tr',
    locale: 'tr-TR',
    supportedLanguages: LANGUAGES,
    introSteps: [{ title: 'Sessiz bir yer bul', body: 'Kapıyı kapat.' }],
  };
  const ENGLISH = {
    ...BASE_JSON,
    language: 'en',
    locale: 'en-US',
    supportedLanguages: LANGUAGES,
    consentVersion: 'en-2026-10',
    introSteps: [{ title: 'Find a quiet place', body: 'Close the door.' }],
  };
  const HINT = 'Hangi dilde okuyacaksan onu seç. Okuma metni o dilde gelir.';

  /** Answers by the language asked for, as the backend does. */
  const serveByLanguage = () =>
    mockGetCloneConfig.mockImplementation(async (language?: string) =>
      parseCloneConfigFromJSON(language === 'en' ? ENGLISH : TURKISH),
    );

  beforeEach(() => {
    mockVoiceStore = new VoiceProfileStore();
  });

  it('asks which language the user will speak, with one sentence of why', async () => {
    serveByLanguage();
    await renderScreen();

    expect(await screen.findByRole('header', { name: 'Konuşacağın dil' })).toBeOnTheScreen();
    expect(screen.getByText(HINT)).toBeOnTheScreen();
    // In a surface card of its own.
    expect(flatStyle(screen.getByTestId('voice-language-step-face')).backgroundColor).toBe(
      themes['gece-mavisi'].surface,
    );
    // The languages are the backend's, in their own names.
    expect(screen.getByRole('radio', { name: 'Türkçe' })).toBeSelected();
    expect(screen.getByRole('radio', { name: 'English' })).not.toBeSelected();
    // The app's own steps, not the served ones.
    expect(screen.getByText('Sessiz bir oda bul')).toBeOnTheScreen();
    expect(screen.queryByText('Sessiz bir yer bul')).toBeNull();
    // Turkish is the backend's default: asked without a parameter.
    expect(mockGetCloneConfig).toHaveBeenCalledTimes(1);
    expect(mockGetCloneConfig).toHaveBeenCalledWith();
  });

  it('starts in the content language when a voice can be recorded in it', async () => {
    mockContentLanguage.effective = 'en';
    serveByLanguage();
    await renderScreen();

    expect(await screen.findByRole('radio', { name: 'English' })).toBeSelected();
    expect(mockGetCloneConfig).toHaveBeenCalledWith('en');
    // The app speaks Turkish: the steps stay Turkish (V7), only the script
    // will be English.
    expect(screen.getByText('Sessiz bir oda bul')).toBeOnTheScreen();
    expect(screen.queryByText('Find a quiet place')).toBeNull();
  });

  it("shows the English app's own steps for an English and for a Turkish voice", async () => {
    await i18n.changeLanguage('en');
    try {
      mockContentLanguage.effective = 'en';
      serveByLanguage();
      await renderScreen();
      expect(await screen.findByRole('radio', { name: 'English' })).toBeSelected();
      expect(screen.getByText('Find a quiet room')).toBeOnTheScreen();
      expect(screen.queryByText('Find a quiet place')).toBeNull();
      // A Turkish voice in the English app: the same English steps.
      fireEvent.press(screen.getByRole('radio', { name: 'Türkçe' }));
      await waitFor(() => expect(mockGetCloneConfig).toHaveBeenLastCalledWith());
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
      expect(screen.getByRole('radio', { name: 'Türkçe' })).toBeSelected();
      expect(screen.getByText('Find a quiet room')).toBeOnTheScreen();
      expect(screen.queryByText('Sessiz bir yer bul')).toBeNull();
      expect(screen.queryByText('Sessiz bir oda bul')).toBeNull();
    } finally {
      await act(async () => {
        await i18n.changeLanguage('tr');
      });
    }
  });

  it('starts in Turkish when the content language is not offered for a voice', async () => {
    mockContentLanguage.effective = 'de';
    mockGetCloneConfig
      .mockRejectedValueOnce(apiErrorFromResponse(400, { code: 'VOICE_LANGUAGE_NOT_SUPPORTED' }))
      .mockResolvedValueOnce(parseCloneConfigFromJSON(TURKISH));
    await renderScreen();

    expect(await screen.findByRole('radio', { name: 'Türkçe' })).toBeSelected();
    expect(screen.getByText('Sessiz bir oda bul')).toBeOnTheScreen();
    expect(showToast.error).not.toHaveBeenCalled();
  });

  it('reloads the texts in the chosen language and takes it to the consent step', async () => {
    serveByLanguage();
    await renderScreen();
    await screen.findByRole('radio', { name: 'English' });

    fireEvent.press(screen.getByRole('radio', { name: 'English' }));

    // The English texts are in; the steps stay the app's Turkish ones.
    await waitFor(() => expect(mockGetCloneConfig).toHaveBeenLastCalledWith('en'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Devam' })).toBeEnabled());
    expect(screen.getByText('Sessiz bir oda bul')).toBeOnTheScreen();
    expect(screen.queryByText('Find a quiet place')).toBeNull();
    expect(screen.getByRole('radio', { name: 'English' })).toBeSelected();

    fireEvent.press(screen.getByRole('button', { name: 'Devam' }));
    await waitFor(() =>
      expect(mockNav.navigate).toHaveBeenCalledWith('VoiceConsent', {
        name: 'Benim Sesim',
        language: 'en',
      }),
    );
  });

  it('answers the tap at once and holds "Devam" until the texts of that language are in', async () => {
    let resolveEnglish: (config: CloneConfig) => void = () => undefined;
    mockGetCloneConfig.mockImplementation((language?: string) =>
      language === 'en'
        ? new Promise<CloneConfig>(resolve => (resolveEnglish = resolve))
        : Promise.resolve(parseCloneConfigFromJSON(TURKISH)),
    );
    await renderScreen();
    await screen.findByRole('radio', { name: 'English' });

    fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    // The segmented control hands the choice over in the next frame.
    act(() => {
      jest.advanceTimersByTime(16);
    });
    await act(async () => undefined);

    expect(screen.getByRole('radio', { name: 'English' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Devam' })).toBeDisabled();

    await act(async () => {
      resolveEnglish(parseCloneConfigFromJSON(ENGLISH));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Devam' })).toBeEnabled());
    expect(screen.getByText('Sessiz bir oda bul')).toBeOnTheScreen();
  });

  it('keeps the steps and the steps card as they are while the voice language changes', async () => {
    let resolveEnglish: (config: CloneConfig) => void = () => undefined;
    let resolveTurkish: (config: CloneConfig) => void = () => undefined;
    let turkishCalls = 0;
    mockGetCloneConfig.mockImplementation((language?: string) => {
      if (language === 'en') return new Promise<CloneConfig>(resolve => (resolveEnglish = resolve));
      turkishCalls += 1;
      // The first load answers at once; the switch back waits.
      return turkishCalls === 1
        ? Promise.resolve(parseCloneConfigFromJSON(TURKISH))
        : new Promise<CloneConfig>(resolve => (resolveTurkish = resolve));
    });
    await renderScreen();
    await screen.findByRole('radio', { name: 'English' });

    const card = () => screen.getByTestId('voice-intro-steps-card');
    const stepTexts = () =>
      within(card())
        .getAllByText(/./)
        .map(node => node.props.children);
    const cardStyle = () => flatStyle(card());
    const before = { texts: stepTexts(), style: cardStyle() };
    expect(before.texts).toEqual(
      expect.arrayContaining([
        'Sessiz bir oda bul',
        'Çevren ne kadar sessiz olursa Sesly sesini o kadar temiz öğrenir.',
        'Yaklaşık 45 saniyelik bir masal oku',
        'Sesin hazırlansın',
      ]),
    );
    // Not dimmed at rest, and (below) not dimmed while a switch loads.
    expect(before.style.opacity ?? 1).toBe(1);

    const choose = async (name: string) => {
      fireEvent.press(screen.getByRole('radio', { name }));
      act(() => {
        jest.advanceTimersByTime(16);
      });
      await act(async () => undefined);
    };

    // To English: while it loads, and once it is in.
    await choose('English');
    expect(screen.getByRole('button', { name: 'Devam' })).toBeDisabled();
    expect({ texts: stepTexts(), style: cardStyle() }).toEqual(before);
    await act(async () => {
      resolveEnglish(parseCloneConfigFromJSON(ENGLISH));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Devam' })).toBeEnabled());
    expect({ texts: stepTexts(), style: cardStyle() }).toEqual(before);
    expect(screen.queryByText('Find a quiet place')).toBeNull();

    // And back to Turkish, whose config serves steps of its own.
    await choose('Türkçe');
    expect({ texts: stepTexts(), style: cardStyle() }).toEqual(before);
    await act(async () => {
      resolveTurkish(parseCloneConfigFromJSON(TURKISH));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Devam' })).toBeEnabled());
    expect(screen.getByRole('radio', { name: 'Türkçe' })).toBeSelected();
    expect({ texts: stepTexts(), style: cardStyle() }).toEqual(before);
    expect(screen.queryByText('Sessiz bir yer bul')).toBeNull();
  });

  it('stays in the previous language and says so when the chosen one cannot be loaded', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetCloneConfig.mockImplementation((language?: string) =>
      language === 'en'
        ? Promise.reject(apiErrorFromResponse(500, {}))
        : Promise.resolve(parseCloneConfigFromJSON(TURKISH)),
    );
    await renderScreen();
    await screen.findByRole('radio', { name: 'English' });

    fireEvent.press(screen.getByRole('radio', { name: 'English' }));

    await waitFor(() =>
      expect(showToast.error).toHaveBeenCalledWith('Bu dilin metinleri yüklenemedi. Tekrar dene.'),
    );
    expect(screen.getByRole('radio', { name: 'Türkçe' })).toBeSelected();
    expect(screen.getByText('Sessiz bir oda bul')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Devam' })).toBeEnabled();
  });

  it('shows no language step when only one language is offered', async () => {
    mockGetCloneConfig.mockResolvedValue(
      parseCloneConfigFromJSON({ ...TURKISH, supportedLanguages: [LANGUAGES[0]] }),
    );
    await renderScreen();

    expect(await screen.findByTestId('voice-intro-steps-card')).toBeOnTheScreen();
    expect(screen.queryByTestId('voice-language-step')).toBeNull();
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    serveByLanguage();
    await renderScreen();

    expect(await screen.findByRole('header', { name: 'Language you will speak' })).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Pick the language you will read in. The reading script comes in that language.',
      ),
    ).toBeOnTheScreen();
    // The languages keep their own names.
    expect(screen.getByRole('radio', { name: 'Türkçe' })).toBeOnTheScreen();
  });
});

describe('CreateVoiceProfileScreen: intro steps copy', () => {
  type Steps = Record<
    'roomTitle' | 'roomBody' | 'readTitle' | 'readBody' | 'readyTitle' | 'readyBody',
    string
  >;
  const stepsOf = (language: 'tr' | 'en'): Steps =>
    (resources[language].voiceFlow as unknown as { intro: { steps: Steps } }).intro.steps;
  const inOrder = (steps: Steps) => [
    steps.roomTitle,
    steps.roomBody,
    steps.readTitle,
    steps.readBody,
    steps.readyTitle,
    steps.readyBody,
  ];

  // The backend's CLONE_INTRO_STEPS (tr) and CLONE_INTRO_STEPS_EN, read from
  // the workspace when the backend sits next to the app.
  const constants = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'sesly-backend',
    'src',
    'modules',
    'voice-profiles',
    'clone-config.constants.ts',
  );
  const withBackend = fs.existsSync(constants) ? it : it.skip;

  /** Title and body literals of one exported step list, with the i18n placeholders. */
  function backendSteps(source: string, name: string): string[] {
    const start = source.indexOf(`export const ${name}: readonly CloneIntroStep[] = [`);
    expect(start).toBeGreaterThanOrEqual(0);
    const block = source.slice(start, source.indexOf('];', start));
    return [...block.matchAll(/(?:title|body): (['`])(.*?)\1,/g)].map(match =>
      match[2]
        .replace('${CLONE_TARGET_SECONDS}', '{{target}}')
        .replace('${CLONE_MIN_SECONDS}', '{{min}}'),
    );
  }

  withBackend('says the steps word for word as the backend serves them, in both languages', () => {
    const source = fs.readFileSync(constants, 'utf8');
    expect(inOrder(stepsOf('tr'))).toEqual(backendSteps(source, 'CLONE_INTRO_STEPS'));
    expect(inOrder(stepsOf('en'))).toEqual(backendSteps(source, 'CLONE_INTRO_STEPS_EN'));
  });

  it('keeps the served wording with the figures as placeholders', () => {
    expect(inOrder(stepsOf('tr'))).toEqual([
      'Sessiz bir oda bul',
      'Çevren ne kadar sessiz olursa Sesly sesini o kadar temiz öğrenir.',
      'Yaklaşık {{target}} saniyelik bir masal oku',
      'Sana kısa bir masal metni göstereceğiz. En az {{min}} saniye okuman gerekiyor; daha uzun kayıt aksanını daha iyi korur.',
      'Sesin hazırlansın',
      'Kaydın genellikle bir dakikadan kısa sürede hazır olur. Beklemek zorunda değilsin, hazır olunca haber veririz.',
    ]);
    expect(inOrder(stepsOf('en'))).toEqual([
      'Find a quiet room',
      'The quieter your surroundings, the more clearly Sesly learns your voice.',
      'Read a story for about {{target}} seconds',
      'We will show you a short story text. You need to read for at least {{min}} seconds; a longer recording preserves your accent better.',
      'Let your voice get ready',
      'Your recording is usually ready in under a minute. You do not have to wait, we will let you know when it is ready.',
    ]);
  });
});
