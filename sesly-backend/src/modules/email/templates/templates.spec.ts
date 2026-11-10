import { findForbiddenUiGlyphs } from '../../../common/utils/ui-text-rules';
import { DEFAULT_EMAIL_TEMPLATES } from './email-template.defaults';
import {
  escapeHtml,
  fillPlain,
  normaliseEmailTemplateFields,
  renderEmail,
  validateEmailTemplateFields,
} from './email-layout';
import {
  EMAIL_FIELD_SPECS,
  EMAIL_TEMPLATE_FIELD_KEYS,
  EMAIL_TEMPLATE_KINDS,
  EMAIL_TEMPLATE_LANGUAGES,
  EmailTemplateFields,
} from './email-template.types';

const WEB = 'https://sesly.io';
const RESET_LINK = 'https://sesly.io/auth/action?mode=resetPassword&oobCode=abc&apiKey=k&lang=tr';

function fields(overrides: Partial<EmailTemplateFields> = {}): EmailTemplateFields {
  return {
    subject: 'Konu {{name}}',
    preheader: 'Önizleme',
    heading: 'Başlık',
    body: 'Merhaba {{name}},\n\nİkinci paragraf **kalın** ve {{email}}.',
    buttonLabel: 'Devam et',
    note: 'Bağlantı:\n{{link}}',
    footer: 'Alt bilgi',
    ...overrides,
  };
}

describe('email templates', () => {
  describe('code defaults', () => {
    it('exist for every kind and language with every field', () => {
      for (const kind of EMAIL_TEMPLATE_KINDS) {
        for (const language of EMAIL_TEMPLATE_LANGUAGES) {
          const t = DEFAULT_EMAIL_TEMPLATES[kind][language];
          expect(Object.keys(t).sort()).toEqual([...EMAIL_TEMPLATE_FIELD_KEYS].sort());
        }
      }
    });

    it('pass the same validation as a panel save (text rules included)', () => {
      for (const kind of EMAIL_TEMPLATE_KINDS) {
        for (const language of EMAIL_TEMPLATE_LANGUAGES) {
          expect({ kind, language, problems: validateEmailTemplateFields(kind, DEFAULT_EMAIL_TEMPLATES[kind][language]) }).toEqual({
            kind,
            language,
            problems: [],
          });
        }
      }
    });

    it('Turkish texts use Turkish letters (no ASCII stand-ins)', () => {
      const tr = JSON.stringify(EMAIL_TEMPLATE_KINDS.map((k) => DEFAULT_EMAIL_TEMPLATES[k].tr));
      expect(tr).toMatch(/[şğıüöçİ]/);
      for (const asciiStandIn of ['Sifre', 'sifre', 'hos geldin', 'Hosgeldin', 'icin', 'baglanti']) {
        expect(tr).not.toContain(asciiStandIn);
      }
    });

    it('the password reset texts put the link in the button and in the note', () => {
      for (const language of EMAIL_TEMPLATE_LANGUAGES) {
        const t = DEFAULT_EMAIL_TEMPLATES.password_reset[language];
        expect(t.buttonLabel).not.toBe('');
        expect(t.note).toContain('{{link}}');
      }
    });
  });

  describe('renderEmail', () => {
    const ctx = { name: 'Ayşe', email: 'ayse@example.com', link: RESET_LINK };

    it('is a dark, table based HTML document in the Sesly design', () => {
      const { html } = renderEmail('tr', fields(), ctx, { webBaseUrl: WEB });
      expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
      expect(html).toContain('<html lang="tr"');
      expect(html).toContain('<meta charset="utf-8">');
      expect(html).toContain('<meta name="color-scheme" content="dark">');
      expect(html).toContain('bgcolor="#08090A"'); // page
      expect(html).toContain('bgcolor="#1F2022"'); // card
      expect(html).toContain('border-bottom:3px solid #060707'); // card lip
      expect(html).toContain('bgcolor="#7ACFBE"'); // mint button
      expect(html).toContain('border-bottom:3px solid #33978A'); // button lip
      expect(html).toContain('color:#0A1D19'); // text on the button
      expect(html).toContain("'Baloo 2'");
      expect(html).toContain('Nunito');
      expect(html).toContain('src="https://sesly.io/image/sesly-icon-192.png"');
      expect(html).toContain('href="mailto:info@sesly.io"');
      expect(html).toContain('role="presentation"');
    });

    it('button and note both carry the link; subject and name are filled in', () => {
      const { html, subject } = renderEmail('tr', fields(), ctx, { webBaseUrl: WEB });
      const escapedLink = escapeHtml(RESET_LINK);
      expect(html).toContain(`<a href="${escapedLink}" target="_blank" style="display:inline-block;`);
      expect(html).toContain(`>${escapedLink}</a>`);
      expect(html).toContain('>Devam et</a>');
      expect(subject).toBe('Konu Ayşe');
      expect(html).toContain('Merhaba Ayşe,');
      expect(html).toContain('<strong style="color:#F0F0EC;font-weight:800;">kalın</strong>');
    });

    it('paragraphs on empty lines, line breaks on single newlines', () => {
      const { html } = renderEmail('tr', fields(), ctx, { webBaseUrl: WEB });
      expect(html.match(/<p style="margin:0 0 16px 0;/g)).toHaveLength(1); // first body paragraph
      expect(html).toContain('Bağlantı:<br><a href=');
    });

    it('without a name the placeholder goes with the space before it', () => {
      const { html, subject, text } = renderEmail('tr', fields(), { ...ctx, name: '  ' }, { webBaseUrl: WEB });
      expect(html).toContain('Merhaba,');
      expect(subject).toBe('Konu');
      expect(text).toContain('Merhaba,');
      expect(html).not.toContain('{{name}}');
    });

    it('escapes user values and admin text: no markup can be injected', () => {
      const evil = renderEmail(
        'en',
        fields({
          heading: '<script>alert(1)</script>',
          body: 'Hi {{name}} <img src=x onerror=alert(1)> **<b>x</b>**',
          buttonLabel: '"><a href="https://evil.test">',
        }),
        { name: '<b onclick="x">Eve</b>', email: '"quote"@example.com', link: 'https://sesly.io/a?x="y"&z=<1>' },
        { webBaseUrl: WEB },
      );
      expect(evil.html).not.toContain('<script>');
      expect(evil.html).not.toContain('<img src=x');
      expect(evil.html).not.toContain('<b onclick');
      expect(evil.html).not.toContain('<b>x</b>');
      expect(evil.html).not.toContain('href="https://evil.test"');
      expect(evil.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(evil.html).toContain('&lt;b onclick=&quot;x&quot;&gt;Eve&lt;/b&gt;');
      expect(evil.html).toContain('href="https://sesly.io/a?x=&quot;y&quot;&amp;z=&lt;1&gt;"');
    });

    it('a value that looks like **bold** or a placeholder stays literal', () => {
      const { html } = renderEmail('tr', fields({ body: 'Merhaba {{name}}' }), { ...ctx, name: '**{{email}}**' }, { webBaseUrl: WEB });
      expect(html).toContain('Merhaba **{{email}}**');
    });

    it('empty optional fields leave their block out', () => {
      const { html, text } = renderEmail(
        'tr',
        fields({ preheader: '', buttonLabel: '', note: '', footer: '' }),
        ctx,
        { webBaseUrl: WEB },
      );
      expect(html).not.toContain('bgcolor="#7ACFBE"');
      expect(html).not.toContain('bgcolor="#2B2D2F"');
      expect(html).not.toContain('mso-hide:all');
      expect(text).not.toContain('Devam et');
    });

    it('plain-text version: heading, body without markers, button with link, note, footer, contact', () => {
      const { text } = renderEmail('tr', fields(), ctx, { webBaseUrl: WEB });
      expect(text).toBe(
        [
          'Başlık',
          'Merhaba Ayşe,\n\nİkinci paragraf kalın ve ayse@example.com.',
          `Devam et: ${RESET_LINK}`,
          `Bağlantı:\n${RESET_LINK}`,
          'Alt bilgi',
          'sesly.io\ninfo@sesly.io',
        ].join('\n\n') + '\n',
      );
    });

    it('every default renders without leftover placeholders or forbidden glyphs, in both languages', () => {
      for (const kind of EMAIL_TEMPLATE_KINDS) {
        for (const language of EMAIL_TEMPLATE_LANGUAGES) {
          for (const name of ['Ayşe', null]) {
            const out = renderEmail(language, DEFAULT_EMAIL_TEMPLATES[kind][language], { ...ctx, name }, { webBaseUrl: WEB });
            for (const part of [out.subject, out.html, out.text]) {
              expect(part).not.toMatch(/\{\{|\}\}/);
              expect(findForbiddenUiGlyphs(part.replace(/&#8204;/g, ''))).toEqual([]);
            }
            expect(out.html).toContain(`lang="${language}"`);
          }
        }
      }
    });
  });

  describe('fillPlain', () => {
    it('fills placeholders, drops ** markers, keeps unknown placeholders', () => {
      expect(fillPlain('**Hi** {{name}} {{other}}', { name: 'Ali', email: 'a@b.co', link: 'L' })).toBe('Hi Ali {{other}}');
    });
  });

  describe('normaliseEmailTemplateFields', () => {
    it('trims, uses Unix newlines and fills missing fields with empty strings', () => {
      expect(normaliseEmailTemplateFields({ subject: '  S  ', body: 'a\r\n\r\nb', note: 5 as any })).toEqual({
        subject: 'S',
        preheader: '',
        heading: '',
        body: 'a\n\nb',
        buttonLabel: '',
        note: '',
        footer: '',
      });
    });
  });

  describe('validateEmailTemplateFields', () => {
    it('required: subject, heading, body; the button only for password_reset', () => {
      const empty = normaliseEmailTemplateFields({});
      expect(validateEmailTemplateFields('welcome', empty)).toEqual([
        'Konu boş olamaz.',
        'Başlık boş olamaz.',
        'Metin boş olamaz.',
      ]);
      expect(validateEmailTemplateFields('password_reset', empty)).toContain('Buton yazısı boş olamaz.');
      expect(validateEmailTemplateFields('welcome', fields({ buttonLabel: '' }))).toEqual([]);
    });

    it('length limits per field', () => {
      const subject = EMAIL_FIELD_SPECS.find((s) => s.key === 'subject')!;
      expect(validateEmailTemplateFields('welcome', fields({ subject: 'a'.repeat(subject.maxLength) }))).toEqual([]);
      expect(validateEmailTemplateFields('welcome', fields({ subject: 'a'.repeat(subject.maxLength + 1) }))).toEqual([
        `Konu en fazla ${subject.maxLength} karakter olabilir.`,
      ]);
    });

    it('one line fields reject line breaks', () => {
      expect(validateEmailTemplateFields('welcome', fields({ heading: 'a\nb' }))).toEqual(['Başlık tek satır olmalıdır.']);
    });

    it('unknown or misplaced placeholders are rejected with the allowed list', () => {
      const [problem] = validateEmailTemplateFields('welcome', fields({ body: 'Merhaba {{firstName}}' }));
      expect(problem).toBe('Metin: {{firstName}} tanınmıyor. Bu alanda kullanılabilenler: {{name}}, {{email}}, {{link}}.');
      expect(validateEmailTemplateFields('welcome', fields({ subject: 'Bak {{link}}' }))[0]).toContain('{{link}} tanınmıyor');
      expect(validateEmailTemplateFields('welcome', fields({ buttonLabel: '{{name}}' }))[0]).toBe(
        'Buton yazısı: {{name}} tanınmıyor. Bu alanda yer tutucu kullanılamaz.',
      );
    });

    it('UI text rules: emoji, em dash, unicode ellipsis, arrows and bullets are rejected; three dots are fine', () => {
      const emDash = String.fromCharCode(0x2014);
      const ellipsis = String.fromCharCode(0x2026);
      const arrow = String.fromCharCode(0x2192);
      const bullet = String.fromCharCode(0x2022);
      const moon = String.fromCodePoint(0x1f319);
      for (const bad of [emDash, ellipsis, arrow, bullet, moon]) {
        const problems = validateEmailTemplateFields('welcome', fields({ body: `Merhaba ${bad} dünya` }));
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/^Metin: emoji, uzun tire/);
      }
      expect(validateEmailTemplateFields('welcome', fields({ body: 'Yükleniyor... - tamam' }))).toEqual([]);
    });
  });
});
