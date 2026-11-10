import { AxiosError, AxiosHeaders } from 'axios';
import ErrorHandler, {
  configureErrorHandler,
  getErrorStatusCode,
  handleError,
  isNetworkError,
  isUnauthorizedError,
  showInfo,
  showSuccess,
  showWarning,
} from './errorHandler';

function httpError(status: number, data: unknown, code?: string): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(`Request failed with status code ${status}`, code, config, {}, {
    status,
    statusText: '',
    headers: {},
    config,
    data,
  });
}

function networkError(code: string, message = 'Network Error'): AxiosError {
  return new AxiosError(message, code, { headers: new AxiosHeaders() });
}

describe('errorHandler', () => {
  const notify = jest.fn();
  const onUnauthorized = jest.fn();

  beforeEach(() => {
    configureErrorHandler({ showNotification: notify, onUnauthorized });
  });

  afterAll(() => {
    configureErrorHandler({});
  });

  it('maps timeouts and offline errors', () => {
    expect(handleError(networkError('ECONNABORTED', 'timeout of 30000ms exceeded')).message).toBe(
      'Bağlantı zaman aşımına uğradı',
    );
    expect(handleError(networkError('ERR_NETWORK')).message).toBe('İnternet bağlantısı kurulamadı');
  });

  it.each([
    [400, { message: 'E-posta geçersiz' }, 'Geçersiz İstek', 'E-posta geçersiz'],
    [400, {}, 'Geçersiz İstek', 'Gönderilen veri hatalı. Lütfen kontrol et.'],
    [403, { error: 'Yasak' }, 'Yetki Yok', 'Yasak'],
    [404, { error: { message: 'Yok' } }, 'Bulunamadı', 'Yok'],
    [409, { detail: 'Zaten var' }, 'Çakışma', 'Zaten var'],
    [422, { errors: [{ message: 'a' }, 'b'] }, 'Doğrulama Hatası', 'a\nb'],
    [429, null, 'Çok Fazla İstek', 'Çok fazla istek gönderdin. Lütfen biraz bekle.'],
    [503, { message: 'Internal' }, 'Sunucu Hatası', 'Sunucu hatası oluştu'],
    [418, {}, 'Hata', 'Bir hata oluştu (418)'],
  ])('status %s', (status, data, title, message) => {
    expect(handleError(httpError(status, data))).toEqual({ title, message, statusCode: status });
  });

  it('401 triggers the unauthorized hook', () => {
    expect(handleError(httpError(401, {})).title).toBe('Oturum Sonlandı');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('notifies for everything except 404', () => {
    handleError(httpError(404, {}), 'Masal yok');
    expect(notify).not.toHaveBeenCalled();
    handleError(httpError(500, {}));
    expect(notify).toHaveBeenCalledWith(
      { title: 'Sunucu Hatası', message: 'Sunucu hatası oluştu', statusCode: 500 },
      'error',
    );
  });

  it('plain errors and custom messages', () => {
    expect(handleError(new Error('Error: bozuk')).message).toBe('bozuk');
    expect(handleError('x', 'Özel mesaj').message).toBe('Özel mesaj');
    expect(handleError(undefined).message).toBe('Bilinmeyen bir hata oluştu');
  });

  it('success/info/warning go through the configured notifier', () => {
    showSuccess('A', 'a');
    showInfo('B', 'b');
    showWarning('C', 'c');
    expect(notify.mock.calls.map(c => c[1])).toEqual(['success', 'info', 'warning']);
    configureErrorHandler({});
    expect(() => showSuccess('A', 'a')).not.toThrow();
  });

  it('predicates', () => {
    expect(isUnauthorizedError(httpError(401, {}))).toBe(true);
    expect(isUnauthorizedError(new Error('x'))).toBe(false);
    expect(isNetworkError(networkError('ERR_NETWORK'))).toBe(true);
    expect(isNetworkError(httpError(500, {}))).toBe(false);
    expect(isNetworkError(new Error('x'))).toBe(false);
    expect(getErrorStatusCode(httpError(409, {}))).toBe(409);
    expect(getErrorStatusCode(networkError('ERR_NETWORK'))).toBeNull();
  });

  it('extractErrorMessage tolerates odd bodies', () => {
    expect(ErrorHandler.extractErrorMessage({ data: 'text' })).toBeNull();
    expect(ErrorHandler.extractErrorMessage(null)).toBeNull();
  });
});
