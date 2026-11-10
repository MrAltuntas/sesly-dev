import { Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Lifecycle only: $connect / $disconnect are stubbed on the instance, so no
 * database connection is ever attempted.
 */
describe('PrismaService lifecycle', () => {
  let service: PrismaService;
  let logSpies: jest.SpyInstance[];

  beforeEach(() => {
    service = new PrismaService();
    logSpies = [
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
    ];
  });

  afterEach(() => logSpies.forEach((s) => s.mockRestore()));

  it('connects on module init', async () => {
    const connect = jest.spyOn(service, '$connect').mockResolvedValue(undefined);
    await service.onModuleInit();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('a failed connection aborts boot (rethrows)', async () => {
    jest.spyOn(service, '$connect').mockRejectedValue(new Error('P1001 cannot reach db'));
    await expect(service.onModuleInit()).rejects.toThrow('P1001');
  });

  it('disconnect errors on shutdown are swallowed', async () => {
    const disconnect = jest.spyOn(service, '$disconnect').mockRejectedValue(new Error('already closed'));
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalled();
  });
});
