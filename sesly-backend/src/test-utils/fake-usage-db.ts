/**
 * In-memory stand-in for the counter tables (usage_limits, usage_lifetime)
 * with the conditional-update semantics the limits engine relies on
 * (`{ field: { lt | gt } }` in updateMany, the raw standard-narration
 * update). Lets tests exercise real counting, limits and refunds instead of
 * asserting mock call shapes.
 */
type Row = Record<string, any>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('lt' in cond && !(row[key] < cond.lt)) return false;
      if ('gt' in cond && !(row[key] > cond.gt)) return false;
      return true;
    }
    return row[key] === cond;
  });
}

function apply(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) row[key] = (row[key] ?? 0) + value.increment;
    else if (value && typeof value === 'object' && 'decrement' in value) row[key] = (row[key] ?? 0) - value.decrement;
    else row[key] = value;
  }
}

export interface FakeUsageDb {
  monthly: Row[];
  lifetime: Map<string, Row>;
  subscription: Row | null;
  profiles: Map<string, Row>;
  presetCount: number;
  cloneCount: number;
  prisma: any;
}

export function createFakeUsageDb(): FakeUsageDb {
  const db: FakeUsageDb = {
    monthly: [],
    lifetime: new Map(),
    subscription: null,
    profiles: new Map(),
    presetCount: 0,
    cloneCount: 0,
    prisma: null,
  };

  const monthlyRow = (userId: string, month: number, year: number) =>
    db.monthly.find((r) => r.userId === userId && r.month === month && r.year === year);

  db.prisma = {
    usageLimit: {
      findUnique: jest.fn(async ({ where }: any) => {
        const { userId, month, year } = where.userId_month_year;
        return monthlyRow(userId, month, year) ?? null;
      }),
      upsert: jest.fn(async ({ where, create }: any) => {
        const { userId, month, year } = where.userId_month_year;
        let row: Row | undefined = monthlyRow(userId, month, year);
        if (!row) {
          const created: Row = { storiesGenerated: 0, premiumStoriesGenerated: 0, clonesCreated: 0, ...create };
          row = created;
          db.monthly.push(created);
        }
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = db.monthly.filter((r) => matches(r, where));
        rows.forEach((r) => apply(r, data));
        return { count: rows.length };
      }),
    },
    usageLifetime: {
      findUnique: jest.fn(async ({ where }: any) => db.lifetime.get(where.userId) ?? null),
      upsert: jest.fn(async ({ where, create }: any) => {
        if (!db.lifetime.has(where.userId)) {
          db.lifetime.set(where.userId, { cloneNarrations: 0, clonesCreated: 0, ...create });
        }
        return db.lifetime.get(where.userId);
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = db.lifetime.get(where.userId);
        if (!row || !matches(row, where)) return { count: 0 };
        apply(row, data);
        return { count: 1 };
      }),
    },
    // UPDATE usage_limits SET storiesGenerated + 1 WHERE ... AND standard < limit
    $executeRaw: jest.fn(async (_strings: TemplateStringsArray, userId: string, month: number, year: number, limit: number) => {
      const row = monthlyRow(userId, month, year);
      if (!row || row.storiesGenerated - row.premiumStoriesGenerated >= limit) return 0;
      row.storiesGenerated += 1;
      return 1;
    }),
    subscription: {
      findUnique: jest.fn(async () => db.subscription),
    },
    voiceProfile: {
      count: jest.fn(async ({ where }: any) => (where.kind === 'PRESET' ? db.presetCount : db.cloneCount)),
      findUnique: jest.fn(async ({ where }: any) => db.profiles.get(where.id) ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = db.profiles.get(where.id);
        if (!row) return { count: 0 };
        if ('creationChargedAt' in where && row.creationChargedAt !== where.creationChargedAt) return { count: 0 };
        apply(row, data);
        return { count: 1 };
      }),
    },
  };
  return db;
}
