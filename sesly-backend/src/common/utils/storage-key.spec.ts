import { extractStorageKey } from './storage-key';

// Core shapes are covered in entitlements.spec.ts; this file locks the edges.
describe('extractStorageKey (edge cases)', () => {
  it.each([
    ['  voice-samples/u/p.mp3  ', 'voice-samples/u/p.mp3'],
    ['/avatars/u/1.jpg', 'avatars/u/1.jpg'],
    ['///avatars/u/1.jpg', 'avatars/u/1.jpg'],
    ['gs://bucket/a/b/c.mp3', 'a/b/c.mp3'],
    ['http://storage.googleapis.com/bucket/a.mp3', 'a.mp3'],
    ['https://storage.cloud.google.com/bucket/a/b.mp3', 'a/b.mp3'],
    ['https://STORAGE.GOOGLEAPIS.COM/bucket/a.mp3', 'a.mp3'],
    ['https://bucket.storage.googleapis.com/a/b.mp3?X-Goog-Expires=60', 'a/b.mp3'],
    ['https://storage.googleapis.com/bucket/stories/%C3%A7ocuk%20masal.png', 'stories/çocuk masal.png'],
    ['https://storage.googleapis.com/bucket/a.mp3#frag', 'a.mp3'],
  ])('%p -> %p', (input, expected) => {
    expect(extractStorageKey(input)).toBe(expected);
  });

  it.each([
    [undefined],
    ['   '],
    ['/'],
    ['gs://bucket'],
    ['gs://bucket/'],
    ['https://storage.googleapis.com/bucket'],
    ['https://storage.googleapis.com/bucket/'],
    ['https://bucket.storage.googleapis.com/'],
    ['https://'],
    ['https://example.com/bucket/a.mp3'],
    ['https://evil.com/storage.googleapis.com/bucket/a.mp3'],
    ['https://storage.googleapis.com.evil.com/bucket/a.mp3'],
    ['ftp://example.com/a.mp3'],
  ])('returns null for %p', (input) => {
    expect(extractStorageKey(input)).toBeNull();
  });

  describe('with our bucket name', () => {
    it.each([
      ['a/b.mp3', 'a/b.mp3'],
      ['gs://ours/a/b.mp3', 'a/b.mp3'],
      ['https://storage.googleapis.com/ours/a/b.mp3', 'a/b.mp3'],
      ['https://storage.cloud.google.com/ours/a/b.mp3', 'a/b.mp3'],
      ['https://ours.storage.googleapis.com/a/b.mp3', 'a/b.mp3'],
      ['https://OURS.storage.googleapis.com/a/b.mp3', 'a/b.mp3'],
    ])('keeps our object %p -> %p', (input, expected) => {
      expect(extractStorageKey(input, 'ours')).toBe(expected);
    });

    it.each([
      ['gs://theirs/a/b.mp3'],
      ['https://storage.googleapis.com/theirs/a/b.mp3'],
      ['https://storage.cloud.google.com/theirs/a/b.mp3'],
      ['https://theirs.storage.googleapis.com/a/b.mp3'],
    ])('treats another bucket %p as foreign (null)', (input) => {
      expect(extractStorageKey(input, 'ours')).toBeNull();
    });
  });

  it('returns the raw key when percent-decoding fails', () => {
    expect(extractStorageKey('https://storage.googleapis.com/bucket/a%E0%A4%A.mp3')).toBe('a%E0%A4%A.mp3');
  });
});
