import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_EMAIL_TEMPLATES } from './templates/email-template.defaults';
import {
  normaliseEmailTemplateFields,
  RenderedEmail,
  renderEmail,
  validateEmailTemplateFields,
} from './templates/email-layout';
import {
  EMAIL_FIELD_SPECS,
  EMAIL_KIND_SPECS,
  EMAIL_LANGUAGE_LABELS,
  EMAIL_PLACEHOLDER_LABELS,
  EMAIL_PLACEHOLDERS,
  EMAIL_TEMPLATE_FIELD_KEYS,
  EMAIL_TEMPLATE_KINDS,
  EMAIL_TEMPLATE_LANGUAGES,
  EmailRenderContext,
  EmailTemplateFields,
  EmailTemplateKind,
  EmailTemplateLanguage,
  isEmailTemplateKind,
  isEmailTemplateLanguage,
} from './templates/email-template.types';

export interface EmailTemplateView {
  kind: EmailTemplateKind;
  language: EmailTemplateLanguage;
  /** 'custom' when a panel text is saved, else 'default'. */
  source: 'default' | 'custom';
  /** The text that is sent. */
  fields: EmailTemplateFields;
  /** The code default (what "reset" goes back to). */
  defaults: EmailTemplateFields;
  updatedAt: string | null;
  updatedByAdminId: string | null;
}

export interface EmailTemplatePreview extends RenderedEmail {
  kind: EmailTemplateKind;
  language: EmailTemplateLanguage;
  /** Turkish problems that would keep this text from being saved. */
  problems: string[];
}

type EmailTemplateRow = Partial<Record<keyof EmailTemplateFields, string>> & {
  kind: string;
  language: string;
  updatedAt?: Date | null;
  updatedByAdminId?: string | null;
};

export const EMAIL_TEMPLATE_INVALID = 'EMAIL_TEMPLATE_INVALID';

/** 400 with every problem: `message` joins them, `problems` lists them. */
function invalidTemplate(problems: string[]): BadRequestException {
  return new BadRequestException({ code: EMAIL_TEMPLATE_INVALID, message: problems.join(' '), problems });
}

/** Sample values for previews and test emails. */
const SAMPLE_PEOPLE: Readonly<Record<EmailTemplateLanguage, { name: string; email: string }>> = {
  tr: { name: 'Ayşe', email: 'ayse@ornek.com' },
  en: { name: 'Emma', email: 'emma@example.com' },
};

/**
 * Text of the service emails per kind and language: a saved panel text
 * (table `email_templates`) or the code default. A database error never
 * stops an email; the default text is used and a warning is logged.
 */
@Injectable()
export class EmailTemplatesService {
  private readonly logger = new Logger(EmailTemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Public web site the layout links to (logo, footer, action page). */
  webBaseUrl(): string {
    return (this.config.get<string>('app.frontendUrl') || 'https://sesly.io').replace(/\/+$/, '');
  }

  /** Effective text to send. Never throws. */
  async getFields(kind: EmailTemplateKind, language: EmailTemplateLanguage): Promise<EmailTemplateFields> {
    try {
      const row = await this.prisma.emailTemplate.findUnique({
        where: { kind_language: { kind, language } },
      });
      if (row) return normaliseEmailTemplateFields(row);
    } catch (error) {
      this.logger.warn(
        `Email template ${kind}/${language} not read, using the default: ${(error as Error)?.message}`,
      );
    }
    return { ...DEFAULT_EMAIL_TEMPLATES[kind][language] };
  }

  /** Rendered email with the effective text. Never throws. */
  async render(
    kind: EmailTemplateKind,
    language: EmailTemplateLanguage,
    ctx: EmailRenderContext,
  ): Promise<RenderedEmail> {
    const fields = await this.getFields(kind, language);
    return renderEmail(language, fields, ctx, { webBaseUrl: this.webBaseUrl() });
  }

  // ===== Admin panel =====

  /** Everything the panel's editor needs: kinds, languages, field rules, every template. */
  async describe() {
    const rows = await this.prisma.emailTemplate.findMany();
    const byKey = new Map(rows.map((row) => [`${row.kind}:${row.language}`, row]));
    const templates: EmailTemplateView[] = [];
    for (const kind of EMAIL_TEMPLATE_KINDS) {
      for (const language of EMAIL_TEMPLATE_LANGUAGES) {
        templates.push(this.toView(kind, language, byKey.get(`${kind}:${language}`) ?? null));
      }
    }
    return {
      kinds: EMAIL_TEMPLATE_KINDS.map((kind) => EMAIL_KIND_SPECS[kind]),
      languages: EMAIL_TEMPLATE_LANGUAGES.map((code) => ({ code, label: EMAIL_LANGUAGE_LABELS[code] })),
      fields: EMAIL_FIELD_SPECS,
      placeholders: EMAIL_PLACEHOLDERS.map((key) => ({ key, label: EMAIL_PLACEHOLDER_LABELS[key] })),
      templates,
    };
  }

  async getOne(kindParam: string, languageParam: string): Promise<EmailTemplateView> {
    const { kind, language } = this.parseTarget(kindParam, languageParam);
    const row = await this.prisma.emailTemplate.findUnique({
      where: { kind_language: { kind, language } },
    });
    return this.toView(kind, language, row);
  }

  async save(
    kindParam: string,
    languageParam: string,
    input: Partial<Record<keyof EmailTemplateFields, unknown>>,
    adminId: string | null,
  ): Promise<EmailTemplateView> {
    const { kind, language } = this.parseTarget(kindParam, languageParam);
    const fields = this.validated(kind, input);
    const row = await this.prisma.emailTemplate.upsert({
      where: { kind_language: { kind, language } },
      create: { kind, language, ...fields, updatedByAdminId: adminId },
      update: { ...fields, updatedByAdminId: adminId },
    });
    this.logger.log(`AUDIT email template saved kind=${kind} language=${language} admin=${adminId ?? '-'}`);
    return this.toView(kind, language, row);
  }

  async reset(kindParam: string, languageParam: string, adminId: string | null): Promise<EmailTemplateView> {
    const { kind, language } = this.parseTarget(kindParam, languageParam);
    await this.prisma.emailTemplate.deleteMany({ where: { kind, language } });
    this.logger.log(`AUDIT email template reset kind=${kind} language=${language} admin=${adminId ?? '-'}`);
    return this.toView(kind, language, null);
  }

  /**
   * Preview with sample values. Fields in `draft` replace the effective
   * text (unsaved edits); problems are reported, never thrown, so the panel
   * can show the preview while the admin types.
   */
  async preview(
    kindParam: string,
    languageParam: string,
    draft: Partial<Record<keyof EmailTemplateFields, unknown>> = {},
  ): Promise<EmailTemplatePreview> {
    const { kind, language } = this.parseTarget(kindParam, languageParam);
    const fields = await this.withDraft(kind, language, draft);
    const sample = SAMPLE_PEOPLE[language];
    const rendered = renderEmail(
      language,
      fields,
      { ...sample, link: this.sampleLink(kind, language) },
      { webBaseUrl: this.webBaseUrl() },
    );
    return { kind, language, ...rendered, problems: validateEmailTemplateFields(kind, fields) };
  }

  /**
   * Test email content for `to`: the draft (or saved) text with the sample
   * name and a sample link that opens the page but resets nothing. 400 when
   * the text could not be saved either.
   */
  async renderTest(
    kindParam: string,
    languageParam: string,
    to: string,
    draft: Partial<Record<keyof EmailTemplateFields, unknown>> = {},
  ): Promise<{ kind: EmailTemplateKind; language: EmailTemplateLanguage; email: RenderedEmail }> {
    const { kind, language } = this.parseTarget(kindParam, languageParam);
    const fields = await this.withDraft(kind, language, draft);
    const problems = validateEmailTemplateFields(kind, fields);
    if (problems.length > 0) throw invalidTemplate(problems);
    const email = renderEmail(
      language,
      fields,
      { name: SAMPLE_PEOPLE[language].name, email: to, link: this.sampleLink(kind, language) },
      { webBaseUrl: this.webBaseUrl() },
    );
    return { kind, language, email };
  }

  // ===== helpers =====

  private parseTarget(kind: string, language: string) {
    if (!isEmailTemplateKind(kind)) {
      throw new BadRequestException(
        `Bilinmeyen e-posta türü "${kind}". Geçerli türler: ${EMAIL_TEMPLATE_KINDS.join(', ')}.`,
      );
    }
    if (!isEmailTemplateLanguage(language)) {
      throw new BadRequestException(
        `Bilinmeyen dil "${language}". Geçerli diller: ${EMAIL_TEMPLATE_LANGUAGES.join(', ')}.`,
      );
    }
    return { kind, language };
  }

  private validated(
    kind: EmailTemplateKind,
    input: Partial<Record<keyof EmailTemplateFields, unknown>>,
  ): EmailTemplateFields {
    const fields = normaliseEmailTemplateFields(input);
    const problems = validateEmailTemplateFields(kind, fields);
    if (problems.length > 0) throw invalidTemplate(problems);
    return fields;
  }

  private async withDraft(
    kind: EmailTemplateKind,
    language: EmailTemplateLanguage,
    draft: Partial<Record<keyof EmailTemplateFields, unknown>>,
  ): Promise<EmailTemplateFields> {
    const current = await this.getFields(kind, language);
    const merged: Partial<Record<keyof EmailTemplateFields, unknown>> = { ...current };
    for (const key of EMAIL_TEMPLATE_FIELD_KEYS) {
      if (typeof draft[key] === 'string') merged[key] = draft[key];
    }
    return normaliseEmailTemplateFields(merged);
  }

  private sampleLink(kind: EmailTemplateKind, language: EmailTemplateLanguage): string {
    if (kind === 'password_reset') {
      return `${this.webBaseUrl()}/auth/action?mode=resetPassword&oobCode=ornek-kod&lang=${language}`;
    }
    return this.webBaseUrl();
  }

  private toView(
    kind: EmailTemplateKind,
    language: EmailTemplateLanguage,
    row: EmailTemplateRow | null,
  ): EmailTemplateView {
    const defaults = { ...DEFAULT_EMAIL_TEMPLATES[kind][language] };
    return {
      kind,
      language,
      source: row ? 'custom' : 'default',
      fields: row ? normaliseEmailTemplateFields(row) : defaults,
      defaults,
      updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      updatedByAdminId: row?.updatedByAdminId ?? null,
    };
  }
}
