import { Controller, Get, HttpStatus, INestApplication, NotFoundException } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { mapPrismaError, PrismaExceptionFilter } from './prisma-exception.filter';
import { HttpExceptionFilter } from './http-exception.filter';
import { createSettingsStub } from '../../test-utils/settings-stub';

function createHost(url = '/stories/abc') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const req = { url, method: 'POST', headers: {} };
  const host: any = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => req,
    }),
  };
  return { host, status, json };
}

const prismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(`Prisma ${code}`, {
    code,
    clientVersion: 'test',
    meta,
  });

describe('PrismaExceptionFilter', () => {
  const filter = new PrismaExceptionFilter();

  it.each([
    ['P2002', { target: ['email'] }, HttpStatus.CONFLICT, 'Unique constraint failed on field: email'],
    [
      'P2002',
      { target: ['userId', 'storyId', 'voiceProfileId'] },
      HttpStatus.CONFLICT,
      'Unique constraint failed on field: userId,storyId,voiceProfileId',
    ],
    ['P2002', { target: 'users_email_key' }, HttpStatus.CONFLICT, 'Unique constraint failed on field: users_email_key'],
    ['P2002', undefined, HttpStatus.CONFLICT, 'Unique constraint failed on field: undefined'],
    ['P2025', { cause: 'Record to update not found.' }, HttpStatus.NOT_FOUND, 'Record not found'],
    ['P2003', { field_name: 'userId' }, HttpStatus.BAD_REQUEST, 'Foreign key constraint failed'],
    ['P2000', undefined, HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error'],
    ['P2034', undefined, HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error'],
    ['P1001', undefined, HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error'],
  ])('%s %j -> %i %p', (code, meta, expectedStatus, expectedMessage) => {
    const { host, status, json } = createHost();

    filter.catch(prismaError(code, meta), host);

    expect(status).toHaveBeenCalledWith(expectedStatus);
    const body = json.mock.calls[0][0];
    expect(body).toEqual({
      statusCode: expectedStatus,
      timestamp: expect.any(String),
      path: '/stories/abc',
      message: expectedMessage,
    });
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it('handles plain objects carrying a Prisma code (no instanceof check)', () => {
    const { host, status } = createHost();
    filter.catch({ code: 'P2025' }, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
  });

  it.each([
    ['HttpException', new NotFoundException('Masal bulunamadı')],
    ['plain Error', new Error('boom')],
    ['Node system error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })],
    ['empty code', Object.assign(new Error('x'), { code: '' })],
  ])('rethrows non-Prisma exceptions untouched (%s)', (_label, exception) => {
    const { host, status } = createHost();
    expect(() => filter.catch(exception, host)).toThrow(exception);
    expect(status).not.toHaveBeenCalled();
  });

  // Fixed (was BUG): `exception.code.startsWith('P')` crashed on the NUMERIC
  // codes of Google client errors (GCS ApiError `code: 404`, gRPC `code: 3`).
  it('rethrows errors with a numeric code (GCS ApiError / gRPC) unchanged', () => {
    const { host } = createHost();
    const gcsError = Object.assign(new Error('No such object'), { code: 404 });
    expect(() => filter.catch(gcsError, host)).toThrow(gcsError);
  });

  describe('mapPrismaError', () => {
    it.each([
      [null],
      [undefined],
      ['P2002'],
      [{ code: 3 }],
      [{ code: 'PX' }],
      [{ code: 'P20021' }],
      [Object.assign(new Error('x'), { code: 'ECONNREFUSED' })],
    ])('%p is not a Prisma error', (value) => {
      expect(mapPrismaError(value)).toBeNull();
    });

    it('maps the handled codes and treats the rest as 500', () => {
      expect(mapPrismaError(prismaError('P2002', { target: ['email'] }))).toEqual({
        status: 409,
        message: 'Unique constraint failed on field: email',
      });
      expect(mapPrismaError({ code: 'P2025' })).toEqual({ status: 404, message: 'Record not found' });
      expect(mapPrismaError({ code: 'P2003' })).toEqual({ status: 400, message: 'Foreign key constraint failed' });
      expect(mapPrismaError({ code: 'P1001' })).toEqual({ status: 500, message: 'Internal server error' });
    });
  });

  describe('app wiring', () => {
    @Controller('probe')
    class ProbeController {
      @Get('duplicate')
      duplicate() {
        throw prismaError('P2002', { target: ['email'] });
      }

      @Get('missing')
      missing() {
        throw prismaError('P2025');
      }

      @Get('crash')
      crash() {
        throw Object.assign(new Error('No such object'), { code: 404 });
      }
    }

    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [ProbeController],
        providers: [{ provide: APP_FILTER, useClass: PrismaExceptionFilter }],
      }).compile();
      app = moduleRef.createNestApplication({ logger: false });
      // Same registration order as main.ts + app.module.ts.
      app.useGlobalFilters(new HttpExceptionFilter({ t: (key: string) => key } as any, createSettingsStub() as any));
      await app.init();
    });

    afterAll(async () => {
      await app?.close();
    });

    // Fixed (was BUG): both filters are @Catch() catch-alls and Nest runs the
    // LAST registered global one, so HttpExceptionFilter handled everything and
    // an unhandled P2002 became 500. HttpExceptionFilter now maps Prisma errors
    // itself (and app.module no longer registers PrismaExceptionFilter).
    it('an unhandled P2002 reaches the client as 409', async () => {
      const res = await request(app.getHttpServer()).get('/probe/duplicate');
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        success: false,
        statusCode: 409,
        message: 'Unique constraint failed on field: email',
        path: '/probe/duplicate',
      });
    });

    it('an unhandled P2025 reaches the client as 404 and a non-Prisma error stays 500', async () => {
      expect((await request(app.getHttpServer()).get('/probe/missing')).status).toBe(404);
      const crash = await request(app.getHttpServer()).get('/probe/crash');
      expect(crash.status).toBe(500);
      expect(crash.body.message).toBe('Internal server error');
    });
  });
});
