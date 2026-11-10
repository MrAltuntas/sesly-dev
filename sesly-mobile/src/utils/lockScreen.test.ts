let mockNativeSession: Record<string, jest.Mock> | null = null;

jest.mock('../../modules/sesly-media', () => ({
  __esModule: true,
  get default() {
    return mockNativeSession;
  },
}));

import { Image, Platform } from 'react-native';
import {
  LOCK_SCREEN_METADATA_MIN_INTERVAL_MS,
  LOCK_SCREEN_OPTIONS,
  LockScreenController,
  buildLockScreenMetadata,
  buildPlayerLockScreenMetadata,
  createLockScreenBackend,
  expoAudioBackend,
  mediaSessionBackend,
  placeholderArtworkUri,
  toExpoAudioMetadata,
  type LockScreenCapablePlayer,
} from './lockScreen';
import { COVER_PLACEHOLDERS, resolveCover } from '../components/design/covers';
import type { SeslyMediaModule } from './mediaSession';

function makePlayer() {
  return {
    setActiveForLockScreen: jest.fn(),
    updateLockScreenMetadata: jest.fn(),
  };
}

const storyA = { title: 'Ayışığı Ormanı', coverImageUrl: 'https://cdn.example/a.jpg' };
const storyB = { title: 'Deniz Feneri', coverImageUrl: 'https://cdn.example/b.jpg' };

describe('buildLockScreenMetadata', () => {
  it('uses story title, voice name and cover', () => {
    expect(buildLockScreenMetadata(storyA, 'Annem')).toEqual({
      title: 'Ayışığı Ormanı',
      artist: 'Annem',
      albumTitle: 'Sesly',
      artworkUrl: 'https://cdn.example/a.jpg',
    });
  });

  it('falls back when data is missing and drops non-http artwork', () => {
    expect(buildLockScreenMetadata({ title: '', coverImageUrl: '/covers/a.jpg' }, null)).toEqual({
      title: 'Masal',
      artist: 'Sesly',
      albumTitle: 'Sesly',
    });
    expect(buildLockScreenMetadata(null)).toEqual({
      title: 'Masal',
      artist: 'Sesly',
      albumTitle: 'Sesly',
    });
  });

  it("the player's metadata names the narrator from currentNarratorName (known without a voice model)", () => {
    expect(
      buildPlayerLockScreenMetadata({ currentStory: storyA, currentNarratorName: 'Kerem' }),
    ).toEqual({
      title: 'Ayışığı Ormanı',
      artist: 'Kerem',
      albumTitle: 'Sesly',
      artworkUrl: 'https://cdn.example/a.jpg',
    });
    expect(
      buildPlayerLockScreenMetadata({ currentStory: storyB, currentNarratorName: null }).artist,
    ).toBe('Sesly');
  });
});

describe('LockScreenController', () => {
  let now = 0;
  const clock = () => now;

  beforeEach(() => {
    now = 10_000;
  });

  it('activates once with seek buttons, then ignores identical syncs', () => {
    const player = makePlayer();
    const ctrl = new LockScreenController(clock);
    const meta = buildLockScreenMetadata(storyA, 'Annem');

    ctrl.sync(player, true, meta);
    ctrl.sync(player, true, { ...meta });
    ctrl.sync(player, true, meta);

    expect(player.setActiveForLockScreen).toHaveBeenCalledTimes(1);
    expect(player.setActiveForLockScreen).toHaveBeenCalledWith(true, meta, LOCK_SCREEN_OPTIONS);
    expect(LOCK_SCREEN_OPTIONS).toEqual({ showSeekForward: true, showSeekBackward: true });
    expect(player.updateLockScreenMetadata).not.toHaveBeenCalled();
    expect(ctrl.isActive).toBe(true);
  });

  it('only updates metadata on a track change (no re-activation)', () => {
    const player = makePlayer();
    const ctrl = new LockScreenController(clock);
    ctrl.sync(player, true, buildLockScreenMetadata(storyA, 'Annem'));

    now += LOCK_SCREEN_METADATA_MIN_INTERVAL_MS;
    const next = buildLockScreenMetadata(storyB, 'Annem');
    ctrl.sync(player, true, next);

    expect(player.setActiveForLockScreen).toHaveBeenCalledTimes(1);
    expect(player.updateLockScreenMetadata).toHaveBeenCalledTimes(1);
    expect(player.updateLockScreenMetadata).toHaveBeenCalledWith(next);
  });

  it('throttles rapid track changes and applies only the latest', () => {
    const player = makePlayer();
    const ctrl = new LockScreenController(clock);
    ctrl.sync(player, true, buildLockScreenMetadata(storyA, 'Annem'));

    // Three changes inside the throttle window.
    now += 100;
    ctrl.sync(player, true, buildLockScreenMetadata(storyB, 'Annem'));
    now += 100;
    ctrl.sync(player, true, buildLockScreenMetadata(storyB, 'Babam'));
    now += 100;
    const last = buildLockScreenMetadata({ title: 'Son Masal' }, 'Babam');
    ctrl.sync(player, true, last);

    expect(player.updateLockScreenMetadata).not.toHaveBeenCalled();

    now += LOCK_SCREEN_METADATA_MIN_INTERVAL_MS;
    jest.advanceTimersByTime(LOCK_SCREEN_METADATA_MIN_INTERVAL_MS);

    expect(player.updateLockScreenMetadata).toHaveBeenCalledTimes(1);
    expect(player.updateLockScreenMetadata).toHaveBeenCalledWith(last);
  });

  it('drops a queued change that returns to what is already shown', () => {
    const player = makePlayer();
    const ctrl = new LockScreenController(clock);
    const shown = buildLockScreenMetadata(storyA, 'Annem');
    ctrl.sync(player, true, shown);

    now += 100;
    ctrl.sync(player, true, buildLockScreenMetadata(storyB, 'Annem'));
    ctrl.sync(player, true, shown);
    jest.advanceTimersByTime(LOCK_SCREEN_METADATA_MIN_INTERVAL_MS);

    expect(player.updateLockScreenMetadata).not.toHaveBeenCalled();
  });

  it('deactivates for free users / previews and re-activates later', () => {
    const player = makePlayer();
    const ctrl = new LockScreenController(clock);
    const meta = buildLockScreenMetadata(storyA, 'Annem');

    ctrl.sync(player, true, meta);
    ctrl.sync(player, false, meta);
    ctrl.sync(player, false, meta);

    expect(player.setActiveForLockScreen).toHaveBeenNthCalledWith(2, false);
    expect(player.setActiveForLockScreen).toHaveBeenCalledTimes(2);
    expect(ctrl.isActive).toBe(false);

    ctrl.sync(player, true, meta);
    expect(player.setActiveForLockScreen).toHaveBeenCalledTimes(3);
    expect(player.setActiveForLockScreen).toHaveBeenLastCalledWith(true, meta, LOCK_SCREEN_OPTIONS);
  });

  it('never calls native code when it was never active', () => {
    const player = makePlayer();
    const ctrl = new LockScreenController(clock);
    ctrl.deactivate();
    ctrl.sync(player, false, null);
    expect(player.setActiveForLockScreen).not.toHaveBeenCalled();
  });

  it('cancels a pending update on deactivate', () => {
    const player = makePlayer();
    const ctrl = new LockScreenController(clock);
    ctrl.sync(player, true, buildLockScreenMetadata(storyA, 'Annem'));
    now += 100;
    ctrl.sync(player, true, buildLockScreenMetadata(storyB, 'Annem'));
    ctrl.deactivate();
    jest.advanceTimersByTime(LOCK_SCREEN_METADATA_MIN_INTERVAL_MS * 2);
    expect(player.updateLockScreenMetadata).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Artwork fallback and the two backends
// ============================================================================

describe('placeholder artwork', () => {
  const PLACEHOLDER = 'assets_images_covers_coverplaceholder03';
  let resolve: jest.SpyInstance;

  beforeEach(() => {
    resolve = jest
      .spyOn(Image, 'resolveAssetSource')
      .mockReturnValue({ uri: PLACEHOLDER, width: 600, height: 900, scale: 1 });
  });

  afterEach(() => {
    resolve.mockRestore();
  });

  it('a story with an id carries its placeholder cover as the fallback', () => {
    const coverless = { id: 'story-1', title: 'Uykulu Ay', coverImageUrl: null };

    expect(placeholderArtworkUri(coverless)).toBe(PLACEHOLDER);
    expect(buildLockScreenMetadata(coverless, 'Annem')).toEqual({
      title: 'Uykulu Ay',
      artist: 'Annem',
      albumTitle: 'Sesly',
      fallbackArtworkUri: PLACEHOLDER,
    });
    // The picture of the player screen: the tale key picks it.
    expect(resolve).toHaveBeenLastCalledWith(
      COVER_PLACEHOLDERS[resolveCover({ id: 'story-1' }).placeholderIndex],
    );
  });

  it('a story with a cover keeps the placeholder for a failed download', () => {
    const meta = buildLockScreenMetadata({ id: 'story-2', ...storyA }, 'Annem');

    expect(meta.artworkUrl).toBe('https://cdn.example/a.jpg');
    expect(meta.fallbackArtworkUri).toBe(PLACEHOLDER);
  });

  it('no id or no resolvable asset: no fallback', () => {
    expect(placeholderArtworkUri(null)).toBeUndefined();
    expect(placeholderArtworkUri({ title: 'x' })).toBeUndefined();
    resolve.mockReturnValueOnce(null as never);
    expect(placeholderArtworkUri({ id: 'story-3' })).toBeUndefined();
    resolve.mockImplementationOnce(() => {
      throw new Error('no asset registry');
    });
    expect(placeholderArtworkUri({ id: 'story-3' })).toBeUndefined();
  });
});

describe('toExpoAudioMetadata (iOS)', () => {
  const base = { title: 'Uykulu Ay', artist: 'Annem', albumTitle: 'Sesly' };

  it('prefers the cover, else a placeholder it can open as a URL', () => {
    expect(
      toExpoAudioMetadata({ ...base, artworkUrl: 'https://cdn/a.jpg', fallbackArtworkUri: 'file:///p.webp' }),
    ).toEqual({ ...base, artworkUrl: 'https://cdn/a.jpg' });
    expect(toExpoAudioMetadata({ ...base, fallbackArtworkUri: 'file:///app/assets/p.webp' })).toEqual({
      ...base,
      artworkUrl: 'file:///app/assets/p.webp',
    });
    expect(
      toExpoAudioMetadata({ ...base, fallbackArtworkUri: 'http://10.0.2.2:8081/assets/p.webp' }),
    ).toEqual({ ...base, artworkUrl: 'http://10.0.2.2:8081/assets/p.webp' });
  });

  it('drops a drawable resource name (Android only)', () => {
    expect(toExpoAudioMetadata({ ...base, fallbackArtworkUri: 'assets_images_covers_p03' })).toEqual(base);
  });

  it('the expo-audio backend sends the converted metadata', () => {
    const player = makePlayer();
    const ctrl = new LockScreenController(() => 0, expoAudioBackend);

    ctrl.sync(player, true, { ...base, fallbackArtworkUri: 'file:///p.webp' });

    expect(player.setActiveForLockScreen).toHaveBeenCalledWith(
      true,
      { ...base, artworkUrl: 'file:///p.webp' },
      LOCK_SCREEN_OPTIONS,
    );
  });
});

describe('media session backend (Android)', () => {
  function makeSession() {
    return {
      activate: jest.fn(async (..._args: unknown[]) => undefined),
      updateMetadata: jest.fn(async (..._args: unknown[]) => undefined),
      deactivate: jest.fn(async () => undefined),
      isActive: jest.fn(() => false),
      addListener: jest.fn(),
    };
  }

  const backendWith = (session: ReturnType<typeof makeSession>) => (p: LockScreenCapablePlayer) =>
    mediaSessionBackend(session as unknown as SeslyMediaModule, p);

  const metaA = {
    title: 'Ayışığı Ormanı',
    artist: 'Annem',
    albumTitle: 'Sesly',
    artworkUrl: 'https://cdn.example/a.jpg',
    fallbackArtworkUri: 'assets_images_covers_p01',
  };
  const metaB = { title: 'Deniz Feneri', artist: 'Annem', albumTitle: 'Sesly' };

  it('activates the native session with the player, the metadata and 15 s skips', () => {
    const session = makeSession();
    const player = makePlayer();
    const ctrl = new LockScreenController(() => 0, backendWith(session));

    ctrl.sync(player, true, metaA);

    expect(session.activate).toHaveBeenCalledWith(player, metaA, {
      skipBackwardMs: 15_000,
      skipForwardMs: 15_000,
    });
    expect(player.setActiveForLockScreen).not.toHaveBeenCalled();
  });

  it('updates a track change at once (no iOS throttle) and deactivates', () => {
    const session = makeSession();
    const player = makePlayer();
    let t = 1000;
    const ctrl = new LockScreenController(() => t, backendWith(session));

    ctrl.sync(player, true, metaA);
    t += 10;
    ctrl.sync(player, true, metaB);
    ctrl.deactivate();

    expect(session.updateMetadata).toHaveBeenCalledWith({
      ...metaB,
      artworkUrl: null,
      fallbackArtworkUri: null,
    });
    expect(session.deactivate).toHaveBeenCalledTimes(1);
  });

  it('a failed activation leaves it inactive, so the next sync retries', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const session = makeSession();
    session.activate.mockRejectedValueOnce(new Error('not a media3 player'));
    const player = makePlayer();
    const ctrl = new LockScreenController(() => 0, backendWith(session));

    ctrl.sync(player, true, metaA);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctrl.isActive).toBe(false);

    ctrl.sync(player, true, metaA);
    expect(session.activate).toHaveBeenCalledTimes(2);
    expect(ctrl.isActive).toBe(true);
    warn.mockRestore();
  });

  it('a late failure of an old activation does not touch a newer one', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const session = makeSession();
    let reject: (error: Error) => void = () => {};
    session.activate.mockImplementationOnce(
      () =>
        new Promise<undefined>((_resolve, rej) => {
          reject = rej;
        }),
    );
    const player = makePlayer();
    const ctrl = new LockScreenController(() => 0, backendWith(session));

    ctrl.sync(player, true, metaA);
    ctrl.deactivate();
    ctrl.sync(player, true, metaA);
    reject(new Error('late'));
    await Promise.resolve();
    await Promise.resolve();

    expect(ctrl.isActive).toBe(true);
    warn.mockRestore();
  });

  it('native update and deactivate failures are logged only', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const session = makeSession();
    session.updateMetadata.mockRejectedValueOnce(new Error('gone'));
    session.deactivate.mockRejectedValueOnce(new Error('gone'));
    const backend = backendWith(session)(makePlayer());

    backend.update(metaB);
    backend.deactivate();
    await Promise.resolve();
    await Promise.resolve();

    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('createLockScreenBackend', () => {
  const originalOS = Platform.OS;
  const meta = { title: 'T', artist: 'A', albumTitle: 'Sesly' };

  afterEach(() => {
    Platform.OS = originalOS;
    mockNativeSession = null;
  });

  it('Android with the native module: the media session', () => {
    Platform.OS = 'android';
    mockNativeSession = {
      activate: jest.fn(async () => undefined),
      updateMetadata: jest.fn(),
      deactivate: jest.fn(),
      isActive: jest.fn(),
      addListener: jest.fn(),
    };
    const player = makePlayer();

    createLockScreenBackend(player).activate(meta, () => {});

    expect(mockNativeSession.activate).toHaveBeenCalledTimes(1);
    expect(player.setActiveForLockScreen).not.toHaveBeenCalled();
  });

  it('iOS, or Android without the module: expo-audio', () => {
    const player = makePlayer();
    Platform.OS = 'ios';
    createLockScreenBackend(player).activate(meta, () => {});
    Platform.OS = 'android';
    createLockScreenBackend(player).activate(meta, () => {});

    expect(player.setActiveForLockScreen).toHaveBeenCalledTimes(2);
  });
});
