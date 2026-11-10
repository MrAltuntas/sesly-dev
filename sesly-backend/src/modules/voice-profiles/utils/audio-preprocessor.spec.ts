import {
  buildPreprocessArgs,
  wavDurationSeconds,
  SPEECH_START_PADDING_MS,
  TARGET_SAMPLE_RATE,
} from './audio-preprocessor';

/** Minimal PCM16 mono WAV with an optional LIST chunk before `data`. */
function makeWav(seconds: number, withList = false): Buffer {
  const dataBytes = Math.round(seconds * TARGET_SAMPLE_RATE * 2);
  const fmt = Buffer.alloc(8 + 16);
  fmt.write('fmt ', 0, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8); // PCM
  fmt.writeUInt16LE(1, 10); // mono
  fmt.writeUInt32LE(TARGET_SAMPLE_RATE, 12);
  fmt.writeUInt32LE(TARGET_SAMPLE_RATE * 2, 16); // byte rate
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const list = Buffer.alloc(withList ? 8 + 26 : 0);
  if (withList) {
    list.write('LIST', 0, 'ascii');
    list.writeUInt32LE(26, 4);
    list.write('INFOISFT', 8, 'ascii');
  }
  const dataHeader = Buffer.alloc(8);
  dataHeader.write('data', 0, 'ascii');
  dataHeader.writeUInt32LE(dataBytes, 4);
  const body = Buffer.concat([fmt, list, dataHeader, Buffer.alloc(dataBytes)]);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(4 + body.length, 4);
  riff.write('WAVE', 8, 'ascii');
  return Buffer.concat([riff, body]);
}

describe('audio preprocessor', () => {
  describe('buildPreprocessArgs', () => {
    it('default: WAV pcm_s16le mono 44.1 kHz, capped at 60 s, no filters, no trim', () => {
      const args = buildPreprocessArgs();
      expect(args.inputOptions).toEqual([]);
      expect(args.startMs).toBe(0);
      const out = args.outputOptions.join(' ');
      expect(out).toContain('-ac 1');
      expect(out).toContain('-ar 44100');
      expect(out).toContain('-c:a pcm_s16le');
      expect(out).toContain('-f wav');
      expect(out).toContain('-t 60');
      // Cartesia wants the clip as recorded: no highpass/loudnorm/silenceremove.
      expect(out).not.toMatch(/-af|-filter|highpass|loudnorm|silenceremove/);
    });

    it('trims leading silence to speechStartMs minus 250 ms (input seek)', () => {
      const args = buildPreprocessArgs({ speechStartMs: 1850 });
      expect(args.startMs).toBe(1850 - SPEECH_START_PADDING_MS);
      expect(args.inputOptions).toEqual(['-ss', '1.600']);
    });

    it('onset within the padding window or invalid -> no trim', () => {
      for (const speechStartMs of [0, 100, 250, -5, NaN, null, undefined]) {
        const args = buildPreprocessArgs({ speechStartMs: speechStartMs as any });
        expect(args.inputOptions).toEqual([]);
        expect(args.startMs).toBe(0);
      }
    });

    it('maxDurationSec null disables the cap (admin sandbox skip mode)', () => {
      const args = buildPreprocessArgs({ maxDurationSec: null });
      expect(args.outputOptions).not.toContain('-t');
      expect(buildPreprocessArgs({ maxDurationSec: 30 }).outputOptions.join(' ')).toContain('-t 30');
    });
  });

  describe('wavDurationSeconds', () => {
    it('reads the data chunk, also after a LIST chunk', () => {
      expect(wavDurationSeconds(makeWav(12.5))).toBeCloseTo(12.5, 3);
      expect(wavDurationSeconds(makeWav(9.2, true))).toBeCloseTo(9.2, 3);
    });

    it('clamps an unfinished (placeholder) data size to the bytes present', () => {
      const wav = makeWav(3);
      const dataSizeOffset = wav.indexOf('data') + 4;
      wav.writeUInt32LE(0xffffffff, dataSizeOffset);
      expect(wavDurationSeconds(wav)).toBeCloseTo(3, 3);
    });

    it('falls back to a header estimate for non-RIFF input', () => {
      expect(wavDurationSeconds(Buffer.alloc(44 + TARGET_SAMPLE_RATE * 2))).toBeCloseTo(1, 3);
    });
  });
});
