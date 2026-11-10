/**
 * VoiceSuccessScreen (playful design): the voice is ready.
 *
 * The app audio player is an observable plain object that follows the real
 * store's sample rules (SPEC-audio 2.5): `playFromUrl` puts the sample's key
 * in the player and waits for it to sound (`previewPending`), the sample's
 * end or `stopPreview(key)` drops the key. The screen derives everything
 * from those fields.
 */

import React from 'react';
import { BackHandler } from 'react-native';
import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { observable, runInAction } from 'mobx';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { showToast } from '../../utils/toast';
import { SUCCESS_SAMPLE_KEY, VoiceSuccessScreen } from './VoiceSuccessScreen';

jest.setTimeout(60000);

interface PlayerMock {
  sampleKey: string | null;
  previewPending: boolean;
  previewFailed: boolean;
  isPlaying: boolean;
  currentPositionMs: number;
  totalDurationMs: number;
  playFromUrl: jest.Mock;
  stopPreview: jest.Mock;
  acknowledgePreviewFailure: jest.Mock;
}

let mockPlayer: PlayerMock;
let mockVoiceStore: {
  voiceProfiles: Array<{ id: string; name: string }>;
  getVoiceSample: jest.Mock;
};
let mockRecordingStore: { profileName: string | null; reset: jest.Mock };

jest.mock('../../hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => mockPlayer,
}));
jest.mock('../../hooks/useVoiceProfile', () => ({
  useVoiceProfile: () => mockVoiceStore,
}));
jest.mock('../../hooks/useVoiceRecording', () => ({
  useVoiceRecording: () => mockRecordingStore,
}));
jest.mock('../../utils/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

const mockNav = { dispatch: jest.fn() };
let mockRouteParams: Record<string, unknown> | undefined;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockRouteParams }),
}));

/** Whether a started sample keeps waiting to sound until `sound()`. */
let holdSample = false;

function makePlayer(): PlayerMock {
  // The jest mocks stay plain (MobX would wrap them into actions).
  const player: PlayerMock = observable(
    {
      sampleKey: null as string | null,
      previewPending: false,
      previewFailed: false,
      isPlaying: false,
      currentPositionMs: 0,
      totalDurationMs: 0,
      playFromUrl: jest.fn(),
      stopPreview: jest.fn(),
      acknowledgePreviewFailure: jest.fn(),
    },
    { playFromUrl: false, stopPreview: false, acknowledgePreviewFailure: false },
  );
  player.playFromUrl.mockImplementation(async (_url: string, meta: { key?: string }) => {
    runInAction(() => {
      // As the store: the sample is in the player and "playing" at once,
      // pending until it actually sounds.
      player.sampleKey = meta.key ?? null;
      player.isPlaying = true;
      player.previewPending = true;
      player.previewFailed = false;
    });
    if (!holdSample) sound();
  });
  player.stopPreview.mockImplementation(async (key?: string) => {
    if (key !== undefined && key !== player.sampleKey) return;
    leave();
  });
  return player;
}

/** The sample sounds: position and length are known. */
function sound() {
  runInAction(() => {
    mockPlayer.previewPending = false;
    mockPlayer.isPlaying = true;
    mockPlayer.currentPositionMs = 4000;
    mockPlayer.totalDurationMs = 12000;
  });
}

/** The sample is over (ended, failed, stopped): the store drops its key. */
function leave() {
  runInAction(() => {
    mockPlayer.sampleKey = null;
    mockPlayer.previewPending = false;
    mockPlayer.isPlaying = false;
    mockPlayer.currentPositionMs = 0;
    mockPlayer.totalDurationMs = 0;
  });
}

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

async function renderScreen(theme: 'gece-mavisi' | 'kitaplik' = 'gece-mavisi') {
  const utils = renderWithProviders(<VoiceSuccessScreen />, { theme });
  await act(async () => undefined);
  return utils;
}

const PLAY = 'Örneği dinle';
const STOP = 'Örneği durdur';
const reset = (tab: string) => ({
  type: 'RESET',
  payload: { index: 0, routes: [{ name: 'Main', params: { screen: tab } }] },
});

async function startSample() {
  fireEvent.press(screen.getByRole('button', { name: PLAY }));
  await waitFor(() => expect(screen.getByRole('button', { name: STOP })).toBeOnTheScreen());
}

beforeEach(() => {
  jest.clearAllMocks();
  holdSample = false;
  mockRouteParams = { profileId: 'vp-1' };
  mockPlayer = makePlayer();
  mockVoiceStore = {
    voiceProfiles: [{ id: 'vp-1', name: 'Zeynep' }],
    getVoiceSample: jest.fn(() => Promise.resolve('https://cdn.test/sample.mp3')),
  };
  mockRecordingStore = { profileName: 'Zeynep', reset: jest.fn() };
});

describe('VoiceSuccessScreen', () => {
  it('shows the ready state without a time before the sample was played', async () => {
    await renderScreen();

    expect(screen.getByRole('header', { name: 'Sesin hazır' })).toBeOnTheScreen();
    expect(screen.getByText('Örneği dinle, sonra bir masalda kullan.')).toBeOnTheScreen();
    // The own-voice badge carries the wave; the card names the voice.
    expect(screen.getByTestId('flow-avatar-icon', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByText('Zeynep')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: PLAY })).toBeOnTheScreen();
    // The length of the sample is not known yet: nothing is invented.
    expect(screen.queryByTestId('voice-sample-time')).toBeNull();
    expect(screen.getByRole('button', { name: 'Bir masalda dinle' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: "Sesim'e dön" })).toBeOnTheScreen();
  });

  it('plays the sample under its own key and shows position and length', async () => {
    await renderScreen();
    await startSample();

    expect(mockVoiceStore.getVoiceSample).toHaveBeenCalledWith('vp-1');
    expect(mockPlayer.playFromUrl).toHaveBeenCalledWith('https://cdn.test/sample.mp3', {
      key: SUCCESS_SAMPLE_KEY,
      title: 'Zeynep',
    });
    expect(screen.getByTestId('voice-sample-time')).toHaveTextContent('0:04 / 0:12');
  });

  it('stops its own sample on a second press', async () => {
    await renderScreen();
    await startSample();

    fireEvent.press(screen.getByRole('button', { name: STOP }));

    await waitFor(() => expect(mockPlayer.stopPreview).toHaveBeenCalledWith(SUCCESS_SAMPLE_KEY));
    expect(screen.getByRole('button', { name: PLAY })).toBeOnTheScreen();
    expect(screen.queryByTestId('voice-sample-time')).toBeNull();
  });

  it('spins without a stop and play flicker while the sample loads, and ignores a tap then', async () => {
    holdSample = true;
    await renderScreen();

    fireEvent.press(screen.getByRole('button', { name: PLAY }));
    await waitFor(() => expect(mockPlayer.playFromUrl).toHaveBeenCalledTimes(1));
    await act(async () => undefined);

    // The store already says "playing", but nothing sounds yet: busy, not stop.
    const button = screen.getByTestId('voice-sample-button');
    expect(button.props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.queryByRole('button', { name: STOP })).toBeNull();
    expect(screen.getByTestId('voice-sample-button-spinner')).toBeOnTheScreen();

    // A second tap in this phase neither fetches nor starts it again.
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.press(button);
    expect(mockVoiceStore.getVoiceSample).toHaveBeenCalledTimes(1);
    expect(mockPlayer.playFromUrl).toHaveBeenCalledTimes(1);

    // It sounds: now the press stops it.
    act(() => sound());
    expect(screen.getByRole('button', { name: STOP })).toBeOnTheScreen();
    expect(screen.getByTestId('voice-sample-button').props.accessibilityState).toMatchObject({
      busy: false,
    });
  });

  it('returns to the play state when the sample ends on its own', async () => {
    await renderScreen();
    await startSample();

    // The store drops the key at the end; the screen acknowledges nothing.
    act(() => leave());

    expect(screen.getByRole('button', { name: PLAY })).toBeOnTheScreen();
    expect(screen.queryByTestId('voice-sample-time')).toBeNull();
  });

  it('acknowledges its own sample failing to start, never that of another screen', async () => {
    holdSample = true;
    mockPlayer.acknowledgePreviewFailure.mockImplementation(() => {
      runInAction(() => {
        mockPlayer.previewFailed = false;
      });
    });
    await renderScreen();

    fireEvent.press(screen.getByRole('button', { name: PLAY }));
    await waitFor(() => expect(mockPlayer.playFromUrl).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(mockPlayer.acknowledgePreviewFailure).not.toHaveBeenCalled();

    // As the store's watchdog: the failure is flagged, then the key goes.
    act(() => {
      runInAction(() => {
        mockPlayer.previewFailed = true;
      });
      leave();
    });
    expect(mockPlayer.acknowledgePreviewFailure).toHaveBeenCalledTimes(1);
    expect(mockPlayer.previewFailed).toBe(false);
    expect(screen.getByRole('button', { name: PLAY })).toBeEnabled();

    // A sample of another screen failing is that screen's to acknowledge.
    act(() => {
      runInAction(() => {
        mockPlayer.sampleKey = 'narrator-preview:achernar';
      });
    });
    act(() => {
      runInAction(() => {
        mockPlayer.previewFailed = true;
      });
      leave();
    });
    expect(mockPlayer.acknowledgePreviewFailure).toHaveBeenCalledTimes(1);
  });

  it('is not fooled by another sample in the player', async () => {
    await renderScreen();
    act(() => {
      runInAction(() => {
        mockPlayer.sampleKey = 'narrator-preview:achernar';
        mockPlayer.isPlaying = true;
        mockPlayer.totalDurationMs = 9000;
      });
    });

    expect(screen.getByRole('button', { name: PLAY })).toBeOnTheScreen();
    expect(screen.queryByTestId('voice-sample-time')).toBeNull();
  });

  it('says so when the sample is not ready', async () => {
    mockVoiceStore.getVoiceSample.mockResolvedValue(null);
    await renderScreen();

    fireEvent.press(screen.getByRole('button', { name: PLAY }));

    await waitFor(() =>
      expect(showToast.info).toHaveBeenCalledWith(
        'Örnek şimdilik hazırlanamadı. Sesini bir masalda dinleyebilirsin.',
      ),
    );
    expect(mockPlayer.playFromUrl).not.toHaveBeenCalled();
  });

  it('says so when there is no profile to sample', async () => {
    mockRouteParams = undefined;
    await renderScreen();

    fireEvent.press(screen.getByRole('button', { name: PLAY }));

    expect(showToast.error).toHaveBeenCalledWith('Ses örneği bulunamadı');
    expect(mockVoiceStore.getVoiceSample).not.toHaveBeenCalled();
  });

  it('survives a playback failure', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockPlayer.playFromUrl.mockRejectedValue(new Error('boom'));
    await renderScreen();

    fireEvent.press(screen.getByRole('button', { name: PLAY }));

    await waitFor(() => expect(mockPlayer.playFromUrl).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(screen.getByRole('button', { name: PLAY })).toBeEnabled();
  });

  it('goes to the stories tab, clearing the recording state and the sample', async () => {
    await renderScreen();
    await startSample();

    fireEvent.press(screen.getByRole('button', { name: 'Bir masalda dinle' }));

    expect(mockRecordingStore.reset).toHaveBeenCalledTimes(1);
    expect(mockNav.dispatch).toHaveBeenCalledWith(reset('Stories'));
    expect(mockPlayer.stopPreview).toHaveBeenCalledWith(SUCCESS_SAMPLE_KEY);
  });

  it('goes back to the story it was started from, with the new voice picked', async () => {
    mockRouteParams = { profileId: 'vp-1', returnToStoryId: 'story-7' };
    await renderScreen();

    expect(screen.queryByRole('button', { name: 'Bir masalda dinle' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Bu masalda dinle' }));

    expect(mockRecordingStore.reset).toHaveBeenCalledTimes(1);
    expect(mockNav.dispatch).toHaveBeenCalledWith({
      type: 'RESET',
      payload: {
        index: 1,
        routes: [
          { name: 'Main' },
          { name: 'StoryDetail', params: { storyId: 'story-7', selectVoiceId: 'vp-1' } },
        ],
      },
    });
  });

  it('goes back to the Sesim tab from the text button and from hardware back', async () => {
    const addListener = jest.spyOn(BackHandler, 'addEventListener');
    await renderScreen();

    fireEvent.press(screen.getByRole('button', { name: "Sesim'e dön" }));
    expect(mockNav.dispatch).toHaveBeenCalledWith(reset('Voices'));

    const handler = addListener.mock.calls[addListener.mock.calls.length - 1][1];
    expect(handler()).toBe(true);
    expect(mockNav.dispatch).toHaveBeenCalledTimes(2);
    expect(mockNav.dispatch).toHaveBeenLastCalledWith(reset('Voices'));
  });

  it('stops only its own sample when the screen unmounts', async () => {
    const view = await renderScreen();
    await startSample();

    view.unmount();
    expect(mockPlayer.stopPreview).toHaveBeenCalledTimes(1);
    expect(mockPlayer.stopPreview).toHaveBeenCalledWith(SUCCESS_SAMPLE_KEY);
    expect(mockPlayer.sampleKey).toBeNull();
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', async scheme => {
    await renderScreen(scheme);
    const T = themes[scheme];

    expect(flatStyle(screen.getByText('Sesin hazır'))).toMatchObject({
      color: T.text,
      fontFamily: T.fontDisplay,
    });
    // The big badge in the own-voice colour, on its own lip: 72dp.
    expect(
      flatStyle(screen.getByTestId('flow-avatar-face', { includeHiddenElements: true })),
    ).toMatchObject({ backgroundColor: T.own, width: 72, height: 72 });
    expect(
      flatStyle(screen.getByTestId('flow-avatar-lip', { includeHiddenElements: true })).backgroundColor,
    ).toBe(T.ownLip);
    // The sample in a surface card, played with the action colour.
    expect(flatStyle(screen.getByTestId('voice-sample-card-face')).backgroundColor).toBe(T.surface);
    expect(flatStyle(screen.getByTestId('voice-sample-button-face')).backgroundColor).toBe(T.action);
    // One primary button, the lg one of the screen.
    expect(flatStyle(screen.getByTestId('voice-success-listen-face'))).toMatchObject({
      backgroundColor: T.action,
      minHeight: 52,
    });
    expect(flatStyle(screen.getByTestId('voice-success-listen-lip')).backgroundColor).toBe(T.actionLip);
  });

  it('names the sample after the voice being created when the profile list has not caught up', async () => {
    mockVoiceStore.voiceProfiles = [];
    mockRecordingStore = { profileName: 'Annem', reset: jest.fn() };
    await renderScreen();
    expect(screen.getByText('Annem')).toBeOnTheScreen();
  });

  it('falls back to "Senin sesin" when the voice has no name', async () => {
    mockVoiceStore.voiceProfiles = [];
    mockRecordingStore = { profileName: null, reset: jest.fn() };
    await renderScreen();
    expect(screen.getByText('Senin sesin')).toBeOnTheScreen();
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    await renderScreen();

    expect(screen.getByRole('header', { name: 'Your voice is ready' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Listen to the sample' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Listen in a story' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Back to My voice' })).toBeOnTheScreen();
  });

  it('names the story button for the story it returns to in English too', async () => {
    await i18n.changeLanguage('en');
    mockRouteParams = { profileId: 'vp-1', returnToStoryId: 'story-7' };
    await renderScreen();

    expect(screen.getByRole('button', { name: 'Listen in this story' })).toBeOnTheScreen();
  });
});
