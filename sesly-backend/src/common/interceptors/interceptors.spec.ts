import { Logger } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';
import { TransformInterceptor } from './transform.interceptor';

function httpContext(request: Partial<any> = {}, statusCode = 200): any {
  const req = {
    method: 'POST',
    originalUrl: '/auth/firebase',
    body: { idToken: 'super-secret-firebase-token' },
    headers: {},
    ip: '10.0.0.1',
    ...request,
  };
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ statusCode }),
    }),
  };
}

function config(logLevel?: string): any {
  return { get: jest.fn((_key: string, fallback: string) => logLevel ?? fallback) };
}

describe('LoggingInterceptor', () => {
  let logSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    debugSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('passes the handler result through untouched', async () => {
    const interceptor = new LoggingInterceptor(config());
    const out = await lastValueFrom(
      interceptor.intercept(httpContext(), { handle: () => of({ ok: 1 }) }),
    );
    expect(out).toEqual({ ok: 1 });
  });

  it('at the default level request bodies (tokens, passwords) are never logged', async () => {
    const interceptor = new LoggingInterceptor(config());
    await lastValueFrom(interceptor.intercept(httpContext(), { handle: () => of({ accessToken: 'jwt' }) }));

    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).not.toContain('super-secret-firebase-token');
    expect(logged).not.toContain('"jwt"');
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('prefers the Cloudflare client IP and logs the user id when authenticated', async () => {
    const interceptor = new LoggingInterceptor(config());
    await lastValueFrom(
      interceptor.intercept(
        httpContext({ headers: { 'cf-connecting-ip': '1.2.3.4' }, user: { id: 'user-9' } }),
        { handle: () => of(null) },
      ),
    );
    const firstLine = logSpy.mock.calls[0][0] as string;
    expect(firstLine).toContain('1.2.3.4');
    expect(firstLine).toContain('user-9');
  });

  it('debug level logs through debug()', async () => {
    const interceptor = new LoggingInterceptor(config('debug'));
    await lastValueFrom(interceptor.intercept(httpContext(), { handle: () => of({}) }));
    expect(debugSpy).toHaveBeenCalledTimes(2);
  });

  it('errors are logged with their status and re-emitted unchanged', async () => {
    const interceptor = new LoggingInterceptor(config());
    const boom = Object.assign(new Error('nope'), { status: 403 });

    await expect(
      lastValueFrom(interceptor.intercept(httpContext(), { handle: () => throwError(() => boom) })),
    ).rejects.toBe(boom);
    expect(errorSpy.mock.calls[0][0]).toContain('Status: 403');
  });

  it('non-HTTP contexts (websocket, queue) bypass logging', async () => {
    const interceptor = new LoggingInterceptor(config());
    const ctx: any = { getType: () => 'ws' };
    const out = await lastValueFrom(interceptor.intercept(ctx, { handle: () => of('x') }));
    expect(out).toBe('x');
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe('TransformInterceptor', () => {
  it('wraps data as { success: true, data }', async () => {
    const out = await lastValueFrom(
      new TransformInterceptor().intercept({} as any, { handle: () => of([1, 2]) }),
    );
    expect(out).toEqual({ success: true, data: [1, 2] });
  });
});
