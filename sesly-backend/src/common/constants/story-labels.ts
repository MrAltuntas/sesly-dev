import {
  AgeGroup,
  AgeGroupSource,
  LanguageLevel,
  LanguageLevelSource,
  StoryCategory,
  StoryLlmTaskStatus,
  StoryLlmTaskType,
  StoryOrigin,
  StoryRightsBasis,
  StoryStatus,
  StoryTextFidelity,
  TranslationMethod,
} from '../enums/prisma.enums';

/**
 * Turkish labels of every story enum. Served by GET /admin/stories/meta so
 * the admin panel keeps no hardcoded copy. Each map is keyed by the enum
 * value, so adding an enum value without a label is a compile error.
 */
export const STORY_STATUS_LABELS: Record<StoryStatus, string> = {
  DRAFT: 'Taslak',
  PUBLISHED: 'Yayında',
  ARCHIVED: 'Arşivlendi',
};

export const STORY_ORIGIN_LABELS: Record<StoryOrigin, string> = {
  PUBLIC_DOMAIN: 'Kamu malı',
  FOLK_ANONYMOUS: 'Anonim halk anlatısı',
  LICENSED: 'Lisanslı',
  ORIGINAL_HUMAN: 'Özgün (insan yazımı)',
  AI_GENERATED: 'Yapay zeka üretimi',
};

export const STORY_TEXT_FIDELITY_LABELS: Record<StoryTextFidelity, string> = {
  VERBATIM: 'Aslına sadık (kelimesi kelimesine)',
  SPELLING_MODERNISED: 'Yazımı güncellenmiş',
  ABRIDGED: 'Kısaltılmış',
  RETOLD: 'Yeniden anlatım',
  TRANSLATED: 'Çeviri',
};

export const STORY_RIGHTS_BASIS_LABELS: Record<StoryRightsBasis, string> = {
  AUTHOR_LIFE_PLUS_70: 'Yazarın ölümünün üzerinden 70 yıl geçti',
  ANONYMOUS_PUBLICATION_PLUS_70: 'Anonim eser, yayımının üzerinden 70 yıl geçti',
  FOLK_NO_AUTHOR: 'Halk anlatısı, yazarı yok',
  CC0: 'CC0 (kamuya bırakılmış)',
  CC_BY: 'CC BY (atıf şartlı)',
  LICENCE_GRANTED: 'Lisans alındı',
  OWNED: 'Hakları bize ait',
};

export const LANGUAGE_LEVEL_LABELS: Record<LanguageLevel, string> = {
  A1: 'A1 Başlangıç',
  A2: 'A2 Temel',
  B1: 'B1 Orta',
  B2: 'B2 Orta üstü',
  C1: 'C1 İleri',
  C2: 'C2 Ustalık',
};

export const LANGUAGE_LEVEL_SOURCE_LABELS: Record<LanguageLevelSource, string> = {
  AI: 'Yapay zeka',
  MANUAL: 'Elle',
};

export const AGE_GROUP_SOURCE_LABELS: Record<AgeGroupSource, string> = {
  AI: 'Yapay zeka',
  MANUAL: 'Elle',
};

export const TRANSLATION_METHOD_LABELS: Record<TranslationMethod, string> = {
  HUMAN: 'İnsan çevirisi',
  MACHINE: 'Makine çevirisi',
};

export const STORY_CATEGORY_LABELS: Record<StoryCategory, string> = {
  TURKISH_CLASSICS: 'Türk klasikleri',
  WORLD_CLASSICS: 'Dünya klasikleri',
  EDUCATIONAL: 'Eğitici',
  BEDTIME: 'Uyku öncesi',
};

export const AGE_GROUP_LABELS: Record<AgeGroup, string> = {
  ZERO_TO_THREE: '0-3 yaş',
  THREE_TO_SIX: '3-6 yaş',
  SIX_TO_TEN: '6-10 yaş',
  TEN_PLUS: '10 yaş ve üzeri',
};

export const STORY_SORT_LABELS: Record<'newest' | 'oldest' | 'title' | 'duration' | 'level', string> = {
  newest: 'En yeni',
  oldest: 'En eski',
  title: 'Başlığa göre',
  duration: 'Süreye göre',
  level: 'Dil seviyesine göre',
};

export interface EnumOption {
  value: string;
  label: string;
}

/** `{ A: 'x', B: 'y' }` as `[{ value: 'A', label: 'x' }, ...]`, in declaration order. */
export function toEnumOptions(labels: Record<string, string>): EnumOption[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

export const STORY_LLM_TASK_TYPE_LABELS: Record<StoryLlmTaskType, string> = {
  TRANSLATE: 'Çeviri',
  ASSESS_LEVEL: 'Dil seviyesi değerlendirmesi',
  ASSESS_AGE_GROUP: 'Yaş grubu değerlendirmesi',
};

export const STORY_LLM_TASK_STATUS_LABELS: Record<StoryLlmTaskStatus, string> = {
  PENDING: 'Sırada',
  RUNNING: 'Çalışıyor',
  DONE: 'Tamamlandı',
  FAILED: 'Başarısız',
};
