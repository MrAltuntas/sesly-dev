import {
  ApiError,
  API_ERROR_CODES,
  maintenanceFallbackMessage,
  apiErrorFromResponse,
  classifyFailure,
  fallbackMessageForStatus,
  getErrorMessage,
  hasApiStatus,
  isApiError,
} from './ApiError';
import { ERROR_MESSAGES } from '../config/constants';
import i18n from '../i18n';

describe('apiErrorFromResponse', () => {
  const envelope = (extra: Record<string, unknown>) => ({
    success: false,
    path: '/narrations',
    method: 'POST',
    timestamp: '2026-09-27T10:00:00.000Z',
    ...extra,
  });

  it('passes the backend Turkish message through for 4xx', () => {
    const err = apiErrorFromResponse(
      403,
      envelope({ statusCode: 403, message: 'Aylık limitinize ulaştınız.' }),
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(403);
    expect(err.message).toBe('Aylık limitinize ulaştınız.');
    expect(err.message.startsWith('Error:')).toBe(false);
  });

  it('exposes code and the full body as data (409 narration conflict)', () => {
    const err = apiErrorFromResponse(
      409,
      envelope({
        statusCode: 409,
        message: 'Bu masal bu sesle zaten seslendirilmiş.',
        code: 'NARRATION_EXISTS',
        existingNarrationId: 'n-1',
        status: 'READY',
      }),
    );
    expect(err.code).toBe('NARRATION_EXISTS');
    expect(err.data?.existingNarrationId).toBe('n-1');
    expect(err.data?.status).toBe('READY');
  });

  it('uses the backend message for 503 maintenance mode', () => {
    const err = apiErrorFromResponse(
      503,
      envelope({ statusCode: 503, message: 'Sesly kısa bir bakımda.' }),
    );
    expect(err.message).toBe('Sesly kısa bir bakımda.');
    expect(err.isMaintenance).toBe(true);
  });

  it('falls back to a Turkish maintenance text when 503 has no message', () => {
    expect(apiErrorFromResponse(503, null).message).toBe(
      maintenanceFallbackMessage(),
    );
  });

  it('hides English "Internal server error" behind the generic 5xx text', () => {
    const err = apiErrorFromResponse(
      500,
      envelope({ statusCode: 500, message: 'Internal server error' }),
    );
    expect(err.message).toBe(ERROR_MESSAGES.SERVER);
  });

  it('maps missing responses to a network error', () => {
    const err = apiErrorFromResponse(undefined, undefined);
    expect(err.status).toBe(0);
    expect(err.code).toBe(API_ERROR_CODES.NETWORK);
    expect(err.isNetworkError).toBe(true);
    expect(err.message).toBe(ERROR_MESSAGES.NETWORK);
  });

  it('takes the first entry of validation message arrays', () => {
    const err = apiErrorFromResponse(400, {
      message: ['storyId must be a UUID', 'other'],
    });
    expect(err.message).toBe('storyId must be a UUID');
  });

  it('uses a status-based Turkish fallback when the body has no message', () => {
    expect(apiErrorFromResponse(404, {}).message).toBe(
      'İstenen içerik bulunamadı.',
    );
  });
});

describe('getErrorMessage', () => {
  it('returns the ApiError message', () => {
    const err = apiErrorFromResponse(403, { message: 'Yetkiniz yok.' });
    expect(getErrorMessage(err, 'fallback')).toBe('Yetkiniz yok.');
  });

  it('prefers the fallback for non-API errors', () => {
    expect(
      getErrorMessage(new Error('Invalid response: expected array'), 'Yüklenemedi'),
    ).toBe('Yüklenemedi');
  });

  it('strips the "Error: " prefix when no fallback is given', () => {
    expect(getErrorMessage(new Error('Error: Hatalı şifre'))).toBe('Hatalı şifre');
  });
});

describe('type guards', () => {
  it('isApiError / hasApiStatus', () => {
    const err = apiErrorFromResponse(404, {});
    expect(isApiError(err)).toBe(true);
    expect(isApiError(new Error('x'))).toBe(false);
    expect(hasApiStatus(err, 404)).toBe(true);
    expect(hasApiStatus(err, 500)).toBe(false);
  });
});

describe('classifyFailure', () => {
  const api = (status: number, code: string | null = null) =>
    new ApiError({ message: 'x', status, code });

  it('connectivity offline wins over everything', () => {
    expect(classifyFailure(api(500), { offline: true })).toBe('offline');
    expect(classifyFailure(api(401), { offline: true })).toBe('offline');
    expect(classifyFailure(new Error('parser'), { offline: true })).toBe('offline');
  });

  it('no response (status 0, NETWORK_ERROR) is offline', () => {
    expect(classifyFailure(apiErrorFromResponse(undefined, null))).toBe('offline');
    expect(classifyFailure(api(0, API_ERROR_CODES.NETWORK), { offline: false })).toBe(
      'offline',
    );
  });

  it('503 is maintenance', () => {
    expect(classifyFailure(apiErrorFromResponse(503, { message: 'Bakım' }))).toBe(
      'maintenance',
    );
  });

  it('401 and SESSION_EXPIRED are session', () => {
    expect(classifyFailure(api(401))).toBe('session');
    expect(classifyFailure(api(401, API_ERROR_CODES.SESSION_EXPIRED))).toBe('session');
    expect(classifyFailure(api(0, API_ERROR_CODES.SESSION_EXPIRED))).toBe('session');
  });

  it.each([500, 502, 504, 429])('%i is server', status => {
    expect(classifyFailure(api(status))).toBe('server');
  });

  it('status 0 UNKNOWN_ERROR and anything that is not an ApiError are server', () => {
    expect(classifyFailure(api(0, API_ERROR_CODES.UNKNOWN))).toBe('server');
    expect(classifyFailure(new TypeError('Cannot read properties of undefined'))).toBe(
      'server',
    );
    expect(classifyFailure('weird')).toBe('server');
    expect(classifyFailure(undefined)).toBe('server');
  });

  it.each([400, 403, 404, 409, 413, 422])('%i is client', status => {
    expect(classifyFailure(api(status))).toBe('client');
  });
});

describe('backend sentences and the UI language', () => {
  afterEach(async () => {
    await i18n.changeLanguage('tr');
  });

  it('in Turkish, the backend message of a 4xx is kept', async () => {
    await i18n.changeLanguage('tr');
    const err = apiErrorFromResponse(403, { message: 'Bu işlem için yetkin yok.' });
    expect(err.message).toBe('Bu işlem için yetkin yok.');
  });

  it('in English, a 403 with a Turkish backend message yields the English forbidden fallback', async () => {
    await i18n.changeLanguage('en');
    const err = apiErrorFromResponse(403, {
      message: 'Bu işlem için yetkin yok.',
      code: 'FORBIDDEN_THING',
    });
    expect(err.message).toBe('You are not allowed to do this.');
    expect(err.message).toBe(fallbackMessageForStatus(403));
    // Callers that map known codes still get the code and the data.
    expect(err.code).toBe('FORBIDDEN_THING');
    expect(err.data?.message).toBe('Bu işlem için yetkin yok.');
  });

  it.each([400, 404, 409, 429])('in English, a %i uses the status fallback', async status => {
    await i18n.changeLanguage('en');
    const err = apiErrorFromResponse(status, { message: 'Türkçe bir cümle.' });
    expect(err.message).toBe(fallbackMessageForStatus(status));
    expect(err.message).not.toBe('Türkçe bir cümle.');
  });

  it('in English, a 503 keeps the English maintenance text, never the Turkish sentence', async () => {
    await i18n.changeLanguage('en');
    const err = apiErrorFromResponse(503, { message: 'Sesly kısa bir bakımda.' });
    expect(err.message).toBe(maintenanceFallbackMessage());
    expect(err.message).not.toBe('Sesly kısa bir bakımda.');
  });

  it('the fallback follows the language at the time of the error', async () => {
    await i18n.changeLanguage('en');
    const english = apiErrorFromResponse(404, {}).message;
    await i18n.changeLanguage('tr');
    const turkish = apiErrorFromResponse(404, {}).message;
    expect(english).toBe('That could not be found.');
    expect(turkish).toBe('İstenen içerik bulunamadı.');
  });
});
