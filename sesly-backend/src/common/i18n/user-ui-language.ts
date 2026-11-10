import { Logger } from '@nestjs/common';
import { DEFAULT_UI_LANGUAGE, parseUiLanguage, UiLanguage } from './ui-language';

/**
 * Stored UI language of users (`UserPreferences.uiLanguage`) for text the
 * server writes on its own, outside a request of that user: push
 * notifications, failure messages stored on a row. Rule: the stored
 * language, else Turkish. Never throws; a database error means Turkish.
 *
 * Structural Prisma type so callers pass PrismaService or a transaction
 * client and specs pass a small stub.
 */
export interface UiLanguagePrisma {
  userPreferences: {
    findUnique(args: {
      where: { userId: string };
      select: { uiLanguage: true };
    }): Promise<{ uiLanguage: string | null } | null>;
    findMany(args: {
      where: { userId: { in: string[] } };
      select: { userId: true; uiLanguage: true };
    }): Promise<Array<{ userId: string; uiLanguage: string | null }>>;
    upsert(args: {
      where: { userId: string };
      update: { uiLanguage: UiLanguage };
      create: { userId: string; uiLanguage: UiLanguage };
    }): Promise<unknown>;
  };
}

const logger = new Logger('UserUiLanguage');

export async function resolveUserUiLanguage(
  prisma: Pick<UiLanguagePrisma, 'userPreferences'>,
  userId: string | null | undefined,
): Promise<UiLanguage> {
  if (!userId) return DEFAULT_UI_LANGUAGE;
  try {
    const row = await prisma.userPreferences.findUnique({
      where: { userId },
      select: { uiLanguage: true },
    });
    return parseUiLanguage(row?.uiLanguage) ?? DEFAULT_UI_LANGUAGE;
  } catch (error) {
    logger.warn(`UI language of user ${userId} not read, using Turkish: ${(error as Error)?.message}`);
    return DEFAULT_UI_LANGUAGE;
  }
}

/** Language per user id (every id present in the map, Turkish when unknown). */
export async function resolveUserUiLanguages(
  prisma: Pick<UiLanguagePrisma, 'userPreferences'>,
  userIds: Array<string | null | undefined>,
): Promise<Map<string, UiLanguage>> {
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const result = new Map<string, UiLanguage>(ids.map((id) => [id, DEFAULT_UI_LANGUAGE]));
  if (ids.length === 0) return result;
  try {
    const rows = await prisma.userPreferences.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, uiLanguage: true },
    });
    for (const row of rows) {
      result.set(row.userId, parseUiLanguage(row.uiLanguage) ?? DEFAULT_UI_LANGUAGE);
    }
  } catch (error) {
    logger.warn(`UI languages not read, using Turkish: ${(error as Error)?.message}`);
  }
  return result;
}

/**
 * Store the UI language a request named (sign in: from Accept-Language).
 * Fail-soft: a failed write is logged and never fails the caller.
 */
export async function recordUserUiLanguage(
  prisma: Pick<UiLanguagePrisma, 'userPreferences'>,
  userId: string,
  language: UiLanguage | null,
): Promise<void> {
  if (!language) return;
  try {
    await prisma.userPreferences.upsert({
      where: { userId },
      update: { uiLanguage: language },
      create: { userId, uiLanguage: language },
    });
  } catch (error) {
    logger.warn(`UI language of user ${userId} not stored: ${(error as Error)?.message}`);
  }
}
