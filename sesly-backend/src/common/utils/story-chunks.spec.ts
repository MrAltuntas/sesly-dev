import { STORY_CHUNK_MAX_CHARS, splitStoryIntoChunks } from './story-chunks';

describe('splitStoryIntoChunks', () => {
  it('a short text is one trimmed chunk; an empty text has none', () => {
    expect(splitStoryIntoChunks('  Bir varmış.  ')).toEqual(['Bir varmış.']);
    expect(splitStoryIntoChunks('   ')).toEqual([]);
    expect(STORY_CHUNK_MAX_CHARS).toBe(5000);
  });

  it('cuts at the last sentence end inside the limit', () => {
    expect(splitStoryIntoChunks('Aaa bbb. Ccc ddd! Eee fff? Ggg', 20)).toEqual([
      'Aaa bbb. Ccc ddd!',
      'Eee fff? Ggg',
    ]);
  });

  it('without punctuation cuts at the last space, without a space cuts hard', () => {
    expect(splitStoryIntoChunks('aaaa bbbb cccc', 10)).toEqual(['aaaa bbbb', 'cccc']);
    expect(splitStoryIntoChunks('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl']);
  });
});
