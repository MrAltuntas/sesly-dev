import { BadRequestException } from '@nestjs/common';
import { StoryOrigin, StoryRightsBasis } from '../../common/enums/prisma.enums';

/**
 * What a story must carry before it can be PUBLISHED.
 *
 * Every story needs an origin and a text fidelity. A text we did not write
 * ourselves (public domain, folk tale, licensed) additionally needs the
 * legal ground it is published on, where it was taken from, and who it is
 * credited to (a folk tale has no author, its origin is the credit).
 *
 * A text published under CC BY (rightsBasis CC_BY) is only usable with its
 * attribution and the licence name, so both are required as well: the app
 * shows them under "Kaynak ve lisans".
 */
export const RIGHTS_REQUIRED_ORIGINS: readonly string[] = [
  StoryOrigin.PUBLIC_DOMAIN,
  StoryOrigin.FOLK_ANONYMOUS,
  StoryOrigin.LICENSED,
];

/** Fields a CC BY text needs on top of the rules above. */
export const CC_BY_REQUIRED_FIELDS: readonly string[] = ['attribution', 'licenseName'];

export const STORY_PUBLISH_REQUIREMENTS_CODE = 'STORY_PUBLISH_REQUIREMENTS';

export interface PublishCheckSource {
  origin?: string | null;
  textFidelity?: string | null;
  rightsBasis?: string | null;
  sourceUrl?: string | null;
  sourceName?: string | null;
  authorName?: string | null;
  collectorName?: string | null;
  attribution?: string | null;
  licenseName?: string | null;
}

export interface MissingPublishField {
  /**
   * Stable key for the admin UI: origin | textFidelity | rightsBasis |
   * source | attribution (author or collector) | ccAttribution | ccLicense.
   */
  field: string;
  /** Turkish label used in the error message. */
  label: string;
}

const filled = (value?: string | null): boolean => typeof value === 'string' && value.trim() !== '';

export function missingPublishFields(story: PublishCheckSource): MissingPublishField[] {
  const missing: MissingPublishField[] = [];

  if (!story.origin) missing.push({ field: 'origin', label: 'Köken' });
  if (!story.textFidelity) missing.push({ field: 'textFidelity', label: 'Metin sadakati' });

  if (story.origin && RIGHTS_REQUIRED_ORIGINS.includes(story.origin)) {
    if (!story.rightsBasis) missing.push({ field: 'rightsBasis', label: 'Hak dayanağı' });
    if (!filled(story.sourceUrl) && !filled(story.sourceName)) {
      missing.push({ field: 'source', label: 'Kaynak (kaynak adı ya da kaynak bağlantısı)' });
    }
    const credited =
      filled(story.authorName) ||
      filled(story.collectorName) ||
      story.origin === StoryOrigin.FOLK_ANONYMOUS;
    if (!credited) missing.push({ field: 'attribution', label: 'Yazar ya da derleyen' });
  }

  // Whatever the origin: a CC BY text without its credit breaks the licence.
  if (story.rightsBasis === StoryRightsBasis.CC_BY) {
    if (!filled(story.attribution)) {
      missing.push({ field: 'ccAttribution', label: 'Atıf metni (CC BY lisansı için zorunlu)' });
    }
    if (!filled(story.licenseName)) {
      missing.push({ field: 'ccLicense', label: 'Lisans adı (CC BY lisansı için zorunlu)' });
    }
  }

  return missing;
}

/** The Turkish refusal of a publish that lacks `missing`. */
export function publishRefusalMessage(missing: MissingPublishField[]): string {
  return `Masal yayınlanamaz. Eksik alanlar: ${missing.map((m) => m.label).join(', ')}.`;
}

/**
 * Throws a coded 400 that lists what is missing:
 * `{ code: 'STORY_PUBLISH_REQUIREMENTS', message, missing: string[] }`.
 */
export function assertStoryPublishable(story: PublishCheckSource): void {
  const missing = missingPublishFields(story);
  if (missing.length === 0) return;
  throw new BadRequestException({
    code: STORY_PUBLISH_REQUIREMENTS_CODE,
    message: publishRefusalMessage(missing),
    missing: missing.map((m) => m.field),
  });
}
