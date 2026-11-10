import { Test, TestingModule, TestingModuleBuilder } from '@nestjs/testing';
import { Provider, Type } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from './prisma-mock';

export interface ServiceTestContext<T> {
  service: T;
  prisma: MockPrismaService;
  module: TestingModule;
}

/**
 * Creates a NestJS TestingModule for a single service under test,
 * automatically overrides PrismaService with a deep mock, and returns them.
 */
export async function createServiceTestingModule<T>(
  serviceClass: Type<T>,
  extraProviders: Provider[] = [],
  configureModuleBuilder?: (builder: TestingModuleBuilder) => void
): Promise<ServiceTestContext<T>> {
  const prismaMock = createMockPrismaService();

  const builder = Test.createTestingModule({
    providers: [
      serviceClass,
      {
        provide: PrismaService,
        useValue: prismaMock,
      },
      ...extraProviders,
    ],
  });

  if (configureModuleBuilder) {
    configureModuleBuilder(builder);
  }

  const module: TestingModule = await builder.compile();
  const service = module.get<T>(serviceClass);

  return {
    service,
    prisma: prismaMock,
    module,
  };
}

/**
 * Mock generator for standard storage operations.
 */
export const mockStorageService = () => ({
  uploadFile: jest.fn().mockResolvedValue('https://storage.googleapis.com/sesly-test-bucket/mock-file.mp3'),
  deleteFile: jest.fn().mockResolvedValue(undefined),
  getSignedUrl: jest.fn().mockResolvedValue('https://storage.googleapis.com/sesly-test-bucket/mock-file.mp3?token=signed'),
});

/**
 * Mock generator for Firebase Admin operations.
 */
export const mockFirebaseAdmin = () => {
  const mockAuth = {
    verifyIdToken: jest.fn().mockResolvedValue({
      uid: 'firebase-user-id',
      email: 'firebase@example.com',
      email_verified: true,
    }),
    createUser: jest.fn().mockResolvedValue({ uid: 'new-firebase-user' }),
    deleteUser: jest.fn().mockResolvedValue(undefined),
  };

  const mockMessaging = {
    send: jest.fn().mockResolvedValue('message-id'),
    sendMulticast: jest.fn().mockResolvedValue({ successCount: 1, failureCount: 0 }),
  };

  return {
    auth: jest.fn().mockReturnValue(mockAuth),
    messaging: jest.fn().mockReturnValue(mockMessaging),
  };
};

/**
 * Mock generator for Bull Queues.
 */
export const mockBullQueue = () => ({
  add: jest.fn().mockResolvedValue({ id: 'job-id', data: {}, opts: {} }),
  process: jest.fn().mockResolvedValue(undefined),
  getJob: jest.fn().mockResolvedValue(null),
  pause: jest.fn().mockResolvedValue(undefined),
  resume: jest.fn().mockResolvedValue(undefined),
});

