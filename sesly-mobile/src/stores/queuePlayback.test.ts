/**
 * Playback from the queue (src/stores/queuePlayback.ts).
 *
 * A fake audio store stands in for AudioPlayerStore: it records every
 * `startNarration`, runs the installed start listener like the real one
 * (synchronously, before its first await) and calls the installed story end
 * handler the way the store does when a story's status reports its end
 * (`finish()`), with no screen mounted. A fake sleep timer counts stories
 * like SleepTimerService. The queue is the real QueueStore singleton, kept
 * in memory only (no signed-in user).
 */

const mockShowInfo = jest.fn();
jest.mock('../utils/toast', () => ({
  showToast: {
    info: (...a: unknown[]) => mockShowInfo(...a),
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  },
}));
// Read lazily: the module under test reaches the store at call time.
let mockAudio: unknown = null;
jest.mock('../hooks/useAudioPlayer', () => ({
  getAudioPlayerStore: () => mockAudio,
}));

import { makeObservable, observable, runInAction } from 'mobx';
import i18n from '../i18n';
import {
  PREVIOUS_RESTART_MS,
  bindStoryEnd,
  playNext,
  playPrevious,
  playQueueFrom,
  type QueueSleepTimer,
} from './queuePlayback';
import { queueStore } from './QueueStore';
import type { NarrationMeta } from './narrationMeta';
import type {
  LoadError,
  LoadPhase,
  NarrationInput,
  PlayerSource,
  StartListener,
  StartOptions,
  StoryEndDecision,
  StoryEndHandler,
} from '../hooks/useAudioPlayer';

class FakeAudio {
  audioId = '';
  source: PlayerSource = 'none';
  loadError: LoadError | null = null;
  loadErrorNarrationId: string | null = null;
  loadPhase: LoadPhase = 'idle';
  pendingNarrationId: string | null = null;
  currentPositionMs = 0;
  /** While set, a start stays pending (the outgoing story keeps the player). */
  holdStart: Promise<void> | null = null;
  startListener: StartListener | null = null;
  storyEndHandler: StoryEndHandler | null = null;
  readonly starts: { id: string; options: StartOptions; input: NarrationInput }[] = [];

  constructor() {
    makeObservable(this, {
      audioId: observable,
      source: observable,
      loadError: observable,
      loadErrorNarrationId: observable,
      loadPhase: observable,
      pendingNarrationId: observable,
      currentPositionMs: observable,
    });
  }

  get isStoryLoaded(): boolean {
    return this.source === 'story' && !!this.audioId;
  }

  startNarration = jest.fn(async (input: NarrationInput, options: StartOptions = {}) => {
    const id = 'narration' in input ? input.narration.id : input.narrationId;
    this.starts.push({ id, options, input });
    runInAction(() => {
      this.loadPhase = 'loading';
      this.pendingNarrationId = id;
      this.loadError = null;
      this.loadErrorNarrationId = null;
    });
    // The real store tells the listener before its first await.
    this.startListener?.(id, options);
    await Promise.resolve();
    if (this.holdStart) await this.holdStart;
    if (this.pendingNarrationId !== id) return false;
    runInAction(() => {
      this.source = 'story';
      this.audioId = id;
      this.loadPhase = 'ready';
      this.pendingNarrationId = null;
      this.currentPositionMs = 0;
    });
    return true;
  });

  seek = jest.fn(async (seconds: number) => {
    runInAction(() => {
      this.currentPositionMs = seconds * 1000;
    });
  });

  setStartListener(listener: StartListener | null): void {
    this.startListener = listener;
  }

  setStoryEndHandler(handler: StoryEndHandler | null): void {
    this.storyEndHandler = handler;
  }

  /** The store's end of a story: the handler decides, 'stop' without one. */
  finish(): StoryEndDecision {
    return this.storyEndHandler?.(this.audioId) ?? 'stop';
  }

  /** The store's 404 for a narration: the loaded story's, or a start's that never took the player. */
  notFound(narrationId: string, error: 'notFound' | 'audioRemoved' = 'notFound'): void {
    runInAction(() => {
      this.loadPhase = 'failed';
      this.loadError = error;
      this.loadErrorNarrationId = narrationId;
      if (this.pendingNarrationId === narrationId) this.pendingNarrationId = null;
    });
  }

  /** A sample in the player (its end never reaches a story end handler in the store). */
  holdSample(): void {
    runInAction(() => {
      this.source = 'sample';
      this.audioId = '';
    });
  }
}

function fakeTimer(): QueueSleepTimer & {
  store: { active: boolean; mode: string; storiesLeft: number };
  handleStoryFinished: jest.Mock;
  turnOff: jest.Mock;
  stopAfter(stories: number): void;
  startDuration(): void;
} {
  const timer = {
    store: { active: false, mode: 'duration', storiesLeft: 0 },
    handleStoryFinished: jest.fn((): 'stop' | 'continue' => {
      const { store } = timer;
      if (!store.active || store.mode !== 'stories') return 'continue';
      if (store.storiesLeft <= 1) {
        timer.turnOff();
        return 'stop';
      }
      store.storiesLeft -= 1;
      return 'continue';
    }),
    turnOff: jest.fn(() => {
      timer.store.active = false;
      timer.store.storiesLeft = 0;
    }),
    stopAfter(stories: number) {
      Object.assign(timer.store, { active: true, mode: 'stories', storiesLeft: stories });
    },
    startDuration() {
      Object.assign(timer.store, { active: true, mode: 'duration', storiesLeft: 0 });
    },
  };
  return timer;
}

function meta(narrationId: string): NarrationMeta {
  return {
    narrationId,
    storyId: `story-${narrationId}`,
    voiceProfileId: 'voice-1',
    story: {
      id: `story-${narrationId}`,
      title: `Masal ${narrationId}`,
      coverImageUrl: null,
      translationGroupId: null,
      category: null,
    },
    voiceProfile: null,
    narratorName: 'Kerem',
    ownVoice: false,
    estimateMs: 0,
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

let audio: FakeAudio;
let timer: ReturnType<typeof fakeTimer>;
let unbind: () => void;

/** The queue a, b, c (or the given ids), bound to a fresh fake store and timer. */
function setup(names: string[] = ['a', 'b', 'c']) {
  names.forEach(name => queueStore.add(meta(name)));
  unbind = bindStoryEnd(audio, queueStore, timer);
}

beforeEach(() => {
  queueStore.reset();
  audio = new FakeAudio();
  mockAudio = audio;
  timer = fakeTimer();
  mockShowInfo.mockReset();
  unbind = () => undefined;
});

afterEach(() => {
  unbind();
  jest.useRealTimers();
});

describe('story end', () => {
  it('advances to the next entry with no screen mounted', async () => {
    setup();
    await playQueueFrom('a');

    const decision = audio.finish();

    expect(decision).toBe('advance');
    expect(audio.startNarration).toHaveBeenCalledTimes(2);
    expect(audio.startNarration).toHaveBeenLastCalledWith(
      { narrationId: 'b', meta: expect.objectContaining({ narrationId: 'b', storyId: 'story-b' }) },
      { autoplay: true, fromQueue: true },
    );
    expect(queueStore.currentId).toBe('b');

    await flush();
    expect(audio.finish()).toBe('advance');
    expect(audio.starts.map(s => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('the advance uses no timer: the start happens with fake timers never advanced', async () => {
    jest.useFakeTimers();
    setup();
    await playQueueFrom('a');
    audio.startNarration.mockClear();

    expect(audio.finish()).toBe('advance');

    // Synchronous, inside the status event: no timer was needed for it.
    expect(audio.startNarration).toHaveBeenCalledTimes(1);
    expect(audio.startNarration.mock.calls[0][0]).toMatchObject({ narrationId: 'b' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a story outside the queue does not advance even if it is queued', async () => {
    setup();
    await playQueueFrom('a');

    // "b" opened from the Library, not from the queue.
    await audio.startNarration({ narrationId: 'b' }, { autoplay: true });

    expect(queueStore.currentId).toBeNull();
    expect(audio.finish()).toBe('stop');
    expect(audio.starts.map(s => s.id)).toEqual(['a', 'b']);
  });

  it('a queued story played with no queue context stops at its end', async () => {
    setup();
    await audio.startNarration({ narrationId: 'a' }, { autoplay: true });

    expect(audio.finish()).toBe('stop');
    expect(audio.startNarration).toHaveBeenCalledTimes(1);
  });

  it('opening the current entry from elsewhere keeps the context', async () => {
    setup();
    await playQueueFrom('a');

    // The same narration from its story page: still the queue's story.
    await audio.startNarration({ narrationId: 'a' }, { autoplay: true });

    expect(queueStore.currentId).toBe('a');
    expect(audio.finish()).toBe('advance');
  });

  it('the end of the queue stops and turns a stories timer off', async () => {
    setup(['a', 'b']);
    timer.stopAfter(5);
    await playQueueFrom('b');

    expect(audio.finish()).toBe('stop');
    expect(timer.turnOff).toHaveBeenCalledTimes(1);
    expect(timer.store.active).toBe(false);
    expect(audio.startNarration).toHaveBeenCalledTimes(1);
  });

  it('the end of the queue leaves a duration timer running', async () => {
    setup(['a']);
    timer.startDuration();
    await playQueueFrom('a');

    expect(audio.finish()).toBe('stop');
    expect(timer.turnOff).not.toHaveBeenCalled();
    expect(timer.store.active).toBe(true);
  });

  it('a 2-story timer stops after the second story', async () => {
    setup(['a', 'b', 'c']);
    timer.stopAfter(2);
    await playQueueFrom('a');

    expect(audio.finish()).toBe('advance');
    await flush();
    expect(audio.audioId).toBe('b');

    expect(audio.finish()).toBe('stop');
    expect(audio.starts.map(s => s.id)).toEqual(['a', 'b']);
    expect(timer.store.active).toBe(false);
    // The context stays on the story that rests at its end.
    expect(queueStore.currentId).toBe('b');
  });

  it('a sample finishing does nothing', async () => {
    setup();
    timer.stopAfter(1);
    await playQueueFrom('a');
    audio.holdSample();
    audio.startNarration.mockClear();

    expect(audio.storyEndHandler?.('')).toBe('stop');

    expect(timer.handleStoryFinished).not.toHaveBeenCalled();
    expect(timer.store.active).toBe(true);
    expect(audio.startNarration).not.toHaveBeenCalled();
    expect(queueStore.currentId).toBe('a');
  });

  it('an end report for a narration that is not loaded is ignored', async () => {
    setup();
    await playQueueFrom('a');
    audio.startNarration.mockClear();

    expect(audio.storyEndHandler?.('b')).toBe('stop');
    expect(audio.startNarration).not.toHaveBeenCalled();
    expect(queueStore.currentId).toBe('a');
  });

  it('unbinding removes the listener and the handler', async () => {
    setup();
    unbind();

    expect(audio.startListener).toBeNull();
    expect(audio.storyEndHandler).toBeNull();
    expect(audio.finish()).toBe('stop');
  });
});

describe('a missing narration', () => {
  it('a narration whose audio was removed is skipped like a missing one', async () => {
    setup(['a', 'b', 'c']);
    await playQueueFrom('a');

    // The background refresh of "a" found it not READY any more.
    audio.notFound('a', 'audioRemoved');

    expect(queueStore.entries.map(e => e.narrationId)).toEqual(['b', 'c']);
    expect(queueStore.currentId).toBe('b');
    expect(audio.startNarration).toHaveBeenLastCalledWith(
      expect.objectContaining({ narrationId: 'b' }),
      { autoplay: true, fromQueue: true },
    );
  });

  it('is dropped from the queue and the next one starts, with one message', async () => {
    setup(['a', 'b', 'c']);
    await playQueueFrom('a');

    // The background refresh of "a" answered 404.
    audio.notFound('a');

    expect(queueStore.entries.map(e => e.narrationId)).toEqual(['b', 'c']);
    expect(queueStore.currentId).toBe('b');
    expect(audio.startNarration).toHaveBeenLastCalledWith(
      expect.objectContaining({ narrationId: 'b' }),
      { autoplay: true, fromQueue: true },
    );
    expect(mockShowInfo).toHaveBeenCalledTimes(1);
    expect(mockShowInfo).toHaveBeenCalledWith(i18n.t('player:queue.skippedMissing'));
    expect(i18n.t('player:queue.skippedMissing')).not.toBe('queue.skippedMissing');
  });

  it('the last entry missing ends the queue without starting anything', async () => {
    setup(['a', 'b']);
    await playQueueFrom('b');
    audio.startNarration.mockClear();

    audio.notFound('b');

    expect(queueStore.entries.map(e => e.narrationId)).toEqual(['a']);
    expect(queueStore.currentId).toBeNull();
    expect(audio.startNarration).not.toHaveBeenCalled();
    expect(mockShowInfo).toHaveBeenCalledTimes(1);
  });

  it('a story outside the queue that is gone leaves the queue alone', async () => {
    setup(['a', 'b']);
    await audio.startNarration({ narrationId: 'other' }, { autoplay: true });
    audio.startNarration.mockClear();

    audio.notFound('other');

    expect(queueStore.entries.map(e => e.narrationId)).toEqual(['a', 'b']);
    expect(audio.startNarration).not.toHaveBeenCalled();
    expect(mockShowInfo).not.toHaveBeenCalled();
  });

  it('a queued start that fails before it takes the player is skipped, not the loaded story', async () => {
    setup(['a', 'b', 'c']);
    await playQueueFrom('a');
    await flush();
    // "b" starts; its stream never reaches the player ("a" stays loaded).
    audio.holdStart = new Promise(() => undefined);
    void playNext();
    await flush();
    expect(audio.audioId).toBe('a');
    expect(queueStore.currentId).toBe('b');

    audio.holdStart = null;
    audio.notFound('b');
    await flush();

    expect(queueStore.entries.map(e => e.narrationId)).toEqual(['a', 'c']);
    expect(queueStore.currentId).toBe('c');
    expect(audio.startNarration).toHaveBeenLastCalledWith(
      expect.objectContaining({ narrationId: 'c' }),
      { autoplay: true, fromQueue: true },
    );
    expect(mockShowInfo).toHaveBeenCalledTimes(1);
  });

  it('a 404 for another narration while a queued story is loaded leaves the queue alone', async () => {
    setup(['a', 'b']);
    await playQueueFrom('a');
    audio.startNarration.mockClear();

    // A push tap for a deleted narration failed; "a" is still loaded and current.
    audio.notFound('gone');

    expect(queueStore.entries.map(e => e.narrationId)).toEqual(['a', 'b']);
    expect(queueStore.currentId).toBe('a');
    expect(audio.startNarration).not.toHaveBeenCalled();
    expect(mockShowInfo).not.toHaveBeenCalled();
  });

  it('another load error is not a missing narration', async () => {
    setup(['a', 'b']);
    await playQueueFrom('a');

    runInAction(() => {
      audio.loadError = 'streamFailed';
      audio.loadErrorNarrationId = 'a';
    });

    expect(queueStore.entries.map(e => e.narrationId)).toEqual(['a', 'b']);
    expect(queueStore.currentId).toBe('a');
  });
});

describe('controls', () => {
  it('playQueueFrom without an id starts the first entry; an empty queue starts nothing', async () => {
    expect(await playQueueFrom()).toBe(false);
    expect(audio.startNarration).not.toHaveBeenCalled();

    setup(['a', 'b']);
    expect(await playQueueFrom()).toBe(true);
    expect(audio.starts[0]).toMatchObject({ id: 'a', options: { autoplay: true, fromQueue: true } });
    expect(queueStore.currentId).toBe('a');
  });

  it('playQueueFrom of a narration that is not queued starts nothing', async () => {
    setup(['a']);

    expect(await playQueueFrom('zzz')).toBe(false);
    expect(audio.startNarration).not.toHaveBeenCalled();
    expect(queueStore.currentId).toBeNull();
  });

  it('playNext moves on and returns false at the end', async () => {
    setup(['a', 'b']);
    await playQueueFrom('a');

    expect(await playNext()).toBe(true);
    expect(queueStore.currentId).toBe('b');
    expect(await playNext()).toBe(false);
    expect(audio.starts.map(s => s.id)).toEqual(['a', 'b']);
  });

  it('playPrevious restarts the story after 5 s and goes back before', async () => {
    setup(['a', 'b']);
    await playQueueFrom('b');
    await flush();

    runInAction(() => {
      audio.currentPositionMs = PREVIOUS_RESTART_MS + 1000;
    });
    expect(await playPrevious()).toBe(false);
    expect(audio.seek).toHaveBeenCalledWith(0);
    expect(queueStore.currentId).toBe('b');
    expect(audio.startNarration).toHaveBeenCalledTimes(1);

    runInAction(() => {
      audio.currentPositionMs = 3000;
    });
    expect(await playPrevious()).toBe(true);
    expect(queueStore.currentId).toBe('a');
    expect(audio.startNarration).toHaveBeenLastCalledWith(
      expect.objectContaining({ narrationId: 'a' }),
      { autoplay: true, fromQueue: true },
    );
  });

  it('playPrevious while the next story is still starting goes back, whatever the outgoing position', async () => {
    setup(['a', 'b', 'c']);
    await playQueueFrom('a');
    await flush();
    // Deep into "a", then "Sonraki": "b" is pending, the store still reads a's position.
    runInAction(() => {
      audio.currentPositionMs = PREVIOUS_RESTART_MS * 10;
    });
    audio.holdStart = new Promise(() => undefined);
    void playNext();
    await flush();
    expect(audio.pendingNarrationId).toBe('b');
    expect(audio.currentPositionMs).toBe(PREVIOUS_RESTART_MS * 10);

    audio.holdStart = null;
    await playPrevious();

    expect(audio.seek).not.toHaveBeenCalled();
    expect(queueStore.currentId).toBe('a');
    expect(audio.startNarration).toHaveBeenLastCalledWith(
      expect.objectContaining({ narrationId: 'a' }),
      { autoplay: true, fromQueue: true },
    );
  });

  it('playPrevious on the first entry while it is still starting seeks nothing', async () => {
    setup(['a', 'b']);
    await playQueueFrom('b');
    await flush();
    runInAction(() => {
      audio.currentPositionMs = PREVIOUS_RESTART_MS * 10;
    });
    // "a" is started from the queue sheet and is still loading.
    queueStore.startAt('a');
    audio.holdStart = new Promise(() => undefined);
    void audio.startNarration({ narrationId: 'a', meta: meta('a') }, { autoplay: true, fromQueue: true });
    await flush();
    audio.startNarration.mockClear();

    // No previous entry before "a": nothing to go back to, and the outgoing "b" is not moved.
    expect(await playPrevious()).toBe(false);
    expect(audio.seek).not.toHaveBeenCalled();
    expect(audio.startNarration).not.toHaveBeenCalled();
  });

  it('playPrevious on the first entry starts the story over', async () => {
    setup(['a', 'b']);
    await playQueueFrom('a');
    await flush();
    audio.seek.mockClear();

    expect(await playPrevious()).toBe(false);
    expect(audio.seek).toHaveBeenCalledWith(0);
    expect(audio.startNarration).toHaveBeenCalledTimes(1);
  });
});
