import { describeGlyph, findForbiddenUiGlyphs } from '../../../common/utils/ui-text-rules';
import {
  EMAIL_FIELD_SPECS,
  EMAIL_KIND_SPECS,
  EMAIL_TEMPLATE_FIELD_KEYS,
  EmailRenderContext,
  EmailTemplateFields,
  EmailTemplateKind,
  EmailTemplateLanguage,
} from './email-template.types';

/**
 * The one HTML layout of every Sesly email, in the site's "murekkep" design
 * (sesly-frontend/tailwind.config.js): a dark card on a near-black page, a
 * Baloo 2 heading, Nunito text, a mint pill button sitting on its darker
 * lip, a muted footer. Table based with inline styles and bgcolor
 * attributes so Gmail and Outlook keep the colors; the web fonts load where
 * the client allows and fall back to system fonts elsewhere.
 *
 * Admin edited text only ever reaches the HTML escaped. The only markup a
 * text can produce is a paragraph, a line break, **bold** and the
 * {{link}} anchor, all written here.
 */

export const EMAIL_CONTACT_ADDRESS = 'info@sesly.io';

/** Design tokens (sesly-frontend/tailwind.config.js, palette "murekkep"). */
const C = {
  page: '#08090A',
  surface: '#1F2022',
  surface2: '#2B2D2F',
  line: '#393B3E',
  lip: '#060707',
  text: '#F0F0EC',
  text2: '#BDBDB7',
  text3: '#959691',
  action: '#7ACFBE',
  actionLip: '#33978A',
  onAction: '#0A1D19',
  uyku: '#C3B9E6',
  turk: '#EBC3A3',
  dunya: '#AACAE3',
  egitici: '#BBD8AA',
} as const;

const FONT_DISPLAY = "'Baloo 2', 'Arial Rounded MT Bold', 'Trebuchet MS', Arial, Helvetica, sans-serif";
const FONT_BODY = "Nunito, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const GOOGLE_FONTS =
  'https://fonts.googleapis.com/css2?family=Baloo+2:wght@700&family=Nunito:wght@400;700;800&display=swap';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface RenderOptions {
  /** Public web site, e.g. https://sesly.io (logo image, footer link). */
  webBaseUrl: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PLACEHOLDER = /\{\{\s*([A-Za-z]+)\s*\}\}/g;
const NAME_WITH_LEADING_SPACE = /[^\S\n]*\{\{\s*name\s*\}\}/g;
const BOLD = /\*\*(?=\S)([\s\S]*?\S)\*\*/g;

function hasName(ctx: EmailRenderContext): boolean {
  return typeof ctx.name === 'string' && ctx.name.trim().length > 0;
}

/** Without a name, "Merhaba {{name}}," becomes "Merhaba,". */
function dropMissingName(template: string, ctx: EmailRenderContext): string {
  return hasName(ctx) ? template : template.replace(NAME_WITH_LEADING_SPACE, '');
}

function placeholderValue(name: string, ctx: EmailRenderContext): string | null {
  switch (name) {
    case 'name':
      return hasName(ctx) ? (ctx.name as string).trim() : '';
    case 'email':
      return ctx.email;
    case 'link':
      return ctx.link;
    default:
      return null;
  }
}

/** Plain text: placeholders filled, ** markers removed. */
export function fillPlain(template: string, ctx: EmailRenderContext): string {
  return dropMissingName(normaliseNewlines(template), ctx)
    .replace(BOLD, '$1')
    .replace(PLACEHOLDER, (whole, name: string) => placeholderValue(name, ctx) ?? whole);
}

/**
 * One line or paragraph of HTML: escaped first, then **bold**, then the
 * placeholders (their values escaped too, so a name can never add markup).
 */
function inlineHtml(template: string, ctx: EmailRenderContext, linkColor: string): string {
  return escapeHtml(template)
    .replace(BOLD, `<strong style="color:${C.text};font-weight:800;">$1</strong>`)
    .replace(PLACEHOLDER, (whole, name: string) => {
      const value = placeholderValue(name, ctx);
      if (value === null) return whole;
      if (name === 'link') {
        const href = escapeHtml(value);
        return `<a href="${href}" target="_blank" style="color:${linkColor};text-decoration:underline;word-break:break-all;">${href}</a>`;
      }
      return escapeHtml(value);
    });
}

function normaliseNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function paragraphs(template: string): string[] {
  return normaliseNewlines(template)
    .split(/\n[^\S\n]*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function formattedHtml(
  template: string,
  ctx: EmailRenderContext,
  style: { size: number; lineHeight: number; color: string; gap: number; linkColor: string },
): string {
  const parts = paragraphs(dropMissingName(template, ctx));
  return parts
    .map((p, i) => {
      const lines = p.split('\n').map((line) => inlineHtml(line.trim(), ctx, style.linkColor));
      const margin = i === parts.length - 1 ? 0 : style.gap;
      return `<p style="margin:0 0 ${margin}px 0;font-family:${FONT_BODY};font-size:${style.size}px;line-height:${style.lineHeight}px;color:${style.color};">${lines.join('<br>')}</p>`;
    })
    .join('\n');
}

function host(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** The four category colors of the app as a small strip on top of the card. */
function accentStrip(): string {
  const pill = (color: string) =>
    `<td width="28" height="6" bgcolor="${color}" style="width:28px;height:6px;background-color:${color};border-radius:3px;font-size:0;line-height:0;">&nbsp;</td>`;
  const gap = '<td width="6" style="width:6px;font-size:0;line-height:0;">&nbsp;</td>';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr>${[
    C.uyku,
    C.turk,
    C.dunya,
    C.egitici,
  ]
    .map(pill)
    .join(gap)}</tr></table>`;
}

function button(label: string, link: string): string {
  const href = escapeHtml(link);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0 0;border-collapse:separate;">
<tr><td align="center" bgcolor="${C.action}" style="background-color:${C.action};border-radius:26px;border-bottom:3px solid ${C.actionLip};mso-padding-alt:15px 30px;">
<a href="${href}" target="_blank" style="display:inline-block;padding:15px 30px;font-family:${FONT_BODY};font-size:16px;line-height:22px;font-weight:800;color:${C.onAction};text-decoration:none;border-radius:26px;">${escapeHtml(label)}</a>
</td></tr></table>`;
}

/**
 * Subject, HTML and plain-text version of one email. `fields` are trusted to
 * be validated for saving, but rendering never depends on it: every text is
 * escaped and an empty optional field just leaves its block out.
 */
export function renderEmail(
  language: EmailTemplateLanguage,
  fields: EmailTemplateFields,
  ctx: EmailRenderContext,
  options: RenderOptions,
): RenderedEmail {
  const web = trimSlash(options.webBaseUrl);
  const subject = fillPlain(fields.subject, ctx).replace(/\s+/g, ' ').trim();
  const preheader = fillPlain(fields.preheader, ctx).replace(/\s+/g, ' ').trim();
  const heading = fillPlain(fields.heading, ctx).replace(/\s+/g, ' ').trim();
  const buttonLabel = fields.buttonLabel.replace(/\s+/g, ' ').trim();

  const bodyHtml = formattedHtml(fields.body, ctx, {
    size: 16,
    lineHeight: 26,
    color: C.text2,
    gap: 16,
    linkColor: C.action,
  });
  const noteHtml = fields.note.trim()
    ? formattedHtml(fields.note, ctx, { size: 14, lineHeight: 22, color: C.text3, gap: 10, linkColor: C.action })
    : '';
  const footerHtml = fields.footer.trim()
    ? formattedHtml(fields.footer, ctx, { size: 13, lineHeight: 20, color: C.text3, gap: 8, linkColor: C.text2 })
    : '';

  const html = `<!DOCTYPE html>
<html lang="${language}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, address=no, email=no, date=no">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(subject)}</title>
<link href="${GOOGLE_FONTS}" rel="stylesheet">
<style>
:root { color-scheme: dark; supported-color-schemes: dark; }
body { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: ${C.page}; }
table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
a { color: ${C.action}; }
@media only screen and (max-width: 620px) {
  .sesly-container { width: 100% !important; }
  .sesly-gutter { padding-left: 16px !important; padding-right: 16px !important; }
  .sesly-card-pad { padding: 28px 22px 30px 22px !important; }
  .sesly-heading { font-size: 26px !important; line-height: 32px !important; }
}
</style>
<!--[if mso]><style>body, table, td, p, a { font-family: Arial, Helvetica, sans-serif !important; }</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${C.page};" bgcolor="${C.page}">
${
  preheader
    ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};">${escapeHtml(preheader)}${'&#8204;&nbsp;'.repeat(40)}</div>`
    : ''
}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background-color:${C.page};">
<tr><td align="center" class="sesly-gutter" style="padding:32px 24px 40px 24px;">
<table role="presentation" class="sesly-container" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;">

<tr><td style="padding:0 4px 20px 4px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="44" style="width:44px;vertical-align:middle;"><a href="${escapeHtml(web)}" target="_blank" style="text-decoration:none;"><img src="${escapeHtml(web)}/image/sesly-icon-192.png" width="44" height="44" alt="Sesly" style="display:block;width:44px;height:44px;border-radius:12px;box-shadow:0 3px 0 ${C.lip};"></a></td>
<td style="padding-left:12px;vertical-align:middle;font-family:${FONT_DISPLAY};font-size:30px;line-height:34px;font-weight:700;color:${C.text};">Sesly</td>
</tr></table>
</td></tr>

<tr><td bgcolor="${C.surface}" class="sesly-card-pad" style="background-color:${C.surface};border-radius:24px;border-bottom:3px solid ${C.lip};padding:36px 36px 38px 36px;">
${accentStrip()}
<h1 class="sesly-heading" style="margin:22px 0 18px 0;font-family:${FONT_DISPLAY};font-size:30px;line-height:36px;font-weight:700;color:${C.text};">${escapeHtml(heading)}</h1>
${bodyHtml}
${buttonLabel ? button(buttonLabel, ctx.link) : ''}
${
  noteHtml
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0 0;"><tr><td bgcolor="${C.surface2}" style="background-color:${C.surface2};border-radius:16px;padding:16px 18px;">${noteHtml}</td></tr></table>`
    : ''
}
</td></tr>

<tr><td style="padding:24px 8px 0 8px;">
${footerHtml ? `${footerHtml}\n` : ''}<p style="margin:${footerHtml ? 14 : 0}px 0 0 0;font-family:${FONT_BODY};font-size:13px;line-height:20px;color:${C.text3};"><a href="${escapeHtml(web)}" target="_blank" style="color:${C.text2};font-weight:700;text-decoration:none;">${escapeHtml(host(web))}</a>&nbsp;&nbsp;&nbsp;&nbsp;<a href="mailto:${EMAIL_CONTACT_ADDRESS}" style="color:${C.text2};font-weight:700;text-decoration:none;">${EMAIL_CONTACT_ADDRESS}</a></p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>
`;

  const text = [
    heading,
    paragraphs(fillPlain(fields.body, ctx)).join('\n\n'),
    buttonLabel ? `${buttonLabel}: ${ctx.link}` : '',
    paragraphs(fillPlain(fields.note, ctx)).join('\n\n'),
    paragraphs(fillPlain(fields.footer, ctx)).join('\n\n'),
    `${host(web)}\n${EMAIL_CONTACT_ADDRESS}`,
  ]
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .join('\n\n');

  return { subject, html, text: `${text}\n` };
}

/** Trimmed fields with Unix newlines; missing optional fields become ''. */
export function normaliseEmailTemplateFields(
  input: Partial<Record<keyof EmailTemplateFields, unknown>>,
): EmailTemplateFields {
  const out = {} as EmailTemplateFields;
  for (const key of EMAIL_TEMPLATE_FIELD_KEYS) {
    const value = input[key];
    out[key] = typeof value === 'string' ? normaliseNewlines(value).trim() : '';
  }
  return out;
}

/**
 * Problems that keep a text from being saved, as Turkish sentences for the
 * admin panel (empty = fine): required fields, length, line breaks in a one
 * line field, unknown placeholders and the UI text rules.
 */
export function validateEmailTemplateFields(kind: EmailTemplateKind, fields: EmailTemplateFields): string[] {
  const problems: string[] = [];
  const required = new Set<keyof EmailTemplateFields>(['subject', 'heading', 'body']);
  if (EMAIL_KIND_SPECS[kind].buttonRequired) required.add('buttonLabel');

  for (const spec of EMAIL_FIELD_SPECS) {
    const value = fields[spec.key];
    if (required.has(spec.key) && !value.trim()) {
      problems.push(`${spec.label} boş olamaz.`);
      continue;
    }
    if ([...value].length > spec.maxLength) {
      problems.push(`${spec.label} en fazla ${spec.maxLength} karakter olabilir.`);
    }
    if (!spec.multiline && /\n/.test(value)) {
      problems.push(`${spec.label} tek satır olmalıdır.`);
    }
    const used = [...value.matchAll(PLACEHOLDER)].map((m) => m[1]);
    const unknown = [...new Set(used.filter((p) => !(spec.placeholders as readonly string[]).includes(p)))];
    if (unknown.length > 0) {
      const allowed = spec.placeholders.length
        ? `Bu alanda kullanılabilenler: ${spec.placeholders.map((p) => `{{${p}}}`).join(', ')}.`
        : 'Bu alanda yer tutucu kullanılamaz.';
      problems.push(`${spec.label}: ${unknown.map((p) => `{{${p}}}`).join(', ')} tanınmıyor. ${allowed}`);
    }
    const glyphs = findForbiddenUiGlyphs(value);
    if (glyphs.length > 0) {
      problems.push(
        `${spec.label}: emoji, uzun tire, tek karakterlik üç nokta, ok ve madde işareti gibi karakterler kullanılamaz (${glyphs
          .map(describeGlyph)
          .join(', ')}).`,
      );
    }
  }
  return problems;
}
