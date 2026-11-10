import {
  PermanentVoiceCloningError,
  isPermanentCloningFailure,
} from './voice-cloning-errors';

describe('voice-cloning-errors', () => {
  describe('PermanentVoiceCloningError', () => {
    it('is an Error with a stable name and message', () => {
      const err = new PermanentVoiceCloningError('clip too short');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(PermanentVoiceCloningError);
      expect(err.name).toBe('PermanentVoiceCloningError');
      expect(err.message).toBe('clip too short');
    });
  });

  describe('isPermanentCloningFailure', () => {
    it.each([
      'Voice duration too short',
      'The audio is too short to clone',
      'Clip was too short (2s)',
      'Invalid audio payload',
      'Unsupported audio format: m4a',
      'Uploaded file is corrupt',
      'No speech detected in the clip',
      'No valid audio found',
      'Audio quality is too low',
      'AUDIO QUALITY TOO LOW',
    ])('permanent: %p', (message) => {
      expect(isPermanentCloningFailure(message)).toBe(true);
    });

    it.each([
      'Request timeout',
      'Internal server error',
      'Rate limit exceeded',
      'socket hang up',
      'ECONNRESET',
      'Cartesia voice cloning failed: 502 Bad Gateway',
    ])('transient (retryable): %p', (message) => {
      expect(isPermanentCloningFailure(message)).toBe(false);
    });

    it('treats an empty / missing message as transient', () => {
      expect(isPermanentCloningFailure('')).toBe(false);
      expect(isPermanentCloningFailure(undefined as unknown as string)).toBe(false);
    });
  });
});
