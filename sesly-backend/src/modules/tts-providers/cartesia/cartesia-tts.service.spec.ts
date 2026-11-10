import { of } from 'rxjs';
import {
  CartesiaTTSService,
  CARTESIA_DEFAULT_API_VERSION,
  CARTESIA_DEFAULT_MODEL,
} from './cartesia-tts.service';
import { toCartesiaLanguage } from './cartesia-language';
import { createSettingsStub, SettingsStub } from '../../../test-utils/settings-stub';
import { PermanentVoiceCloningError } from '../voice-cloning-errors';

describe('CartesiaTTSService (API 2026-08-14)', () => {
  let http: any;
  let config: Record<string, unknown>;
  let settings: SettingsStub;

  const build = () =>
    new CartesiaTTSService({ get: (key: string) => config[key] } as any, http, settings as any);

  beforeEach(() => {
    config = { 'cartesia.apiKey': 'test-key' };
    settings = createSettingsStub();
    http = {
      post: jest.fn(() => of({ data: { id: 'voice-123' } })),
      get: jest.fn(),
      delete: jest.fn(() => of({ data: {} })),
    };
  });

  it('defaults to Cartesia-Version 2026-08-14 and model sonic-3.6', async () => {
    expect(CARTESIA_DEFAULT_API_VERSION).toBe('2026-08-14');
    expect(CARTESIA_DEFAULT_MODEL).toBe('sonic-3.6');
    http.post.mockReturnValue(of({ data: Buffer.from('mp3') }));

    await build().textToSpeech('Merhaba', 'v1');

    const [url, body, opts] = http.post.mock.calls[0];
    expect(url).toBe('https://api.cartesia.ai/tts/bytes');
    expect(body.model_id).toBe('sonic-3.6');
    expect(opts.headers['Cartesia-Version']).toBe('2026-08-14');
  });

  it('the version comes from config, the model from the tts.cartesia.model setting (read live)', async () => {
    config['cartesia.version'] = '2026-09-01';
    settings.values['tts.cartesia.model'] = 'sonic-3.6-2026-08-27';
    const service = build();
    const body = service.buildTtsBody('x', 'v', { language: 'tr', generationConfig: {} });
    expect(body.model_id).toBe('sonic-3.6-2026-08-27');
    expect(service.buildTtsBody('x', 'v', { language: 'tr', generationConfig: {}, model: 'explicit' }).model_id).toBe(
      'explicit',
    );

    // Same instance, setting changed in the panel.
    settings.values['tts.cartesia.model'] = 'sonic-4';
    http.post.mockReturnValue(of({ data: Buffer.from('mp3') }));
    await service.textToSpeech('Merhaba', 'v1');
    const [, sent, opts] = http.post.mock.calls[0];
    expect(sent.model_id).toBe('sonic-4');
    expect(opts.headers['Cartesia-Version']).toBe('2026-09-01');
  });

  it('/tts/bytes body: language from options, singular pronunciation_dict_id', async () => {
    http.post.mockReturnValue(of({ data: Buffer.from('mp3') }));
    await build().textToSpeech('Hello', 'v1', { language: 'en-US', pronunciationDictId: 'dict-1', emotion: 'calm' });

    const body = http.post.mock.calls[0][1];
    expect(body).toMatchObject({
      transcript: 'Hello',
      voice: { mode: 'id', id: 'v1' },
      language: 'en',
      pronunciation_dict_id: 'dict-1',
      output_format: { container: 'mp3', bit_rate: 128000, sample_rate: 44100 },
    });
    expect(body.pronunciation_dict_ids).toBeUndefined();
    expect(body.generation_config.emotion).toBe('calm');
  });

  it('/tts/bytes with grouped parts: one transcript with inline speed and break tags', async () => {
    http.post.mockReturnValue(of({ data: Buffer.from('mp3') }));
    await build().textToSpeech('Bir. Iki.', 'v1', {
      speed: 0.8,
      emotion: 'calm',
      parts: [{ text: 'Bir.', speed: 0.8, pauseAfterMs: 500 }, { text: 'Iki.', speed: 1 }],
    });

    const body = http.post.mock.calls[0][1];
    expect(body.transcript).toBe('Bir.<break time="500ms"/> <speed ratio="1"/> Iki.');
    expect(body.generation_config).toMatchObject({ speed: 0.8, emotion: 'calm' });
  });

  it('/tts/bytes language falls back to tr', () => {
    const svc = build();
    expect(svc.buildTtsBody('x', 'v', { language: toCartesiaLanguage(undefined), generationConfig: {} }).language).toBe('tr');
  });

  it('clone form sends exactly clip + name + language (+ description), no mode / enhance', async () => {
    const form = build().buildCloneForm(
      { buffer: Buffer.from('RIFF'), mimeType: 'audio/wav', filename: 'reference.wav' },
      'Annem',
      'tr',
    );
    const keys = Array.from((form as any).keys());
    expect(keys).toEqual(['clip', 'name', 'language']);
    expect(form.get('language')).toBe('tr');
    expect(form.get('mode')).toBeNull();
    expect(form.get('enhance')).toBeNull();

    const withDescription = build().buildCloneForm(
      { buffer: Buffer.from('RIFF'), mimeType: 'audio/wav', filename: 'reference.wav' },
      'Annem',
      'tr',
      'support note',
    );
    expect(Array.from((withDescription as any).keys())).toEqual(['clip', 'name', 'language', 'description']);
  });

  it('clone form carries the accent label as a plain string field when given', () => {
    const form = build().buildCloneForm(
      { buffer: Buffer.from('RIFF'), mimeType: 'audio/wav', filename: 'reference.wav' },
      'Annem',
      'en',
      'support note',
      'general-american',
    );
    expect(Array.from((form as any).keys())).toEqual(['clip', 'name', 'language', 'accent', 'description']);
    expect(form.get('accent')).toBe('general-american');
  });

  it.each([
    ['tr-TR', 'istanbul', 'tr'],
    ['en-US', 'general-american', 'en'],
  ])('createVoiceClone sends language %p with accent %p', async (language, accent, sentLanguage) => {
    await build().createVoiceClone(
      { buffer: Buffer.from('RIFF....WAVE'), mimeType: 'audio/wav', filename: 'reference.wav' },
      'Annem',
      { language, accent },
    );
    expect(http.post).toHaveBeenCalledTimes(1);
    const form = http.post.mock.calls[0][1];
    expect(Array.from(form.keys())).toEqual(['clip', 'name', 'language', 'accent']);
    expect(form.get('language')).toBe(sentLanguage);
    expect(form.get('accent')).toBe(accent);
  });

  it('createVoiceClone sends no accent field when none (or a blank one) is given', async () => {
    const clip = { buffer: Buffer.from('RIFF....WAVE'), mimeType: 'audio/wav', filename: 'reference.wav' };
    await build().createVoiceClone(clip, 'Annem', { language: 'de-DE' });
    await build().createVoiceClone(clip, 'Annem', { language: 'tr', accent: '  ' });
    await build().createVoiceClone(clip, 'Annem', { language: 'tr', accent: null });
    for (const [, form] of http.post.mock.calls) {
      expect(form.get('accent')).toBeNull();
    }
  });

  it('createVoiceClone maps tr-TR -> tr and returns the upstream id', async () => {
    const id = await build().createVoiceClone(
      { buffer: Buffer.from('RIFF....WAVE'), mimeType: 'audio/wav', filename: 'reference.wav' },
      'Annem',
      { language: 'tr-TR' },
    );
    expect(id).toBe('voice-123');
    const [url, form, opts] = http.post.mock.calls[0];
    expect(url).toBe('https://api.cartesia.ai/voices/clone');
    expect(form.get('language')).toBe('tr');
    expect(opts.headers['Cartesia-Version']).toBe('2026-08-14');
  });

  it('rejects clips above the 16 MB clone limit as permanent', async () => {
    const err = await build()
      .createVoiceClone(
        { buffer: Buffer.alloc(16 * 1024 * 1024 + 1), mimeType: 'audio/wav', filename: 'reference.wav' },
        'Annem',
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(PermanentVoiceCloningError);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('exposes NO preset voices and never lists the org voices (they are user clones)', async () => {
    await expect(build().getAvailableVoices()).resolves.toEqual([]);
    expect(http.get).not.toHaveBeenCalled();
  });

  it('toCartesiaLanguage normalizes BCP-47 and falls back to tr', () => {
    expect(toCartesiaLanguage('tr-TR')).toBe('tr');
    expect(toCartesiaLanguage('EN_us')).toBe('en');
    expect(toCartesiaLanguage(null, 'de-DE')).toBe('de');
    expect(toCartesiaLanguage('', undefined)).toBe('tr');
    expect(toCartesiaLanguage('multilingual')).toBe('tr');
  });
});
