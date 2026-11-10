import {
  SONIC3_DEFAULT_EMOTION,
  SONIC3_EXTENDED_EMOTIONS,
  SONIC3_PRIMARY_EMOTIONS,
  SONIC3_SPEED_MAX,
  SONIC3_SPEED_MIN,
  SONIC3_VOLUME_MAX,
  SONIC3_VOLUME_MIN,
  isValidSonic3Emotion,
} from './cartesia-emotions.constants';
import { CARTESIA_DEFAULT_LANGUAGE, toCartesiaLanguage } from './cartesia-language';

describe('cartesia emotion constants', () => {
  it('primary emotions are a prefix of the extended list', () => {
    expect(SONIC3_EXTENDED_EMOTIONS.slice(0, SONIC3_PRIMARY_EMOTIONS.length)).toEqual([
      ...SONIC3_PRIMARY_EMOTIONS,
    ]);
    expect(SONIC3_PRIMARY_EMOTIONS).toEqual(['neutral', 'angry', 'excited', 'content', 'sad', 'scared']);
  });

  it('extended list has no duplicates', () => {
    expect(new Set(SONIC3_EXTENDED_EMOTIONS).size).toBe(SONIC3_EXTENDED_EMOTIONS.length);
  });

  it('contains every emotion the LLM prompt may produce (bedtime whitelist)', () => {
    for (const emotion of [
      'neutral', 'peaceful', 'calm', 'content', 'curious', 'mysterious',
      'nostalgic', 'happy', 'excited', 'sad', 'scared',
    ]) {
      expect(isValidSonic3Emotion(emotion)).toBe(true);
    }
  });

  it('default emotion is neutral and valid', () => {
    expect(SONIC3_DEFAULT_EMOTION).toBe('neutral');
    expect(isValidSonic3Emotion(SONIC3_DEFAULT_EMOTION)).toBe(true);
  });

  it.each([
    ['Happy'],
    ['mutlu'],
    ['happy_excited'],
    [''],
    [null],
    [undefined],
    [42],
    [{}],
  ])('rejects %p', (value) => {
    expect(isValidSonic3Emotion(value)).toBe(false);
  });

  it('keeps the Sonic 3 numeric limits', () => {
    expect([SONIC3_SPEED_MIN, SONIC3_SPEED_MAX]).toEqual([0.6, 1.5]);
    expect([SONIC3_VOLUME_MIN, SONIC3_VOLUME_MAX]).toEqual([0.5, 2.0]);
  });
});

describe('toCartesiaLanguage', () => {
  it.each([
    [['tr-TR'], 'tr'],
    [['TR'], 'tr'],
    [[' en-GB '], 'en'],
    [['de_DE'], 'de'],
    [[undefined, null, 'fr-FR'], 'fr'],
    [['zzz', 'es'], 'es'],
    [['123'], 'tr'],
    [[], 'tr'],
  ])('%j -> %s', (candidates, expected) => {
    expect(toCartesiaLanguage(...candidates)).toBe(expected);
  });

  it('default language is tr', () => {
    expect(CARTESIA_DEFAULT_LANGUAGE).toBe('tr');
  });
});
