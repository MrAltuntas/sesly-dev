import { Logger } from '@nestjs/common';
import { AdminUserSeeder, DEV_DEFAULT_ADMIN_EMAIL, DEV_DEFAULT_ADMIN_PASSWORD } from './admin-user.seeder';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';

jest.mock('bcrypt', () => ({
  hash: jest.fn(async (plain: string) => `hashed(${plain})`),
}));

describe('AdminUserSeeder (runs on every boot)', () => {
  const ORIGINAL_ENV = process.env;
  let prisma: MockPrismaService;
  let seeder: AdminUserSeeder;
  let logSpies: jest.SpyInstance[];

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    prisma = createMockPrismaService();
    seeder = new AdminUserSeeder(prisma as any);
    logSpies = ['log', 'warn', 'error'].map((m) =>
      jest.spyOn(Logger.prototype, m as 'log').mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    logSpies.forEach((s) => s.mockRestore());
  });

  it('is idempotent: an existing SUPER_ADMIN means nothing is created', async () => {
    prisma.admin.findFirst.mockResolvedValue({ id: 'adm-1' });
    await seeder.onModuleInit();
    expect(prisma.admin.findFirst).toHaveBeenCalledWith({ where: { role: 'SUPER_ADMIN' } });
    expect(prisma.admin.create).not.toHaveBeenCalled();
  });

  it('creates the SUPER_ADMIN from ADMIN_EMAIL / ADMIN_PASSWORD, storing only a bcrypt hash', async () => {
    process.env.ADMIN_EMAIL = 'owner@sesly.app';
    process.env.ADMIN_PASSWORD = 'correct horse battery staple';
    prisma.admin.findFirst.mockResolvedValue(null);

    await seeder.seed();

    expect(prisma.admin.create).toHaveBeenCalledWith({
      data: {
        email: 'owner@sesly.app',
        passwordHash: 'hashed(correct horse battery staple)',
        firstName: 'Super',
        lastName: 'Admin',
        role: 'SUPER_ADMIN',
      },
    });
    expect(JSON.stringify(prisma.admin.create.mock.calls)).not.toContain('"correct horse battery staple"');
  });

  it('a DB error never crashes boot', async () => {
    prisma.admin.findFirst.mockRejectedValue(new Error('db down'));
    await expect(seeder.seed()).resolves.toBeUndefined();
  });

  // Fixed: production skips the seed (with a warning) unless ADMIN_EMAIL and
  // ADMIN_PASSWORD are both set. The test now pins NODE_ENV=production: the
  // agreed behaviour keeps the dev default for local development only.
  it('never creates a SUPER_ADMIN with a hardcoded default password in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
    prisma.admin.findFirst.mockResolvedValue(null);

    await seeder.seed();

    expect(prisma.admin.create).not.toHaveBeenCalled();
    expect(logSpies[1]).toHaveBeenCalledWith(expect.stringContaining('skipping admin seed'));
  });

  it.each([
    ['only ADMIN_EMAIL', { ADMIN_EMAIL: 'owner@sesly.app' }],
    ['only ADMIN_PASSWORD', { ADMIN_PASSWORD: 'long-random-password' }],
    ['a blank ADMIN_PASSWORD', { ADMIN_EMAIL: 'owner@sesly.app', ADMIN_PASSWORD: '   ' }],
    ['the .env.example placeholder password', { ADMIN_EMAIL: 'owner@sesly.app', ADMIN_PASSWORD: 'TODO_SET_ME' }],
  ])('production with %s set: skips, never falls back to the dev default', async (_label, env) => {
    process.env.NODE_ENV = 'production';
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
    Object.assign(process.env, env);
    prisma.admin.findFirst.mockResolvedValue(null);

    await seeder.seed();

    expect(prisma.admin.create).not.toHaveBeenCalled();
  });

  it('production with both set creates the admin from the environment', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ADMIN_EMAIL = ' owner@sesly.app ';
    process.env.ADMIN_PASSWORD = 'long-random-password';
    prisma.admin.findFirst.mockResolvedValue(null);

    await seeder.seed();

    expect(prisma.admin.create.mock.calls[0][0].data).toMatchObject({
      email: 'owner@sesly.app',
      passwordHash: 'hashed(long-random-password)',
    });
  });

  it('outside production the local dev default fills in and is flagged', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
    prisma.admin.findFirst.mockResolvedValue(null);

    await seeder.seed();

    expect(prisma.admin.create.mock.calls[0][0].data).toMatchObject({
      email: DEV_DEFAULT_ADMIN_EMAIL,
      passwordHash: `hashed(${DEV_DEFAULT_ADMIN_PASSWORD})`,
    });
    expect(logSpies[1]).toHaveBeenCalledWith(expect.stringContaining('local development default password'));
  });
});
