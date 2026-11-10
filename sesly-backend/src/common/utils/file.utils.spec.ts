import { BadRequestException } from '@nestjs/common';
import {
  ALLOWED_AUDIO_MIMETYPES,
  MAX_FILE_SIZE,
  generateUniqueFileName,
  sanitizeFilename,
  validateAudioFile,
} from './file.utils';

const file = (overrides: Partial<Express.Multer.File> = {}): Express.Multer.File =>
  ({
    fieldname: 'audio',
    originalname: 'kayit.m4a',
    mimetype: 'audio/m4a',
    size: 1024,
    buffer: Buffer.from('x'),
    ...overrides,
  }) as Express.Multer.File;

describe('file.utils', () => {
  describe('validateAudioFile', () => {
    it('max size is 10 MB', () => {
      expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
    });

    it.each(ALLOWED_AUDIO_MIMETYPES)('accepts %s', (mimetype) => {
      expect(() => validateAudioFile(file({ mimetype }))).not.toThrow();
    });

    it('allows the documented audio types (wav + m4a/aac for iOS/Android recordings)', () => {
      expect(ALLOWED_AUDIO_MIMETYPES).toEqual(
        expect.arrayContaining(['audio/wav', 'audio/mpeg', 'audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/aac']),
      );
    });

    it('rejects a missing file', () => {
      expect(() => validateAudioFile(undefined)).toThrow(BadRequestException);
      expect(() => validateAudioFile(undefined)).toThrow('No file provided');
    });

    it('prefixes messages with the field name', () => {
      expect(() => validateAudioFile(undefined, 'consentAudio')).toThrow('consentAudio No file provided');
      expect(() => validateAudioFile(file({ mimetype: 'text/plain' }), 'consentAudio')).toThrow(
        /^consentAudio Invalid file type/,
      );
    });

    it.each(['audio/ogg', 'video/mp4', 'application/octet-stream', 'text/plain', ''])(
      'rejects mimetype %p',
      (mimetype) => {
        expect(() => validateAudioFile(file({ mimetype }))).toThrow(BadRequestException);
        expect(() => validateAudioFile(file({ mimetype }))).toThrow(/Invalid file type/);
      },
    );

    it('accepts exactly 10 MB and rejects one byte more', () => {
      expect(() => validateAudioFile(file({ size: MAX_FILE_SIZE }))).not.toThrow();
      expect(() => validateAudioFile(file({ size: MAX_FILE_SIZE + 1 }))).toThrow(
        'File size exceeds maximum allowed size of 10MB',
      );
    });

    it('checks the type before the size', () => {
      expect(() => validateAudioFile(file({ mimetype: 'video/mp4', size: MAX_FILE_SIZE * 2 }))).toThrow(
        /Invalid file type/,
      );
    });
  });

  describe('sanitizeFilename', () => {
    it.each([
      ['Örnek Dosya İsmi.mp3', 'ornek-dosya-ismi.mp3'],
      ["Çağla'nın Şarkısı.wav", 'cagla-nin-sarkisi.wav'],
      ['ĞÜŞİÖÇ ğüşıöç.M4A', 'gusioc-gusioc.m4a'],
      ['  __kayit (1)__  .mp3', 'kayit-1.mp3'],
      ['dosya adi', 'dosya-adi'],
      ['a.b.c.wav', 'a-b-c.wav'],
      ['SES.MP3', 'ses.mp3'],
    ])('%p -> %p', (input, expected) => {
      expect(sanitizeFilename(input)).toBe(expected);
    });

    it('output name part only contains [a-z0-9-]', () => {
      const out = sanitizeFilename('Keloğlan & Dev <script> ~!@#$%^&*().wav');
      const [name, ext] = [out.slice(0, out.lastIndexOf('.')), out.slice(out.lastIndexOf('.'))];
      expect(name).toMatch(/^[a-z0-9-]+$/);
      expect(name).not.toMatch(/^-|-$/);
      expect(ext).toBe('.wav');
    });
  });

  describe('generateUniqueFileName', () => {
    let nowSpy: jest.SpyInstance;
    let randomSpy: jest.SpyInstance;

    beforeEach(() => {
      nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.123456789);
    });

    afterEach(() => {
      nowSpy.mockRestore();
      randomSpy.mockRestore();
    });

    const RAND = (0.123456789).toString(36).substring(2, 15);

    it('sanitized: <name>-<timestamp>-<random>.<ext>', () => {
      expect(generateUniqueFileName('Örnek Kayıt.M4A')).toBe(`ornek-kayit-1700000000000-${RAND}.m4a`);
    });

    it('unsanitized: <timestamp>-<random>.<ext> (original name dropped)', () => {
      expect(generateUniqueFileName('test.wav', false)).toBe(`1700000000000-${RAND}.wav`);
    });

    it('no extension: <timestamp>-<random>', () => {
      expect(generateUniqueFileName('kayit')).toBe(`1700000000000-${RAND}`);
    });

    it('produces distinct names for the same input', () => {
      randomSpy.mockRestore();
      const a = generateUniqueFileName('a.wav');
      const b = generateUniqueFileName('a.wav');
      expect(a).not.toBe(b);
    });
  });
});
