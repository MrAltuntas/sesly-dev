/**
 * Low-level counter rows shared by the narration quota (UsageService) and
 * the clone creation allowance (voice-profiles/clone-quota.ts).
 *
 *   usage_limits    one row per user and calendar month (server-local time):
 *                   storiesGenerated, premiumStoriesGenerated, clonesCreated
 *   usage_lifetime  one row per user, never reset: cloneNarrations,
 *                   clonesCreated
 *
 * Every counter is append-only. Increments that enforce a limit are
 * conditional updates (`... < limit`), so concurrent requests cannot go past
 * the limit.
 */

export interface UsagePeriod {
  month: number;
  year: number;
  /** First moment of the next period: when monthly allowances renew. */
  resetAt: Date;
}

export function currentUsagePeriod(now: Date = new Date()): UsagePeriod {
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  return { month, year, resetAt: new Date(year, month, 1) };
}

export interface CounterPrisma {
  usageLimit: {
    findUnique(args: any): Promise<any>;
    upsert(args: any): Promise<unknown>;
    updateMany(args: any): Promise<{ count: number }>;
  };
  usageLifetime: {
    findUnique(args: any): Promise<any>;
    upsert(args: any): Promise<unknown>;
    updateMany(args: any): Promise<{ count: number }>;
  };
}

function ignoreUniqueRace(error: any): void {
  // Two concurrent first upserts: the loser hits the unique constraint, but
  // the row now exists, which is all the caller needs.
  if (error?.code !== 'P2002') throw error;
}

export async function ensureMonthlyRow(
  prisma: CounterPrisma,
  userId: string,
  period: UsagePeriod,
): Promise<void> {
  try {
    await prisma.usageLimit.upsert({
      where: { userId_month_year: { userId, month: period.month, year: period.year } },
      create: { userId, month: period.month, year: period.year, resetAt: period.resetAt },
      update: {},
    });
  } catch (error) {
    ignoreUniqueRace(error);
  }
}

export async function ensureLifetimeRow(prisma: CounterPrisma, userId: string): Promise<void> {
  try {
    await prisma.usageLifetime.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  } catch (error) {
    ignoreUniqueRace(error);
  }
}

export interface LifetimeCounters {
  cloneNarrations: number;
  clonesCreated: number;
}

export async function getLifetimeCounters(
  prisma: CounterPrisma,
  userId: string,
): Promise<LifetimeCounters> {
  const row = await prisma.usageLifetime.findUnique({ where: { userId } });
  return {
    cloneNarrations: row?.cloneNarrations ?? 0,
    clonesCreated: row?.clonesCreated ?? 0,
  };
}
