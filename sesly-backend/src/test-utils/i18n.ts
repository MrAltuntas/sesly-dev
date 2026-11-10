import { HttpException } from '@nestjs/common';
import { MESSAGE_ARGS_FIELD, serverText } from '../common/i18n/server-text';

/**
 * The text a client gets for an i18n-keyed message, as HttpExceptionFilter
 * renders it: pass an HttpException, its response body or a
 * `{ message, messageArgs }` object. A message that is not a key comes back
 * unchanged.
 */
export function renderMessage(source: unknown, language: 'tr' | 'en' = 'tr'): string {
  const body =
    source instanceof HttpException ? (source.getResponse() as unknown) : source;
  if (typeof body === 'string') return serverText(body, language);
  const record = (body ?? {}) as Record<string, unknown>;
  const message = Array.isArray(record.message) ? record.message[0] : record.message;
  return serverText(String(message ?? ''), language, record[MESSAGE_ARGS_FIELD] as any);
}

/**
 * Stand-in for nestjs-i18n's I18nService in specs: `t(key, { lang, args })`
 * served from the real translation files, the key itself when unknown.
 */
export function createI18nStub() {
  return {
    t: jest.fn((key: string, options?: { lang?: string; args?: Record<string, unknown> }) =>
      serverText(key, options?.lang ?? 'tr', options?.args as any),
    ),
  };
}
