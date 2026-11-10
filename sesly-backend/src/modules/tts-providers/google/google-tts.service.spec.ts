const mockSynthesizeSpeech = jest.fn();
const mockListVoices = jest.fn();

// Module-level mock: no real TextToSpeechClient (and no credential file
// lookup) is ever created in this test process.
jest.mock('@google-cloud/text-to-speech', () => ({
  TextToSpeechClient: jest.fn().mockImplementation(() => ({
    synthesizeSpeech: (...args: unknown[]) => mockSynthesizeSpeech(...args),
    listVoices: (...args: unknown[]) => mockListVoices(...args),
  })),
}));

import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { GoogleTTSService } from './google-tts.service';
import { createSettingsStub, SettingsStub } from '../../../test-utils/settings-stub';
import { TTSProviderEnum } from '../interfaces/tts-provider.interface';

const ClientCtor = TextToSpeechClient as unknown as jest.Mock;

const ENV_KEYS = ['GOOGLE_APPLICATION_CREDENTIALS'] as const;

describe('GoogleTTSService', () => {
  let config: Record<string, unknown>;
  let savedEnv: Record<string, string | undefined>;
  let settings: SettingsStub;

  const build = () =>
    new GoogleTTSService({ get: jest.fn((key: string) => config[key]) } as any, settings as any);

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/fake/creds.json';

    config = { 'google.projectId': 'test-project' };
    settings = createSettingsStub();
    mockSynthesizeSpeech.mockResolvedValue([
      { audioContent: new Uint8Array([0x49, 0x44, 0x33, 0x04]) },
    ]);
    mockListVoices.mockResolvedValue([{ voices: [] }]);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('throws when google.projectId is not configured and never creates a client', () => {
      config = {};
      expect(() => build()).toThrow('Google Project ID is not configured');
      expect(ClientCtor).not.toHaveBeenCalled();
    });

    it('creates the client with the credentials file + project id', () => {
      build();
      expect(ClientCtor).toHaveBeenCalledTimes(1);
      expect(ClientCtor).toHaveBeenCalledWith({
        keyFilename: '/fake/creds.json',
        projectId: 'test-project',
      });
    });

    it('falls back to ./certs/backend-service-account.json when GOOGLE_APPLICATION_CREDENTIALS is unset', () => {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      build();
      expect(ClientCtor).toHaveBeenCalledWith({
        keyFilename: './certs/backend-service-account.json',
        projectId: 'test-project',
      });
    });
  });

  describe('textToSpeech', () => {
    it('SSML voice: exact request, rate and pitch once in audioConfig and no prosody tag', async () => {
      const text = 'Bir varmis.\n\nBir yokmus & <son>.';
      const buffer = await build().textToSpeech(text, 'tr-TR-Wavenet-A');

      expect(mockSynthesizeSpeech).toHaveBeenCalledTimes(1);
      expect(mockSynthesizeSpeech).toHaveBeenCalledWith({
        input: {
          ssml: '<speak><p>Bir varmis.</p><break time="500ms"/><p>Bir yokmus &amp; &lt;son&gt;.</p></speak>',
        },
        voice: { languageCode: 'tr-TR', name: 'tr-TR-Wavenet-A' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 0.92, pitch: -2 },
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(Array.from(buffer)).toEqual([0x49, 0x44, 0x33, 0x04]);
    });

    it('Chirp 3 HD voice: exact request is plain text with speakingRate and without pitch', async () => {
      await build().textToSpeech('Merhaba <dunya>', 'tr-TR-Chirp3-HD-Achernar');

      expect(mockSynthesizeSpeech).toHaveBeenCalledTimes(1);
      const request = mockSynthesizeSpeech.mock.calls[0][0];
      expect(request).toEqual({
        input: { text: 'Merhaba <dunya>' },
        voice: { languageCode: 'tr-TR', name: 'tr-TR-Chirp3-HD-Achernar' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 0.92 },
      });
      // Google answers INVALID_ARGUMENT when the key is present at all.
      expect('pitch' in request.audioConfig).toBe(false);
      expect(JSON.stringify(request)).not.toMatch(/pitch|prosody/);
    });

    it('Chirp 3 HD voice: a pitch setting never reaches the request, the rate setting does', async () => {
      settings.values = { 'tts.google.speakingRate': 1.1, 'tts.google.pitch': 4 };
      await build().textToSpeech('x', 'en-US-Chirp3-HD-Kore');
      expect(mockSynthesizeSpeech.mock.calls[0][0].audioConfig).toEqual({
        audioEncoding: 'MP3',
        speakingRate: 1.1,
      });
    });

    it.each([
      ['en-US-Wavenet-A', 'en-US'],
      ['de-DE-Standard-B', 'de-DE'],
      ['customvoice', 'tr-TR'],
    ])('derives the language code from voice id %p -> %p', async (voiceId, languageCode) => {
      await build().textToSpeech('x', voiceId);
      expect(mockSynthesizeSpeech.mock.calls[0][0].voice).toEqual({ languageCode, name: voiceId });
    });

    it('ignores per-call Cartesia-only options (emotion, speed, volume)', async () => {
      await build().textToSpeech('x', 'tr-TR-Standard-A', {
        emotion: 'sad',
        speed: 1.4,
        volume: 2,
        pronunciationDictId: 'dict',
      });
      const request = mockSynthesizeSpeech.mock.calls[0][0];
      expect(request.audioConfig).toEqual({ audioEncoding: 'MP3', speakingRate: 0.92, pitch: -2 });
      expect(JSON.stringify(request)).not.toContain('sad');
      expect(JSON.stringify(request)).not.toContain('dict');
    });

    it('grouped parts with a pause go to Chirp as markup', async () => {
      await build().textToSpeech('Bir. Iki.', 'tr-TR-Chirp3-HD-Achernar', {
        parts: [{ text: 'Bir.', pauseAfterMs: 1500 }, { text: 'Iki.' }],
      });
      expect(mockSynthesizeSpeech.mock.calls[0][0].input).toEqual({ markup: 'Bir. [pause long] Iki.' });
    });

    it('applies the tts.google.speakingRate / tts.google.pitch settings', async () => {
      settings.values = { 'tts.google.speakingRate': 1.1, 'tts.google.pitch': 0.5 };
      await build().textToSpeech('x', 'tr-TR-Standard-A');
      expect(mockSynthesizeSpeech.mock.calls[0][0].audioConfig).toEqual({
        audioEncoding: 'MP3',
        speakingRate: 1.1,
        pitch: 0.5,
      });
    });

    it('reads the prosody on every call: a panel change applies to the next synthesis', async () => {
      const service = build();
      await service.textToSpeech('x', 'tr-TR-Standard-A');
      settings.values['tts.google.speakingRate'] = 1.25;
      settings.values['tts.google.pitch'] = 3;
      await service.textToSpeech('x', 'tr-TR-Standard-A');

      expect(mockSynthesizeSpeech.mock.calls[0][0].audioConfig).toMatchObject({ speakingRate: 0.92, pitch: -2 });
      expect(mockSynthesizeSpeech.mock.calls[1][0].audioConfig).toMatchObject({ speakingRate: 1.25, pitch: 3 });
      expect(service.getProsody()).toEqual({ speakingRate: 1.25, pitch: 3 });
    });

    it('rejects when Google returns no audio content', async () => {
      mockSynthesizeSpeech.mockResolvedValue([{ audioContent: null }]);
      await expect(build().textToSpeech('x', 'tr-TR-Standard-A')).rejects.toThrow(
        'No audio content in response from Google TTS',
      );
    });

    it('propagates the Google API error unchanged', async () => {
      const apiError = Object.assign(new Error('3 INVALID_ARGUMENT: voice not found'), { code: 3 });
      mockSynthesizeSpeech.mockRejectedValue(apiError);
      await expect(build().textToSpeech('x', 'tr-TR-Nope-Z')).rejects.toBe(apiError);
    });
  });

  describe('getAvailableVoices', () => {
    it('serves the static Chirp 3 HD catalogue and never calls listVoices', async () => {
      const voices = await build().getAvailableVoices();

      expect(mockListVoices).not.toHaveBeenCalled();
      expect(voices).toHaveLength(30);
      expect(voices[0]).toEqual({
        id: 'tr-TR-Chirp3-HD-Achernar',
        name: 'Achernar',
        language: 'Turkish',
        languageCode: 'tr-TR',
        contentLanguage: 'tr',
        gender: 'female',
        description: 'Kadın anlatıcı sesi',
        provider: TTSProviderEnum.GOOGLE,
      });
      expect(voices.find((v) => v.name === 'Zubenelgenubi')).toMatchObject({
        id: 'tr-TR-Chirp3-HD-Zubenelgenubi',
        gender: 'male',
        description: 'Erkek anlatıcı sesi',
      });
      expect(voices.every((v) => v.id.includes('-Chirp3-HD-'))).toBe(true);
      expect(voices.some((v) => /Wavenet|Standard/.test(v.id) || /HD|Chirp/.test(v.name))).toBe(false);
    });

    it('a Google outage cannot empty or change the list', async () => {
      mockListVoices.mockRejectedValue(new Error('UNAVAILABLE'));
      mockSynthesizeSpeech.mockRejectedValue(new Error('UNAVAILABLE'));
      const service = build();
      const first = await service.getAvailableVoices();
      const second = await service.getAvailableVoices();
      expect(second).toEqual(first);
      expect(first).toHaveLength(30);
    });

    it('lists the voices of the requested content languages, in order', async () => {
      const voices = await build().getAvailableVoices(['en', 'tr']);
      expect(voices).toHaveLength(60);
      expect(voices[0]).toMatchObject({ id: 'en-US-Chirp3-HD-Achernar', contentLanguage: 'en', language: 'English' });
      expect(voices[30]).toMatchObject({ id: 'tr-TR-Chirp3-HD-Achernar', contentLanguage: 'tr' });
    });

    it('an empty language list means Turkish; a language without voices contributes none', async () => {
      expect(await build().getAvailableVoices([])).toHaveLength(30);
      expect(await build().getAvailableVoices(['ru'])).toEqual([]);
    });
  });

  it('getProviderName is "google"', () => {
    expect(build().getProviderName()).toBe('google');
  });
});
