import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { HttpExceptionFilter, looksLikeI18nKey } from './http-exception.filter';
import { createSettingsStub } from '../../test-utils/settings-stub';
import { createI18nStub } from '../../test-utils/i18n';
import { localizedError } from '../i18n/server-text';
import { UsageService } from '../../modules/usage/usage.service';

function createHost(headers: Record<string, string> = {}) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const request = { url: '/narrations', method: 'POST', headers };
  const host: any = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  };
  return { host, status, json };
}

describe('HttpExceptionFilter', () => {
  const i18n: any = {
    t: jest.fn((key: string) =>
      key === 'errors.stories.notFound' ? 'Masal bulunamadı' : key,
    ),
  };
  const settings = createSettingsStub();
  const filter = new HttpExceptionFilter(i18n, settings as any);

  beforeEach(() => {
    i18n.t.mockClear();
    settings.values = {};
  });

  describe('language resolution (runtime settings)', () => {
    const langFor = (headers: Record<string, string>) => {
      const { host } = createHost(headers);
      filter.catch(new NotFoundException('errors.stories.notFound'), host);
      return i18n.t.mock.calls[i18n.t.mock.calls.length - 1][1].lang;
    };

    it('no Accept-Language -> i18n.defaultLocale (code default tr), read live', () => {
      expect(langFor({})).toBe('tr');
      settings.values['i18n.defaultLocale'] = 'en';
      expect(langFor({})).toBe('en');
      expect(langFor({ 'accept-language': '*' })).toBe('en');
    });

    it('a supported requested language wins over the settings', () => {
      settings.values = { 'i18n.defaultLocale': 'tr', 'i18n.fallbackLocale': 'tr' };
      expect(langFor({ 'accept-language': 'en-US,en;q=0.9' })).toBe('en');
      expect(langFor({ 'accept-language': 'TR;q=0.8' })).toBe('tr');
    });

    it('an unsupported requested language -> i18n.fallbackLocale, read live', () => {
      expect(langFor({ 'accept-language': 'de-DE,de;q=0.9' })).toBe('tr');
      settings.values['i18n.fallbackLocale'] = 'en';
      expect(langFor({ 'accept-language': 'de-DE,de;q=0.9' })).toBe('en');
    });
  });

  it('passes structured fields of an object exception body through', () => {
    const { host, status, json } = createHost();

    filter.catch(
      new ConflictException({
        code: 'NARRATION_EXISTS',
        existingNarrationId: 'n-1',
        status: 'READY',
        message: 'Bu masal bu sesle zaten seslendirilmiş.',
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(409);
    const body = json.mock.calls[0][0];
    expect(body).toMatchObject({
      success: false,
      statusCode: 409,
      message: 'Bu masal bu sesle zaten seslendirilmiş.',
      path: '/narrations',
      method: 'POST',
      code: 'NARRATION_EXISTS',
      existingNarrationId: 'n-1',
      status: 'READY',
    });
    expect(body.timestamp).toBeDefined();
  });

  it('never lets extras override the envelope', () => {
    const { host, json } = createHost();
    filter.catch(
      new ForbiddenException({ message: 'Kota doldu.', statusCode: 999, success: true }),
      host,
    );
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(403);
    expect(body.success).toBe(false);
    expect(body.message).toBe('Kota doldu.');
  });

  it('does not truncate human messages that contain a period', () => {
    const { host, json } = createHost();
    filter.catch(
      new NotFoundException('Masal bulunamadı. Lütfen tekrar dene.'),
      host,
    );
    const body = json.mock.calls[0][0];
    expect(body.message).toBe('Masal bulunamadı. Lütfen tekrar dene.');
    expect(i18n.t).not.toHaveBeenCalled();
    // Nest's default "error" label is not echoed as an extra field
    expect(body.error).toBeUndefined();
  });

  it('translates messages shaped like i18n keys', () => {
    const { host, json } = createHost({ 'accept-language': 'tr-TR,tr;q=0.9' });
    filter.catch(new NotFoundException('errors.stories.notFound'), host);
    expect(json.mock.calls[0][0].message).toBe('Masal bulunamadı');
  });

  describe('messageArgs (localizedError) with the real translation files', () => {
    const realFilter = new HttpExceptionFilter(createI18nStub() as any, createSettingsStub() as any);
    const quota = () =>
      new ForbiddenException({
        code: 'QUOTA_PRESET_MONTHLY',
        limit: 20,
        renewsAt: new Date(2026, 10, 1),
        ...localizedError(...UsageService.quotaMessageKey('QUOTA_PRESET_MONTHLY', 'FREE', 20, new Date(2026, 10, 1))),
      });

    it('fills the placeholders in the request language and never sends messageArgs', () => {
      const tr = createHost({ 'accept-language': 'tr' });
      realFilter.catch(quota(), tr.host);
      const trBody = tr.json.mock.calls[0][0];
      expect(trBody.message).toBe(
        'Bu ay hazır anlatıcı seslerle 20 masal hakkını kullandın. Hakların 1 Kasım tarihinde yenilenir. Sınırsız masal için Mini ya da Premium plana geçebilirsin.',
      );
      expect(trBody).toMatchObject({ code: 'QUOTA_PRESET_MONTHLY', limit: 20 });
      expect(trBody).not.toHaveProperty('messageArgs');

      const en = createHost({ 'accept-language': 'en-US' });
      realFilter.catch(quota(), en.host);
      expect(en.json.mock.calls[0][0].message).toBe(
        "You have used this month's 20 stories with ready-made narrator voices. Your allowance renews on November 1. Switch to Mini or Premium for unlimited stories.",
      );
    });

    it('a Date placeholder is written in the response language', () => {
      const exception = new ForbiddenException({
        code: 'CLONE_CREATION_LIMIT',
        ...localizedError('errors.voiceSlots.cloneCreationRenews', { renewDate: new Date(2026, 0, 1) }),
      });
      const en = createHost({ 'accept-language': 'en' });
      realFilter.catch(exception, en.host);
      expect(en.json.mock.calls[0][0].message).toBe(' Your new recordings renew on January 1.');
      const none = createHost();
      realFilter.catch(exception, none.host);
      expect(none.json.mock.calls[0][0].message).toBe(' Yeni kayıt hakkın 1 Ocak tarihinde yenilenir.');
    });
  });

  it('returns an unknown i18n-looking key intact instead of its last segment', () => {
    const { host, json } = createHost();
    filter.catch(new BadRequestException('errors.missing.key'), host);
    expect(json.mock.calls[0][0].message).toBe('errors.missing.key');
  });

  it('uses the first validation message for array messages', () => {
    const { host, json } = createHost();
    filter.catch(
      new BadRequestException(['storyId must be a UUID', 'title must be a string']),
      host,
    );
    expect(json.mock.calls[0][0].message).toBe('storyId must be a UUID');
  });

  it('maps unknown errors to 500', () => {
    const { host, status, json } = createHost();
    filter.catch(new Error('boom'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json.mock.calls[0][0].message).toBe('Internal server error');
  });

  it.each([
    [{ code: 'P2002', meta: { target: ['email'] } }, 409, 'Unique constraint failed on field: email'],
    [{ code: 'P2025' }, 404, 'Record not found'],
    [{ code: 'P2003' }, 400, 'Foreign key constraint failed'],
    [{ code: 'P1001' }, 500, 'Internal server error'],
    [Object.assign(new Error('No such object'), { code: 404 }), 500, 'Internal server error'],
  ])('maps an unhandled Prisma-coded error %j to %i in the standard envelope', (exception, code, message) => {
    const { host, status, json } = createHost();
    filter.catch(exception, host);
    expect(status).toHaveBeenCalledWith(code);
    expect(json.mock.calls[0][0]).toMatchObject({ success: false, statusCode: code, message });
  });

  describe('looksLikeI18nKey', () => {
    it.each([
      ['errors.auth.invalidToken', true],
      ['common.success', true],
      ['Masal bulunamadı.', false],
      ['file.mp3 not found', false],
      ['nodots', false],
    ])('%s -> %s', (input, expected) => {
      expect(looksLikeI18nKey(input)).toBe(expected);
    });
  });
});
