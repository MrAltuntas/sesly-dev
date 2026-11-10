import { HttpException, HttpStatus } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { CartesiaTTSService } from './cartesia-tts.service';
import { createSettingsStub, SettingsStub } from '../../../test-utils/settings-stub';
import { PermanentVoiceCloningError } from '../voice-cloning-errors';

/**
 * Gap coverage for CartesiaTTSService (the contract-level happy paths live in
 * cartesia-tts.service.spec.ts): config parsing, clamping, error mapping,
 * URL-sourced clones and idempotent deletion.
 */
describe('CartesiaTTSService (errors, clamping, deletion)', () => {
  let http: { post: jest.Mock; get: jest.Mock; delete: jest.Mock };
  let config: Record<string, unknown>;
  let settings: SettingsStub;

  const build = () =>
    new CartesiaTTSService({ get: (key: string) => config[key] } as any, http as any, settings as any);

  const axiosError = (status: number | undefined, data: unknown, message = 'Request failed') =>
    Object.assign(new Error(message), status === undefined ? {} : { response: { status, data } });

  const clip = (bytes = 'RIFF....WAVE') => ({
    buffer: Buffer.from(bytes),
    mimeType: 'audio/wav',
    filename: 'reference.wav',
  });

  beforeEach(() => {
    config = { 'cartesia.apiKey': 'test-key' };
    settings = createSettingsStub();
    http = {
      post: jest.fn(() => of({ data: Buffer.from('mp3-bytes') })),
      get: jest.fn(() => of({ data: Buffer.from('RIFF-downloaded') })),
      delete: jest.fn(() => of({ data: {} })),
    };
  });

  it('getProviderName is CARTESIA', () => {
    expect(build().getProviderName()).toBe('CARTESIA');
  });

  describe('textToSpeech', () => {
    it('refuses to call the API without an API key', async () => {
      config = {};
      await expect(build().textToSpeech('x', 'v1')).rejects.toThrow('Cartesia API key is missing');
      expect(http.post).not.toHaveBeenCalled();
    });

    it('sends auth headers, arraybuffer response type, and returns the bytes as a Buffer', async () => {
      config['cartesia.apiUrl'] = 'https://cartesia.test';
      const out = await build().textToSpeech('Merhaba', 'v1');

      const [url, , opts] = http.post.mock.calls[0];
      expect(url).toBe('https://cartesia.test/tts/bytes');
      expect(opts).toEqual({
        headers: {
          'X-API-Key': 'test-key',
          'Cartesia-Version': '2026-08-14',
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
      });
      expect(Buffer.isBuffer(out)).toBe(true);
      expect(out.toString()).toBe('mp3-bytes');
    });

    it('uses defaults speed 0.85 / volume 1.0 / emotion neutral / language tr', async () => {
      await build().textToSpeech('x', 'v1');
      const body = http.post.mock.calls[0][1];
      expect(body.generation_config).toEqual({ speed: 0.85, volume: 1, emotion: 'neutral' });
      expect(body.language).toBe('tr');
      expect(body.pronunciation_dict_id).toBeUndefined();
    });

    it('reads default speed / volume / emotion from the settings on every call', async () => {
      const service = build();
      settings.values = {
        'tts.cartesia.defaultSpeed': 0.9,
        'tts.cartesia.defaultVolume': 1.2,
        'tts.cartesia.defaultEmotion': 'calm',
      };
      await service.textToSpeech('x', 'v1');
      expect(http.post.mock.calls[0][1].generation_config).toEqual({
        speed: 0.9,
        volume: 1.2,
        emotion: 'calm',
      });

      settings.values['tts.cartesia.defaultSpeed'] = 1.1;
      await service.textToSpeech('x', 'v1');
      expect(http.post.mock.calls[1][1].generation_config.speed).toBe(1.1);
    });

    it('per-call options win over the default settings', async () => {
      settings.values = { 'tts.cartesia.defaultSpeed': 0.9, 'tts.cartesia.defaultEmotion': 'calm' };
      await build().textToSpeech('x', 'v1', { speed: 1.2, volume: 0.8, emotion: 'sad' });
      expect(http.post.mock.calls[0][1].generation_config).toEqual({ speed: 1.2, volume: 0.8, emotion: 'sad' });
    });

    it.each([
      [{ speed: 3, volume: 5 }, { speed: 1.5, volume: 2 }],
      [{ speed: 0.1, volume: 0 }, { speed: 0.6, volume: 0.5 }],
      [{ speed: 1.0, volume: 1.5 }, { speed: 1.0, volume: 1.5 }],
      [{ speed: Number.NaN, volume: Number.POSITIVE_INFINITY }, { speed: 0.6, volume: 0.5 }],
    ])('clamps %j into the Sonic 3 range -> %j', async (opts, expected) => {
      await build().textToSpeech('x', 'v1', opts);
      expect(http.post.mock.calls[0][1].generation_config).toMatchObject(expected);
    });

    it('omits emotion when the caller passes an empty emotion', async () => {
      await build().textToSpeech('x', 'v1', { emotion: '' });
      expect(http.post.mock.calls[0][1].generation_config).not.toHaveProperty('emotion');
    });

    it.each([
      [
        'Buffer JSON with error.message',
        Buffer.from(JSON.stringify({ error: { message: 'voice not found' } })),
        'Cartesia TTS failed: voice not found',
      ],
      [
        'Buffer JSON with message',
        Buffer.from(JSON.stringify({ message: 'invalid transcript' })),
        'Cartesia TTS failed: invalid transcript',
      ],
      ['Buffer non-JSON', Buffer.from('upstream exploded'), 'Cartesia TTS failed: upstream exploded'],
      ['object with error.message', { error: { message: 'quota' } }, 'Cartesia TTS failed: quota'],
      ['object with message', { message: 'bad voice' }, 'Cartesia TTS failed: bad voice'],
      ['object without message', { code: 42 }, 'Cartesia TTS failed: {"code":42}'],
    ])('maps upstream errors (%s) to 502 with a readable message', async (_label, data, message) => {
      http.post.mockReturnValue(throwError(() => axiosError(400, data)));
      const err = await build().textToSpeech('x', 'v1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect((err as HttpException).message).toBe(message);
    });

    it('maps network errors without a response to 502 using the error message', async () => {
      http.post.mockReturnValue(throwError(() => axiosError(undefined, undefined, 'socket hang up')));
      const err = await build().textToSpeech('x', 'v1').catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect((err as HttpException).message).toBe('Cartesia TTS failed: socket hang up');
    });

    it('falls back to "Unknown error" for an empty error', async () => {
      http.post.mockReturnValue(throwError(() => ({})));
      const err = await build().textToSpeech('x', 'v1').catch((e: unknown) => e);
      expect((err as HttpException).message).toBe('Cartesia TTS failed: Unknown error');
    });
  });

  describe('createVoiceClone', () => {
    beforeEach(() => {
      http.post.mockImplementation(() => of({ data: { id: 'voice-123' } }));
    });

    it('refuses to call the API without an API key', async () => {
      config = {};
      await expect(build().createVoiceClone(clip(), 'Annem')).rejects.toThrow(
        'Cartesia API key is missing',
      );
      expect(http.post).not.toHaveBeenCalled();
    });

    it('posts multipart with auth headers, 60 s timeout, no manual Content-Type', async () => {
      await build().createVoiceClone(clip(), 'Annem', { description: 'support note' });
      const [url, form, opts] = http.post.mock.calls[0];
      expect(url).toBe('https://api.cartesia.ai/voices/clone');
      expect(form).toBeInstanceOf(FormData);
      expect(form.get('name')).toBe('Annem');
      expect(form.get('language')).toBe('tr');
      expect(form.get('description')).toBe('support note');
      expect(opts.timeout).toBe(60_000);
      expect(opts.maxBodyLength).toBe(Infinity);
      expect(opts.maxContentLength).toBe(Infinity);
      expect(opts.headers).toEqual({ 'X-API-Key': 'test-key', 'Cartesia-Version': '2026-08-14' });
    });

    it('uses the clip mime type and filename of an in-memory clip', async () => {
      await build().createVoiceClone(
        { buffer: Buffer.from('ID3...'), mimeType: 'audio/mpeg', filename: 'sample.mp3' },
        'Annem',
      );
      const blob = http.post.mock.calls[0][1].get('clip') as File;
      expect(blob.type).toBe('audio/mpeg');
      expect(blob.name).toBe('sample.mp3');
      expect(blob.size).toBe(6);
    });

    it('downloads a URL source first and sends it as reference.wav / audio/wav', async () => {
      const id = await build().createVoiceClone('https://storage.test/sample.wav', 'Annem');

      expect(id).toBe('voice-123');
      expect(http.get).toHaveBeenCalledWith('https://storage.test/sample.wav', {
        responseType: 'arraybuffer',
      });
      const blob = http.post.mock.calls[0][1].get('clip') as File;
      expect(blob.type).toBe('audio/wav');
      expect(blob.name).toBe('reference.wav');
      expect(Buffer.from(await blob.arrayBuffer()).toString()).toBe('RIFF-downloaded');
    });

    it('surfaces a download failure as a plain (retryable) error without calling Cartesia', async () => {
      http.get.mockReturnValue(throwError(() => new Error('403 Forbidden')));
      const err = await build()
        .createVoiceClone('https://storage.test/x.wav', 'Annem')
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(PermanentVoiceCloningError);
      expect(err).not.toBeInstanceOf(HttpException);
      expect((err as Error).message).toBe('Failed to download reference audio: 403 Forbidden');
      expect(http.post).not.toHaveBeenCalled();
    });

    it('rejects an empty clip as permanent before calling Cartesia', async () => {
      const err = await build()
        .createVoiceClone({ buffer: Buffer.alloc(0), mimeType: 'audio/wav', filename: 'r.wav' }, 'Annem')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PermanentVoiceCloningError);
      expect(http.post).not.toHaveBeenCalled();
    });

    it('rejects an empty downloaded clip as permanent', async () => {
      http.get.mockReturnValue(of({ data: new ArrayBuffer(0) }));
      await expect(
        build().createVoiceClone('https://storage.test/empty.wav', 'Annem'),
      ).rejects.toBeInstanceOf(PermanentVoiceCloningError);
      expect(http.post).not.toHaveBeenCalled();
    });

    it('accepts a clip of exactly 16 MB', async () => {
      await expect(
        build().createVoiceClone(
          { buffer: Buffer.alloc(16 * 1024 * 1024), mimeType: 'audio/wav', filename: 'r.wav' },
          'Annem',
        ),
      ).resolves.toBe('voice-123');
    });

    it.each([
      [{ voice: { id: 'nested-voice' } }, 'nested-voice'],
      [{ data: { id: 'data-voice' } }, 'data-voice'],
    ])('reads the voice id from alternative response shapes %j', async (data, expected) => {
      http.post.mockReturnValue(of({ data }));
      await expect(build().createVoiceClone(clip(), 'Annem')).resolves.toBe(expected);
    });

    it('a response without a voice id is a retryable 502, not a permanent failure', async () => {
      http.post.mockReturnValue(of({ data: { status: 'ok' } }));
      const err = await build().createVoiceClone(clip(), 'Annem').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect((err as HttpException).message).toContain('did not include a voice id');
    });

    it('a numeric id is rejected (id must be a string)', async () => {
      http.post.mockReturnValue(of({ data: { id: 12345 } }));
      await expect(build().createVoiceClone(clip(), 'Annem')).rejects.toBeInstanceOf(HttpException);
    });

    it.each([
      [{ error: { message: 'Voice duration too short' } }, 'Voice duration too short'],
      [{ message: 'No speech detected in clip' }, 'No speech detected in clip'],
      [Buffer.from(JSON.stringify({ message: 'Unsupported audio format' })), 'Unsupported audio format'],
    ])('maps an input-validation rejection %j to PermanentVoiceCloningError', async (data, message) => {
      http.post.mockReturnValue(throwError(() => axiosError(400, data)));
      const err = await build().createVoiceClone(clip(), 'Annem').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PermanentVoiceCloningError);
      expect((err as Error).message).toBe(message);
    });

    it('maps other upstream failures to a retryable 502 HttpException', async () => {
      http.post.mockReturnValue(
        throwError(() => axiosError(500, { error: { message: 'Internal error' } })),
      );
      const err = await build().createVoiceClone(clip(), 'Annem').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err).not.toBeInstanceOf(PermanentVoiceCloningError);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect((err as HttpException).message).toBe('Cartesia voice cloning failed: Internal error');
    });

    it.each([
      [400, { error: { message: 'accent is not valid for language tr' } }],
      [422, { message: 'Unknown field: accent' }],
    ])('a %i about the accent label is retried once without it, so a label never fails a clone', async (status, data) => {
      http.post
        .mockReturnValueOnce(throwError(() => axiosError(status, data)))
        .mockReturnValueOnce(of({ data: { id: 'voice-123' } }));

      await expect(
        build().createVoiceClone(clip(), 'Annem', { language: 'tr', accent: 'istanbul' }),
      ).resolves.toBe('voice-123');

      expect(http.post).toHaveBeenCalledTimes(2);
      expect(http.post.mock.calls[0][1].get('accent')).toBe('istanbul');
      expect(http.post.mock.calls[1][1].get('accent')).toBeNull();
      expect(http.post.mock.calls[1][1].get('language')).toBe('tr');
    });

    it('the retry without the accent can still fail on the clip itself', async () => {
      http.post
        .mockReturnValueOnce(throwError(() => axiosError(400, { message: 'invalid accent' })))
        .mockReturnValueOnce(throwError(() => axiosError(400, { message: 'No speech detected in clip' })));

      const err = await build()
        .createVoiceClone(clip(), 'Annem', { language: 'tr', accent: 'istanbul' })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(PermanentVoiceCloningError);
      expect(http.post).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['a 4xx about something else', 400, { message: 'No speech detected in clip' }, { accent: 'istanbul' }],
      ['a 5xx that mentions the accent', 500, { message: 'accent service down' }, { accent: 'istanbul' }],
      ['a network error that mentions the accent', undefined, undefined, { accent: 'istanbul' }],
      ['an accent complaint when no accent was sent', 400, { message: 'accent required' }, {}],
    ])('is not retried: %s', async (_name, status, data, options) => {
      http.post.mockReturnValue(throwError(() => axiosError(status, data, 'accent socket hang up')));

      await expect(build().createVoiceClone(clip(), 'Annem', options)).rejects.toBeDefined();

      expect(http.post).toHaveBeenCalledTimes(1);
    });

    it('maps a timeout (no response) to a retryable 502', async () => {
      http.post.mockReturnValue(
        throwError(() => axiosError(undefined, undefined, 'timeout of 60000ms exceeded')),
      );
      const err = await build().createVoiceClone(clip(), 'Annem').catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect((err as HttpException).message).toContain('timeout of 60000ms exceeded');
    });
  });

  describe('deleteVoiceClone', () => {
    it.each(['', '   '])('is a no-op for an empty id %p', async (id) => {
      await expect(build().deleteVoiceClone(id)).resolves.toBeUndefined();
      expect(http.delete).not.toHaveBeenCalled();
    });

    it('refuses to call the API without an API key', async () => {
      config = {};
      await expect(build().deleteVoiceClone('voice-1')).rejects.toThrow('Cartesia API key is missing');
      expect(http.delete).not.toHaveBeenCalled();
    });

    it('DELETEs /voices/:id with an URL-encoded id, auth headers and 30 s timeout', async () => {
      await build().deleteVoiceClone('a/b c');
      expect(http.delete).toHaveBeenCalledWith('https://api.cartesia.ai/voices/a%2Fb%20c', {
        headers: { 'X-API-Key': 'test-key', 'Cartesia-Version': '2026-08-14' },
        timeout: 30_000,
      });
    });

    it('treats 404 as already deleted (idempotent)', async () => {
      http.delete.mockReturnValue(throwError(() => axiosError(404, { message: 'not found' })));
      await expect(build().deleteVoiceClone('gone')).resolves.toBeUndefined();
    });

    it('maps other failures to 502', async () => {
      http.delete.mockReturnValue(throwError(() => axiosError(500, { message: 'db down' })));
      const err = await build().deleteVoiceClone('voice-1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect((err as HttpException).message).toBe('Cartesia voice deletion failed: db down');
    });

    it('maps 401 to 502 as well (only 404 is swallowed)', async () => {
      http.delete.mockReturnValue(throwError(() => axiosError(401, { message: 'bad key' })));
      await expect(build().deleteVoiceClone('voice-1')).rejects.toBeInstanceOf(HttpException);
    });
  });
});
