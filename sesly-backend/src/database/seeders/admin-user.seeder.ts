import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { ENV_PLACEHOLDER } from '../../config/jwt.config';

/** Local-development convenience credentials. NEVER used in production. */
export const DEV_DEFAULT_ADMIN_EMAIL = 'admin@sesly.io';
export const DEV_DEFAULT_ADMIN_PASSWORD = 'Admin@123456';

/**
 * Seeder for initial admin user
 * Runs on application startup
 *
 * Production (NODE_ENV=production) only creates the first SUPER_ADMIN from
 * ADMIN_EMAIL + ADMIN_PASSWORD. When either is missing it skips with a
 * warning: a fresh production database must never get an admin whose
 * password is committed to the repository. Outside production the dev
 * defaults above fill in whatever is missing.
 */
@Injectable()
export class AdminUserSeeder implements OnModuleInit {
  private readonly logger = new Logger(AdminUserSeeder.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.seed();
  }

  async seed() {
    try {
      // Check if admin user already exists
      const adminExists = await this.prisma.admin.findFirst({
        where: { role: 'SUPER_ADMIN' },
      });

      if (adminExists) {
        this.logger.log('Super admin user already exists, skipping seed');
        return;
      }

      const credentials = this.resolveCredentials();
      if (!credentials) {
        return;
      }

      const hashedPassword = await bcrypt.hash(credentials.password, 12);

      await this.prisma.admin.create({
        data: {
          email: credentials.email,
          passwordHash: hashedPassword,
          firstName: 'Super',
          lastName: 'Admin',
          role: 'SUPER_ADMIN',
        },
      });

      this.logger.log(`Super admin user created: ${credentials.email}`);
      if (credentials.isDevDefault) {
        this.logger.warn(
          'Super admin created with the local development default password. Never use this database in production.',
        );
      }
    } catch (error) {
      this.logger.error('Error seeding admin user:', error);
    }
  }

  private resolveCredentials(): { email: string; password: string; isDevDefault: boolean } | null {
    const email = process.env.ADMIN_EMAIL?.trim();
    const password = process.env.ADMIN_PASSWORD;
    // Blank or the .env.example placeholder is not a password.
    const hasPassword =
      !!password && password.trim().length > 0 && password.trim() !== ENV_PLACEHOLDER;

    if (process.env.NODE_ENV === 'production') {
      if (!email || !hasPassword) {
        this.logger.warn(
          'No SUPER_ADMIN exists and ADMIN_EMAIL / ADMIN_PASSWORD are not both set: skipping admin seed. ' +
            'Set both and restart to create the first admin.',
        );
        return null;
      }
      return { email, password: password as string, isDevDefault: false };
    }

    return {
      email: email || DEV_DEFAULT_ADMIN_EMAIL,
      password: hasPassword ? (password as string) : DEV_DEFAULT_ADMIN_PASSWORD,
      isDevDefault: !hasPassword,
    };
  }
}
