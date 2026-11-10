/**
 * narrationMeta: what a narration start needs without a network round trip,
 * the memory cache (newest 300) and the stored shape.
 */

import { autorun } from 'mobx';
import { parseStoryNarrationFromJSON } from '../models/Narration';
import { parseStoryFromJSON } from '../models/Story';
import { narrationDurationMs } from '../components/library/narrationProgress';
import { mockNarrationJSON, mockStoryJSON } from '../test-utils/mock-data';
import {
  NARRATION_META_LIMIT,
  getNarrationMeta,
  metaFromNarration,
  narrationEstimateMs,
  onNarrationMetaRemembered,
  parseNarrationMeta,
  playerStoryOf,
  rememberNarrationMeta,
  resetNarrationMetaForTests,
  storableMeta,
  type NarrationMeta,
} from './narrationMeta';

const narration = parseStoryNarrationFromJSON({
  ...mockNarrationJSON,
  id: 'narr-1',
  totalDuration: 300,
});

const metaOf = (id: string, patch: Partial<NarrationMeta> = {}): NarrationMeta => ({
  narrationId: id,
  storyId: `story-${id}`,
  voiceProfileId: null,
  story: playerStoryOf({ id: `story-${id}`, title: `Masal ${id}` }),
  voiceProfile: null,
  narratorName: null,
  ownVoice: false,
  estimateMs: 0,
  ...patch,
});

beforeEach(() => {
  resetNarrationMetaForTests();
});

describe('metaFromNarration', () => {
  it('takes the five story fields, the narrator, the own-voice flag and the estimate in ms', () => {
    const meta = metaFromNarration(narration);

    expect(meta).toEqual({
      narrationId: 'narr-1',
      storyId: 'story-123',
      voiceProfileId: 'voice-123',
      story: {
        id: 'story-123',
        title: mockStoryJSON.title,
        coverImageUrl: mockStoryJSON.coverImageUrl,
        translationGroupId: null,
        category: 'BEDTIME',
      },
      voiceProfile: narration.voiceProfile,
      narratorName: 'Babamın Sesi',
      // The mock voice is a Cartesia clone: the parent's own voice.
      ownVoice: true,
      estimateMs: 300000,
    });
  });

  it('a ready-made narrator is named by its bare voice name and is not the own voice', () => {
    const preset = parseStoryNarrationFromJSON({
      ...mockNarrationJSON,
      id: 'narr-2',
      voiceProfile: {
        ...mockNarrationJSON.voiceProfile,
        id: 'voice-9',
        name: 'Chirp3 Achernar (HD)',
        provider: 'GOOGLE',
        kind: 'PRESET',
        voiceId: 'tr-TR-Chirp3-HD-Achernar',
      },
    });

    const meta = metaFromNarration(preset);

    expect(meta.narratorName).toBe('Achernar');
    expect(meta.ownVoice).toBe(false);
  });

  it("the estimate is the story's minutes, the length the Library row shows, not the backend's (NL-04)", () => {
    // "Ninni": the card and the Library row read 4 dk, the backend stored 13.
    const ninni = parseStoryNarrationFromJSON({
      ...mockNarrationJSON,
      id: 'narr-ninni',
      totalDuration: 13 * 60,
      story: { ...mockStoryJSON, estimatedDuration: 4 },
    });

    const meta = metaFromNarration(ninni);

    expect(meta.estimateMs).toBe(4 * 60000);
    expect(meta.estimateMs).toBe(narrationDurationMs(ninni));
  });

  it('narrationEstimateMs follows the Library rule in every case', () => {
    const cases = [
      { totalDuration: 780, story: { estimatedDuration: 4 } },
      { totalDuration: 780, story: { estimatedDuration: 0 } },
      { totalDuration: 0, story: { estimatedDuration: 5 } },
      { totalDuration: 312, story: null },
      { totalDuration: 0, story: null },
    ];
    for (const { totalDuration, story } of cases) {
      const input = {
        totalDuration,
        story: story ? parseStoryFromJSON({ ...mockStoryJSON, ...story }) : null,
      };
      expect(narrationEstimateMs(input)).toBe(narrationDurationMs(input));
    }
  });

  it("a narration without its story keeps a remembered copy's estimate, else uses the backend's", () => {
    const pageNarration = { ...narration, id: 'narr-page', story: null, totalDuration: 12 * 60 };

    // Nothing better known: the stored length, as the Library row would.
    expect(metaFromNarration(pageNarration).estimateMs).toBe(12 * 60000);

    // A Library page remembered the story's 4 minutes for it.
    rememberNarrationMeta(metaOf('narr-page', { estimateMs: 4 * 60000 }));
    expect(metaFromNarration(pageNarration).estimateMs).toBe(4 * 60000);

    // A narration that carries its story decides from it.
    const withStory = parseStoryNarrationFromJSON({
      ...mockNarrationJSON,
      id: 'narr-page',
      story: { ...mockStoryJSON, estimatedDuration: 6 },
    });
    expect(metaFromNarration(withStory).estimateMs).toBe(6 * 60000);
  });

  it('a narration without story, voice or length still gives a usable meta', () => {
    const bare = { ...narration, story: null, voiceProfile: null, totalDuration: 0 };

    const meta = metaFromNarration(bare);

    expect(meta.story).toEqual({
      id: 'story-123',
      title: '',
      coverImageUrl: null,
      translationGroupId: null,
      category: null,
    });
    expect(meta.voiceProfile).toBeNull();
    expect(meta.narratorName).toBeNull();
    expect(meta.ownVoice).toBe(false);
    expect(meta.estimateMs).toBe(0);
    // The id the narration names is kept even without the voice model.
    expect(meta.voiceProfileId).toBe('voice-123');
  });
});

describe('the memory cache', () => {
  it('returns what was remembered and null for anything else', () => {
    const meta = metaFromNarration(narration);
    expect(getNarrationMeta('narr-1')).toBeNull();

    rememberNarrationMeta(meta);

    expect(getNarrationMeta('narr-1')).toBe(meta);
    expect(getNarrationMeta('narr-x')).toBeNull();
    expect(getNarrationMeta(null)).toBeNull();
    expect(getNarrationMeta('')).toBeNull();
  });

  it('keeps the newest 300 entries; a remembered entry counts as new again', () => {
    for (let i = 0; i < NARRATION_META_LIMIT; i++) rememberNarrationMeta(metaOf(`n-${i}`));
    // Touch the oldest one: it becomes the newest.
    rememberNarrationMeta(metaOf('n-0'));

    rememberNarrationMeta(metaOf('n-new'));

    expect(NARRATION_META_LIMIT).toBe(300);
    expect(getNarrationMeta('n-new')).not.toBeNull();
    expect(getNarrationMeta('n-0')).not.toBeNull();
    // The oldest untouched one was dropped.
    expect(getNarrationMeta('n-1')).toBeNull();
    expect(getNarrationMeta('n-2')).not.toBeNull();
  });

  it('a newer meta replaces the older one and observers see it', () => {
    const titles: Array<string | null> = [];
    const dispose = autorun(() => titles.push(getNarrationMeta('n-1')?.story.title ?? null));

    rememberNarrationMeta(metaOf('n-1'));
    rememberNarrationMeta(metaOf('n-1', { story: playerStoryOf({ id: 's', title: 'Yeni ad' }) }));
    dispose();

    expect(titles).toEqual([null, 'Masal n-1', 'Yeni ad']);
  });

  it('tells its listeners about every remembered meta until they unsubscribe', () => {
    const heard: string[] = [];
    const failing = jest.fn(() => {
      throw new Error('listener bug');
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    onNarrationMetaRemembered(failing);
    const unsubscribe = onNarrationMetaRemembered(meta => heard.push(meta.narrationId));

    rememberNarrationMeta(metaOf('a'));
    rememberNarrationMeta(metaOf('b'));
    unsubscribe();
    rememberNarrationMeta(metaOf('c'));

    // A throwing listener does not stop the others.
    expect(heard).toEqual(['a', 'b']);
    expect(failing).toHaveBeenCalledTimes(3);
  });

  it('ignores a meta without a narration id', () => {
    rememberNarrationMeta(metaOf(''));
    expect(getNarrationMeta('')).toBeNull();
  });
});

describe('the stored shape', () => {
  it('drops the voice model and reads back with voiceProfile null', () => {
    const meta = metaFromNarration(narration);

    const stored = JSON.parse(JSON.stringify(storableMeta(meta)));
    const back = parseNarrationMeta(stored);

    expect(stored.voiceProfile).toBeNull();
    expect(back).toEqual({ ...meta, voiceProfile: null });
    // Without a voice model nothing needs dropping.
    const plain = metaOf('n');
    expect(storableMeta(plain)).toBe(plain);
  });

  it('treats a stored meta without narration id or story as absent and defaults the rest', () => {
    expect(parseNarrationMeta(null)).toBeNull();
    expect(parseNarrationMeta('n-1')).toBeNull();
    expect(parseNarrationMeta({ storyId: 's' })).toBeNull();
    expect(parseNarrationMeta({ narrationId: 'n' })).toBeNull();

    expect(
      parseNarrationMeta({
        narrationId: 'n',
        story: { id: 's', title: 'T', category: 7 },
        ownVoice: 'yes',
        estimateMs: -5,
      }),
    ).toEqual({
      narrationId: 'n',
      storyId: 's',
      voiceProfileId: null,
      story: { id: 's', title: 'T', coverImageUrl: null, translationGroupId: null, category: null },
      voiceProfile: null,
      narratorName: null,
      ownVoice: false,
      estimateMs: 0,
    });
  });
});
