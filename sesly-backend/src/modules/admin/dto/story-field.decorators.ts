import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CONTENT_WARNINGS,
  CONTENT_WARNING_LABELS,
  ContentWarning,
} from '../../../common/constants/content-warnings';

/**
 * Property decorators for the optional story fields of the admin create /
 * update DTOs. Those endpoints are multipart (cover upload), so every value
 * arrives as a string and "clear this field" arrives as an empty string:
 * the transforms turn a blank into null (which @IsOptional lets through and
 * the service writes as NULL) and numeric strings into numbers.
 *
 * Messages are Turkish and name the field, because the panel shows them.
 */

/** Trimmed string; a blank becomes null. Non-strings are left for the validator. */
export function blankToNull(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** "1875" becomes 1875; a blank becomes null; anything else is left for the validator. */
export function toIntOrNull(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : value;
}

/** Upper-cased enum value; a blank becomes null. */
export function toEnumOrNull(value: unknown): unknown {
  const cleaned = blankToNull(value);
  return typeof cleaned === 'string' ? cleaned.toUpperCase() : cleaned;
}

export function OptionalText(label: string, maxLength: number) {
  return applyDecorators(
    ApiPropertyOptional({ description: label, nullable: true, maxLength }),
    IsOptional(),
    Transform(({ value }) => blankToNull(value)),
    IsString({ message: `${label} metin olmalıdır.` }),
    MaxLength(maxLength, { message: `${label} en fazla ${maxLength} karakter olabilir.` }),
  );
}

export function OptionalUrl(label: string) {
  return applyDecorators(
    ApiPropertyOptional({ description: label, nullable: true }),
    IsOptional(),
    Transform(({ value }) => blankToNull(value)),
    IsUrl(
      { protocols: ['http', 'https'], require_protocol: true },
      { message: `${label} http ya da https ile başlayan geçerli bir bağlantı olmalıdır.` },
    ),
    MaxLength(2000, { message: `${label} en fazla 2000 karakter olabilir.` }),
  );
}

/** A calendar year. Negative years (BCE) are allowed for ancient sources. */
export const YEAR_MIN = -3000;
export const YEAR_MAX = 2100;

export function OptionalYear(label: string) {
  return applyDecorators(
    ApiPropertyOptional({ description: label, nullable: true, example: 1875 }),
    IsOptional(),
    Transform(({ value }) => toIntOrNull(value)),
    IsInt({ message: `${label} tam sayı olmalıdır.` }),
    Min(YEAR_MIN, { message: `${label} ${YEAR_MIN} ile ${YEAR_MAX} arasında olmalıdır.` }),
    Max(YEAR_MAX, { message: `${label} ${YEAR_MIN} ile ${YEAR_MAX} arasında olmalıdır.` }),
  );
}

export function OptionalEnum(label: string, values: Record<string, string>) {
  return applyDecorators(
    ApiPropertyOptional({ description: label, nullable: true, enum: Object.values(values) }),
    IsOptional(),
    Transform(({ value }) => toEnumOrNull(value)),
    IsEnum(values, {
      message: `${label} şu değerlerden biri olmalıdır: ${Object.values(values).join(', ')}.`,
    }),
  );
}

export function OptionalDate(label: string) {
  return applyDecorators(
    ApiPropertyOptional({ description: `${label} (ISO 8601)`, nullable: true }),
    IsOptional(),
    Transform(({ value }) => blankToNull(value)),
    IsISO8601({}, { message: `${label} geçerli bir tarih olmalıdır (ISO 8601).` }),
  );
}

/**
 * Content warnings (enum ContentWarning): an array, or (multipart form) one
 * comma separated string; values are trimmed and upper-cased like the other
 * enum fields, blanks and repeats dropped, so "" clears the list.
 */
export function OptionalContentWarnings() {
  const keys = CONTENT_WARNINGS;
  return applyDecorators(
    ApiPropertyOptional({
      type: [String],
      enum: keys,
      description: `Content warnings: ${keys.map((k) => `${k} (${CONTENT_WARNING_LABELS[k]})`).join(', ')}`,
    }),
    IsOptional(),
    Transform(({ value }) => {
      const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : value;
      return Array.isArray(items)
        ? [
            ...new Set(
              items.map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v)).filter((v) => v !== ''),
            ),
          ]
        : items;
    }),
    IsArray({ message: 'İçerik uyarıları bir dizi olmalıdır.' }),
    ArrayMaxSize(keys.length, { message: `En fazla ${keys.length} içerik uyarısı olabilir.` }),
    IsEnum(ContentWarning, {
      each: true,
      message: `İçerik uyarısı şu değerlerden biri olmalıdır: ${keys.join(', ')}.`,
    }),
  );
}
