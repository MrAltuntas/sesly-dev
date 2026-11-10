/**
 * Queue entry points with feedback (src/stores/queueActions.ts).
 *
 * The queue (in memory, no signed-in user) and the queue sheet controller
 * are real; the snackbar API and the story store are mocked.
 */

const mockToast = {
  success: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  warning: jest.fn(),
};
jest.mock('../utils/toast', () => ({
  get showToast() {
    return mockToast;
  },
}));
let mockStoryNarrations: Record<string, unknown[]> | null = null;
let mockPeekStories: Record<string, unknown> = {};
jest.mock('../hooks/useStory', () => ({
  getStoryStore: () =>
    mockStoryNarrations
      ? {
          getNarrationsForStory: (storyId: string) => mockStoryNarrations?.[storyId] ?? [],
          peekStory: (storyId: string) => mockPeekStories[storyId] ?? null,
        }
      : null,
}));

import i18n from '../i18n';
import {
  addToQueueWithFeedback,
  isQueued,
  newestReadyNarration,
  removeFromQueueWithFeedback,
} from './queueActions';
import { QUEUE_MAX, queueStore } from './QueueStore';
import { queueSheet } from './queueSheet';
import {
  rememberNarrationMeta,
  resetNarrationMetaForTests,
  type NarrationMeta,
} from './narrationMeta';
import { parseStoryNarrationFromJSON, type StoryNarration } from '../models/Narration';
import { mockNarrationJSON, mockStoryJSON } from '../test-utils/mock-data';

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

function narration(
  id: string,
  status: string,
  completedAt: string,
  storyId = 'story-7',
): StoryNarration {
  return parseStoryNarrationFromJSON({
    ...mockNarrationJSON,
    id,
    storyId,
    status,
    createdAt: completedAt,
    completedAt: status === 'READY' ? completedAt : null,
    story: { ...mockStoryJSON, id: storyId, title: 'Kırmızı Başlıklı Kız' },
  });
}

const actionOf = (mock: jest.Mock, call = 0) =>
  mock.mock.calls[call][2] as { label: string; onPress: () => void } | undefined;

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  queueStore.reset();
  queueSheet.close();
  Object.values(mockToast).forEach(fn => fn.mockReset());
  mockStoryNarrations = null;
  mockPeekStories = {};
  resetNarrationMetaForTests();
});

describe('addToQueueWithFeedback', () => {
  it('added: a success snackbar whose "Sırayı aç" opens the queue sheet from the toast', () => {
    expect(addToQueueWithFeedback(meta('a'))).toBe('added');

    expect(queueStore.has('a')).toBe(true);
    expect(mockToast.success).toHaveBeenCalledTimes(1);
    expect(mockToast.success.mock.calls[0][0]).toBe(i18n.t('player:queue.added'));
    const action = actionOf(mockToast.success);
    expect(action?.label).toBe(i18n.t('player:queue.open'));

    expect(queueSheet.visible).toBe(false);
    action?.onPress();
    expect(queueSheet.visible).toBe(true);
    expect(queueSheet.origin).toBe('toast');
  });

  it('exists: an info snackbar with the same action, the queue unchanged', () => {
    addToQueueWithFeedback(meta('a'));
    mockToast.success.mockReset();

    expect(addToQueueWithFeedback(meta('a'))).toBe('exists');

    expect(queueStore.entries).toHaveLength(1);
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.info).toHaveBeenCalledTimes(1);
    expect(mockToast.info.mock.calls[0][0]).toBe(i18n.t('player:queue.exists'));
    const action = actionOf(mockToast.info);
    expect(action?.label).toBe(i18n.t('player:queue.open'));
    action?.onPress();
    expect(queueSheet.origin).toBe('toast');
    expect(queueSheet.visible).toBe(true);
  });

  it('full: an error snackbar naming the limit, nothing added', () => {
    for (let i = 0; i < QUEUE_MAX; i++) queueStore.add(meta(`n${i}`));

    expect(addToQueueWithFeedback(meta('late'))).toBe('full');

    expect(queueStore.has('late')).toBe(false);
    expect(mockToast.error).toHaveBeenCalledWith(i18n.t('player:queue.full', { max: 50 }));
    expect(mockToast.error.mock.calls[0][0]).toContain('50');
  });

  it('never starts playback and never opens the sheet by itself', () => {
    addToQueueWithFeedback(meta('a'));

    expect(queueStore.currentId).toBeNull();
    expect(queueSheet.visible).toBe(false);
  });

  it("a narration of a story page (no story) gets the story store's title and cover", () => {
    mockStoryNarrations = {};
    mockPeekStories = {
      'story-a': { ...mockStoryJSON, id: 'story-a', title: 'Pamuk Prenses', coverImageUrl: 'https://c/p.png' },
    };
    const bare = { ...meta('a'), story: { ...meta('a').story, title: '' } };

    addToQueueWithFeedback(bare);

    expect(queueStore.entries[0].story).toMatchObject({
      id: 'story-a',
      title: 'Pamuk Prenses',
      coverImageUrl: 'https://c/p.png',
    });
  });

  it('a remembered meta of that narration wins over an empty story', () => {
    rememberNarrationMeta(meta('a'));
    const bare = { ...meta('a'), storyId: '', story: { ...meta('a').story, id: '', title: '' } };

    addToQueueWithFeedback(bare);

    expect(queueStore.entries[0]).toMatchObject({ storyId: 'story-a', story: { title: 'Masal a' } });
  });
});

describe('queueSheet', () => {
  it('opens with its origin and keeps the origin after close', () => {
    queueSheet.open('library');
    expect(queueSheet.visible).toBe(true);
    expect(queueSheet.origin).toBe('library');

    queueSheet.close();
    expect(queueSheet.visible).toBe(false);
    expect(queueSheet.origin).toBe('library');

    queueSheet.open('player');
    expect(queueSheet.origin).toBe('player');
  });
});

describe('removeFromQueueWithFeedback', () => {
  it('removes with "Geri al", which puts it back at the same index', () => {
    ['a', 'b', 'c'].forEach(id => queueStore.add(meta(id)));

    expect(removeFromQueueWithFeedback('b')).toBe(true);

    expect(queueStore.entries.map(e => e.narrationId)).toEqual(['a', 'c']);
    expect(mockToast.info.mock.calls[0][0]).toBe(i18n.t('player:queue.removed'));
    const action = actionOf(mockToast.info);
    expect(action?.label).toBe(i18n.t('common:undo'));

    action?.onPress();
    expect(queueStore.entries.map(e => e.narrationId)).toEqual(['a', 'b', 'c']);
  });

  it('an entry that is not queued: nothing happens, no snackbar', () => {
    expect(removeFromQueueWithFeedback('zzz')).toBe(false);
    expect(mockToast.info).not.toHaveBeenCalled();
  });

  it('isQueued follows the queue', () => {
    expect(isQueued('a')).toBe(false);
    queueStore.add(meta('a'));
    expect(isQueued('a')).toBe(true);
    removeFromQueueWithFeedback('a');
    expect(isQueued('a')).toBe(false);
  });
});

describe('newestReadyNarration', () => {
  it('takes the newest READY one and skips the others', () => {
    const list = [
      narration('old', 'READY', '2026-10-01T10:00:00.000Z'),
      narration('gen', 'GENERATING', '2026-10-18T10:00:00.000Z'),
      narration('new', 'READY', '2026-10-12T10:00:00.000Z'),
      narration('fail', 'FAILED', '2026-10-17T10:00:00.000Z'),
    ];

    expect(newestReadyNarration(list)?.id).toBe('new');
    expect(newestReadyNarration(list.filter(n => n.status !== 'READY'))).toBeNull();
    expect(newestReadyNarration([])).toBeNull();
  });
});
