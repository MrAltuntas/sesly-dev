import { PrismaClient  } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Hash passwords
  const adminPassword = await bcrypt.hash('local-admin-change-me', 12);
  const userPassword = await bcrypt.hash('local-user-change-me', 12);

  // ============================================
  // 1. CREATE ADMIN USER
  // ============================================
  console.log('👤 Creating admin user...');

  const admin = await prisma.admin.upsert({
    where: { email: 'admin@sesly.local' },
    update: {},
    create: {
      email: 'admin@sesly.local',
      passwordHash: adminPassword,
      firstName: 'Admin',
      role: 'SUPER_ADMIN',
      isActive: true,
    },
  });
  console.log(`✅ Admin created: ${admin.email} (Role: ${admin.role})`);
  console.log(`   Password: local-admin-change-me`);

  // ============================================
  // 2. CREATE NORMAL USER
  // ============================================
  console.log('\\n👤 Creating normal user...');

  const user = await prisma.user.upsert({
    where: { email: 'user@sesly.local' },
    update: {},
    create: {
      email: 'user@sesly.local',
      passwordHash: userPassword,
      firstName: 'Test',
      lastName: 'Test',
      provider: 'EMAIL',
      emailVerified: true, // Pre-verified for testing
    },
  });
  console.log(`✅ User created: ${user.email}`);
  console.log(`   Password: local-user-change-me`);

  // ============================================
  // 3. CREATE SUBSCRIPTION FOR USER
  // ============================================
  console.log('\\n💳 Creating subscription...');

  const subscription = await prisma.subscription.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      plan: 'PRO',
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },
  });
  console.log(`✅ Subscription created: ${subscription.plan} (${subscription.status})`);

  // ============================================
  // 4. CREATE VOICE PROFILES
  // ============================================
  console.log('\\n🎤 Creating voice profiles...');

  const voiceProfiles = await Promise.all([
    prisma.voiceProfile.create({
      data: {
        userId: user.id,
        name: 'Achernar',
        provider: 'GOOGLE',
        voiceId: 'tr-TR-Chirp3-HD-Achernar',
        language: 'tr-TR',
        status: 'READY',
      },
    }),
  ]);
  console.log(`✅ ${voiceProfiles.length} voice profiles created`);

  // ============================================
  // 5. STORIES
  // ============================================
  // No stories here. A development database gets them from an import file:
  //   npm run seed:stories -- --file ../stories/batch1/import-batch1.json [--publish]
  // (the same import the admin panel runs; see prisma/seed-stories.ts).

  // ============================================
  // 6. CREATE USAGE LIMITS
  // ============================================
  console.log('\\n📊 Creating usage limits...');

  const usageLimit = await prisma.usageLimit.create({
    data: {
      userId: user.id,
      month: 11,
      year: 2025,
      storiesGenerated: 5,
      textToSpeechCount: 120,
      resetAt: new Date('2025-12-01'), // Reset at the beginning of next month
    },
  });
  console.log(`✅ Usage limit created for ${usageLimit.month}/${usageLimit.year}`);

  // Push preferences live in user_preferences (defaults apply, no row needed).

  // ============================================
  // SUMMARY
  // ============================================
  console.log('\\n\\n🎉 Database seeded successfully!\\n');
  console.log('═══════════════════════════════════════════');
  console.log('📋 CREDENTIALS');
  console.log('═══════════════════════════════════════════');
  console.log('\\n🔐 ADMIN LOGIN:');
  console.log('   Email:    admin@sesly.local');
  console.log('   Password: local-admin-change-me');
  console.log('   Role:     SUPER_ADMIN');
  console.log('   URL:      https://admin.sesly.io');

  console.log('\\n👤 USER LOGIN:');
  console.log('   Email:    user@sesly.local');
  console.log('   Password: local-user-change-me');
  console.log('   Plan:     PRO (Active)');
  console.log('   URL:      https://api.sesly.io/auth/login');

  console.log('\\n📊 CREATED DATA:');
  console.log(`   ✅ 1 Admin user`);
  console.log(`   ✅ 1 Regular user (verified)`);
  console.log(`   ✅ 1 PRO subscription`);
  console.log(`   ✅ 3 Voice profiles`);
  console.log(`   ✅ Stories: run npm run seed:stories -- --file <import json>`);
  console.log(`   ✅ Usage tracking enabled`);
  console.log(`   ✅ Notification preferences set`);

  console.log('\\n🧪 TEST COMMANDS:');
  console.log('   # Login as user');
  console.log('   curl -X POST http://localhost:3000/auth/login \\\\');
  console.log('     -H "Content-Type: application/json" \\\\');
  console.log(`     -d '{"email":"user@sesly.local","password":"local-user-change-me"}'`);

  console.log('\\n   # Get stories');
  console.log('   curl http://localhost:3000/stories');

  console.log('\\n═══════════════════════════════════════════\\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
