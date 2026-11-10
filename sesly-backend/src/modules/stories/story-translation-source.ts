import { PrismaService } from '../../prisma/prisma.service';
import { StoryStatus, TranslationMethod } from '../../common/enums/prisma.enums';

/**
 * Where a translated story comes from (GET /stories/:id -> `translation`).
 *
 * Contract, null for a story that is not a translation (no translation
 * method and no source story):
 *   {
 *     isMachineTranslation: boolean,   // the text is an AI / machine translation
 *     method: 'HUMAN' | 'MACHINE' | null,
 *     fromLanguage: string | null,     // language of the text it was translated from
 *     original: { id, title, language } | null
 *   }
 * `original` is the source story inside the same translation group and is
 * only given when it is PUBLISHED, so the app can open it ("Orijinalini aç").
 *
 * The source is `translatedFromId` (set by the Gemini TRANSLATE task and by
 * the bulk import's `translatedFrom`). A machine translation without it
 * falls back to the group member in `originalLanguage`.
 */
export interface StoryTranslationOriginal {
  id: string;
  title: string;
  language: string;
}

export interface StoryTranslationInfo {
  isMachineTranslation: boolean;
  method: string | null;
  fromLanguage: string | null;
  original: StoryTranslationOriginal | null;
}

export interface StoryTranslationSourceInput {
  id: string;
  translationMethod?: string | null;
  translatedFromId?: string | null;
  translationGroupId?: string | null;
  originalLanguage?: string | null;
}

export async function loadStoryTranslationSource(
  prisma: PrismaService,
  story: StoryTranslationSourceInput,
): Promise<StoryTranslationInfo | null> {
  const method = story.translationMethod ?? null;
  if (!method && !story.translatedFromId) return null;

  const select = { id: true, title: true, language: true, status: true, translationGroupId: true } as const;
  let source = story.translatedFromId
    ? await prisma.story.findUnique({ where: { id: story.translatedFromId }, select })
    : null;
  if (!source && method === TranslationMethod.MACHINE && story.translationGroupId && story.originalLanguage) {
    source = await prisma.story.findFirst({
      where: {
        translationGroupId: story.translationGroupId,
        language: story.originalLanguage,
        id: { not: story.id },
      },
      select,
    });
  }

  const linkable =
    !!source &&
    source.id !== story.id &&
    source.status === StoryStatus.PUBLISHED &&
    !!story.translationGroupId &&
    source.translationGroupId === story.translationGroupId;

  return {
    isMachineTranslation: method === TranslationMethod.MACHINE,
    method,
    fromLanguage: source?.language ?? story.originalLanguage ?? null,
    original: linkable && source ? { id: source.id, title: source.title, language: source.language } : null,
  };
}
