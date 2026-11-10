import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { LegalDocumentsController } from './legal-documents.controller';
import { LegalDocumentsService } from './legal-documents.service';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { LEGAL_DOCUMENT_LANGUAGE_MESSAGE } from './legal-languages';

/** Stand-in for the global JwtAuthGuard: non-public routes need `x-test-user`. */
@Injectable()
class FakeJwtGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const req = ctx.switchToHttp().getRequest();
    if (isPublic) return true;
    if (!req.headers['x-test-user']) throw new UnauthorizedException();
    return true;
  }
}

describe('LegalDocumentsController (HTTP, public)', () => {
  let app: INestApplication;
  const svc = { listPublic: jest.fn(), getPublicBySlug: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LegalDocumentsController],
      providers: [
        { provide: LegalDocumentsService, useValue: svc },
        { provide: APP_GUARD, useClass: FakeJwtGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // Same options as the global pipe in main.ts.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    svc.listPublic.mockReset();
    svc.getPublicBySlug.mockReset();
    svc.listPublic.mockResolvedValue([{ slug: 'tos', language: 'tr', version: 2 }]);
    svc.getPublicBySlug.mockImplementation(async (slug: string) => {
      if (slug === 'tos') {
        // English is not published: the Turkish text comes back, labelled tr.
        return { slug: 'tos', language: 'tr', title: 'Kullanım Şartları', contentMd: '# ToS', version: 2 };
      }
      throw new NotFoundException(`Legal document "${slug}" not found`);
    });
  });

  it('both routes are @Public (legal pages must be readable before sign-in)', () => {
    for (const m of ['list', 'getBySlug']) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, (LegalDocumentsController.prototype as any)[m])).toBe(true);
    }
  });

  it('GET /legal lists published documents anonymously; no language is passed on as undefined (tr)', async () => {
    const res = await request(app.getHttpServer()).get('/legal').expect(200);
    expect(res.body).toEqual([{ slug: 'tos', language: 'tr', version: 2 }]);
    expect(svc.listPublic).toHaveBeenCalledWith(undefined);
  });

  it('GET /legal?language=en forwards the language', async () => {
    await request(app.getHttpServer()).get('/legal?language=en').expect(200);
    expect(svc.listPublic).toHaveBeenCalledWith('en');
  });

  it('GET /legal/:slug returns the published snapshot anonymously (app builds in the field send no language)', async () => {
    const res = await request(app.getHttpServer()).get('/legal/tos').expect(200);
    expect(svc.getPublicBySlug).toHaveBeenCalledWith('tos', undefined);
    expect(res.body).toMatchObject({ slug: 'tos', language: 'tr', version: 2 });
  });

  it.each([
    ['en', 'en'],
    ['tr', 'tr'],
    ['EN', 'en'],
    ['en-US', 'en'],
    [' tr ', 'tr'],
  ])('GET /legal/:slug?language=%p is read as %p', async (sent, expected) => {
    const res = await request(app.getHttpServer())
      .get('/legal/tos')
      .query({ language: sent })
      .expect(200);
    expect(svc.getPublicBySlug).toHaveBeenCalledWith('tos', expected);
    // The fallback says which language was served.
    expect(res.body.language).toBe('tr');
  });

  it('an empty language is treated as absent', async () => {
    await request(app.getHttpServer()).get('/legal/tos?language=').expect(200);
    expect(svc.getPublicBySlug).toHaveBeenCalledWith('tos', undefined);
  });

  it.each(['de', 'xx', 'english'])('language=%p is rejected with 400 and the service is not called', async (bad) => {
    const res = await request(app.getHttpServer()).get('/legal/tos').query({ language: bad }).expect(400);
    expect(JSON.stringify(res.body)).toContain(LEGAL_DOCUMENT_LANGUAGE_MESSAGE);
    expect(svc.getPublicBySlug).not.toHaveBeenCalled();

    await request(app.getHttpServer()).get('/legal').query({ language: bad }).expect(400);
    expect(svc.listPublic).not.toHaveBeenCalled();
  });

  it('a repeated language parameter is rejected (400)', async () => {
    await request(app.getHttpServer()).get('/legal/tos?language=en&language=tr').expect(400);
    expect(svc.getPublicBySlug).not.toHaveBeenCalled();
  });

  it('an unknown query parameter is rejected (forbidNonWhitelisted)', async () => {
    await request(app.getHttpServer()).get('/legal/tos?lang=en').expect(400);
    expect(svc.getPublicBySlug).not.toHaveBeenCalled();
  });

  it('GET /legal/:slug for an unknown / never-published slug -> 404', async () => {
    const res = await request(app.getHttpServer()).get('/legal/unknown').expect(404);
    expect(res.body.message).toBe('Legal document "unknown" not found');
  });
});
