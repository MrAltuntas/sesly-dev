import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { I18nService } from 'nestjs-i18n';
import { errorWrapper } from '../utils/wrappers';
import { mapPrismaError } from './prisma-exception.filter';
import type { SettingsService } from '../../modules/settings/settings.service';
import { I18N_LOCALES } from '../../modules/settings/settings.registry';
import { MESSAGE_ARGS_FIELD, resolveMessageArgs } from '../i18n/server-text';

/**
 * A message is only treated as an i18n key when it looks like one: a dotted
 * path of identifier segments with no whitespace (e.g. `errors.auth.invalidToken`).
 * Anything else (human sentences, Turkish copy, "Dosya.mp3 bulunamadi") is
 * returned to the client verbatim.
 */
const I18N_KEY_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/;

/** Fields of the exception body that are part of the envelope, not extras. */
const ENVELOPE_KEYS = new Set([
  'message',
  'statusCode',
  'success',
  'path',
  'method',
  'timestamp',
  // Placeholder values of an i18n key (see localizedError); consumed here,
  // never sent to the client.
  MESSAGE_ARGS_FIELD,
]);

export function looksLikeI18nKey(message: string): boolean {
  return I18N_KEY_PATTERN.test(message);
}

/**
 * Global HTTP Exception Filter with i18n support.
 *
 * Response envelope: `{ success:false, statusCode, message, path, method, timestamp }`
 * plus any extra structured fields from an object exception body
 * (`code`, `existingNarrationId`, `status`, ...).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(
    private readonly i18n: I18nService,
    private readonly settings: Pick<SettingsService, 'get'>,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string | string[];
    let extra: Record<string, unknown> | undefined;
    let messageArgs: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const body = exceptionResponse as Record<string, unknown>;
        message = (body.message as string | string[]) ?? exception.message;
        extra = this.pickExtras(body);
        messageArgs = body[MESSAGE_ARGS_FIELD];
      } else {
        message = exceptionResponse as string;
      }
    } else {
      // An unhandled Prisma error (unique violation, record not found, FK)
      // is a client-visible 409 / 404 / 400, not a crash. This filter is the
      // only global catch-all, so the mapping has to live here.
      const prismaError = mapPrismaError(exception);
      status = prismaError?.status ?? HttpStatus.INTERNAL_SERVER_ERROR;
      message = prismaError?.message ?? 'Internal server error';
      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(`Unexpected error: ${exception}`, (exception as Error)?.stack);
      }
    }

    // Handle array of messages (validation errors)
    const rawMessage = Array.isArray(message) ? message[0] : message;
    const messageText =
      typeof rawMessage === 'string' ? rawMessage : String(rawMessage ?? '');

    const translatedMessage = this.translate(messageText, request, messageArgs);

    const errorResponse = errorWrapper(
      translatedMessage,
      status,
      request.url,
      request.method,
      extra,
    );

    // Only log stack trace for 5xx errors (server errors)
    // 4xx errors (client errors like 404) are expected and don't need stack traces
    if (status >= 500) {
      this.logger.error(
        `HTTP ${status} Error: ${request.method} ${request.url} - ${translatedMessage}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `HTTP ${status} Error: ${request.method} ${request.url} - ${translatedMessage}`,
      );
    }

    response.status(status).json(errorResponse);
  }

  /**
   * Translate only when the message is shaped like an i18n key. A key with
   * no translation is returned unchanged (never truncated). `messageArgs`
   * fill the key's `{name}` placeholders; a Date is written as a day and
   * month of the response language, a `{ tr, en }` value picks its language.
   */
  private translate(message: string, request: Request, messageArgs?: unknown): string {
    if (!message || !looksLikeI18nKey(message)) {
      return message;
    }
    try {
      const lang = this.resolveLang(request);
      const args = resolveMessageArgs(messageArgs, lang);
      const translated = this.i18n.t(
        message,
        Object.keys(args).length > 0 ? { lang, args } : { lang },
      );
      return typeof translated === 'string' && translated.length > 0
        ? translated
        : message;
    } catch {
      return message;
    }
  }

  /**
   * Language of the error message, driven by the runtime settings:
   * no Accept-Language header -> i18n.defaultLocale; a language without
   * translation files -> i18n.fallbackLocale. (A key missing in a supported
   * language falls back inside nestjs-i18n, whose fallback language is kept
   * equal to i18n.fallbackLocale by I18nSettingsSync.)
   */
  private resolveLang(request: Request): string {
    const requested = request.headers?.['accept-language']
      ?.split(',')[0]
      ?.split(';')[0]
      ?.split('-')[0]
      ?.trim()
      .toLowerCase();
    if (!requested || requested === '*') {
      return this.settings.get('i18n.defaultLocale');
    }
    return I18N_LOCALES.includes(requested) ? requested : this.settings.get('i18n.fallbackLocale');
  }

  /**
   * Structured fields a service attached to the exception body. Nest's
   * default `error` label (e.g. "Bad Request") is dropped because it is
   * noise, not a machine-readable code.
   */
  private pickExtras(body: Record<string, unknown>): Record<string, unknown> | undefined {
    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (ENVELOPE_KEYS.has(key)) continue;
      if (key === 'error' && typeof value === 'string') continue;
      extras[key] = value;
    }
    return Object.keys(extras).length > 0 ? extras : undefined;
  }
}
