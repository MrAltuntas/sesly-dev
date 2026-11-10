import { PrismaService } from '../prisma/prisma.service';

/**
 * Nested mock type helper that turns all methods on PrismaService and its models into Jest mocks.
 */
export type MockPrismaService = {
  [K in keyof PrismaService]: PrismaService[K] extends (...args: any[]) => any
    ? jest.Mock
    : {
        [M in keyof PrismaService[K]]: jest.Mock;
      };
};

/**
 * Creates a fully dynamic, deeply mocked instance of PrismaService.
 * Intercepts calls on all models (e.g., prisma.user.findUnique) and
 * top-level Prisma operations (e.g., prisma.$transaction) and returns Jest mock functions.
 */
export function createMockPrismaService(): MockPrismaService {
  const modelMocks: Record<string, Record<string, jest.Mock>> = {};
  const topLevelMocks: Record<string, jest.Mock> = {};

  const getModelMock = (modelName: string) => {
    if (!modelMocks[modelName]) {
      modelMocks[modelName] = {};
    }
    return new Proxy(
      {},
      {
        get(target, prop) {
          if (typeof prop === 'symbol' || prop === 'then' || prop === 'catch') {
            return undefined;
          }
          const methodName = prop as string;
          if (!modelMocks[modelName][methodName]) {
            modelMocks[modelName][methodName] = jest.fn();
          }
          return modelMocks[modelName][methodName];
        },
      }
    );
  };

  return new Proxy(
    {},
    {
      get(target, prop) {
        if (typeof prop === 'symbol' || prop === 'then' || prop === 'catch') {
          return undefined;
        }

        const name = prop as string;

        // Prisma client-level methods (e.g. $connect, $transaction, $executeRaw)
        if (name.startsWith('$')) {
          if (!topLevelMocks[name]) {
            topLevelMocks[name] = jest.fn();
          }
          return topLevelMocks[name];
        }

        // Prisma models (e.g. user, voiceProfile, story)
        return getModelMock(name);
      },
    }
  ) as unknown as MockPrismaService;
}
