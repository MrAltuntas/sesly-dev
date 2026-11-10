/**
 * useLastListened: which story the Library's "Kaldığın yerden devam et" card
 * shows (docs/release-pass/SPEC-audio.md 4.2). The audio store is an
 * observable stand-in; the focus effect has real semantics (runs on focus,
 * cleans up on blur), driven by `setFocused`.
 */

import { act, renderHook } from '@testing-library/react-native';
import { observable, runInAction } from 'mobx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { forgetLastListened, metaOfLastPlayed, useLastListened } from './useLastListened';
import { resetSessionForTests, setSessionUserId } from '../stores/session';
import {
  LAST_PLAYED_STORAGE_KEY,
  lastPlayedFrom,
  readLastPlayed,
  writeLastPlayed,
} from '../utils/lastPlayed';
import type { NarrationMeta } from '../stores/narrationMeta';
import {
  rememberNarrationDuration,
  resetNarrationDurationsForTests,
} from '../utils/narrationDurations';

// ── Focus with real semantics ──
let mockFocused = true;
const mockFocusListeners = new Set<() => void>();
function setFocused(focused: boolean) {
  mockFocused = focused;
  mockFocusListeners.forEach(listener => listener());
}
jest.mock('@react-navigation/native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const subscribe = (listener: () => void) => {
    mockFocusListeners.add(listener);
    return () => {
      mockFocusListeners.delete(listener);
    };
  };
  const useFocused = () => ReactActual.useSyncExternalStore(subscribe, () => mockFocused);
  return {
    ...jest.requireActual('@react-navigation/native'),
    useIsFocused: () => useFocused(),
    useFocusEffect: (callback: () => void | (() => void)) => {
      const focused = useFocused();
      ReactActual.useEffect(() => (focused ? callback() : undefined), [focused, callback]);
    },
  };
});

// ── The audio store ──
const PLAYER_IDLE = {
  audioId: '',
  source: 'none' as 'none' | 'story' | 'sample',
  isStoryLoaded: false,
  isPlayingStory: false,
  isPlaying: false,
  pendingNarrationId: null as string | null,
  loadPhase: 'idle' as 'idle' | 'loading' | 'ready' | 'failed',
  loadError: null as null | 'notFound' | 'audioRemoved' | 'loadFailed' | 'streamFailed',
  /** The narration the failure is about (the store names it). */
  loadErrorNarrationId: null as string | null,
  totalDurationMs: 0,
};
const mockAudio = observable({ ...PLAYER_IDLE });
const setAudio = (patch: Partial<typeof PLAYER_IDLE>) =>
  act(() => {
    runInAction(() => Object.assign(mockAudio, patch));
  });
/** The story `id` is loaded; `playing` is the user's intent. */
const loaded = (id: string, playing: boolean) =>
  setAudio({
    audioId: id,
    source: 'story',
    isStoryLoaded: true,
    isPlayingStory: true,
    isPlaying: playing,
    loadPhase: 'ready',
    pendingNarrationId: null,
  });
jest.mock('./useAudioPlayer', () => ({ useAudioPlayer: () => mockAudio }));

const meta = (narrationId: string, patch: Partial<NarrationMeta> = {}): NarrationMeta => ({
  narrationId,
  storyId: `s-${narrationId}`,
  voiceProfileId: 'vp-kerem',
  story: {
    id: `s-${narrationId}`,
    title: 'Uykulu Ay',
    coverImageUrl: null,
    translationGroupId: 'tg-ay',
    category: 'BEDTIME',
  },
  voiceProfile: null,
  narratorName: 'Kerem',
  ownVoice: false,
  estimateMs: 240000,
  ...patch,
});

async function remember(narrationId: string, userId: string | null, positionMs?: number) {
  await writeLastPlayed(lastPlayedFrom(meta(narrationId), userId, 1000));
  if (positionMs !== undefined) {
    await AsyncStorage.setItem(`narration_position:${narrationId}`, String(positionMs));
  }
}

/** Let the reads of the hook (storage promises, a microtask) settle. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });

async function renderLastListened() {
  const view = renderHook(() => useLastListened());
  await settle();
  return view;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetSessionForTests();
  setSessionUserId('u-1');
  mockFocused = true;
  runInAction(() => Object.assign(mockAudio, PLAYER_IDLE));
  resetNarrationDurationsForTests();
});

describe('useLastListened', () => {
  it('shows the story of this account with a resumable position', async () => {
    await remember('n1', 'u-1', 180000);
    const { result } = await renderLastListened();
    expect(result.current).toMatchObject({
      positionMs: 180000,
      durationMs: 240000,
      live: false,
    });
    expect(result.current?.record).toMatchObject({
      narrationId: 'n1',
      narratorName: 'Kerem',
      story: { title: 'Uykulu Ay' },
    });
  });

  it('shows nothing for another account', async () => {
    await remember('n1', 'u-2', 180000);
    const { result } = await renderLastListened();
    expect(result.current).toBeNull();
  });

  it('shows nothing without a saved position (never played) or with a finished one', async () => {
    await remember('n1', 'u-1');
    const first = await renderLastListened();
    expect(first.result.current).toBeNull();
    first.unmount();

    // Two seconds from the end counts as finished.
    await AsyncStorage.setItem('narration_position:n1', '239000');
    const second = await renderLastListened();
    expect(second.result.current).toBeNull();
  });

  it('takes the real length the device remembered over the estimate', async () => {
    // Played 3 of a real 4 minutes; the estimate says 12.
    await writeLastPlayed(lastPlayedFrom(meta('n1', { estimateMs: 720000 }), 'u-1', 1000));
    await AsyncStorage.setItem('narration_position:n1', '180000');
    rememberNarrationDuration('n1', 240000);
    const { result } = await renderLastListened();
    expect(result.current?.durationMs).toBe(240000);

    // Played past the real end minus two seconds: nothing to resume.
    await AsyncStorage.setItem('narration_position:n1', '239500');
    act(() => setFocused(false));
    act(() => setFocused(true));
    await settle();
    expect(result.current).toBeNull();
  });

  it('shows nothing when its story was playing as the tab gained focus', async () => {
    await remember('n1', 'u-1', 180000);
    loaded('n1', true);
    const { result } = await renderLastListened();
    expect(result.current).toBeNull();

    // Paused and back on the tab: the card is there again.
    setAudio({ isPlaying: false });
    act(() => setFocused(false));
    act(() => setFocused(true));
    await settle();
    expect(result.current?.record.narrationId).toBe('n1');
  });

  it('a card whose story plays when the tab comes back goes at once, before the reads', async () => {
    await remember('n1', 'u-1', 180000);
    const { result } = await renderLastListened();
    expect(result.current?.record.narrationId).toBe('n1');

    act(() => setFocused(false));
    loaded('n1', true);
    // The reads of the new focus never finish: the card is gone anyway.
    (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(() => new Promise(() => undefined));
    act(() => setFocused(true));
    expect(result.current).toBeNull();
  });

  it('a paused story in the player still gets its card, and it is live', async () => {
    await remember('n1', 'u-1', 180000);
    loaded('n1', false);
    setAudio({ totalDurationMs: 250000 });
    const { result } = await renderLastListened();
    expect(result.current).toMatchObject({ live: true, durationMs: 250000 });
  });

  it('stays while focused when its story starts, and turns live', async () => {
    await remember('n1', 'u-1', 180000);
    const { result } = await renderLastListened();
    expect(result.current?.live).toBe(false);

    setAudio({ loadPhase: 'loading', isPlaying: true });
    loaded('n1', true);
    await settle();
    expect(result.current).not.toBeNull();
    expect(result.current?.live).toBe(true);
  });

  it('reads the saved position again when the player pauses while focused', async () => {
    await remember('n1', 'u-1', 60000);
    loaded('n1', false);
    const { result } = await renderLastListened();
    expect(result.current?.positionMs).toBe(60000);

    setAudio({ isPlaying: true });
    // The store saves where the story stopped, in the same tick as the pause.
    await act(async () => {
      runInAction(() => {
        mockAudio.isPlaying = false;
      });
      void AsyncStorage.setItem('narration_position:n1', '125000');
    });
    await settle();
    expect(result.current?.positionMs).toBe(125000);
  });

  it('keeps its story during a focus even when another story starts', async () => {
    await remember('n1', 'u-1', 60000);
    const { result } = await renderLastListened();
    // A row starts n2; the store writes the record of n2.
    await remember('n2', 'u-1', 0);
    loaded('n2', true);
    await settle();
    expect(result.current?.record.narrationId).toBe('n1');
    expect(result.current?.live).toBe(false);

    // The next focus decides afresh: n2 plays, so no card.
    act(() => setFocused(false));
    act(() => setFocused(true));
    await settle();
    expect(result.current).toBeNull();
  });

  it('a read that finishes after the tab left is dropped', async () => {
    await remember('n1', 'u-1', 60000);
    let release: (value: string | null) => void = () => undefined;
    (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(
      () => new Promise<string | null>(resolve => (release = resolve)),
    );
    const { result } = renderHook(() => useLastListened());
    act(() => setFocused(false));
    await act(async () => {
      release(await AsyncStorage.getItem(LAST_PLAYED_STORAGE_KEY));
    });
    await settle();
    expect(result.current).toBeNull();
  });

  it('forgets a narration whose audio was removed (not READY any more)', async () => {
    await remember('n1', 'u-1', 60000);
    const { result } = await renderLastListened();
    setAudio({ pendingNarrationId: 'n1', loadPhase: 'loading', isPlaying: true });
    loaded('n1', true);
    setAudio({ loadError: 'audioRemoved', loadErrorNarrationId: 'n1', loadPhase: 'failed', isPlaying: false });
    await settle();
    expect(result.current).toBeNull();
    expect(await readLastPlayed('u-1')).toBeNull();
  });

  it('forgets a narration that is gone when its start answered 404', async () => {
    await remember('n1', 'u-1', 60000);
    const { result } = await renderLastListened();
    // Started on the stored meta; the background fetch then answers 404.
    setAudio({ pendingNarrationId: 'n1', loadPhase: 'loading', isPlaying: true });
    loaded('n1', true);
    setAudio({ loadError: 'notFound', loadErrorNarrationId: 'n1', loadPhase: 'failed', isPlaying: false });
    await settle();
    expect(result.current).toBeNull();
    expect(await readLastPlayed('u-1')).toBeNull();
  });

  it("forgets the card's story when its start fails before it takes the player", async () => {
    await remember('n1', 'u-1', 60000);
    loaded('n2', false);
    const { result } = await renderLastListened();
    expect(result.current?.record.narrationId).toBe('n1');

    // n1 is started (the card, a push tap) while n2 stays loaded; the server
    // no longer has it, so the start fails before the stream is replaced.
    setAudio({ pendingNarrationId: 'n1', loadPhase: 'loading', isPlaying: true });
    setAudio({
      pendingNarrationId: null,
      loadPhase: 'failed',
      loadError: 'notFound',
      loadErrorNarrationId: 'n1',
      isPlaying: false,
    });
    await settle();
    expect(mockAudio.audioId).toBe('n2');
    expect(result.current).toBeNull();
    expect(await readLastPlayed('u-1')).toBeNull();
  });

  it('a start of another narration that is not found leaves the loaded story and its card alone', async () => {
    await remember('n1', 'u-1', 60000);
    loaded('n1', false);
    const { result } = await renderLastListened();
    expect(result.current?.live).toBe(true);

    // A push tap starts n9, which the server no longer has: the start fails
    // before it takes the player, so n1 stays loaded with the error set.
    setAudio({ pendingNarrationId: 'n9', loadPhase: 'loading', isPlaying: true });
    setAudio({
      pendingNarrationId: null,
      loadPhase: 'failed',
      loadError: 'notFound',
      loadErrorNarrationId: 'n9',
      isPlaying: false,
    });
    await settle();
    expect(result.current?.record.narrationId).toBe('n1');
    expect(await readLastPlayed('u-1')).not.toBeNull();

    // A later 404 of n1 itself (its own start) still forgets it.
    setAudio({
      loadError: null,
      loadErrorNarrationId: null,
      pendingNarrationId: 'n1',
      loadPhase: 'loading',
      isPlaying: true,
    });
    loaded('n1', true);
    setAudio({ loadError: 'notFound', loadErrorNarrationId: 'n1', loadPhase: 'failed', isPlaying: false });
    await settle();
    expect(result.current).toBeNull();
    expect(await readLastPlayed('u-1')).toBeNull();
  });

  it('a 404 of another narration leaves the card alone', async () => {
    await remember('n1', 'u-1', 60000);
    const { result } = await renderLastListened();
    loaded('n2', true);
    setAudio({ loadError: 'notFound', loadErrorNarrationId: 'n2', loadPhase: 'failed' });
    await settle();
    expect(result.current?.record.narrationId).toBe('n1');
  });
});

describe('forgetLastListened', () => {
  it('clears the stored record that points to the narration and hides its card', async () => {
    await remember('n1', 'u-1', 60000);
    const { result } = await renderLastListened();
    await act(async () => {
      await forgetLastListened('n1');
    });
    expect(result.current).toBeNull();
    expect(await AsyncStorage.getItem(LAST_PLAYED_STORAGE_KEY)).toBeNull();
  });

  it('keeps a record that points to another narration', async () => {
    await remember('n1', 'u-1', 60000);
    const { result } = await renderLastListened();
    await act(async () => {
      await forgetLastListened('n9');
    });
    expect(result.current?.record.narrationId).toBe('n1');
    expect(await readLastPlayed('u-1')).not.toBeNull();
  });
});

describe('metaOfLastPlayed', () => {
  it('is the narration meta of the record, without the account fields', () => {
    const record = lastPlayedFrom(meta('n1'), 'u-1', 1000);
    expect(metaOfLastPlayed(record)).toEqual(meta('n1'));
  });
});
