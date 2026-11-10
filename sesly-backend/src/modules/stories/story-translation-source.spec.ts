import { loadStoryTranslationSource } from './story-translation-source';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';

describe('loadStoryTranslationSource', () => {
  let prisma: MockPrismaService;
  const source = (overrides: Partial<any> = {}) => ({
    id: 'en-1',
    title: 'The Rabbit',
    language: 'en',
    status: 'PUBLISHED',
    translationGroupId: 'g1',
    ...overrides,
  });

  beforeEach(() => {
    prisma = createMockPrismaService();
  });

  it('not a translation: null, no query', async () => {
    await expect(loadStoryTranslationSource(prisma as any, { id: 's1' })).resolves.toBeNull();
    expect(prisma.story.findUnique).not.toHaveBeenCalled();
  });

  it('a machine translation with a published source in its group links the original', async () => {
    prisma.story.findUnique.mockResolvedValue(source());
    await expect(
      loadStoryTranslationSource(prisma as any, {
        id: 'tr-1',
        translationMethod: 'MACHINE',
        translatedFromId: 'en-1',
        translationGroupId: 'g1',
      }),
    ).resolves.toEqual({
      isMachineTranslation: true,
      method: 'MACHINE',
      fromLanguage: 'en',
      original: { id: 'en-1', title: 'The Rabbit', language: 'en' },
    });
  });

  it('a draft source, or one outside the group, is named by language only', async () => {
    const story = { id: 'tr-1', translationMethod: 'MACHINE', translatedFromId: 'en-1', translationGroupId: 'g1' };
    prisma.story.findUnique.mockResolvedValueOnce(source({ status: 'DRAFT' }));
    await expect(loadStoryTranslationSource(prisma as any, story)).resolves.toMatchObject({
      fromLanguage: 'en',
      original: null,
    });
    prisma.story.findUnique.mockResolvedValueOnce(source({ translationGroupId: 'other' }));
    await expect(loadStoryTranslationSource(prisma as any, story)).resolves.toMatchObject({ original: null });
  });

  it('a machine translation without a source id falls back to the group member in originalLanguage', async () => {
    prisma.story.findFirst.mockResolvedValue(source());
    const info = await loadStoryTranslationSource(prisma as any, {
      id: 'tr-1',
      translationMethod: 'MACHINE',
      translationGroupId: 'g1',
      originalLanguage: 'en',
    });
    expect(prisma.story.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { translationGroupId: 'g1', language: 'en', id: { not: 'tr-1' } } }),
    );
    expect(info?.original).toEqual({ id: 'en-1', title: 'The Rabbit', language: 'en' });
  });

  it('a human translation of a text outside the catalogue: from the original language, nothing to open', async () => {
    await expect(
      loadStoryTranslationSource(prisma as any, { id: 'tr-1', translationMethod: 'HUMAN', originalLanguage: 'de' }),
    ).resolves.toEqual({ isMachineTranslation: false, method: 'HUMAN', fromLanguage: 'de', original: null });
    expect(prisma.story.findFirst).not.toHaveBeenCalled();
  });

  it('a source id that points nowhere: language unknown, nothing to open', async () => {
    prisma.story.findUnique.mockResolvedValue(null);
    await expect(
      loadStoryTranslationSource(prisma as any, { id: 'tr-1', translatedFromId: 'gone', translationGroupId: 'g1' }),
    ).resolves.toEqual({ isMachineTranslation: false, method: null, fromLanguage: null, original: null });
  });
});
