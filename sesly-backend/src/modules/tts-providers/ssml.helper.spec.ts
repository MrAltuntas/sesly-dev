import {
  buildGoogleInput,
  buildGoogleSynthesisRequest,
  chirpPauseTag,
  isChirpVoice,
  STORYTELLING_PARAGRAPH_BREAK_MS,
  voiceSupportsPitch,
  voiceSupportsSsml,
  wrapStorytellingSSML,
} from './ssml.helper';

describe('ssml.helper', () => {
  it('keeps the tuned paragraph pause', () => {
    expect(STORYTELLING_PARAGRAPH_BREAK_MS).toBe(500);
  });

  describe('grouped segments (buildGoogleInput)', () => {
    const chirp = 'tr-TR-Chirp3-HD-Achernar';
    const wavenet = 'tr-TR-Wavenet-A';

    it.each([
      [100, '[pause short]'],
      [399, '[pause short]'],
      [400, '[pause]'],
      [999, '[pause]'],
      [1000, '[pause long]'],
    ])('a pause of %p ms is %p on Chirp', (ms, tag) => {
      expect(chirpPauseTag(ms)).toBe(tag);
    });

    it('without pauses the parts are plain text (Chirp) or the usual SSML (other voices)', () => {
      const parts = [{ text: 'Bir.', speed: 0.8 }, { text: 'Iki.' }];
      expect(buildGoogleInput('ignored', chirp, parts)).toEqual({ text: 'Bir. Iki.' });
      expect(buildGoogleInput('Tek metin.', chirp)).toEqual({ text: 'Tek metin.' });
      expect(buildGoogleInput('ignored', wavenet, parts)).toEqual({ ssml: '<speak><p>Bir. Iki.</p></speak>' });
    });

    it('Chirp with pauses: the markup field with pause tags, square brackets made harmless', () => {
      expect(
        buildGoogleInput('ignored', chirp, [
          { text: 'Bir [not]. ', pauseAfterMs: 1200 },
          { text: 'Iki.', pauseAfterMs: 200 },
          { text: 'Uc.' },
        ]),
      ).toEqual({ markup: 'Bir (not). [pause long] Iki. [pause short] Uc.' });
    });

    it('other voices with pauses: SSML with a break after the part', () => {
      expect(
        buildGoogleInput('ignored', wavenet, [{ text: 'A & B.', pauseAfterMs: 750.4 }, { text: 'C.\n\nD.' }]),
      ).toEqual({
        ssml: '<speak><p>A &amp; B.</p><break time="750ms"/><p>C.</p><break time="500ms"/><p>D.</p></speak>',
      });
    });

    it('the request builder uses the grouped input', () => {
      const request = buildGoogleSynthesisRequest('x', chirp, { speakingRate: 1, pitch: 0 }, [
        { text: 'A.', pauseAfterMs: 500 },
        { text: 'B.' },
      ]);
      expect(request.input).toEqual({ markup: 'A. [pause] B.' });
    });
  });

  describe('voice family rules', () => {
    it.each([
      ['tr-TR-Standard-A', true],
      ['tr-TR-Wavenet-B', true],
      ['tr-TR-Neural2-A', true],
      ['en-US-Studio-O', true],
      ['tr-TR-Chirp3-HD-Achernar', false],
      ['en-US-Chirp3-HD-Zubenelgenubi', false],
      ['tr-TR-Chirp-HD-F', false],
      ['', false],
    ])('%p: ssml and pitch supported = %s', (voiceId, expected) => {
      expect(voiceSupportsSsml(voiceId)).toBe(expected);
      expect(voiceSupportsPitch(voiceId)).toBe(expected);
    });

    it('returns false for a missing voice id', () => {
      expect(voiceSupportsSsml(undefined as unknown as string)).toBe(false);
      expect(voiceSupportsPitch(undefined as unknown as string)).toBe(false);
      expect(isChirpVoice(undefined as unknown as string)).toBe(false);
    });

    it('recognises the Chirp family', () => {
      expect(isChirpVoice('tr-TR-Chirp3-HD-Kore')).toBe(true);
      expect(isChirpVoice('tr-TR-Wavenet-A')).toBe(false);
    });
  });

  describe('wrapStorytellingSSML', () => {
    const BREAK = '<break time="500ms"/>';

    it('wraps a single paragraph in speak + p, with no prosody tag', () => {
      const out = wrapStorytellingSSML('Bir varmis bir yokmus.');
      expect(out).toBe('<speak><p>Bir varmis bir yokmus.</p></speak>');
      expect(out).not.toContain('prosody');
    });

    it('splits paragraphs on blank lines and joins them with a break', () => {
      const text = 'Birinci paragraf.\n\nIkinci paragraf.\n\n\n\nUcuncu paragraf.';
      expect(wrapStorytellingSSML(text)).toBe(
        `<speak><p>Birinci paragraf.</p>${BREAK}<p>Ikinci paragraf.</p>${BREAK}<p>Ucuncu paragraf.</p></speak>`,
      );
    });

    it('does not split on a single newline', () => {
      expect(wrapStorytellingSSML('Satir bir\nSatir iki')).toBe(
        '<speak><p>Satir bir\nSatir iki</p></speak>',
      );
    });

    it('trims paragraphs and drops empty ones', () => {
      const text = '\n\n   Ilk.   \n\n   \n\n  Son.  \n\n';
      expect(wrapStorytellingSSML(text)).toBe(`<speak><p>Ilk.</p>${BREAK}<p>Son.</p></speak>`);
    });

    it('emits an empty envelope for empty / whitespace-only text', () => {
      expect(wrapStorytellingSSML('')).toBe('<speak></speak>');
      expect(wrapStorytellingSSML('   \n\n  ')).toBe('<speak></speak>');
    });

    it('escapes &, <, >, double and single quotes', () => {
      expect(wrapStorytellingSSML(`Ali & Veli <kral> "dedi" 'evet'`)).toBe(
        '<speak><p>Ali &amp; Veli &lt;kral&gt; &quot;dedi&quot; &apos;evet&apos;</p></speak>',
      );
    });

    it('escapes & first, so existing entities are escaped literally (no double-decoding)', () => {
      expect(wrapStorytellingSSML('A &amp; B')).toBe('<speak><p>A &amp;amp; B</p></speak>');
    });

    it('user text cannot inject SSML tags', () => {
      const out = wrapStorytellingSSML('<break time="10s"/><prosody pitch="+9st"></speak><speak>');
      expect(out.match(/<speak>/g)).toHaveLength(1);
      expect(out.match(/<\/speak>/g)).toHaveLength(1);
      expect(out).not.toContain('<break time="10s"/>');
      expect(out).not.toContain('<prosody');
      expect(out).toContain('&lt;break time=&quot;10s&quot;/&gt;');
    });

    it('keeps Turkish characters untouched', () => {
      expect(wrapStorytellingSSML('Keloğlan çok şaşırmış.')).toBe(
        '<speak><p>Keloğlan çok şaşırmış.</p></speak>',
      );
    });

    it('honours a custom paragraph pause', () => {
      expect(wrapStorytellingSSML('A\n\nB', 750)).toBe(
        '<speak><p>A</p><break time="750ms"/><p>B</p></speak>',
      );
    });

    it('produces exactly (paragraphs - 1) breaks', () => {
      const text = Array.from({ length: 6 }, (_, i) => `Paragraf ${i + 1}.`).join('\n\n');
      const out = wrapStorytellingSSML(text);
      expect(out.match(/<p>/g)).toHaveLength(6);
      expect(out.match(/<break /g)).toHaveLength(5);
    });
  });

  describe('buildGoogleSynthesisRequest', () => {
    const prosody = { speakingRate: 0.92, pitch: -2 };

    it('Chirp 3 HD voice: plain text, speakingRate, and no pitch anywhere', () => {
      const request = buildGoogleSynthesisRequest(
        'Bir varmış.\n\nBir yokmuş.',
        'tr-TR-Chirp3-HD-Achernar',
        prosody,
      );

      expect(request).toEqual({
        input: { text: 'Bir varmış.\n\nBir yokmuş.' },
        voice: { languageCode: 'tr-TR', name: 'tr-TR-Chirp3-HD-Achernar' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 0.92 },
      });
      expect(Object.keys(request.audioConfig)).not.toContain('pitch');
      expect(JSON.stringify(request)).not.toMatch(/pitch|prosody|<speak>/);
    });

    it('Chirp voice: pitch is left out even when the setting is 0', () => {
      const request = buildGoogleSynthesisRequest('x', 'en-US-Chirp3-HD-Kore', {
        speakingRate: 1,
        pitch: 0,
      });
      expect(request.audioConfig).toEqual({ audioEncoding: 'MP3', speakingRate: 1 });
    });

    it('SSML voice: rate and pitch once in audioConfig, none in the SSML', () => {
      const request = buildGoogleSynthesisRequest(
        'Bir varmış.\n\nBir yokmuş.',
        'tr-TR-Wavenet-A',
        prosody,
      );

      expect(request).toEqual({
        input: {
          ssml: '<speak><p>Bir varmış.</p><break time="500ms"/><p>Bir yokmuş.</p></speak>',
        },
        voice: { languageCode: 'tr-TR', name: 'tr-TR-Wavenet-A' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 0.92, pitch: -2 },
      });
      expect((request.input as { ssml: string }).ssml).not.toMatch(/prosody|rate=|pitch=/);
    });

    it.each([
      [0.1, 0.25],
      [0.25, 0.25],
      [1.3, 1.3],
      [2, 2],
      [3.5, 2],
    ])('clamps speakingRate %p to %p (the range Chirp 3 HD accepts)', (rate, expected) => {
      const request = buildGoogleSynthesisRequest('x', 'tr-TR-Chirp3-HD-Puck', {
        speakingRate: rate,
        pitch: 0,
      });
      expect(request.audioConfig.speakingRate).toBe(expected);
    });

    it.each([
      ['en-US-Chirp3-HD-Aoede', 'en-US'],
      ['de-DE-Standard-B', 'de-DE'],
      ['customvoice', 'tr-TR'],
    ])('derives the language code from voice id %p as %p', (voiceId, languageCode) => {
      expect(buildGoogleSynthesisRequest('x', voiceId, prosody).voice).toEqual({
        languageCode,
        name: voiceId,
      });
    });
  });
});
