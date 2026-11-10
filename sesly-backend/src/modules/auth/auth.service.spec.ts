import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService, EMAIL_IN_USE_CODE, EMAIL_IN_USE_MESSAGE } from './auth.service';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createMockUser, createMockSubscription } from '../../test-utils/mock-factories';

// firebase-admin is fully mocked: no SDK init, no network. The mock object is
// reached through jest.requireMock so tests can drive apps / verifyIdToken.
jest.mock('firebase-admin', () => {
  const verifyIdToken = jest.fn();
  return {
    apps: [] as any[],
    initializeApp: jest.fn(),
    credential: { cert: jest.fn((c: any) => ({ __cert: c })) },
    auth: jest.fn(() => ({ verifyIdToken })),
    __verifyIdToken: verifyIdToken,
  };
});

type FirebaseMock = {
  apps: any[];
  initializeApp: jest.Mock;
  credential: { cert: jest.Mock };
  auth: jest.Mock;
  __verifyIdToken: jest.Mock;
};
const firebase = jest.requireMock('firebase-admin') as FirebaseMock;

const CONFIG: Record<string, string | undefined> = {
  'jwt.secret': 'unit-access-secret',
  'jwt.refreshSecret': 'unit-refresh-secret',
  'jwt.expiresIn': '1h',
  'jwt.refreshExpiresIn': '7d',
};

const NOW = new Date('2026-09-28T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const AUTH_RESPONSE_KEYS = ['accessToken', 'refreshToken', 'user'].sort();
const AUTH_USER_KEYS = [
  'id',
  'email',
  'firstName',
  'lastName',
  'emailVerified',
  'provider',
  'profileImageUrl',
  'subscriptionTier',
  'subscriptionExpiresAt',
  'createdAt',
  'updatedAt',
].sort();

function decodedToken(overrides: Record<string, any> = {}) {
  return {
    uid: 'firebase-uid-1',
    email: 'ayse@example.com',
    email_verified: true,
    name: 'Ayse Yilmaz',
    picture: 'https://lh3.googleusercontent.com/a/pic',
    firebase: { sign_in_provider: 'google.com' },
    ...overrides,
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: MockPrismaService;
  let jwtService: JwtService;
  let configService: { get: jest.Mock };
  let emailService: { sendWelcomeEmail: jest.Mock };
  let storageService: { getReadUrl: jest.Mock };
  let config: Record<string, string | undefined>;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });

    prisma = createMockPrismaService();
    jwtService = new JwtService({});
    config = { ...CONFIG };
    configService = { get: jest.fn((key: string) => config[key]) };
    emailService = { sendWelcomeEmail: jest.fn().mockResolvedValue(undefined) };
    storageService = {
      getReadUrl: jest.fn(async (value: string | null | undefined) => (value ? `signed:${value}` : null)),
    };

    firebase.apps.length = 0;
    firebase.__verifyIdToken.mockReset();

    service = new AuthService(
      prisma as any,
      jwtService,
      configService as any,
      emailService as any,
      storageService as any,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function verifyAccess(token: string) {
    return jwtService.verify(token, { secret: CONFIG['jwt.secret'] });
  }

  function verifyRefresh(token: string) {
    return jwtService.verify(token, { secret: CONFIG['jwt.refreshSecret'] });
  }

  function signRefresh(payload: Record<string, any>, opts: Record<string, any> = {}) {
    return jwtService.sign(payload, { secret: CONFIG['jwt.refreshSecret'], expiresIn: '7d', ...opts });
  }

  /** Wires prisma for a first-time login: lookup miss, create, reload with FREE sub. */
  function arrangeNewUser(created: any, subscription: any = null) {
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...created, subscription });
    prisma.user.create.mockResolvedValue(created);
    prisma.subscription.create.mockResolvedValue({ id: 'sub-new', userId: created.id, plan: 'FREE' });
  }

  function expectAuthResponseShape(res: any) {
    expect(Object.keys(res).sort()).toEqual(AUTH_RESPONSE_KEYS);
    expect(Object.keys(res.user).sort()).toEqual(AUTH_USER_KEYS);
    expect(typeof res.accessToken).toBe('string');
    expect(typeof res.refreshToken).toBe('string');
  }

  // ---------------------------------------------------------------------------
  // onModuleInit (Firebase Admin bootstrap)
  // ---------------------------------------------------------------------------

  describe('onModuleInit', () => {
    it('does not re-initialize Firebase when an app already exists', () => {
      firebase.apps.push({});
      config['firebase.serviceAccountPath'] = './certs/firebase.json';

      service.onModuleInit();

      expect(firebase.initializeApp).not.toHaveBeenCalled();
    });

    it('initializes with the service account file when a path is configured', () => {
      config['firebase.serviceAccountPath'] = './certs/firebase.json';
      config['firebase.projectId'] = 'proj';
      config['firebase.clientEmail'] = 'sa@proj.iam';
      config['firebase.privateKey'] = 'KEY';

      service.onModuleInit();

      expect(firebase.credential.cert).toHaveBeenCalledWith('./certs/firebase.json');
      expect(firebase.initializeApp).toHaveBeenCalledWith({
        credential: { __cert: './certs/firebase.json' },
      });
    });

    it('falls back to env credentials when no service account path is configured', () => {
      config['firebase.projectId'] = 'proj';
      config['firebase.clientEmail'] = 'sa@proj.iam';
      config['firebase.privateKey'] = 'KEY';

      service.onModuleInit();

      expect(firebase.credential.cert).toHaveBeenCalledWith({
        projectId: 'proj',
        clientEmail: 'sa@proj.iam',
        privateKey: 'KEY',
      });
      expect(firebase.initializeApp).toHaveBeenCalledTimes(1);
    });

    it('skips initialization when env credentials are incomplete', () => {
      config['firebase.projectId'] = 'proj';
      config['firebase.clientEmail'] = 'sa@proj.iam';

      service.onModuleInit();

      expect(firebase.initializeApp).not.toHaveBeenCalled();
    });

    it('swallows initialization errors so the app still boots', () => {
      config['firebase.serviceAccountPath'] = './missing.json';
      firebase.initializeApp.mockImplementationOnce(() => {
        throw new Error('ENOENT');
      });

      expect(() => service.onModuleInit()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // verifyFirebaseToken
  // ---------------------------------------------------------------------------

  describe('verifyFirebaseToken', () => {
    describe('invalid tokens', () => {
      it('rejects an invalid/expired Firebase token with 401 and touches nothing', async () => {
        firebase.__verifyIdToken.mockRejectedValue(
          Object.assign(new Error('Firebase ID token has expired'), { code: 'auth/id-token-expired' }),
        );

        await expect(service.verifyFirebaseToken({ idToken: 'expired' })).rejects.toThrow(
          new UnauthorizedException('Invalid Firebase token'),
        );
        expect(firebase.__verifyIdToken).toHaveBeenCalledWith('expired');
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
        expect(prisma.user.create).not.toHaveBeenCalled();
        expect(prisma.user.update).not.toHaveBeenCalled();
      });

      it('rejects a token without an email claim with 401 and creates no user', async () => {
        firebase.__verifyIdToken.mockResolvedValue(decodedToken({ email: undefined }));

        await expect(service.verifyFirebaseToken({ idToken: 'no-email' })).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
        expect(prisma.user.create).not.toHaveBeenCalled();
      });

      it('returns 401 when the freshly created user cannot be reloaded', async () => {
        firebase.__verifyIdToken.mockResolvedValue(decodedToken());
        prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
        prisma.user.create.mockResolvedValue(createMockUser({ id: 'u-new', email: 'ayse@example.com' }));
        prisma.subscription.create.mockResolvedValue({});

        await expect(service.verifyFirebaseToken({ idToken: 't' })).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
        expect(emailService.sendWelcomeEmail).not.toHaveBeenCalled();
      });
    });

    describe('first login (user creation)', () => {
      it('creates the user, a FREE/ACTIVE subscription, sends welcome mail and issues a JWT pair', async () => {
        firebase.__verifyIdToken.mockResolvedValue(decodedToken());
        const created = createMockUser({
          id: 'u-new',
          email: 'ayse@example.com',
          firstName: 'Ayse',
          lastName: 'Yilmaz',
          provider: 'GOOGLE',
          providerId: 'firebase-uid-1',
          emailVerified: true,
          avatarUrl: 'https://lh3.googleusercontent.com/a/pic',
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          updatedAt: new Date('2026-09-02T00:00:00.000Z'),
        });
        arrangeNewUser(
          created,
          createMockSubscription({ userId: 'u-new', plan: 'FREE', status: 'ACTIVE', currentPeriodEnd: null }),
        );

        const res = await service.verifyFirebaseToken({ idToken: 'good' });

        // lookup is by the token email and includes the subscription
        expect(prisma.user.findUnique).toHaveBeenNthCalledWith(1, {
          where: { email: 'ayse@example.com' },
          include: { subscription: true },
        });
        expect(prisma.user.create).toHaveBeenCalledWith({
          data: {
            email: 'ayse@example.com',
            providerId: 'firebase-uid-1',
            firstName: 'Ayse',
            lastName: 'Yilmaz',
            provider: 'GOOGLE',
            emailVerified: true,
            avatarUrl: 'https://lh3.googleusercontent.com/a/pic',
          },
        });
        expect(prisma.subscription.create).toHaveBeenCalledWith({
          data: { userId: 'u-new', plan: 'FREE', status: 'ACTIVE' },
        });
        expect(prisma.user.findUnique).toHaveBeenNthCalledWith(2, {
          where: { id: 'u-new' },
          include: { subscription: true },
        });
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith('ayse@example.com', 'Ayse', 'tr');

        expectAuthResponseShape(res);
        expect(res.user).toEqual({
          id: 'u-new',
          email: 'ayse@example.com',
          firstName: 'Ayse',
          lastName: 'Yilmaz',
          emailVerified: true,
          provider: 'GOOGLE',
          profileImageUrl: 'signed:https://lh3.googleusercontent.com/a/pic',
          subscriptionTier: 'FREE',
          subscriptionExpiresAt: null,
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-02T00:00:00.000Z',
        });
        expect(storageService.getReadUrl).toHaveBeenCalledWith('https://lh3.googleusercontent.com/a/pic');
      });

      it.each([
        ['google.com', 'GOOGLE'],
        ['apple.com', 'APPLE'],
        ['password', 'EMAIL'],
        ['phone', 'EMAIL'],
        [undefined, 'EMAIL'],
      ])('maps Firebase sign_in_provider %p to provider %p', async (signIn, expected) => {
        firebase.__verifyIdToken.mockResolvedValue(
          decodedToken({ firebase: signIn === undefined ? undefined : { sign_in_provider: signIn } }),
        );
        const created = createMockUser({ id: 'u-new', email: 'ayse@example.com', provider: expected });
        arrangeNewUser(created);

        await service.verifyFirebaseToken({ idToken: 't' });

        expect(prisma.user.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ provider: expected }),
        });
      });

      it('prefers DTO names over the token display name', async () => {
        firebase.__verifyIdToken.mockResolvedValue(decodedToken({ name: 'Token Name' }));
        arrangeNewUser(createMockUser({ id: 'u-new', email: 'ayse@example.com' }));

        await service.verifyFirebaseToken({ idToken: 't', firstName: 'Suleyman', lastName: 'Karaca' });

        expect(prisma.user.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ firstName: 'Suleyman', lastName: 'Karaca' }),
        });
        expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith('ayse@example.com', 'Suleyman', 'tr');
      });

      it('sends the welcome email in the Accept-Language of the first sign in', async () => {
        firebase.__verifyIdToken.mockResolvedValue(decodedToken({ name: 'Token Name' }));
        arrangeNewUser(createMockUser({ id: 'u-new', email: 'ayse@example.com' }));

        await service.verifyFirebaseToken({ idToken: 't', firstName: 'Emma' }, 'en-GB');

        expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith('ayse@example.com', 'Emma', 'en');
      });

      it('parses a multi-word display name: last word is lastName, the rest is firstName', async () => {
        firebase.__verifyIdToken.mockResolvedValue(decodedToken({ name: '  Ali   Veli  Yilmaz ' }));
        arrangeNewUser(createMockUser({ id: 'u-new', email: 'ayse@example.com' }));

        await service.verifyFirebaseToken({ idToken: 't' });

        expect(prisma.user.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ firstName: 'Ali Veli', lastName: 'Yilmaz' }),
        });
      });

      it('keeps a DTO lastName when only the firstName comes from the display name', async () => {
        firebase.__verifyIdToken.mockResolvedValue(decodedToken({ name: 'Ayse Yilmaz' }));
        arrangeNewUser(createMockUser({ id: 'u-new', email: 'ayse@example.com' }));

        await service.verifyFirebaseToken({ idToken: 't', lastName: 'Karaca' });

        expect(prisma.user.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ firstName: 'Ayse', lastName: 'Karaca' }),
        });
      });

      it('single-word display name becomes firstName with no lastName', async () => {
        firebase.__verifyIdToken.mockResolvedValue(decodedToken({ name: 'Ayse' }));
        arrangeNewUser(createMockUser({ id: 'u-new', email: 'ayse@example.com' }));

        await service.verifyFirebaseToken({ idToken: 't' });

        expect(prisma.user.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ firstName: 'Ayse', lastName: undefined }),
        });
      });

      it('falls back to "User" in the welcome email when no name is known', async () => {
        firebase.__verifyIdToken.mockResolvedValue(decodedToken({ name: undefined }));
        arrangeNewUser(createMockUser({ id: 'u-new', email: 'ayse@example.com' }));

        await service.verifyFirebaseToken({ idToken: 't' });

        expect(prisma.user.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ firstName: undefined, lastName: undefined }),
        });
        expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith('ayse@example.com', undefined, 'tr');
      });

      it('defaults emailVerified to true when the claim is absent, keeps false when explicit', async () => {
        firebase.__verifyIdToken.mockResolvedValue(decodedToken({ email_verified: undefined }));
        arrangeNewUser(createMockUser({ id: 'u-new', email: 'ayse@example.com' }));
        await service.verifyFirebaseToken({ idToken: 't' });
        expect(prisma.user.create).toHaveBeenLastCalledWith({
          data: expect.objectContaining({ emailVerified: true }),
        });

        firebase.__verifyIdToken.mockResolvedValue(decodedToken({ email_verified: false }));
        arrangeNewUser(createMockUser({ id: 'u-new-2', email: 'ayse@example.com' }));
        await service.verifyFirebaseToken({ idToken: 't' });
        expect(prisma.user.create).toHaveBeenLastCalledWith({
          data: expect.objectContaining({ emailVerified: false }),
        });
      });

      it('still logs the user in when the welcome email fails', async () => {
        firebase.__verifyIdToken.mockResolvedValue(decodedToken());
        arrangeNewUser(createMockUser({ id: 'u-new', email: 'ayse@example.com' }));
        emailService.sendWelcomeEmail.mockRejectedValue(new Error('resend down'));

        const res = await service.verifyFirebaseToken({ idToken: 't' });

        expectAuthResponseShape(res);
        expect(res.user.id).toBe('u-new');
      });
    });

    describe('repeat login (existing user)', () => {
      it('updates provider linkage in place; no create, no subscription, no welcome email', async () => {
        firebase.__verifyIdToken.mockResolvedValue(
          decodedToken({ uid: 'firebase-uid-2', firebase: { sign_in_provider: 'apple.com' }, picture: 'https://new/pic.png' }),
        );
        const existing = createMockUser({
          id: 'u-1',
          email: 'ayse@example.com',
          provider: 'GOOGLE',
          providerId: 'firebase-uid-1',
          emailVerified: false,
          avatarUrl: 'avatars/u-1/old.jpg',
          firstName: 'Ayse',
          lastName: 'Yilmaz',
        });
        prisma.user.findUnique.mockResolvedValue({ ...existing, subscription: null });
        prisma.user.update.mockResolvedValue({
          ...existing,
          provider: 'APPLE',
          providerId: 'firebase-uid-2',
          emailVerified: true,
          avatarUrl: 'https://new/pic.png',
          subscription: null,
        });

        const res = await service.verifyFirebaseToken({ idToken: 't', firstName: 'Ignored', lastName: 'Ignored' });

        expect(prisma.user.update).toHaveBeenCalledWith({
          where: { id: 'u-1' },
          data: {
            providerId: 'firebase-uid-2',
            provider: 'APPLE',
            emailVerified: true,
            avatarUrl: 'https://new/pic.png',
          },
          include: { subscription: true },
        });
        expect(prisma.user.create).not.toHaveBeenCalled();
        expect(prisma.subscription.create).not.toHaveBeenCalled();
        expect(emailService.sendWelcomeEmail).not.toHaveBeenCalled();

        expectAuthResponseShape(res);
        expect(res.user.provider).toBe('APPLE');
        expect(res.user.firstName).toBe('Ayse');
      });

      it('keeps the stored avatar and emailVerified when the token omits them', async () => {
        firebase.__verifyIdToken.mockResolvedValue(
          decodedToken({ picture: undefined, email_verified: undefined }),
        );
        const existing = createMockUser({
          id: 'u-1',
          email: 'ayse@example.com',
          providerId: 'firebase-uid-1',
          emailVerified: true,
          avatarUrl: 'avatars/u-1/me.jpg',
        });
        // Same Firebase account (uid match): no email_verified claim needed.
        prisma.user.findFirst.mockResolvedValue({ ...existing, subscription: null });
        prisma.user.update.mockResolvedValue({ ...existing, subscription: null });

        await service.verifyFirebaseToken({ idToken: 't' });

        expect(prisma.user.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ emailVerified: true, avatarUrl: 'avatars/u-1/me.jpg' }),
          }),
        );
      });

      it('re-login with the same uid works even while the email is still unverified', async () => {
        firebase.__verifyIdToken.mockResolvedValue(
          decodedToken({ uid: 'uid-same', email_verified: false, firebase: { sign_in_provider: 'password' } }),
        );
        const existing = createMockUser({ id: 'u-1', email: 'ayse@example.com', providerId: 'uid-same', provider: 'EMAIL' });
        prisma.user.findFirst.mockResolvedValue({ ...existing, subscription: null });
        prisma.user.update.mockResolvedValue({ ...existing, emailVerified: false, subscription: null });

        const res = await service.verifyFirebaseToken({ idToken: 't' });

        expect(prisma.user.findFirst).toHaveBeenCalledWith({
          where: { providerId: 'uid-same' },
          include: { subscription: true },
        });
        // Resolved by uid: the email lookup is never needed.
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
        expect(res.user.id).toBe('u-1');
      });

      it('the uid match wins over a different account that owns the token email', async () => {
        firebase.__verifyIdToken.mockResolvedValue(
          decodedToken({ uid: 'uid-a', email: 'new@example.com', email_verified: true }),
        );
        const owner = createMockUser({ id: 'u-a', email: 'old@example.com', providerId: 'uid-a' });
        prisma.user.findFirst.mockResolvedValue({ ...owner, subscription: null });
        prisma.user.update.mockResolvedValue({ ...owner, subscription: null });

        const res = await service.verifyFirebaseToken({ idToken: 't' });

        expect(res.user.id).toBe('u-a');
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
        expect(prisma.user.update).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'u-a' }, data: expect.objectContaining({ providerId: 'uid-a' }) }),
        );
      });

      it('links a verified identity with a new uid to the existing account and stores the uid', async () => {
        firebase.__verifyIdToken.mockResolvedValue(
          decodedToken({ uid: 'google-uid', email_verified: true, firebase: { sign_in_provider: 'google.com' } }),
        );
        const existing = createMockUser({ id: 'u-1', email: 'ayse@example.com', providerId: 'password-uid', provider: 'EMAIL' });
        prisma.user.findFirst.mockResolvedValue(null);
        prisma.user.findUnique.mockResolvedValue({ ...existing, subscription: null });
        prisma.user.update.mockResolvedValue({ ...existing, providerId: 'google-uid', provider: 'GOOGLE', subscription: null });

        const res = await service.verifyFirebaseToken({ idToken: 't' });

        expect(res.user.id).toBe('u-1');
        expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({ providerId: 'google-uid', provider: 'GOOGLE' });
      });

      it.each([
        ['email_verified false', false],
        ['email_verified claim missing', undefined],
        ['email_verified as the string "true"', 'true'],
      ])('409 EMAIL_IN_USE for an existing email when %s (different uid)', async (_label, claim) => {
        firebase.__verifyIdToken.mockResolvedValue(
          decodedToken({ uid: 'other-uid', email_verified: claim, firebase: { sign_in_provider: 'password' } }),
        );
        const existing = createMockUser({ id: 'u-1', email: 'ayse@example.com', providerId: 'google-uid' });
        prisma.user.findFirst.mockResolvedValue(null);
        prisma.user.findUnique.mockResolvedValue({ ...existing, subscription: null });

        const err = await service.verifyFirebaseToken({ idToken: 't' }).catch((e) => e);

        expect(err).toBeInstanceOf(ConflictException);
        expect(err.getStatus()).toBe(409);
        expect(err.getResponse()).toEqual({ code: EMAIL_IN_USE_CODE, message: EMAIL_IN_USE_MESSAGE });
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(prisma.user.create).not.toHaveBeenCalled();
      });

      // Fixed (was BUG, account takeover): verifyFirebaseToken linked a Firebase
      // identity to an existing backend user purely by email. Anyone can create
      // an (unverified) Firebase email/password account for an address they do
      // not own, e.g. the system test user `voice-test@sesly.local`, and got a
      // JWT pair for the victim. Now the uid is resolved first and an email
      // match is only linked for email_verified === true. The refusal is a 409
      // EMAIL_IN_USE (the contract the mobile client handles), not the 401 this
      // test first expected.
      it('refuses to link an unverified Firebase identity (different uid) to an existing account', async () => {
        firebase.__verifyIdToken.mockResolvedValue(
          decodedToken({ uid: 'attacker-uid', email: 'voice-test@sesly.local', email_verified: false, firebase: { sign_in_provider: 'password' } }),
        );
        const victim = createMockUser({ id: 'victim', email: 'voice-test@sesly.local', providerId: null });
        prisma.user.findFirst.mockResolvedValue(null);
        prisma.user.findUnique.mockResolvedValue({ ...victim, subscription: null });
        prisma.user.update.mockResolvedValue({ ...victim, subscription: null });

        const err = await service.verifyFirebaseToken({ idToken: 't' }).catch((e) => e);
        expect(err).toBeInstanceOf(ConflictException);
        expect(err.getResponse()).toMatchObject({ code: 'EMAIL_IN_USE' });
        expect(prisma.user.update).not.toHaveBeenCalled();
      });
    });

    describe('effective plan in the auth response', () => {
      async function loginWithSubscription(subscription: any) {
        firebase.__verifyIdToken.mockResolvedValue(decodedToken());
        const existing = createMockUser({ id: 'u-1', email: 'ayse@example.com' });
        prisma.user.findUnique.mockResolvedValue({ ...existing, subscription });
        prisma.user.update.mockResolvedValue({ ...existing, subscription });
        return service.verifyFirebaseToken({ idToken: 't' });
      }

      const noStore = { stripeSubscriptionId: null, appleTransactionId: null, googlePurchaseToken: null };

      it('expired admin grant (PRO, period ended, no store billing) resolves to FREE', async () => {
        const end = new Date(NOW.getTime() - DAY);
        const res = await loginWithSubscription(
          createMockSubscription({ plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: end, ...noStore }),
        );

        expect(res.user.subscriptionTier).toBe('FREE');
        expect(res.user.subscriptionExpiresAt).toBe(end.toISOString());
      });

      it('active PRO grant stays PRO and exposes the period end as ISO string', async () => {
        const end = new Date(NOW.getTime() + 10 * DAY);
        const res = await loginWithSubscription(
          createMockSubscription({ plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: end, ...noStore }),
        );

        expect(res.user.subscriptionTier).toBe('PRO');
        expect(res.user.subscriptionExpiresAt).toBe(end.toISOString());
      });

      it('store-billed PRO within the 24h renewal grace stays PRO', async () => {
        const end = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
        const res = await loginWithSubscription(
          createMockSubscription({
            plan: 'PRO',
            status: 'ACTIVE',
            currentPeriodEnd: end,
            stripeSubscriptionId: null,
            appleTransactionId: 'apple-tx-1',
            googlePurchaseToken: null,
          }),
        );

        expect(res.user.subscriptionTier).toBe('PRO');
      });

      it('status EXPIRED resolves to FREE even with a future period end', async () => {
        const res = await loginWithSubscription(
          createMockSubscription({ plan: 'CREATOR', status: 'EXPIRED', currentPeriodEnd: new Date(NOW.getTime() + DAY) }),
        );

        expect(res.user.subscriptionTier).toBe('FREE');
      });

      it('no subscription row yields null tier and null expiry', async () => {
        const res = await loginWithSubscription(null);

        expect(res.user.subscriptionTier).toBeNull();
        expect(res.user.subscriptionExpiresAt).toBeNull();
      });
    });

    describe('issued tokens and secrecy', () => {
      it('access/refresh tokens carry only sub+email+tv, use separate secrets and configured lifetimes', async () => {
        firebase.__verifyIdToken.mockResolvedValue(decodedToken());
        const existing = createMockUser({ id: 'u-1', email: 'ayse@example.com', tokenVersion: 3 });
        prisma.user.findUnique.mockResolvedValue({ ...existing, subscription: null });
        prisma.user.update.mockResolvedValue({ ...existing, subscription: null });

        const res = await service.verifyFirebaseToken({ idToken: 't' });

        const access = verifyAccess(res.accessToken);
        const refresh = verifyRefresh(res.refreshToken);
        expect(Object.keys(access).sort()).toEqual(['email', 'exp', 'iat', 'sub', 'tv']);
        expect(Object.keys(refresh).sort()).toEqual(['email', 'exp', 'iat', 'sub', 'tv']);
        // tv = the account's current session generation (users.tokenVersion)
        expect(access).toMatchObject({ sub: 'u-1', email: 'ayse@example.com', tv: 3 });
        expect(refresh).toMatchObject({ sub: 'u-1', email: 'ayse@example.com', tv: 3 });
        expect(access.exp - access.iat).toBe(60 * 60);
        expect(refresh.exp - refresh.iat).toBe(7 * 24 * 60 * 60);

        // secrets are not interchangeable
        expect(() => verifyRefresh(res.accessToken)).toThrow();
        expect(() => verifyAccess(res.refreshToken)).toThrow();
      });

      it('a brand-new user gets tokens of generation 0', async () => {
        firebase.__verifyIdToken.mockResolvedValue(decodedToken());
        arrangeNewUser(createMockUser({ id: 'u-new', email: 'ayse@example.com' }));

        const res = await service.verifyFirebaseToken({ idToken: 't' });

        expect(verifyAccess(res.accessToken).tv).toBe(0);
        expect(verifyRefresh(res.refreshToken).tv).toBe(0);
      });

      it('never leaks password hash, verification/reset tokens or signing secrets', async () => {
        firebase.__verifyIdToken.mockResolvedValue(decodedToken());
        const existing = createMockUser({
          id: 'u-1',
          email: 'ayse@example.com',
          passwordHash: '$2b$12$SECRETHASHSECRETHASHSECRETHASHSECRETHASHSECRET',
          emailVerificationToken: 'verify-token-secret',
          passwordResetToken: 'reset-token-secret',
          passwordResetExpires: new Date(NOW.getTime() + DAY),
        });
        prisma.user.findUnique.mockResolvedValue({ ...existing, subscription: null });
        prisma.user.update.mockResolvedValue({ ...existing, subscription: null });

        const res: any = await service.verifyFirebaseToken({ idToken: 't' });
        const json = JSON.stringify(res);

        for (const forbidden of ['passwordHash', 'emailVerificationToken', 'passwordResetToken', 'passwordResetExpires', 'providerId', 'avatarUrl']) {
          expect(res.user).not.toHaveProperty(forbidden);
        }
        expect(json).not.toContain('SECRETHASH');
        expect(json).not.toContain('verify-token-secret');
        expect(json).not.toContain('reset-token-secret');
        expect(json).not.toContain(CONFIG['jwt.secret']);
        expect(json).not.toContain(CONFIG['jwt.refreshSecret']);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // refreshTokens
  // ---------------------------------------------------------------------------

  describe('UI language from Accept-Language (sign in, refresh)', () => {
    const existingLogin = () => {
      firebase.__verifyIdToken.mockResolvedValue(decodedToken());
      const existing = createMockUser({ id: 'u-1', email: 'ayse@example.com' });
      prisma.user.findUnique.mockResolvedValue({ ...existing, subscription: null });
      prisma.user.update.mockResolvedValue({ ...existing, subscription: null });
    };

    it('an existing user signing in with en-US gets uiLanguage en stored', async () => {
      existingLogin();
      await service.verifyFirebaseToken({ idToken: 't' }, 'en-US,en;q=0.9');
      expect(prisma.userPreferences.upsert).toHaveBeenCalledWith({
        where: { userId: 'u-1' },
        update: { uiLanguage: 'en' },
        create: { userId: 'u-1', uiLanguage: 'en' },
      });
    });

    it('a new user gets the language of the sign-up request', async () => {
      firebase.__verifyIdToken.mockResolvedValue(decodedToken());
      const created = createMockUser({ id: 'u-new', email: 'ayse@example.com' });
      arrangeNewUser(created, createMockSubscription({ userId: 'u-new', plan: 'FREE', status: 'ACTIVE' }));

      await service.verifyFirebaseToken({ idToken: 'good' }, 'tr-TR');

      expect(prisma.userPreferences.upsert).toHaveBeenCalledWith({
        where: { userId: 'u-new' },
        update: { uiLanguage: 'tr' },
        create: { userId: 'u-new', uiLanguage: 'tr' },
      });
    });

    it('no header or a language without UI texts leaves the stored value alone', async () => {
      existingLogin();
      await service.verifyFirebaseToken({ idToken: 't' });
      await service.verifyFirebaseToken({ idToken: 't' }, 'de-DE');
      expect(prisma.userPreferences.upsert).not.toHaveBeenCalled();
    });

    it('a failed write never fails the sign in', async () => {
      existingLogin();
      prisma.userPreferences.upsert.mockRejectedValue(new Error('db down'));
      await expect(service.verifyFirebaseToken({ idToken: 't' }, 'en')).resolves.toMatchObject({
        user: { id: 'u-1' },
      });
    });

    it('refresh records it too (app builds that never send the preference)', async () => {
      const token = signRefresh({ sub: 'u-1', email: 'a@example.com' });
      prisma.user.findUnique.mockResolvedValue(createMockUser({ id: 'u-1', email: 'a@example.com' }));

      await service.refreshTokens(token, 'en');

      expect(prisma.userPreferences.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u-1' }, update: { uiLanguage: 'en' } }),
      );
    });
  });

  describe('refreshTokens', () => {
    it('valid refresh token -> new {accessToken, refreshToken} pair for the stored user', async () => {
      const token = signRefresh({ sub: 'u-1', email: 'old@example.com' });
      prisma.user.findUnique.mockResolvedValue(createMockUser({ id: 'u-1', email: 'new@example.com' }));

      const res = await service.refreshTokens(token);

      expect(Object.keys(res).sort()).toEqual(['accessToken', 'refreshToken']);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u-1' } });
      // payload is rebuilt from the DB row, not copied from the old token
      expect(verifyAccess(res.accessToken)).toMatchObject({ sub: 'u-1', email: 'new@example.com', tv: 0 });
      expect(verifyRefresh(res.refreshToken)).toMatchObject({ sub: 'u-1', email: 'new@example.com', tv: 0 });
    });

    it('a refresh token of the current generation gets a new pair of that generation', async () => {
      const token = signRefresh({ sub: 'u-1', email: 'a@example.com', tv: 2 });
      prisma.user.findUnique.mockResolvedValue(createMockUser({ id: 'u-1', email: 'a@example.com', tokenVersion: 2 }));

      const res = await service.refreshTokens(token);

      expect(verifyAccess(res.accessToken).tv).toBe(2);
      expect(verifyRefresh(res.refreshToken).tv).toBe(2);
    });

    it.each([
      ['an older generation (logged out since)', { tv: 1 }, 2],
      ['a pre-revocation token (no tv claim) after the first bump', {}, 1],
      ['a non-integer tv claim after the first bump', { tv: '1' }, 1],
    ])('rejects %s with 401 "Invalid refresh token"', async (_label, claims, current) => {
      const token = signRefresh({ sub: 'u-1', email: 'a@example.com', ...claims });
      prisma.user.findUnique.mockResolvedValue(createMockUser({ id: 'u-1', tokenVersion: current }));

      await expect(service.refreshTokens(token)).rejects.toThrow(
        new UnauthorizedException('Invalid refresh token'),
      );
    });

    it('is stateless: nothing is persisted/rotated in the DB on refresh', async () => {
      const token = signRefresh({ sub: 'u-1', email: 'a@example.com' });
      prisma.user.findUnique.mockResolvedValue(createMockUser({ id: 'u-1', email: 'a@example.com' }));

      await service.refreshTokens(token);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      ['empty string', () => ''],
      ['garbage', () => 'not-a-jwt'],
      [
        'an access token (signed with the access secret)',
        () => new JwtService({}).sign({ sub: 'u-1', email: 'a@example.com' }, { secret: CONFIG['jwt.secret'], expiresIn: '1h' }),
      ],
      [
        'a token signed with a foreign secret',
        () => new JwtService({}).sign({ sub: 'u-1', email: 'a@example.com' }, { secret: 'attacker', expiresIn: '7d' }),
      ],
      [
        'an admin refresh token',
        () =>
          new JwtService({}).sign(
            { sub: 'u-1', email: 'a@example.com', role: 'SUPER_ADMIN' },
            { secret: 'unit-admin-refresh-secret', expiresIn: '7d' },
          ),
      ],
    ])('rejects %s with 401 "Invalid refresh token"', async (_label, makeToken) => {
      prisma.user.findUnique.mockResolvedValue(createMockUser({ id: 'u-1' }));

      await expect(service.refreshTokens(makeToken())).rejects.toThrow(
        new UnauthorizedException('Invalid refresh token'),
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an expired refresh token with 401', async () => {
      const token = signRefresh({ sub: 'u-1', email: 'a@example.com' }, { expiresIn: '7d' });
      jest.setSystemTime(new Date(NOW.getTime() + 8 * DAY));
      prisma.user.findUnique.mockResolvedValue(createMockUser({ id: 'u-1' }));

      await expect(service.refreshTokens(token)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a valid refresh token whose user no longer exists (deleted) with 401', async () => {
      const token = signRefresh({ sub: 'u-gone', email: 'a@example.com' });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.refreshTokens(token)).rejects.toThrow(
        new UnauthorizedException('Invalid refresh token'),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // logout
  // ---------------------------------------------------------------------------

  describe('logout', () => {
    beforeEach(() => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
    });

    it('bumps the token version of the refresh token generation and returns the success message', async () => {
      const token = signRefresh({ sub: 'u-1', email: 'a@example.com', tv: 3 });

      await expect(service.logout(token)).resolves.toEqual({ message: 'Logged out successfully' });

      expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u-1', tokenVersion: 3 },
        data: { tokenVersion: { increment: 1 } },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('a pre-revocation refresh token (no tv) logs out generation 0', async () => {
      const token = signRefresh({ sub: 'u-1', email: 'a@example.com' });

      await service.logout(token);

      expect(prisma.user.updateMany.mock.calls[0][0].where).toEqual({ id: 'u-1', tokenVersion: 0 });
    });

    it('works with an expired access token: only the refresh token is needed', async () => {
      const token = signRefresh({ sub: 'u-1', email: 'a@example.com', tv: 0 }, { expiresIn: '7d' });
      jest.setSystemTime(new Date(NOW.getTime() + 2 * 60 * 60 * 1000)); // access (1h) long gone

      await expect(service.logout(token)).resolves.toEqual({ message: 'Logged out successfully' });
      expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
    });

    it('is idempotent: an already revoked (or deleted) session is a 200 no-op', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      const token = signRefresh({ sub: 'u-1', email: 'a@example.com', tv: 0 });

      await expect(service.logout(token)).resolves.toEqual({ message: 'Logged out successfully' });
    });

    it('after logout the same refresh token no longer refreshes', async () => {
      const token = signRefresh({ sub: 'u-1', email: 'a@example.com', tv: 0 });
      await service.logout(token);

      // The row now carries the bumped generation.
      prisma.user.findUnique.mockResolvedValue(createMockUser({ id: 'u-1', tokenVersion: 1 }));
      await expect(service.refreshTokens(token)).rejects.toThrow(
        new UnauthorizedException('Invalid refresh token'),
      );
    });

    it.each([
      ['empty string', () => ''],
      ['garbage', () => 'not-a-jwt'],
      [
        'an access token (signed with the access secret)',
        () => new JwtService({}).sign({ sub: 'u-1', email: 'a@example.com' }, { secret: CONFIG['jwt.secret'], expiresIn: '1h' }),
      ],
      [
        'a token signed with a foreign secret',
        () => new JwtService({}).sign({ sub: 'u-1', email: 'a@example.com' }, { secret: 'attacker', expiresIn: '7d' }),
      ],
      ['a refresh token without sub', () => signRefresh({ email: 'a@example.com' })],
      ['a refresh token with an empty sub', () => signRefresh({ sub: '', email: 'a@example.com' })],
    ])('rejects %s with 401 and writes nothing', async (_label, makeToken) => {
      await expect(service.logout(makeToken())).rejects.toThrow(
        new UnauthorizedException('Invalid refresh token'),
      );
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('rejects an expired refresh token with 401 and writes nothing', async () => {
      const token = signRefresh({ sub: 'u-1', email: 'a@example.com' }, { expiresIn: '7d' });
      jest.setSystemTime(new Date(NOW.getTime() + 8 * DAY));

      await expect(service.logout(token)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // googleLogin / appleLogin (legacy OAuth helpers, no route wired today)
  // ---------------------------------------------------------------------------

  describe('googleLogin / appleLogin', () => {
    const profile = {
      email: 'mehmet@example.com',
      providerId: 'oauth-sub-1',
      provider: 'APPLE' as const,
      firstName: 'Mehmet',
      lastName: 'Demir',
      avatarUrl: 'https://oauth/pic.png',
    };

    it('googleLogin creates a new GOOGLE user (provider forced), FREE subscription and welcome mail', async () => {
      const created = createMockUser({ id: 'u-g', email: profile.email, provider: 'GOOGLE' });
      arrangeNewUser(created);

      const res = await service.googleLogin(profile);

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'mehmet@example.com',
          providerId: 'oauth-sub-1',
          firstName: 'Mehmet',
          lastName: 'Demir',
          provider: 'GOOGLE',
          emailVerified: true,
          avatarUrl: 'https://oauth/pic.png',
        },
      });
      expect(prisma.subscription.create).toHaveBeenCalledWith({
        data: { userId: 'u-g', plan: 'FREE', status: 'ACTIVE' },
      });
      expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith('mehmet@example.com', 'Mehmet', 'tr');
      expectAuthResponseShape(res);
    });

    it('appleLogin updates an existing user, keeping stored names/avatar when the profile omits them', async () => {
      const existing = createMockUser({
        id: 'u-a',
        email: profile.email,
        firstName: 'Stored',
        lastName: 'Name',
        avatarUrl: 'avatars/u-a/me.jpg',
        emailVerified: true,
      });
      prisma.user.findUnique.mockResolvedValue({ ...existing, subscription: null });
      prisma.user.update.mockResolvedValue({ ...existing, provider: 'APPLE', subscription: null });

      const res = await service.appleLogin({
        email: profile.email,
        providerId: 'apple-sub',
        provider: 'GOOGLE',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-a' },
        data: {
          providerId: 'apple-sub',
          provider: 'APPLE',
          emailVerified: true,
          avatarUrl: 'avatars/u-a/me.jpg',
          firstName: 'Stored',
          lastName: 'Name',
        },
        include: { subscription: true },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(emailService.sendWelcomeEmail).not.toHaveBeenCalled();
      expectAuthResponseShape(res);
    });

    it('OAuth first login still succeeds when the welcome email fails; uses "User" fallback', async () => {
      arrangeNewUser(createMockUser({ id: 'u-g', email: profile.email }));
      emailService.sendWelcomeEmail.mockRejectedValue(new Error('smtp'));

      const res = await service.googleLogin({ email: profile.email, providerId: 'x', provider: 'GOOGLE' });

      expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith('mehmet@example.com', undefined, 'tr');
      expect(res.user.id).toBe('u-g');
    });

    it('OAuth first login returns 401 when the created user cannot be reloaded', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValue(createMockUser({ id: 'u-g' }));
      prisma.subscription.create.mockResolvedValue({});

      await expect(service.googleLogin(profile)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
