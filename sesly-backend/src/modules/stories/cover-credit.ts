import { BadRequestException } from '@nestjs/common';

/**
 * Credit of a cover picture (Story.coverCredit, JSON).
 *
 * Covers made for Sesly need none. An illustration taken from a CC BY book
 * or from the public domain does: who drew it, under which licence, where it
 * comes from, or the attribution sentence the source asks for. The credit
 * belongs to the picture, so it is written wherever the cover is written
 * (the whole tale, "Bu kapağı tüm dillere ve bölümlere uygula") and a story
 * that borrows a cover borrows its credit.
 *
 * Clients get one plain text line (`credit.coverCredit`), shown in the app
 * under "Kaynak ve lisans" as "Kapak resmi: ...". Links in it stay text, the
 * app never opens them (same rule as the text attribution).
 */
export interface CoverCredit {
  illustrator?: string;
  licenseName?: string;
  licenseUrl?: string;
  source?: string;
  attribution?: string;
}

export const COVER_CREDIT_INVALID = 'COVER_CREDIT_INVALID';

const LIMITS: Record<keyof CoverCredit, number> = {
  illustrator: 300,
  licenseName: 200,
  licenseUrl: 500,
  source: 1000,
  attribution: 2000,
};

const LABELS: Record<keyof CoverCredit, string> = {
  illustrator: 'Kapak resminin çizeri',
  licenseName: 'Kapak resminin lisansı',
  licenseUrl: 'Kapak resminin lisans bağlantısı',
  source: 'Kapak resminin kaynağı',
  attribution: 'Kapak resminin atıf metni',
};

/**
 * Names accepted for each field. The second spelling is the one of the
 * `<slug>.credit.json` files next to the batch images (licence, licenceUrl),
 * so such a file can be sent as it is; unknown keys (width, height,
 * illustratorDeathYear) are ignored.
 */
const ALIASES: Record<keyof CoverCredit, string[]> = {
  illustrator: ['illustrator'],
  licenseName: ['licenseName', 'licence', 'license', 'licenceName'],
  licenseUrl: ['licenseUrl', 'licenceUrl'],
  source: ['source'],
  attribution: ['attribution'],
};

const FIELDS = Object.keys(LIMITS) as Array<keyof CoverCredit>;

function invalid(message: string): BadRequestException {
  return new BadRequestException({ code: COVER_CREDIT_INVALID, message });
}

/**
 * A credit from a request (an object or its JSON text) as it will be
 * stored: trimmed, known fields only, null when nothing is left. A blank
 * value or an empty object clears the credit. Throws a coded 400 for a value
 * that is not text, a text that is too long or a licence link that is not
 * http(s).
 */
export function normalizeCoverCredit(raw: unknown): CoverCredit | null {
  if (raw === undefined || raw === null) return null;
  let value: unknown = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return null;
    try {
      value = JSON.parse(text);
    } catch {
      throw invalid('Kapak resmi künyesi geçerli bir JSON değil.');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('Kapak resmi künyesi bir nesne olmalıdır.');
  }
  const input = value as Record<string, unknown>;
  const credit: CoverCredit = {};
  for (const field of FIELDS) {
    const key = ALIASES[field].find((alias) => input[alias] !== undefined && input[alias] !== null);
    if (!key) continue;
    const item = input[key];
    if (typeof item !== 'string') throw invalid(`${LABELS[field]} metin olmalıdır.`);
    const text = item.trim();
    if (!text) continue;
    if (text.length > LIMITS[field]) {
      throw invalid(`${LABELS[field]} en fazla ${LIMITS[field]} karakter olabilir.`);
    }
    if (field === 'licenseUrl' && !/^https?:\/\/\S+$/i.test(text)) {
      throw invalid(`${LABELS[field]} http ya da https ile başlayan bir adres olmalıdır.`);
    }
    credit[field] = text;
  }
  return Object.keys(credit).length > 0 ? credit : null;
}

/** A stored value read back (never throws: a bad row is treated as no credit). */
export function readCoverCredit(stored: unknown): CoverCredit | null {
  try {
    return normalizeCoverCredit(stored);
  } catch {
    return null;
  }
}

/**
 * The plain line clients show after "Kapak resmi:". The attribution, when
 * given, already says everything and is used as it is; otherwise the
 * illustrator, the licence (with its link as text) and the source.
 */
export function coverCreditLine(stored: unknown): string | null {
  const credit = readCoverCredit(stored);
  if (!credit) return null;
  if (credit.attribution) return credit.attribution;
  const licence = credit.licenseName
    ? credit.licenseUrl
      ? `${credit.licenseName} (${credit.licenseUrl})`
      : credit.licenseName
    : credit.licenseUrl;
  const parts = [credit.illustrator, licence, credit.source].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}
