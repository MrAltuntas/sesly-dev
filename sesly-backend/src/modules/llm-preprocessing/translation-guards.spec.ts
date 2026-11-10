import {
  LlmOutputRejectedError,
  TRANSLATION_RATIO_MAX,
  TRANSLATION_RATIO_MIN,
  allowedParagraphDrift,
  checkTranslation,
  normaliseTypography,
  splitParagraphs,
} from './translation-guards';

const TR = [
  'Bir varmış bir yokmuş, uzak bir köyde Keloğlan adında bir çocuk yaşarmış.',
  'Bir sabah annesi ona ormana gitmesini ve odun toplamasını söylemiş.',
  'Keloğlan yola çıkmış, akşam olmadan eve dönmüş ve mutlu bir şekilde uyumuş.',
];
const EN = [
  'Once upon a time, in a faraway village, there lived a boy called Keloglan.',
  'One morning his mother told him to go to the forest and gather firewood.',
  'Keloglan set off, came home before evening and fell happily asleep.',
];

const rejection = (fn: () => unknown): LlmOutputRejectedError => {
  try {
    fn();
  } catch (e) {
    return e as LlmOutputRejectedError;
  }
  throw new Error('expected a rejection');
};

describe('splitParagraphs', () => {
  it('splits on blank lines when the text has them (CRLF too) and remembers the separator', () => {
    expect(splitParagraphs('Bir.\r\n\r\nİki.\n \n\n  Üç.  \n')).toEqual({
      paragraphs: ['Bir.', 'İki.', 'Üç.'],
      separator: '\n\n',
    });
  });

  it('keeps a single line break inside a paragraph of a blank-line text', () => {
    expect(splitParagraphs('Bir.\nBir devam.\n\nİki.').paragraphs).toEqual(['Bir.\nBir devam.', 'İki.']);
  });

  it('splits on single line breaks when there is no blank line', () => {
    expect(splitParagraphs('Bir.\nİki.\nÜç.')).toEqual({
      paragraphs: ['Bir.', 'İki.', 'Üç.'],
      separator: '\n',
    });
  });

  it('an empty or missing text has no paragraphs', () => {
    expect(splitParagraphs('  \n ').paragraphs).toEqual([]);
    expect(splitParagraphs(undefined as any).paragraphs).toEqual([]);
  });
});

describe('normaliseTypography', () => {
  it('turns a dialogue em dash into a hyphen and an inline one into a spaced hyphen', () => {
    expect(normaliseTypography('— Merhaba, dedi.\n  ―Sen kimsin?')).toBe(
      '- Merhaba, dedi.\n- Sen kimsin?',
    );
    expect(normaliseTypography('The fox—clever as ever — smiled.')).toBe(
      'The fox - clever as ever - smiled.',
    );
  });

  it('replaces the unicode ellipsis with three full stops', () => {
    expect(normaliseTypography('Ve sonra…')).toBe('Ve sonra...');
  });

  it('removes emoji (with skin tone, flags, joiners and keycaps) and tidies the spaces', () => {
    expect(normaliseTypography('Ay \u{1F319} doğdu ✨ ve \u{1F44D}\u{1F3FD} oldu.')).toBe(
      'Ay doğdu ve oldu.',
    );
    expect(
      normaliseTypography('\u{1F1F9}\u{1F1F7} Aile \u{1F468}‍\u{1F469}‍\u{1F467} 1️⃣'),
    ).toBe('Aile 1');
  });

  it('keeps letters of every content language, quotes and line breaks', () => {
    const text = '«Bonjour», „Hallo“, مرحبا, Привет.\n\nÇğıöşü İ.';
    expect(normaliseTypography(text)).toBe(text);
  });

  it('handles CRLF, trailing spaces and a missing value', () => {
    expect(normaliseTypography('a  \r\n  b\t\tc  ')).toBe('a\nb c');
    expect(normaliseTypography(undefined as any)).toBe('');
  });
});

describe('checkTranslation', () => {
  const source = { title: 'Keloğlan', paragraphs: TR };

  it('accepts a faithful translation and reports the shape', () => {
    const check = checkTranslation(source, { title: 'Keloglan', paragraphs: EN });
    expect(check).toEqual({
      sourceParagraphs: 3,
      translatedParagraphs: 3,
      lengthRatio: expect.any(Number),
    });
    expect(check.lengthRatio).toBeGreaterThan(0.7);
    expect(check.lengthRatio).toBeLessThan(1.4);
  });

  it('rejects an empty title', () => {
    const err = rejection(() => checkTranslation(source, { title: '  ', paragraphs: EN }));
    expect(err).toBeInstanceOf(LlmOutputRejectedError);
    expect(err.name).toBe('LlmOutputRejectedError');
    expect(err.reason).toBe('TRANSLATION_GUARD');
    expect(err.message).toBe('Çeviri reddedildi: başlık boş döndü.');
  });

  it('rejects an empty paragraph, naming it', () => {
    const err = rejection(() =>
      checkTranslation(source, { title: 'K', paragraphs: [EN[0], '   ', EN[2]] }),
    );
    expect(err.message).toBe('Çeviri reddedildi: 2. paragraf boş döndü.');
  });

  it('rejects a different number of paragraphs (merged or dropped)', () => {
    const err = rejection(() =>
      checkTranslation(source, { title: 'K', paragraphs: [`${EN[0]} ${EN[1]}`, EN[2]] }),
    );
    expect(err.message).toContain('paragraf sayısı tutmuyor (kaynak 3, çeviri 2)');
  });

  it('tolerates one paragraph of drift per ten source paragraphs, no more', () => {
    expect(allowedParagraphDrift(9)).toBe(0);
    expect(allowedParagraphDrift(10)).toBe(1);
    expect(allowedParagraphDrift(25)).toBe(2);

    const long = { title: 'T', paragraphs: Array.from({ length: 10 }, (_, i) => `${TR[i % 3]} ${i}`) };
    const translated = Array.from({ length: 10 }, (_, i) => `${EN[i % 3]} ${i}`);
    expect(() =>
      checkTranslation(long, { title: 'T', paragraphs: translated.slice(0, 9) }),
    ).not.toThrow();
    expect(() =>
      checkTranslation(long, { title: 'T', paragraphs: translated.slice(0, 8) }),
    ).toThrow(LlmOutputRejectedError);
  });

  it('rejects the source handed back unchanged (case and spacing do not hide it)', () => {
    const err = rejection(() =>
      checkTranslation(source, {
        title: 'K',
        paragraphs: TR.map((p) => `  ${p.replace(/ /g, '   ')}  `.replace('Bir varmış', 'BİR VARMIŞ')),
      }),
    );
    expect(err.message).toBe('Çeviri reddedildi: metin çevrilmeden geri döndü.');
  });

  it('rejects a translation that is far too short or far too long', () => {
    const long = { title: 'K', paragraphs: [...TR, ...TR] };
    const tooShort = rejection(() =>
      checkTranslation(long, { title: 'K', paragraphs: [...EN, 'A boy.', 'He went.', 'He slept.'].map((p) => p.slice(0, 30)) }),
    );
    expect(tooShort.message).toContain('çok kısa');
    expect(tooShort.message).toContain(`en az ${TRANSLATION_RATIO_MIN}`);

    const tooLong = rejection(() =>
      checkTranslation(long, { title: 'K', paragraphs: [...EN, ...EN].map((p) => `${p} ${p} ${p}`) }),
    );
    expect(tooLong.message).toContain('çok uzun');
    expect(tooLong.message).toContain(`en fazla ${TRANSLATION_RATIO_MAX}`);
  });

  it('uses looser length bounds for a very short text', () => {
    const tiny = { title: 'T', paragraphs: ['Tik tak, tik tak.'] };
    // Ratio about 2.9: over the normal maximum, inside the short-text one.
    expect(() =>
      checkTranslation(tiny, { title: 'T', paragraphs: ['Tick tock, tick tock, went the old clock.'] }),
    ).not.toThrow();
    expect(() =>
      checkTranslation(tiny, { title: 'T', paragraphs: ['Tick tock. '.repeat(12)] }),
    ).toThrow(/çok uzun/);
    expect(() => checkTranslation(tiny, { title: 'T', paragraphs: ['Ti.'] })).toThrow(/çok kısa/);
  });

  it('rejects paragraphs left untranslated, but not a single line that is the same in both', () => {
    const err = rejection(() =>
      checkTranslation(source, { title: 'K', paragraphs: [EN[0], TR[1], TR[2]] }),
    );
    expect(err.message).toBe('Çeviri reddedildi: 2 paragraf çevrilmeden bırakılmış.');

    const withName = { title: 'T', paragraphs: [TR[0], 'Keloğlan!', TR[2]] };
    expect(() =>
      checkTranslation(withName, { title: 'T', paragraphs: [EN[0], 'Keloğlan!', EN[2]] }),
    ).not.toThrow();
    // One long paragraph out of three is not enough to call it untranslated.
    expect(() =>
      checkTranslation(source, { title: 'K', paragraphs: [EN[0], TR[1], EN[2]] }),
    ).not.toThrow();
  });

  it.each([
    "Translator's note: Keloglan means bald boy.",
    '(T.N.: a Turkish folk hero)',
    'Note du traducteur : un héros turc.',
    'Anm. d. Übers.: ein türkischer Held.',
    'Nota del traductor: un héroe turco.',
    'Примечание переводчика: герой.',
  ])('rejects an added translator note: %s', (note) => {
    const err = rejection(() =>
      checkTranslation(source, { title: 'K', paragraphs: [EN[0], `${EN[1]} ${note}`, EN[2]] }),
    );
    expect(err.message).toBe('Çeviri reddedildi: metne çevirmen notu eklenmiş.');
  });

  it('a note that is already in the source is not an addition', () => {
    const noted = { title: 'T', paragraphs: [TR[0], `${TR[1]} (Çevirmenin notu: masal kahramanı.)`] };
    expect(() =>
      checkTranslation(noted, {
        title: 'T',
        paragraphs: [EN[0], `${EN[1]} (Translator's note: a folk hero.)`],
      }),
    ).not.toThrow();
  });

  it('every rejection message follows the workspace copy rules', () => {
    const messages = [
      rejection(() => checkTranslation(source, { title: '', paragraphs: EN })).message,
      rejection(() => checkTranslation(source, { title: 'K', paragraphs: EN.slice(0, 1) })).message,
      rejection(() => checkTranslation(source, { title: 'K', paragraphs: TR })).message,
    ];
    for (const message of messages) {
      expect(message).toMatch(/^[\p{L}\p{N} ,.:()]+$/u);
    }
  });
});
