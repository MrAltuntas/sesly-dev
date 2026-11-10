import { isNarrationAccented, parseStoryNarrationFromJSON } from './Narration';

describe('parseStoryNarrationFromJSON', () => {
  const base = {
    id: 'n-1',
    userId: 'u-1',
    storyId: 's-1',
    voiceProfileId: 'v-1',
    status: 'READY',
    createdAt: '2026-09-01T10:00:00.000Z',
  };

  it('reads totalDuration', () => {
    const n = parseStoryNarrationFromJSON({ ...base, totalDuration: 312.5 });
    expect(n.totalDuration).toBe(312.5);
  });

  it('falls back to duration when totalDuration is missing', () => {
    const n = parseStoryNarrationFromJSON({ ...base, duration: 240 });
    expect(n.totalDuration).toBe(240);
  });

  it('falls back to duration when totalDuration is 0 or null', () => {
    expect(
      parseStoryNarrationFromJSON({ ...base, totalDuration: 0, duration: 90 })
        .totalDuration,
    ).toBe(90);
    expect(
      parseStoryNarrationFromJSON({ ...base, totalDuration: null, duration: 90 })
        .totalDuration,
    ).toBe(90);
  });

  it('uses 0 when no duration is known', () => {
    expect(parseStoryNarrationFromJSON(base).totalDuration).toBe(0);
  });

  it('parses updatedAt when present', () => {
    const n = parseStoryNarrationFromJSON({
      ...base,
      updatedAt: '2026-09-20T08:30:00.000Z',
    });
    expect(n.updatedAt.toISOString()).toBe('2026-09-20T08:30:00.000Z');
  });

  it('falls back to createdAt (not parse time) when updatedAt is missing', () => {
    const n = parseStoryNarrationFromJSON(base);
    expect(n.updatedAt.toISOString()).toBe('2026-09-01T10:00:00.000Z');
    expect(n.updatedAt.getTime()).toBe(n.createdAt.getTime());
  });

  it('falls back to createdAt when updatedAt is invalid', () => {
    const n = parseStoryNarrationFromJSON({ ...base, updatedAt: 'not-a-date' });
    expect(n.updatedAt.getTime()).toBe(n.createdAt.getTime());
  });
});

describe('narration language fields', () => {
  const base = {
    id: 'n-1',
    userId: 'u-1',
    storyId: 's-1',
    voiceProfileId: 'v-1',
    status: 'READY',
    createdAt: '2026-09-01T10:00:00.000Z',
  };

  it('reads voiceLanguage, storyLanguage, languageMismatch and nativeVoiceUsed', () => {
    const n = parseStoryNarrationFromJSON({
      ...base,
      voiceLanguage: 'TR',
      storyLanguage: 'en',
      languageMismatch: true,
      nativeVoiceUsed: false,
    });
    expect(n.voiceLanguage).toBe('tr');
    expect(n.storyLanguage).toBe('en');
    expect(n.languageMismatch).toBe(true);
    expect(n.nativeVoiceUsed).toBe(false);
    expect(isNarrationAccented(n)).toBe(true);
  });

  it('is not accented when a native voice stood in for the narrator', () => {
    const n = parseStoryNarrationFromJSON({
      ...base,
      voiceLanguage: 'tr',
      storyLanguage: 'en',
      languageMismatch: true,
      nativeVoiceUsed: true,
    });
    expect(isNarrationAccented(n)).toBe(false);
  });

  it('never fails on an older response without the fields', () => {
    const n = parseStoryNarrationFromJSON(base);
    expect(n.voiceLanguage).toBeNull();
    expect(n.storyLanguage).toBeNull();
    expect(n.languageMismatch).toBe(false);
    expect(n.nativeVoiceUsed).toBe(false);
    expect(isNarrationAccented(n)).toBe(false);
    // Anything that is not the boolean true is "no".
    const odd = parseStoryNarrationFromJSON({ ...base, languageMismatch: 'true', voiceLanguage: 7 });
    expect(odd.languageMismatch).toBe(false);
    expect(odd.voiceLanguage).toBeNull();
    expect(isNarrationAccented(null)).toBe(false);
  });
});
