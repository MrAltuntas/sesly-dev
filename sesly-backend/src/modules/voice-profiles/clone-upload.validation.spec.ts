import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { parseSpeechStartMs, validateCloneUploadFile } from './clone-upload.validation';
import { UploadSamplesDto } from './dto/upload-samples.dto';
import { CLONE_UPLOAD_MAX_BYTES } from './clone-config.constants';

const file = (overrides: Partial<Express.Multer.File> = {}) =>
  ({
    originalname: 'reference.m4a',
    mimetype: 'audio/m4a',
    size: 1024,
    buffer: Buffer.from('x'),
    ...overrides,
  }) as Express.Multer.File;

const codeOf = (fn: () => void) => {
  try {
    fn();
    return null;
  } catch (e: any) {
    return { type: e.constructor, body: e.getResponse() };
  }
};

describe('clone upload validation', () => {
  it('accepts every contract mimetype (m4a/mp4/aac/wav variants)', () => {
    for (const mimetype of [
      'audio/m4a',
      'audio/mp4',
      'audio/x-m4a',
      'audio/aac',
      'audio/wav',
      'audio/x-wav',
      'audio/wave',
      'AUDIO/WAV',
    ]) {
      expect(() => validateCloneUploadFile(file({ mimetype }))).not.toThrow();
    }
  });

  it('rejects other types with 400 INVALID_AUDIO_TYPE', () => {
    for (const mimetype of ['audio/mpeg', 'video/mp4', 'application/octet-stream', '']) {
      const err = codeOf(() => validateCloneUploadFile(file({ mimetype })));
      expect(err?.type).toBe(BadRequestException);
      expect(err?.body).toMatchObject({ code: 'INVALID_AUDIO_TYPE' });
    }
  });

  it('missing / empty file -> 400 AUDIO_REQUIRED', () => {
    expect(codeOf(() => validateCloneUploadFile(undefined))?.body).toMatchObject({ code: 'AUDIO_REQUIRED' });
    expect(codeOf(() => validateCloneUploadFile(file({ size: 0 })))?.body).toMatchObject({ code: 'AUDIO_REQUIRED' });
  });

  it('above 20 MB -> 413 AUDIO_TOO_LARGE', () => {
    expect(() => validateCloneUploadFile(file({ size: CLONE_UPLOAD_MAX_BYTES }))).not.toThrow();
    const err = codeOf(() => validateCloneUploadFile(file({ size: CLONE_UPLOAD_MAX_BYTES + 1 })));
    expect(err?.type).toBe(PayloadTooLargeException);
    expect(err?.body).toMatchObject({ code: 'AUDIO_TOO_LARGE' });
  });

  it('parseSpeechStartMs: multipart string -> integer or null', () => {
    expect(parseSpeechStartMs('850')).toBe(850);
    expect(parseSpeechStartMs('0')).toBe(0);
    expect(parseSpeechStartMs(undefined)).toBeNull();
    expect(parseSpeechStartMs('')).toBeNull();
  });

  it('UploadSamplesDto: consentVersion + speechStartMs only, speechStartMs digits only', async () => {
    const check = (body: object) =>
      validate(plainToInstance(UploadSamplesDto, body) as object, { whitelist: true, forbidNonWhitelisted: true });

    expect(await check({ consentVersion: '2026-09-v1', speechStartMs: '850' })).toHaveLength(0);
    expect(await check({})).toHaveLength(0); // consent is enforced by the service (CONSENT_REQUIRED)
    expect((await check({ speechStartMs: '-5' })).length).toBeGreaterThan(0);
    expect((await check({ speechStartMs: '1.5' })).length).toBeGreaterThan(0);
    expect((await check({ consentVersion: '2026-09-v1', other: 'x' })).length).toBeGreaterThan(0);
  });
});
