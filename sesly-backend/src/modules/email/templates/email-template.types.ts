import { UI_LANGUAGES, UiLanguage } from '../../../common/i18n/ui-language';

/**
 * Service emails Sesly sends, each with one text per language. The texts
 * are editable in the admin panel (table `email_templates`, an override of
 * the code defaults in email-template.defaults.ts); the HTML layout is code
 * (email-layout.ts), so an edit can change words but never the design.
 */
export const EMAIL_TEMPLATE_KINDS = ['welcome', 'password_reset'] as const;
export type EmailTemplateKind = (typeof EMAIL_TEMPLATE_KINDS)[number];

/** Languages every template has a text in: the app's UI languages. */
export const EMAIL_TEMPLATE_LANGUAGES = UI_LANGUAGES;
export type EmailTemplateLanguage = UiLanguage;

/** Text fields of one template. Empty optional fields are left out of the email. */
export interface EmailTemplateFields {
  /** Subject line. Plain text. */
  subject: string;
  /** Inbox preview text shown after the subject. Plain text, optional. */
  preheader: string;
  /** Large heading at the top of the card. */
  heading: string;
  /** Main text: paragraphs separated by an empty line, **bold**, placeholders. */
  body: string;
  /** Label of the mint button. Empty = no button (not allowed for password_reset). */
  buttonLabel: string;
  /** Small text under the button, e.g. the copyable link. Optional. */
  note: string;
  /** Muted text under the card, e.g. why the email was sent. Optional. */
  footer: string;
}

export type EmailTemplateFieldKey = keyof EmailTemplateFields;

export const EMAIL_TEMPLATE_FIELD_KEYS: readonly EmailTemplateFieldKey[] = [
  'subject',
  'preheader',
  'heading',
  'body',
  'buttonLabel',
  'note',
  'footer',
];

export const EMAIL_PLACEHOLDERS = ['name', 'email', 'link'] as const;
export type EmailPlaceholder = (typeof EMAIL_PLACEHOLDERS)[number];

export interface EmailFieldSpec {
  key: EmailTemplateFieldKey;
  /** Turkish label for the admin panel. */
  label: string;
  /** Turkish hint for the admin panel. */
  hint: string;
  maxLength: number;
  multiline: boolean;
  /** Paragraphs and **bold** are applied (body, note, footer). */
  formatted: boolean;
  placeholders: readonly EmailPlaceholder[];
}

export const EMAIL_FIELD_SPECS: readonly EmailFieldSpec[] = [
  {
    key: 'subject',
    label: 'Konu',
    hint: 'E-postanın konu satırı.',
    maxLength: 150,
    multiline: false,
    formatted: false,
    placeholders: ['name'],
  },
  {
    key: 'preheader',
    label: 'Önizleme metni',
    hint: 'Gelen kutusunda konunun yanında görünen kısa metin. Boş bırakılabilir.',
    maxLength: 200,
    multiline: false,
    formatted: false,
    placeholders: ['name'],
  },
  {
    key: 'heading',
    label: 'Başlık',
    hint: 'Kartın üstündeki büyük başlık.',
    maxLength: 120,
    multiline: false,
    formatted: false,
    placeholders: ['name'],
  },
  {
    key: 'body',
    label: 'Metin',
    hint: 'Paragrafları boş bir satırla ayır. **kalın** yazı desteklenir.',
    maxLength: 5000,
    multiline: true,
    formatted: true,
    placeholders: ['name', 'email', 'link'],
  },
  {
    key: 'buttonLabel',
    label: 'Buton yazısı',
    hint: 'Nane rengi butonun yazısı. Buton {{link}} adresine gider.',
    maxLength: 40,
    multiline: false,
    formatted: false,
    placeholders: [],
  },
  {
    key: 'note',
    label: 'Buton altı notu',
    hint: 'Butonun altındaki küçük metin. {{link}} tıklanabilir bağlantı olarak yazılır.',
    maxLength: 1000,
    multiline: true,
    formatted: true,
    placeholders: ['name', 'email', 'link'],
  },
  {
    key: 'footer',
    label: 'Alt bilgi',
    hint: 'Kartın altındaki soluk metin. sesly.io ve info@sesly.io her zaman eklenir.',
    maxLength: 1000,
    multiline: true,
    formatted: true,
    placeholders: ['email'],
  },
];

export interface EmailKindSpec {
  kind: EmailTemplateKind;
  /** Turkish label for the admin panel. */
  label: string;
  /** Turkish description for the admin panel. */
  description: string;
  /** What {{link}} points to, in Turkish. */
  linkDescription: string;
  /** The button carries the only working link, so it cannot be removed. */
  buttonRequired: boolean;
}

export const EMAIL_KIND_SPECS: Readonly<Record<EmailTemplateKind, EmailKindSpec>> = {
  welcome: {
    kind: 'welcome',
    label: 'Hoş geldin e-postası',
    description: 'Yeni hesap açıldığında bir kez gönderilir.',
    linkDescription: 'Sesly web sitesi (sesly.io).',
    buttonRequired: false,
  },
  password_reset: {
    kind: 'password_reset',
    label: 'Şifre sıfırlama e-postası',
    description: 'Uygulamada "Şifremi unuttum" istendiğinde gönderilir. Bağlantı 1 saat geçerlidir.',
    linkDescription: 'Yeni şifre belirleme sayfası (sesly.io/auth/action).',
    buttonRequired: true,
  },
};

/** Turkish descriptions of the placeholders for the admin panel. */
export const EMAIL_PLACEHOLDER_LABELS: Readonly<Record<EmailPlaceholder, string>> = {
  name: 'Kullanıcının adı. Ad bilinmiyorsa {{name}} önündeki boşlukla birlikte silinir ("Merhaba {{name}}," olur "Merhaba,").',
  email: 'Kullanıcının e-posta adresi.',
  link: 'E-postanın bağlantısı.',
};

/** Turkish names of the languages for the admin panel. */
export const EMAIL_LANGUAGE_LABELS: Readonly<Record<EmailTemplateLanguage, string>> = {
  tr: 'Türkçe',
  en: 'İngilizce',
};

export function isEmailTemplateKind(value: unknown): value is EmailTemplateKind {
  return typeof value === 'string' && (EMAIL_TEMPLATE_KINDS as readonly string[]).includes(value);
}

export function isEmailTemplateLanguage(value: unknown): value is EmailTemplateLanguage {
  return typeof value === 'string' && (EMAIL_TEMPLATE_LANGUAGES as readonly string[]).includes(value);
}

/** Values filled into the placeholders when an email is rendered. */
export interface EmailRenderContext {
  /** First name, or empty / null when unknown. */
  name?: string | null;
  email: string;
  link: string;
}
