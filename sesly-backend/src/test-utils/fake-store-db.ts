/**
 * In-memory stand-in for the tables the store code writes
 * (subscriptions, store_purchases, store_events, users), enforcing the same
 * unique keys as the schema (P2002 on a duplicate), so the purchase binding,
 * idempotency and precedence rules can be tested end to end.
 */
type Row = Record<string, any>;

function uniqueError(target: string[]) {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target } });
}

export interface FakeStoreDb {
  users: Set<string>;
  subscriptions: Map<string, any>;
  purchases: any[];
  events: any[];
  prisma: any;
}

export function createFakeStoreDb(): FakeStoreDb {
  let seq = 0;
  const id = (prefix: string) => `${prefix}-${++seq}`;
  const db: FakeStoreDb = {
    users: new Set(),
    subscriptions: new Map(),
    purchases: [],
    events: [],
    prisma: null,
  };

  const findPurchase = (where: any) => {
    if (where.id) return db.purchases.find((p) => p.id === where.id);
    const key = where.platform_purchaseKey;
    return db.purchases.find((p) => p.platform === key.platform && p.purchaseKey === key.purchaseKey);
  };

  const copy = <T>(row: T | undefined | null): T | null => (row ? { ...(row as any) } : null);

  db.prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => (db.users.has(where.id) ? { id: where.id } : null)),
    },
    subscription: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const row = db.subscriptions.get(where.userId);
        if (!row) return null;
        const result: Row = { ...row };
        if (include?.storePurchase) {
          result.storePurchase = copy(db.purchases.find((p) => p.id === row.storePurchaseId));
        }
        return result;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        const [field, value] = Object.entries(where)[0] as [string, any];
        const row = [...db.subscriptions.values()].find((s) => s[field] === value);
        return row ? { userId: row.userId } : null;
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = db.subscriptions.get(where.userId);
        const next = existing ? { ...existing, ...update } : { plan: 'FREE', status: 'ACTIVE', ...create };
        for (const field of ['appleOriginalTransactionId', 'googlePurchaseToken', 'appleTransactionId']) {
          if (!next[field]) continue;
          const clash = [...db.subscriptions.values()].find((s) => s.userId !== where.userId && s[field] === next[field]);
          if (clash) throw uniqueError([field]);
        }
        db.subscriptions.set(where.userId, next);
        return { ...next };
      }),
    },
    storePurchase: {
      findUnique: jest.fn(async ({ where }: any) => copy(findPurchase(where))),
      findMany: jest.fn(async ({ where }: any) => db.purchases.filter((p) => p.userId === where.userId).map((p) => ({ ...p }))),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = findPurchase(where);
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return { ...existing };
        }
        const row = { id: id('purchase'), createdAt: new Date(), updatedAt: new Date(), ...create };
        db.purchases.push(row);
        return { ...row };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = findPurchase(where);
        if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      }),
    },
    storeEvent: {
      create: jest.fn(async ({ data }: any) => {
        if (data.externalId && db.events.some((e) => e.platform === data.platform && e.externalId === data.externalId)) {
          throw uniqueError(['platform', 'externalId']);
        }
        const row = { id: id('event'), status: 'RECEIVED', ...data };
        db.events.push(row);
        return { ...row };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const key = where.platform_externalId;
        return copy(db.events.find((e) => e.platform === key.platform && e.externalId === key.externalId));
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = db.events.find((e) => e.id === where.id);
        Object.assign(row as Row, data);
        return { ...row };
      }),
    },
  };
  return db;
}
