import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { CLONE_UPLOAD_MAX_BYTES, CLONE_UPLOAD_MIMETYPES } from './clone-config.constants';

/**
 * Validates one clone upload file (referenceAudio or consentAudio).
 * Messages are i18n keys (errors.cloneUpload.*, served per Accept-Language)
 * next to machine-readable codes:
 *   400 AUDIO_REQUIRED      missing or empty file
 *   400 INVALID_AUDIO_TYPE  mimetype not in CLONE_UPLOAD_MIMETYPES
 *   413 AUDIO_TOO_LARGE     above CLONE_UPLOAD_MAX_BYTES (20 MB)
 */
export function validateCloneUploadFile(file: Express.Multer.File | undefined): void {
  if (!file || !file.size || (file.buffer && file.buffer.length === 0)) {
    throw new BadRequestException({
      code: 'AUDIO_REQUIRED',
      message: 'errors.cloneUpload.audioRequired',
    });
  }

  const mimetype = (file.mimetype || '').toLowerCase().split(';')[0].trim();
  if (!CLONE_UPLOAD_MIMETYPES.includes(mimetype)) {
    throw new BadRequestException({
      code: 'INVALID_AUDIO_TYPE',
      message: 'errors.cloneUpload.invalidType',
    });
  }

  if (file.size > CLONE_UPLOAD_MAX_BYTES) {
    throw new PayloadTooLargeException({
      code: 'AUDIO_TOO_LARGE',
      message: 'errors.cloneUpload.tooLarge',
    });
  }
}

/** Multipart string -> integer ms, or null. DTO already enforced digits only. */
export function parseSpeechStartMs(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number.parseInt(String(raw), 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
