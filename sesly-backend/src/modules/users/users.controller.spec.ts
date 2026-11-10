import { serverText } from '../../common/i18n/server-text';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { StoriesService } from '../stories/stories.service';
import { StorageService } from '../storage/storage.service';
import { TTSProviderFactory } from '../tts-providers/tts-provider.factory';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';

jest.mock('firebase-admin', () => ({ apps: [], auth: jest.fn() }));
// Collaborators are provided as plain mocks below; replacing their modules
// keeps the (large) stories / TTS / storage import graph out of this test.
jest.mock('../stories/stories.service', () => ({ StoriesService: class StoriesService {} }));
jest.mock('../tts-providers/tts-provider.factory', () => ({ TTSProviderFactory: class TTSProviderFactory {} }));
jest.mock('../storage/storage.service', () => ({ StorageService: class StorageService {} }));

const AUTH_USER = 'auth-user-1';

/** Stand-in for the global JwtAuthGuard (`x-test-user` = verified token). */
@Injectable()
class FakeJwtGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const req = ctx.switchToHttp().getRequest();
    const id = req.headers['x-test-user'];
    if (id) req.user = { id };
    if (isPublic) return true;
    if (!id) throw new UnauthorizedException();
    return true;
  }
}

/** A DB user row carrying every secret column the response must never expose. */
function dbUser(overrides: Record<string, unknown> = {}) {
  return {
    id: AUTH_USER,
    email: 'anne@test.sesly',
    passwordHash: 'SECRET_PASSWORD_HASH',
    firstName: 'Ayse',
    lastName: 'Yilmaz',
    avatarUrl: 'avatars/auth-user-1/1-me.jpg',
    provider: 'GOOGLE',
    providerId: 'SECRET_FIREBASE_UID',
    emailVerified: true,
    emailVerificationToken: 'SECRET_VERIFY_TOKEN',
    passwordResetToken: 'SECRET_RESET_TOKEN',
    passwordResetExpires: new Date('2026-10-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    subscription: {
      id: 'sub-row',
      userId: AUTH_USER,
      plan: 'PRO',
      status: 'ACTIVE',
      currentPeriodEnd: new Date('2099-01-01T00:00:00Z'),
      stripeCustomerId: 'SECRET_STRIPE_CUSTOMER',
      stripeSubscriptionId: 'SECRET_STRIPE_SUB',
      appleTransactionId: 'SECRET_APPLE_TXN',
      appleOriginalTransactionId: 'SECRET_APPLE_ORIG',
      googlePurchaseToken: 'SECRET_GOOGLE_TOKEN',
    },
    ...overrides,
  };
}

const SAFE_KEYS = [
  'avatarUrl',
  'createdAt',
  'email',
  'emailVerified',
  'firstName',
  'id',
  'lastName',
  'profileImageUrl',
  'provider',
  'subscriptionExpiresAt',
  'subscriptionTier',
  'updatedAt',
];

describe('UsersController (HTTP)', () => {
  let app: INestApplication;
  let prisma: MockPrismaService;
  let usersService: UsersService;
  const storage = {
    getReadUrl: jest.fn(),
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
    deleteFolder: jest.fn(),
  };
  const stories = { getFavorites: jest.fn() };
  let spies: {
    deleteUser: jest.SpyInstance;
    getUserProfile: jest.SpyInstance;
    getStats: jest.SpyInstance;
    uploadAvatar: jest.SpyInstance;
  };

  beforeAll(async () => {
    prisma = createMockPrismaService();
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: TTSProviderFactory, useValue: { getCloningProvider: jest.fn() } },
        { provide: StoriesService, useValue: stories },
        { provide: APP_GUARD, useClass: FakeJwtGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    usersService = moduleRef.get(UsersService);
    spies = {
      deleteUser: jest.spyOn(usersService, 'deleteUser'),
      getUserProfile: jest.spyOn(usersService, 'getUserProfile'),
      getStats: jest.spyOn(usersService, 'getStats'),
      uploadAvatar: jest.spyOn(usersService, 'uploadAvatar'),
    };
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    storage.getReadUrl.mockImplementation(async (v: string | null) => (v ? `https://signed.test/${v}` : null));
    stories.getFavorites.mockResolvedValue({ data: [], meta: { page: 1 } });
    spies.deleteUser.mockResolvedValue({ message: 'Account deleted successfully' });
    spies.getUserProfile.mockResolvedValue({ user: { id: AUTH_USER } });
    spies.getStats.mockResolvedValue({ storiesCompleted: 1, hoursListened: 0.5, voicesTrained: 2 });
    spies.uploadAvatar.mockResolvedValue({ message: 'Avatar uploaded successfully' });
  });

  const http = () => request(app.getHttpServer());
  const authed = (req: request.Test) => req.set('x-test-user', AUTH_USER);

  function expectNoSecrets(body: unknown) {
    const json = JSON.stringify(body);
    expect(json).not.toMatch(/SECRET_/);
    for (const key of ['passwordHash', 'providerId', 'emailVerificationToken', 'passwordResetToken', 'passwordResetExpires', 'subscription']) {
      expect(json).not.toContain(`"${key}"`);
    }
  }

  it('no users route is public', () => {
    const methods = Object.getOwnPropertyNames(UsersController.prototype).filter((m) => m !== 'constructor');
    for (const m of methods) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, (UsersController.prototype as any)[m])).toBeUndefined();
    }
  });

  it.each([
    ['get', '/users/me'],
    ['patch', '/users/me'],
    ['delete', '/users/me'],
    ['get', '/users/me/profile'],
    ['get', '/users/me/stats'],
    ['get', '/users/me/favorites'],
    ['post', '/users/me/avatar'],
  ] as const)('%s %s requires auth', async (method, path) => {
    await (http() as any)[method](path).expect(401);
  });

  describe('GET /users/me', () => {
    it('returns only the allow-listed safe shape for the authenticated user', async () => {
      prisma.user.findUnique.mockResolvedValue(dbUser());

      const res = await authed(http().get('/users/me')).expect(200);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: AUTH_USER },
        include: { subscription: true },
      });
      expect(Object.keys(res.body).sort()).toEqual(SAFE_KEYS);
      expectNoSecrets(res.body);
      expect(res.body).toMatchObject({
        id: AUTH_USER,
        email: 'anne@test.sesly',
        subscriptionTier: 'PRO',
        avatarUrl: 'https://signed.test/avatars/auth-user-1/1-me.jpg',
        profileImageUrl: 'https://signed.test/avatars/auth-user-1/1-me.jpg',
      });
    });

    it('reports the effective tier: an expired admin grant is FREE', async () => {
      prisma.user.findUnique.mockResolvedValue(
        dbUser({
          subscription: {
            plan: 'CREATOR',
            status: 'ACTIVE',
            currentPeriodEnd: new Date('2020-01-01T00:00:00Z'),
            stripeSubscriptionId: null,
            appleTransactionId: null,
            googlePurchaseToken: null,
          },
        }),
      );

      const res = await authed(http().get('/users/me')).expect(200);
      expect(res.body.subscriptionTier).toBe('FREE');
    });

    it('404 when the authenticated user row is gone', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await authed(http().get('/users/me')).expect(404);
    });
  });

  describe('PATCH /users/me', () => {
    it('updates the authenticated user and returns the safe shape', async () => {
      prisma.user.update.mockImplementation(async (args: any) => dbUser({ ...args.data }));

      const res = await authed(http().patch('/users/me'))
        .send({ firstName: 'Zeynep', lastName: 'Kaya' })
        .expect(200);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: AUTH_USER },
        data: { firstName: 'Zeynep', lastName: 'Kaya' },
        include: { subscription: true },
      });
      expect(Object.keys(res.body).sort()).toEqual(SAFE_KEYS);
      expectNoSecrets(res.body);
      expect(res.body.firstName).toBe('Zeynep');
    });

    it.each([
      [{ emailVerified: true }],
      [{ passwordHash: 'x' }],
      [{ id: 'other-user' }],
      [{ subscriptionTier: 'CREATOR' }],
      [{ providerId: 'x' }],
    ])('rejects mass-assignment of %j with 400', async (body) => {
      await authed(http().patch('/users/me')).send(body).expect(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects any email (it belongs to the Firebase account) and over-long names with 400', async () => {
      await authed(http().patch('/users/me')).send({ email: 'not-an-email' }).expect(400);
      await authed(http().patch('/users/me')).send({ email: 'new@test.sesly' }).expect(400);
      await authed(http().patch('/users/me')).send({ firstName: 'a'.repeat(51) }).expect(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  it('DELETE /users/me deletes the authenticated account via UsersService.deleteUser', async () => {
    const res = await authed(http().delete('/users/me')).send({ userId: 'victim' }).expect(200);

    expect(spies.deleteUser).toHaveBeenCalledTimes(1);
    expect(spies.deleteUser).toHaveBeenCalledWith(AUTH_USER);
    expect(res.body).toEqual({ message: 'Account deleted successfully' });
  });

  it('GET /users/me/profile and /users/me/stats use the authenticated user', async () => {
    await authed(http().get('/users/me/profile')).expect(200);
    const stats = await authed(http().get('/users/me/stats')).expect(200);

    expect(spies.getUserProfile).toHaveBeenCalledWith(AUTH_USER);
    expect(spies.getStats).toHaveBeenCalledWith(AUTH_USER);
    expect(stats.body).toEqual({ storiesCompleted: 1, hoursListened: 0.5, voicesTrained: 2 });
  });

  describe('GET /users/me/favorites', () => {
    it('defaults to page 1 / limit 20', async () => {
      await authed(http().get('/users/me/favorites')).expect(200);
      expect(stories.getFavorites).toHaveBeenCalledWith(AUTH_USER, 1, 20);
    });

    it('forwards explicit pagination', async () => {
      await authed(http().get('/users/me/favorites?page=3&limit=5')).expect(200);
      expect(stories.getFavorites).toHaveBeenCalledWith(AUTH_USER, 3, 5);
    });

    it('rejects a limit above 100', async () => {
      await authed(http().get('/users/me/favorites?limit=500')).expect(400);
      expect(stories.getFavorites).not.toHaveBeenCalled();
    });
  });

  describe('POST /users/me/avatar', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    it('400 when no file is attached', async () => {
      const res = await authed(http().post('/users/me/avatar')).expect(400);
      expect(res.body.message).toBe('errors.upload.noFile');
      expect(serverText(res.body.message, 'tr')).toBe('Dosya yüklenmedi.');
      expect(spies.uploadAvatar).not.toHaveBeenCalled();
    });

    it('400 for a disallowed mime type', async () => {
      const res = await authed(http().post('/users/me/avatar'))
        .attach('avatar', png, { filename: 'a.gif', contentType: 'image/gif' })
        .expect(400);
      expect(serverText(res.body.message, 'tr')).toBe('Geçersiz dosya türü. Yalnızca JPG, PNG ve WebP yükleyebilirsin.');
      expect(spies.uploadAvatar).not.toHaveBeenCalled();
    });

    it('400 for a file over 5 MB', async () => {
      const big = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
      const res = await authed(http().post('/users/me/avatar'))
        .attach('avatar', big, { filename: 'big.png', contentType: 'image/png' })
        .expect(400);
      expect(serverText(res.body.message, 'tr')).toBe('Dosya çok büyük. En fazla 5 MB yükleyebilirsin.');
      expect(spies.uploadAvatar).not.toHaveBeenCalled();
    });

    it.each(['image/png', 'image/jpeg', 'image/webp'])('accepts %s for the authenticated user', async (type) => {
      await authed(http().post('/users/me/avatar'))
        .attach('avatar', png, { filename: 'me.img', contentType: type })
        .expect(201);

      expect(spies.uploadAvatar).toHaveBeenCalledTimes(1);
      const [userId, file] = spies.uploadAvatar.mock.calls[0];
      expect(userId).toBe(AUTH_USER);
      expect(file.mimetype).toBe(type);
      expect(Buffer.compare(file.buffer, png)).toBe(0);
    });
  });
});
