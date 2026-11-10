import {
  FALLBACK_SEGMENT_TARGET_CHARS,
  SEGMENTS_MAX_COUNT,
  SEGMENT_MAX_CHARS,
  compareSegmentsWithContent,
  joinSegmentTexts,
  normalizeStoredSegments,
  segmentProblems,
  segmentVocabulary,
  splitSentences,
  splitStoryForTts,
  toStoredSegments,
  utf8Bytes,
} from './story-segments';

describe('story segments', () => {
  describe('normalizeStoredSegments', () => {
    it('keeps usable entries and their valid tags, drops everything else', () => {
      expect(
        normalizeStoredSegments([
          { text: 'Bir.', emotion: 'calm', speed: 0.8, volume: 1.1, pauseAfterMs: 400.4 },
          { text: '  ' },
          null,
          'garbage',
          { text: 5 },
          { text: 'Iki.', emotion: '', speed: Number.NaN, volume: 'x', pauseAfterMs: 0 },
        ]),
      ).toEqual([
        { text: 'Bir.', emotion: 'calm', speed: 0.8, volume: 1.1, pauseAfterMs: 400 },
        { text: 'Iki.' },
      ]);
    });

    it('anything but an array is no segments', () => {
      expect(normalizeStoredSegments(null)).toEqual([]);
      expect(normalizeStoredSegments({ text: 'a' })).toEqual([]);
    });
  });

  it('toStoredSegments writes only the fields that are set', () => {
    expect(
      toStoredSegments([
        { text: 'a', emotion: 'calm', speed: 0, volume: 1, pauseAfterMs: 250.6 },
        { text: 'b', emotion: '', speed: undefined, pauseAfterMs: 0 } as any,
      ]),
    ).toEqual([{ text: 'a', emotion: 'calm', speed: 0, volume: 1, pauseAfterMs: 251 }, { text: 'b' }]);
  });

  describe('segmentProblems', () => {
    it('an empty list is a problem', () => {
      expect(segmentProblems([])).toEqual(['En az bir segment gerekir.']);
      expect(segmentProblems(undefined as any)).toEqual(['En az bir segment gerekir.']);
    });

    it('a valid list has none', () => {
      expect(
        segmentProblems([{ text: 'Bir.', emotion: 'peaceful', speed: 0.8, volume: 1, pauseAfterMs: 500 }]),
      ).toEqual([]);
    });

    it('names every problem in Turkish with its segment number', () => {
      const problems = segmentProblems([
        { text: ' ' },
        { text: 'x'.repeat(SEGMENT_MAX_CHARS + 1) },
        { text: 'a', emotion: 'joyful' },
        { text: 'a', speed: 2 },
        { text: 'a', volume: 0.1 },
        { text: 'a', pauseAfterMs: 5000 },
        { text: 'a', speed: 'fast' as any },
      ]);
      expect(problems).toEqual([
        'Segment 1: metin boş olamaz.',
        `Segment 2: en fazla ${SEGMENT_MAX_CHARS} karakter olabilir, bölün.`,
        'Segment 3: "joyful" desteklenen bir duygu değil.',
        'Segment 4: hız 0.6 ile 1.5 arasında olmalı.',
        'Segment 5: ses düzeyi 0.5 ile 2 arasında olmalı.',
        'Segment 6: ara 0 ile 3000 ms arasında olmalı.',
        'Segment 7: hız 0.6 ile 1.5 arasında olmalı.',
      ]);
    });

    it('a multi-byte text over the byte limit is too long even under the character limit', () => {
      expect(segmentProblems([{ text: 'ş'.repeat(1400) }])).toHaveLength(0);
      expect(utf8Bytes('ş'.repeat(1400))).toBe(2800);
      expect(segmentProblems([{ text: '\u{1F600}'.repeat(1200) }])[0]).toContain('karakter');
    });

    it('too many segments', () => {
      const many = Array.from({ length: SEGMENTS_MAX_COUNT + 1 }, () => ({ text: 'a' }));
      expect(segmentProblems(many)[0]).toContain(`En fazla ${SEGMENTS_MAX_COUNT} segment`);
    });
  });

  describe('compareSegmentsWithContent', () => {
    it('ignores whitespace', () => {
      expect(compareSegmentsWithContent([{ text: 'Bir varmış ' }, { text: '\nbir yokmuş.' }], 'Bir varmış bir yokmuş.')).toEqual({
        matches: true,
      });
    });

    it('shows the first difference', () => {
      const result = compareSegmentsWithContent([{ text: 'Bir varmış.' }], 'Bir yokmuş.');
      expect(result.matches).toBe(false);
      expect(result.diff).toContain('segmentler: "Birvarmış."');
      expect(result.diff).toContain('metin: "Biryokmuş."');
    });
  });

  it('joinSegmentTexts adds a space only where neither side has whitespace', () => {
    expect(joinSegmentTexts(['Bir.', 'Iki.', ' Uc.', 'Dort.\n\n', 'Bes.'])).toBe('Bir. Iki. Uc. Dort.\n\nBes.');
    expect(joinSegmentTexts([])).toBe('');
  });

  describe('splitSentences (Turkish-aware)', () => {
    it('splits at . ! ? and the ellipsis, keeping closing quotes with the sentence', () => {
      expect(splitSentences('Gel buraya! "Neden?" Bilmiyorum... Sonra gitti.')).toEqual([
        'Gel buraya! ',
        '"Neden?" ',
        'Bilmiyorum... ',
        'Sonra gitti.',
      ]);
    });

    it('a lower-case word after the terminator continues the sentence (dialogue tags)', () => {
      expect(splitSentences('"Nereye gidiyorsun?" diye sordu ılgın. Kız sustu.')).toEqual([
        '"Nereye gidiyorsun?" diye sordu ılgın. ',
        'Kız sustu.',
      ]);
    });

    it('abbreviations and initials do not end a sentence', () => {
      expect(splitSentences('Dr. Ali geldi. J. R. Tolkien de geldi. Mr. Fox gitti.')).toEqual([
        'Dr. Ali geldi. ',
        'J. R. Tolkien de geldi. ',
        'Mr. Fox gitti.',
      ]);
    });

    it('keeps every character', () => {
      const text = 'Bir. İki! Üç? Dört\u2026 Beş';
      expect(splitSentences(text).join('')).toBe(text);
    });
  });

  describe('splitStoryForTts', () => {
    it('empty text: no segments', () => {
      expect(splitStoryForTts('')).toEqual([]);
      expect(splitStoryForTts(null as any)).toEqual([]);
    });

    it('packs short paragraphs together and keeps the paragraph break', () => {
      expect(splitStoryForTts('Bir.\r\n\r\n\r\nIki.')).toEqual([{ text: 'Bir.\n\nIki.' }]);
    });

    it('cuts long paragraphs at sentence ends near the target, never inside a sentence', () => {
      const sentence = 'Küçük tavşan ormanda yıldızları saydı ve uyudu. ';
      const text = sentence.repeat(40).trim();
      const segments = splitStoryForTts(text);
      expect(segments.length).toBeGreaterThan(3);
      for (const s of segments) {
        expect(s.text.length).toBeLessThanOrEqual(FALLBACK_SEGMENT_TARGET_CHARS);
        expect(s.text.endsWith('uyudu.')).toBe(true);
      }
      expect(compareSegmentsWithContent(segments, text).matches).toBe(true);
    });

    it('a sentence longer than the hard limit is cut at a line break, a clause mark, then a space', () => {
      const clause = 've sonra yürüdü, ';
      const text = clause.repeat(200);
      const segments = splitStoryForTts(text);
      for (const s of segments) expect(s.text.length).toBeLessThanOrEqual(SEGMENT_MAX_CHARS);
      expect(compareSegmentsWithContent(segments, text).matches).toBe(true);

      const poem = Array.from({ length: 200 }, (_, i) => `satır ${i} burada`).join('\n');
      const poemSegments = splitStoryForTts(poem);
      for (const s of poemSegments) expect(s.text.length).toBeLessThanOrEqual(SEGMENT_MAX_CHARS);
      expect(compareSegmentsWithContent(poemSegments, poem).matches).toBe(true);

      const solid = 'z'.repeat(4000);
      const solidSegments = splitStoryForTts(solid);
      expect(solidSegments.map((s) => s.text.length)).toEqual([1500, 1500, 1000]);
    });

    it('respects the byte limit for multi-byte text', () => {
      const text = 'ğ'.repeat(3000);
      for (const s of splitStoryForTts(text)) expect(utf8Bytes(s.text)).toBeLessThanOrEqual(4500);
    });
  });

  it('segmentVocabulary lists every emotion with a Turkish label and marks the bedtime ones', () => {
    const v = segmentVocabulary();
    expect(v.emotions.find((e) => e.value === 'peaceful')).toEqual({ value: 'peaceful', label: 'Huzurlu', recommended: true });
    expect(v.emotions.find((e) => e.value === 'angry')).toMatchObject({ recommended: false });
    expect(v.speed).toEqual({ min: 0.6, max: 1.5, recommendedMin: 0.65, recommendedMax: 1.05 });
    expect(v.pauseAfterMs).toEqual({ min: 0, max: 3000 });
  });
});
