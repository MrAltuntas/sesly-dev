/**
 * ProcessingScreen (playful design): the voice is being prepared.
 *
 * The voice profile store is an observable plain object, so a test can move
 * the tracker (waiting, ready, failed, timeout) the way the real one does.
 */

import React from 'react';
import { BackHandler } from 'react-native';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { observable, runInAction } from 'mobx';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { BUTTON_METRICS } from '../../components/design';
import type { DialogOptions } from '../../hooks/useDialog';
import { VoiceProfileStatus } from '../../types/enums';
import { ProcessingScreen, READY_HOLD_MS } from './ProcessingScreen';

jest.setTimeout(60000);

type Phase = 'waiting' | 'ready' | 'failed' | 'timeout';

interface ProfileRow {
  id: string;
  name: string;
  status: VoiceProfileStatus;
  errorMessage: string | null;
}

interface VoiceStoreMock {
  voiceProfiles: ProfileRow[];
  track: { phase: Phase; errorMessage: string | null } | null;
  trackingObservedId: string | null;
  getTrackState: jest.Mock;
  trackVoiceProfile: jest.Mock;
  setTrackingObserved: jest.Mock;
  restartTracking: jest.Mock;
  checkCanCreate: jest.Mock;
  slotBlock: jest.Mock;
  deleteVoiceProfile: jest.Mock;
}

let mockVoiceStore: VoiceStoreMock;
let mockRecordingStore: {
  createdProfile: { id: string; name: string } | null;
  profileName: string | null;
  reset: jest.Mock;
};
const mockShowDialog = jest.fn();
const mockEnsurePush = jest.fn(() => Promise.resolve(true));

jest.mock('../../hooks/useVoiceProfile', () => ({
  useVoiceProfile: () => mockVoiceStore,
}));
jest.mock('../../hooks/useVoiceRecording', () => ({
  useVoiceRecording: () => mockRecordingStore,
}));
jest.mock('../../hooks/useSubscription', () => ({
  useSubscription: () => ({ planId: 'free' }),
}));
jest.mock('../../hooks/useDialog', () => ({
  useDialog: () => ({ showDialog: mockShowDialog, hideDialog: jest.fn() }),
}));
jest.mock('../../services/PushNotificationService', () => ({
  ensurePushPermission: () => mockEnsurePush(),
}));

const mockNav = {
  replace: jest.fn(),
  dispatch: jest.fn(),
  goBack: jest.fn(),
  navigate: jest.fn(),
  popTo: jest.fn(),
  canGoBack: jest.fn(() => true),
};
let mockRouteParams: Record<string, unknown> | undefined;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockRouteParams }),
}));

function makeVoiceStore(
  status: VoiceProfileStatus | null = VoiceProfileStatus.PROCESSING,
  phase: Phase | null = null,
): VoiceStoreMock {
  // The jest mocks stay plain (MobX would wrap them into actions).
  const store: VoiceStoreMock = observable(
    {
      voiceProfiles: status
        ? [{ id: 'vp-1', name: 'zeynep', status, errorMessage: null }]
        : [],
      track: phase ? { phase, errorMessage: null } : null,
      trackingObservedId: null as string | null,
      getTrackState: jest.fn(),
      trackVoiceProfile: jest.fn(),
      setTrackingObserved: jest.fn(),
      restartTracking: jest.fn(),
      checkCanCreate: jest.fn(() => Promise.resolve(true)),
      slotBlock: jest.fn(),
      deleteVoiceProfile: jest.fn(() => Promise.resolve(true)),
    },
    {
      getTrackState: false,
      trackVoiceProfile: false,
      setTrackingObserved: false,
      restartTracking: false,
      checkCanCreate: false,
      slotBlock: false,
      deleteVoiceProfile: false,
    },
  );
  store.getTrackState.mockImplementation((id: string | null) => (id ? store.track : null));
  store.setTrackingObserved.mockImplementation((id: string | null) => {
    runInAction(() => {
      store.trackingObservedId = id;
    });
  });
  return store;
}

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

async function renderScreen(theme: 'gece-mavisi' | 'kitaplik' = 'gece-mavisi') {
  const utils = renderWithProviders(<ProcessingScreen />, { theme });
  await act(async () => undefined);
  return utils;
}

const BACKGROUND = 'Arka planda devam et';
const RESET_VOICES = {
  type: 'RESET',
  payload: { index: 0, routes: [{ name: 'Main', params: { screen: 'Voices' } }] },
};

function markReady() {
  act(() => {
    runInAction(() => {
      mockVoiceStore.track = { phase: 'ready', errorMessage: null };
      mockVoiceStore.voiceProfiles[0].status = VoiceProfileStatus.READY;
    });
  });
}

function failAndGetDialog(): DialogOptions {
  act(() => {
    runInAction(() => {
      mockVoiceStore.track = { phase: 'failed', errorMessage: 'Kayıtta çok gürültü var.' };
    });
  });
  expect(mockShowDialog).toHaveBeenCalledTimes(1);
  return mockShowDialog.mock.calls[0][0] as DialogOptions;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNav.canGoBack.mockReturnValue(true);
  mockRouteParams = { profileId: 'vp-1' };
  mockVoiceStore = makeVoiceStore();
  mockRecordingStore = { createdProfile: null, profileName: null, reset: jest.fn() };
});

describe('ProcessingScreen', () => {
  it('shows the waiting state with an indeterminate bar and the two status lines', async () => {
    await renderScreen();

    expect(screen.getByRole('header', { name: 'Sesin hazırlanıyor' })).toBeOnTheScreen();
    expect(screen.getByText('Genellikle bir dakikadan kısa sürer.')).toBeOnTheScreen();
    // The initial of the voice, uppercased.
    expect(screen.getByText('Z', { includeHiddenElements: true })).toBeOnTheScreen();
    // No percentage: the backend sends none for cloning.
    const bar = screen.getByTestId('processing-bar');
    expect(bar.props.accessibilityValue).toBeUndefined();
    expect(screen.queryByText(/%/)).toBeNull();

    expect(screen.getByText('Kayıt yüklendi')).toBeOnTheScreen();
    expect(screen.getByTestId('processing-upload-check', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByText('Sesin oluşturuluyor')).toBeOnTheScreen();
    expect(screen.getByTestId('processing-create-spinner')).toBeOnTheScreen();
    expect(
      screen.getByText('Beklemene gerek yok, hazır olunca haber veririz.'),
    ).toBeOnTheScreen();
  });

  it('starts tracking, marks the profile as observed and asks for push permission', async () => {
    const view = await renderScreen();

    expect(mockVoiceStore.trackVoiceProfile).toHaveBeenCalledWith('vp-1');
    expect(mockVoiceStore.setTrackingObserved).toHaveBeenCalledWith('vp-1');
    expect(mockEnsurePush).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(mockVoiceStore.setTrackingObserved).toHaveBeenLastCalledWith(null);
  });

  it('does not restart a tracker that already finished', async () => {
    mockVoiceStore = makeVoiceStore(VoiceProfileStatus.PROCESSING, 'timeout');
    await renderScreen();
    expect(mockVoiceStore.trackVoiceProfile).not.toHaveBeenCalled();
  });

  it('shows the upload as running and the creation as not started while the profile is PENDING', async () => {
    mockVoiceStore = makeVoiceStore(VoiceProfileStatus.PENDING, 'waiting');
    await renderScreen();

    expect(screen.getByText('Kayıt yükleniyor')).toBeOnTheScreen();
    expect(screen.getByTestId('processing-upload-spinner')).toBeOnTheScreen();
    // Only one line spins: the creation waits for the upload.
    expect(screen.queryByTestId('processing-create-spinner')).toBeNull();
    expect(screen.getByTestId('processing-create-pending')).toBeOnTheScreen();
    expect(flatStyle(screen.getByText('Sesin oluşturuluyor')).color).toBe(themes['gece-mavisi'].text3);
  });

  it('shows the ready check for a moment, then opens VoiceSuccess once', async () => {
    await renderScreen();
    expect(mockNav.replace).not.toHaveBeenCalled();

    markReady();

    // The check of the last line is seen before the screen changes.
    expect(screen.getByTestId('processing-create-check', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByText('Sesin oluşturuldu')).toBeOnTheScreen();
    act(() => {
      jest.advanceTimersByTime(READY_HOLD_MS - 1);
    });
    expect(mockNav.replace).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(mockNav.replace).toHaveBeenCalledTimes(1);
    expect(mockNav.replace).toHaveBeenCalledWith('VoiceSuccess', { profileId: 'vp-1' });
    expect(READY_HOLD_MS).toBe(600);
  });

  it('passes the story the flow was started from on to VoiceSuccess', async () => {
    mockRouteParams = { profileId: 'vp-1', returnToStoryId: 'story-7' };
    await renderScreen();

    markReady();
    act(() => {
      jest.advanceTimersByTime(READY_HOLD_MS);
    });
    expect(mockNav.replace).toHaveBeenCalledWith('VoiceSuccess', {
      profileId: 'vp-1',
      returnToStoryId: 'story-7',
    });
  });

  it('drops the hand-over to VoiceSuccess when the user leaves during the hold', async () => {
    const view = await renderScreen();
    markReady();

    fireEvent.press(screen.getByRole('button', { name: BACKGROUND }));
    act(() => {
      jest.advanceTimersByTime(READY_HOLD_MS);
    });
    expect(mockNav.dispatch).toHaveBeenCalledWith(RESET_VOICES);
    expect(mockNav.replace).not.toHaveBeenCalled();

    // Unmounting during a hold cancels it too.
    view.unmount();
    mockNav.replace.mockClear();
    await renderScreen();
    markReady();
    screen.unmount();
    act(() => {
      jest.advanceTimersByTime(READY_HOLD_MS);
    });
    expect(mockNav.replace).not.toHaveBeenCalled();
  });

  it('reports a failure in a dialog with a way back to Sesim and a new recording', async () => {
    await renderScreen();

    const dialog = failAndGetDialog();
    expect(dialog.title).toBe('Sesin hazırlanamadı');
    expect(dialog.message).toBe('Kayıtta çok gürültü var.');
    expect(dialog.cancelable).toBe(false);
    expect(dialog.buttons?.map(b => b.text)).toEqual(["Sesim'e dön", 'Yeniden kaydet']);
    expect(dialog.buttons?.[0].style).toBe('cancel');

    dialog.buttons?.[0].onPress?.();
    expect(mockNav.dispatch).toHaveBeenCalledWith(RESET_VOICES);
    expect(mockNav.replace).not.toHaveBeenCalled();
    expect(mockVoiceStore.deleteVoiceProfile).not.toHaveBeenCalled();
  });

  it('records again from the failure: the failed voice goes and the flow restarts with its story', async () => {
    mockRouteParams = { profileId: 'vp-1', returnToStoryId: 'story-7' };
    await renderScreen();

    const dialog = failAndGetDialog();
    await act(async () => {
      dialog.buttons?.[1].onPress?.();
    });

    expect(mockVoiceStore.checkCanCreate).toHaveBeenCalledWith('clone');
    // Sesim stays clean: no failed voice is left behind.
    expect(mockVoiceStore.deleteVoiceProfile).toHaveBeenCalledWith('vp-1');
    expect(mockRecordingStore.reset).toHaveBeenCalledTimes(1);
    expect(mockNav.popTo).toHaveBeenCalledWith('CreateVoiceProfile', { returnToStoryId: 'story-7' });
    expect(mockVoiceStore.deleteVoiceProfile.mock.invocationCallOrder[0]).toBeLessThan(
      mockNav.popTo.mock.invocationCallOrder[0],
    );
  });

  it('records again without a story when the flow started on Sesim', async () => {
    await renderScreen();

    const dialog = failAndGetDialog();
    await act(async () => {
      dialog.buttons?.[1].onPress?.();
    });
    expect(mockNav.popTo).toHaveBeenCalledWith('CreateVoiceProfile', undefined);
  });

  it('explains on Sesim when no new recording is allowed, with the plans', async () => {
    mockVoiceStore.checkCanCreate.mockResolvedValue(false);
    mockVoiceStore.slotBlock.mockReturnValue({
      title: 'Kendi ses hakkını kullandın',
      message: 'Yeni bir ses için Mini ya da Premium plana geçebilirsin.',
      showPaywall: true,
    });
    await renderScreen();

    const dialog = failAndGetDialog();
    await act(async () => {
      dialog.buttons?.[1].onPress?.();
    });

    expect(mockVoiceStore.slotBlock).toHaveBeenCalledWith('clone', 'free');
    expect(mockVoiceStore.deleteVoiceProfile).not.toHaveBeenCalled();
    expect(mockNav.replace).not.toHaveBeenCalled();
    expect(mockNav.popTo).not.toHaveBeenCalled();
    expect(mockNav.dispatch).toHaveBeenCalledWith(RESET_VOICES);
    const block = mockShowDialog.mock.calls[1][0] as DialogOptions;
    expect(block.title).toBe('Kendi ses hakkını kullandın');
    expect(block.buttons?.map(b => b.text)).toEqual(['Vazgeç', 'Planları gör']);
  });

  it('uses its own failure text when the backend sent none', async () => {
    mockVoiceStore = makeVoiceStore(VoiceProfileStatus.FAILED, null);
    await renderScreen();

    const dialog = mockShowDialog.mock.calls[0][0] as DialogOptions;
    expect(dialog.message).toBe('Kayıt işlenemedi. Yeniden okumayı dene.');
  });

  it('keeps waiting in the background on the Sesim tab, from the button and from hardware back', async () => {
    const addListener = jest.spyOn(BackHandler, 'addEventListener');
    await renderScreen();

    // Sesim is where the "Hazırlanıyor" card of the voice is.
    fireEvent.press(screen.getByRole('button', { name: BACKGROUND }));
    expect(mockNav.dispatch).toHaveBeenCalledWith(RESET_VOICES);

    const handler = addListener.mock.calls[addListener.mock.calls.length - 1][1];
    expect(handler()).toBe(true);
    expect(mockNav.dispatch).toHaveBeenCalledTimes(2);
    expect(mockNav.dispatch).toHaveBeenLastCalledWith(RESET_VOICES);
  });

  it('draws the way out as a secondary md button in a dock with 8 on top', async () => {
    await renderScreen();

    const face = flatStyle(screen.getByTestId('processing-background-face'));
    expect(face.minHeight).toBe(BUTTON_METRICS.md.height);
    expect(flatStyle(screen.getByTestId('processing-background-lip')).top).toBe(BUTTON_METRICS.md.lip);
    // A block: it spans the dock.
    expect(flatStyle(screen.getByTestId('processing-background')).alignSelf).toBe('stretch');
    expect(flatStyle(screen.getByTestId('processing-dock')).paddingTop).toBe(8);
  });

  it('offers to check again or to leave when the tracker timed out, the primary on top', async () => {
    mockVoiceStore = makeVoiceStore(VoiceProfileStatus.PROCESSING, 'timeout');
    await renderScreen();
    const T = themes['gece-mavisi'];

    expect(screen.getByText('Beklenenden uzun sürüyor')).toBeOnTheScreen();
    // Both actions sit in the dock, md and full width: the primary over the way out.
    const dock = screen.getByTestId('processing-dock');
    expect(within(dock).getByTestId('processing-retry')).toBeOnTheScreen();
    expect(within(dock).getByTestId('processing-background')).toBeOnTheScreen();
    // The state above has no button of its own any more.
    expect(within(screen.getByTestId('processing-timeout')).queryAllByRole('button')).toHaveLength(0);
    expect(flatStyle(screen.getByTestId('processing-retry-face'))).toMatchObject({
      backgroundColor: T.action,
      minHeight: BUTTON_METRICS.md.height,
    });
    expect(flatStyle(screen.getByTestId('processing-background-face')).minHeight).toBe(
      BUTTON_METRICS.md.height,
    );
    const buttons = screen.getAllByRole('button').map(b => b.props.accessibilityLabel);
    expect(buttons.indexOf('Tekrar kontrol et')).toBeLessThan(buttons.indexOf(BACKGROUND));

    fireEvent.press(screen.getByRole('button', { name: 'Tekrar kontrol et' }));
    expect(mockVoiceStore.restartTracking).toHaveBeenCalledWith('vp-1');

    fireEvent.press(screen.getByRole('button', { name: BACKGROUND }));
    expect(mockNav.dispatch).toHaveBeenCalledWith(RESET_VOICES);
  });

  it('falls back to the profile the recording store just created', async () => {
    mockRouteParams = undefined;
    mockRecordingStore = {
      createdProfile: { id: 'vp-1', name: 'Annem' },
      profileName: 'Annem',
      reset: jest.fn(),
    };
    mockVoiceStore = makeVoiceStore(null);
    await renderScreen();

    expect(mockVoiceStore.trackVoiceProfile).toHaveBeenCalledWith('vp-1');
    expect(screen.getByText('A', { includeHiddenElements: true })).toBeOnTheScreen();
    // Reached only after a successful upload: an unknown profile counts as uploaded.
    expect(screen.getByText('Kayıt yüklendi')).toBeOnTheScreen();
  });

  it('shows a way back when there is no profile to follow', async () => {
    mockRouteParams = undefined;
    await renderScreen();

    expect(screen.getByText('Ses bulunamadı')).toBeOnTheScreen();
    expect(mockVoiceStore.trackVoiceProfile).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: 'Geri dön' }));
    expect(mockNav.goBack).toHaveBeenCalledTimes(1);

    mockNav.canGoBack.mockReturnValue(false);
    fireEvent.press(screen.getByRole('button', { name: 'Geri dön' }));
    expect(mockNav.dispatch).toHaveBeenCalledWith(RESET_VOICES);
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', async scheme => {
    await renderScreen(scheme);
    const T = themes[scheme];

    expect(flatStyle(screen.getByText('Sesin hazırlanıyor'))).toMatchObject({
      color: T.text,
      fontFamily: T.fontDisplay,
    });
    // The voice being made wears the own-voice colour, its initial dark.
    expect(
      flatStyle(screen.getByTestId('flow-avatar-face', { includeHiddenElements: true })).backgroundColor,
    ).toBe(T.own);
    expect(flatStyle(screen.getByText('Z', { includeHiddenElements: true })).color).toBe(T.onCat);
    // A fat bar in the action colour, inside a surface card.
    expect(flatStyle(screen.getByTestId('processing-card-face')).backgroundColor).toBe(T.surface);
    expect(flatStyle(screen.getByTestId('processing-bar'))).toMatchObject({
      height: 12,
      backgroundColor: T.line,
    });
    expect(flatStyle(screen.getByText('Sesin oluşturuluyor')).color).toBe(T.text2);
    expect(flatStyle(screen.getByTestId('processing-create-dot')).backgroundColor).toBe(T.surface2);
    // The way out is a neutral card button on its lip.
    expect(flatStyle(screen.getByTestId('processing-background-face')).backgroundColor).toBe(T.surface);
    expect(flatStyle(screen.getByTestId('processing-background-lip')).backgroundColor).toBe(T.lip);
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    await renderScreen();

    expect(screen.getByRole('header', { name: 'Your voice is being prepared' })).toBeOnTheScreen();
    expect(screen.getByText('Recording uploaded')).toBeOnTheScreen();
    expect(screen.getByText('Creating your voice')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Continue in the background' })).toBeOnTheScreen();
  });
});
