jest.mock('./navigationRef', () => ({
  navigationRef: {
    isReady: jest.fn(),
    getRootState: jest.fn(),
    navigate: jest.fn(),
    getState: jest.fn(),
    goBack: jest.fn(),
  },
}));

import { navigationRef } from './navigationRef';
import {
  PENDING_OPEN_TTL_MS,
  clearPendingNotificationOpen,
  flushPendingNotificationOpen,
  hasPendingNotificationOpen,
  isAppShellReady,
  queueNotificationOpen,
  routeForNotificationTarget,
  shouldSuppressForegroundToast,
} from './pushRouting';
import { NotificationType, PushPayload } from '../models/Notification';

const nav = navigationRef as unknown as {
  isReady: jest.Mock;
  getRootState: jest.Mock;
  navigate: jest.Mock;
  getState: jest.Mock;
  goBack: jest.Mock;
};

/** A cold start whose boot route is Login: no session shell yet. */
const BOOT_STATE = { index: 0, routes: [{ name: 'Login' }] };
const MAIN_STATE = { index: 0, routes: [{ name: 'Main' }] };

function payload(
  type: NotificationType,
  data: Record<string, string>,
): PushPayload {
  return { type, notificationId: 'n-1', data, title: null, body: null };
}

beforeEach(() => {
  clearPendingNotificationOpen();
  nav.isReady.mockReturnValue(true);
  nav.getRootState.mockReturnValue(MAIN_STATE);
  nav.getState.mockReset().mockReturnValue(MAIN_STATE);
  nav.navigate.mockReset();
  nav.goBack.mockReset();
});

describe('routeForNotificationTarget', () => {
  it('maps every target kind', () => {
    expect(routeForNotificationTarget({ kind: 'player', narrationId: 'nar-1' })).toEqual({
      name: 'AudioPlayer',
      params: { narrationId: 'nar-1' },
    });
    expect(routeForNotificationTarget({ kind: 'story', storyId: 's-1' })).toEqual({
      name: 'StoryDetail',
      params: { storyId: 's-1' },
    });
    expect(routeForNotificationTarget({ kind: 'voices' })).toEqual({ name: 'VoiceProfiles' });
    expect(routeForNotificationTarget({ kind: 'none' })).toBeNull();
  });

  it('a plain tap never autoplays; the toast action asks for it', () => {
    const plain = routeForNotificationTarget({ kind: 'player', narrationId: 'nar-1' });
    expect(plain?.name).toBe('AudioPlayer');
    expect(plain?.name === 'AudioPlayer' ? plain.params : null).not.toHaveProperty('autoplay');

    expect(
      routeForNotificationTarget({ kind: 'player', narrationId: 'nar-1' }, { autoplay: true }),
    ).toEqual({ name: 'AudioPlayer', params: { narrationId: 'nar-1', autoplay: true } });
    // Only the player has something to start.
    expect(routeForNotificationTarget({ kind: 'story', storyId: 's-1' }, { autoplay: true })).toEqual({
      name: 'StoryDetail',
      params: { storyId: 's-1' },
    });
  });
});

describe('isAppShellReady', () => {
  it('is true only once Main is in the root stack', () => {
    expect(isAppShellReady(undefined)).toBe(false);
    expect(isAppShellReady(BOOT_STATE)).toBe(false);
    expect(isAppShellReady({ routes: [{ name: 'Main' }, { name: 'AudioPlayer' }] })).toBe(true);
  });
});

describe('notification tap queue', () => {
  it('navigates immediately and marks read when the shell is mounted', () => {
    const onOpened = jest.fn();
    queueNotificationOpen({ kind: 'player', narrationId: 'nar-1' }, 'n-1', onOpened);

    expect(nav.navigate).toHaveBeenCalledWith('AudioPlayer', { narrationId: 'nar-1' });
    expect(onOpened).toHaveBeenCalledWith('n-1');
    expect(hasPendingNotificationOpen()).toBe(false);
  });

  it('waits on the boot route (cold start on Login) and runs once Main appears', () => {
    nav.getRootState.mockReturnValue(BOOT_STATE);
    const onOpened = jest.fn();
    queueNotificationOpen({ kind: 'story', storyId: 's-1' }, 'n-1', onOpened);

    expect(nav.navigate).not.toHaveBeenCalled();
    expect(onOpened).not.toHaveBeenCalled();

    nav.getRootState.mockReturnValue(MAIN_STATE);
    flushPendingNotificationOpen();
    flushPendingNotificationOpen();

    expect(nav.navigate).toHaveBeenCalledTimes(1);
    expect(nav.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 's-1' });
    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  it('waits for the navigation container to be ready', () => {
    nav.isReady.mockReturnValue(false);
    queueNotificationOpen({ kind: 'voices' }, null);
    expect(nav.navigate).not.toHaveBeenCalled();

    nav.isReady.mockReturnValue(true);
    flushPendingNotificationOpen();
    expect(nav.navigate).toHaveBeenCalledWith('VoiceProfiles');
  });

  it('marks SYSTEM taps read without navigating', () => {
    const onOpened = jest.fn();
    queueNotificationOpen({ kind: 'none' }, 'n-5', onOpened);
    expect(onOpened).toHaveBeenCalledWith('n-5');
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('still navigates when marking the notification read throws', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    queueNotificationOpen({ kind: 'story', storyId: 's-2' }, 'n-2', () => {
      throw new Error('store gone');
    });
    expect(nav.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 's-2' });
    expect(warn).toHaveBeenCalledWith('[Push] onOpened failed:', expect.any(Error));
  });

  it('does not mark read when the tap has no notification id', () => {
    const onOpened = jest.fn();
    queueNotificationOpen({ kind: 'voices' }, null, onOpened);
    expect(onOpened).not.toHaveBeenCalled();
    expect(nav.navigate).toHaveBeenCalledWith('VoiceProfiles');
  });

  it('a newer tap replaces an older queued one', () => {
    nav.getRootState.mockReturnValue(BOOT_STATE);
    queueNotificationOpen({ kind: 'voices' }, 'n-1');
    queueNotificationOpen({ kind: 'player', narrationId: 'nar-9' }, 'n-2');
    nav.getRootState.mockReturnValue(MAIN_STATE);
    flushPendingNotificationOpen();
    expect(nav.navigate).toHaveBeenCalledTimes(1);
    expect(nav.navigate).toHaveBeenCalledWith('AudioPlayer', { narrationId: 'nar-9' });
  });

  it('drops a tap that waited longer than the TTL', () => {
    nav.getRootState.mockReturnValue(BOOT_STATE);
    jest.setSystemTime(new Date('2026-09-27T20:00:00Z'));
    queueNotificationOpen({ kind: 'voices' }, 'n-1');

    jest.setSystemTime(new Date(Date.now() + PENDING_OPEN_TTL_MS + 1));
    nav.getRootState.mockReturnValue(MAIN_STATE);
    flushPendingNotificationOpen();

    expect(nav.navigate).not.toHaveBeenCalled();
    expect(hasPendingNotificationOpen()).toBe(false);
  });

  it('keeps the autoplay of a queued toast action until it runs', () => {
    nav.getRootState.mockReturnValue(BOOT_STATE);
    queueNotificationOpen({ kind: 'player', narrationId: 'nar-3' }, 'n-3', undefined, { autoplay: true });
    expect(nav.navigate).not.toHaveBeenCalled();

    nav.getRootState.mockReturnValue(MAIN_STATE);
    flushPendingNotificationOpen();
    expect(nav.navigate).toHaveBeenCalledWith('AudioPlayer', { narrationId: 'nar-3', autoplay: true });
  });

  it('a story tap over the player of that story goes back to its page', () => {
    nav.getState.mockReturnValue({
      index: 2,
      routes: [
        { name: 'Main' },
        { name: 'StoryDetail', params: { storyId: 's-1' } },
        { name: 'AudioPlayer', params: { narrationId: 'nar-1' } },
      ],
    });

    queueNotificationOpen({ kind: 'story', storyId: 's-1' }, 'n-1');

    expect(nav.goBack).toHaveBeenCalledTimes(1);
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('a story tap about another story pushes its page', () => {
    nav.getState.mockReturnValue({
      index: 2,
      routes: [
        { name: 'Main' },
        { name: 'StoryDetail', params: { storyId: 's-1' } },
        { name: 'AudioPlayer', params: { narrationId: 'nar-1' } },
      ],
    });

    queueNotificationOpen({ kind: 'story', storyId: 's-2' }, 'n-2');

    expect(nav.goBack).not.toHaveBeenCalled();
    expect(nav.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 's-2' });
  });
});

describe('shouldSuppressForegroundToast', () => {
  const narrationReady = payload(NotificationType.NARRATION_READY, {
    narrationId: 'nar-1',
    storyId: 's-1',
  });
  const voiceReady = payload(NotificationType.VOICE_READY, { voiceProfileId: 'v-1' });

  it('suppresses when the user is watching that generation or narration', () => {
    expect(
      shouldSuppressForegroundToast(narrationReady, {
        name: 'AudioGeneration',
        params: { storyId: 's-1', voiceProfileId: 'v-1' },
      }),
    ).toBe(true);
    expect(
      shouldSuppressForegroundToast(narrationReady, {
        name: 'AudioPlayer',
        params: { narrationId: 'nar-1' },
      }),
    ).toBe(true);
    expect(
      shouldSuppressForegroundToast(voiceReady, { name: 'Processing', params: { profileId: 'v-1' } }),
    ).toBe(true);
  });

  it('shows the toast anywhere else', () => {
    expect(
      shouldSuppressForegroundToast(narrationReady, {
        name: 'AudioGeneration',
        params: { storyId: 's-2', voiceProfileId: 'v-1' },
      }),
    ).toBe(false);
    expect(shouldSuppressForegroundToast(narrationReady, { name: 'Stories' })).toBe(false);
    expect(
      shouldSuppressForegroundToast(voiceReady, { name: 'Processing', params: { profileId: 'v-9' } }),
    ).toBe(false);
    expect(
      shouldSuppressForegroundToast(payload(NotificationType.SYSTEM, {}), { name: 'Processing' }),
    ).toBe(false);
    expect(shouldSuppressForegroundToast(narrationReady, undefined)).toBe(false);
  });
});
