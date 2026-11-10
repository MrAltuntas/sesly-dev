import { BadRequestException } from '@nestjs/common';

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const ALLOWED_AUDIO_MIMETYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/mp3',
  'audio/m4a',
  'audio/x-m4a',
  'audio/mp4',
  'audio/aac',
];

/**
 * Validates uploaded audio files
 * Checks mimetype and file size
 */
export function validateAudioFile(file: Express.Multer.File | undefined, fieldName?: string): void {
  if (!file) {
    throw new BadRequestException(`${fieldName ? fieldName + ' ' : ''}No file provided`);
  }

  if (!ALLOWED_AUDIO_MIMETYPES.includes(file.mimetype)) {
    throw new BadRequestException(
      `${fieldName ? fieldName + ' ' : ''}Invalid file type. Allowed types: ${ALLOWED_AUDIO_MIMETYPES.join(', ')}`,
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new BadRequestException(
      `${fieldName ? fieldName + ' ' : ''}File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    );
  }
}

/**
 * Sanitizes filename by removing Turkish characters and special characters
 * Converts Turkish characters to their ASCII equivalents
 * Replaces special characters with hyphens
 *
 * @param filename The original filename
 * @returns Sanitized filename
 *
 * @example
 * sanitizeFilename('Örnek Dosya İsmi.mp3') // returns 'ornek-dosya-ismi.mp3'
 * sanitizeFilename('Çağla\'nın Şarkısı.wav') // returns 'caglanin-sarkisi.wav'
 */
export function sanitizeFilename(filename: string): string {
  const turkishMap: Record<string, string> = {
    ç: 'c',
    Ç: 'C',
    ğ: 'g',
    Ğ: 'G',
    ı: 'i',
    İ: 'I',
    ö: 'o',
    Ö: 'O',
    ş: 's',
    Ş: 'S',
    ü: 'u',
    Ü: 'U',
  };

  const lastDotIndex = filename.lastIndexOf('.');
  const ext = lastDotIndex !== -1 ? filename.substring(lastDotIndex) : '';
  let nameWithoutExt =
    lastDotIndex !== -1 ? filename.substring(0, lastDotIndex) : filename;

  // Replace Turkish characters and sanitize
  nameWithoutExt = nameWithoutExt
    .split('')
    .map((char) => turkishMap[char] || char)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphen
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

  return nameWithoutExt + ext.toLowerCase();
}

/**
 * Generates unique filename with timestamp and random string
 * Optionally sanitizes the original filename first
 *
 * @param originalName The original filename
 * @param sanitize Whether to sanitize Turkish characters (default: true)
 * @returns Unique filename
 *
 * @example
 * generateUniqueFileName('örnek.mp3') // returns 'ornek-1234567890-abc123.mp3'
 * generateUniqueFileName('test.wav', false) // returns '1234567890-abc123.wav'
 */
export function generateUniqueFileName(
  originalName: string,
  sanitize = true,
): string {
  const processedName = sanitize ? sanitizeFilename(originalName) : originalName;
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);

  const lastDotIndex = processedName.lastIndexOf('.');
  const extension = lastDotIndex !== -1 ? processedName.substring(lastDotIndex + 1) : '';
  const nameWithoutExt =
    lastDotIndex !== -1 ? processedName.substring(0, lastDotIndex) : processedName;

  if (extension) {
    return sanitize
      ? `${nameWithoutExt}-${timestamp}-${randomString}.${extension}`
      : `${timestamp}-${randomString}.${extension}`;
  }

  return `${timestamp}-${randomString}`;
}
