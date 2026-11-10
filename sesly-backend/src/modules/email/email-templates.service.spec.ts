import { BadRequestException, Logger } from '@nestjs/common';
import { EMAIL_TEMPLATE_INVALID, EmailTemplatesService } from './email-templates.service';
import { DEFAULT_EMAIL_TEMPLATES } from './templates/email-template.defaults';

const SAVED = {
  id: 't1',
  kind: 'welcome',
  language: 'en',
  subject: 'Saved subject',
  preheader: '',
  heading: 'Saved heading',
  body: 'Hello {{name}}',
  buttonLabel: '',
  note: '',
  footer: '',
  updatedAt: new Date('2026-11-05T09:00:00Z'),
  updatedByAdminId: 'admin-1',
};

describe('EmailTemplatesService', () => {
  let prisma: {
    emailTemplate: { findUnique: jest.Mock; findMany: jest.Mock; upsert: jest.Mock; deleteMany: jest.Mock };
  };
  let service: EmailTemplatesService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    prisma = {
      emailTemplate: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([SAVED]),
        upsert: jest.fn(async ({ create }) => ({ ...create, updatedAt: new Date('2026-11-05T10:00:00Z') })),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new EmailTemplatesService(prisma as any, { get: jest.fn(() => 'https://sesly.test/') } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('describe: every kind x language, saved text marked custom, the rest default', async () => {
    const out = await service.describe();
    expect(out.kinds.map((k) => k.kind)).toEqual(['welcome', 'password_reset']);
    expect(out.languages).toEqual([
      { code: 'tr', label: 'Türkçe' },
      { code: 'en', label: 'İngilizce' },
    ]);
    expect(out.fields.map((f) => f.key)).toEqual(['subject', 'preheader', 'heading', 'body', 'buttonLabel', 'note', 'footer']);
    expect(out.placeholders.map((p) => p.key)).toEqual(['name', 'email', 'link']);
    expect(out.templates.map((t) => `${t.kind}/${t.language}/${t.source}`)).toEqual([
      'welcome/tr/default',
      'welcome/en/custom',
      'password_reset/tr/default',
      'password_reset/en/default',
    ]);
    const custom = out.templates[1];
    expect(custom.fields.subject).toBe('Saved subject');
    expect(custom.defaults).toEqual(DEFAULT_EMAIL_TEMPLATES.welcome.en);
    expect(custom.updatedAt).toBe('2026-11-05T09:00:00.000Z');
    expect(custom.updatedByAdminId).toBe('admin-1');
    expect(out.templates[0].fields).toEqual(DEFAULT_EMAIL_TEMPLATES.welcome.tr);
  });

  it('getOne: unknown kind or language is a 400 in Turkish', async () => {
    await expect(service.getOne('newsletter', 'tr')).rejects.toThrow('Bilinmeyen e-posta türü "newsletter"');
    await expect(service.getOne('welcome', 'de')).rejects.toThrow('Bilinmeyen dil "de". Geçerli diller: tr, en.');
  });

  it('save: validated, trimmed, upserted per (kind, language) with the admin id', async () => {
    const view = await service.save(
      'password_reset',
      'tr',
      { subject: '  Konu ', heading: 'Başlık', body: 'Metin\r\n\r\nİkinci', buttonLabel: 'Sıfırla' },
      'admin-9',
    );
    const args = prisma.emailTemplate.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ kind_language: { kind: 'password_reset', language: 'tr' } });
    expect(args.create).toEqual({
      kind: 'password_reset',
      language: 'tr',
      subject: 'Konu',
      preheader: '',
      heading: 'Başlık',
      body: 'Metin\n\nİkinci',
      buttonLabel: 'Sıfırla',
      note: '',
      footer: '',
      updatedByAdminId: 'admin-9',
    });
    expect(view.source).toBe('custom');
    expect(view.fields.subject).toBe('Konu');
  });

  it('save: problems are a coded 400 listing every one, nothing is written', async () => {
    const error = await service
      .save('password_reset', 'en', { subject: '', heading: 'H', body: 'B {{oops}}' }, 'a')
      .catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    const body = error.getResponse();
    expect(body.code).toBe(EMAIL_TEMPLATE_INVALID);
    expect(body.problems).toEqual([
      'Konu boş olamaz.',
      'Metin: {{oops}} tanınmıyor. Bu alanda kullanılabilenler: {{name}}, {{email}}, {{link}}.',
      'Buton yazısı boş olamaz.',
    ]);
    expect(body.message).toBe(body.problems.join(' '));
    expect(prisma.emailTemplate.upsert).not.toHaveBeenCalled();
  });

  it('reset: deletes the row and returns the default', async () => {
    const view = await service.reset('welcome', 'en', 'admin-1');
    expect(prisma.emailTemplate.deleteMany).toHaveBeenCalledWith({ where: { kind: 'welcome', language: 'en' } });
    expect(view).toMatchObject({ source: 'default', fields: DEFAULT_EMAIL_TEMPLATES.welcome.en, updatedAt: null });
  });

  it('preview: sample values, draft fields over the saved text, problems reported not thrown', async () => {
    prisma.emailTemplate.findUnique.mockResolvedValue(SAVED);
    const out = await service.preview('welcome', 'en', { heading: 'Draft {{name}}', body: 'Hi {{bad}}' });
    expect(out.subject).toBe('Saved subject');
    expect(out.html).toContain('Draft Emma');
    expect(out.html).toContain('src="https://sesly.test/image/sesly-icon-192.png"');
    expect(out.problems).toHaveLength(1);
    expect(out.text.startsWith('Draft Emma')).toBe(true);
  });

  it('preview: the password reset sample link opens the action page in that language', async () => {
    const out = await service.preview('password_reset', 'tr');
    expect(out.html).toContain('https://sesly.test/auth/action?mode=resetPassword&amp;oobCode=ornek-kod&amp;lang=tr');
    expect(out.html).toContain('Merhaba Ayşe,');
    expect(out.problems).toEqual([]);
  });

  it('renderTest: rejects a text that could not be saved', async () => {
    await expect(service.renderTest('welcome', 'tr', 'a@b.co', { subject: '' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('getFields: a database error gives the default text', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma.emailTemplate.findUnique.mockRejectedValue(new Error('db down'));
    await expect(service.getFields('password_reset', 'en')).resolves.toEqual(DEFAULT_EMAIL_TEMPLATES.password_reset.en);
  });
});
