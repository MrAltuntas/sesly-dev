import { errorWrapper } from './wrappers';
import { createMockPrismaService, createMockUser } from '../../test-utils';

describe('Backend Test Infrastructure Smoke Test', () => {
  describe('errorWrapper', () => {
    it('should correctly wrap error details into standard payload', () => {
      const error = errorWrapper('Invalid input', 400, '/users', 'POST');
      expect(error.success).toBe(false);
      expect(error.message).toBe('Invalid input');
      expect(error.statusCode).toBe(400);
      expect(error.path).toBe('/users');
      expect(error.method).toBe('POST');
      expect(error.timestamp).toBeDefined();
    });
  });

  describe('Prisma Deep Mock', () => {
    it('should create a reusable deep mocked PrismaService', async () => {
      const prisma = createMockPrismaService();
      
      const mockUser = { id: 'user-1', email: 'test@example.com' };
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await prisma.user.findUnique({ where: { id: 'user-1' } });
      
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      expect(result).toEqual(mockUser);
    });
  });

  describe('Mock Factories', () => {
    it('should generate a valid user using @faker-js/faker v10', () => {
      const mockUser = createMockUser({ email: 'override@example.com' });
      expect(mockUser.id).toBeDefined();
      expect(mockUser.email).toBe('override@example.com');
      expect(mockUser.firstName).toBeDefined();
      expect(mockUser.lastName).toBeDefined();
      expect(mockUser.avatarUrl).toBeDefined();
    });
  });
});
