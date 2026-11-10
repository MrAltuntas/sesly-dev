import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminStorageService, STORAGE_PREFIXES } from './admin-storage.service';
import { createMockPrismaService, MockPrismaService } from '../../../test-utils/prisma-mock';

type GcsFile = { name: string; sizeBytes: number; updatedAt: string };

const file = (name: string, sizeBytes = 10): GcsFile => ({
  name,
  sizeBytes,
  updatedAt: '2026-09-01T00:00:00.000Z',
});

describe('AdminStorageService', () => {
  let prisma: MockPrismaService;
  let storage: {
    listAllFilesWithMetadata: jest.Mock;
    fileExists: jest.Mock;
    deleteFile: jest.Mock;
  };
  let service: AdminStorageService;

  /** DB references, one list per source table. */
  function wireReferences(refs: {
    audio?: Array<string | null>;
    segments?: Array<string | null>;
    voiceProfiles?: Array<{ sampleAudioUrl?: string | null; consentAudioUrl?: string | null }>;
    stories?: Array<string | null>;
    users?: Array<string | null>;
    collections?: Array<string | null>;
  }) {
    prisma.audio.findMany.mockResolvedValue((refs.audio ?? []).map((audioUrl) => ({ audioUrl })));
    prisma.audioSegment.findMany.mockResolvedValue((refs.segments ?? []).map((audioUrl) => ({ audioUrl })));
    prisma.voiceProfile.findMany.mockResolvedValue(
      (refs.voiceProfiles ?? []).map((v) => ({
        sampleAudioUrl: v.sampleAudioUrl ?? null,
        consentAudioUrl: v.consentAudioUrl ?? null,
      })),
    );
    prisma.story.findMany.mockResolvedValue((refs.stories ?? []).map((coverImageUrl) => ({ coverImageUrl })));
    prisma.user.findMany.mockResolvedValue((refs.users ?? []).map((avatarUrl) => ({ avatarUrl })));
    prisma.collection.findMany.mockResolvedValue(
      (refs.collections ?? []).map((coverImageUrl) => ({ coverImageUrl })),
    );
  }

  beforeEach(() => {
    prisma = createMockPrismaService();
    storage = {
      listAllFilesWithMetadata: jest.fn().mockResolvedValue([]),
      fileExists: jest.fn().mockResolvedValue(true),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    service = new AdminStorageService(prisma as any, storage as any);
    wireReferences({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('listOrphans', () => {
    it('a key referenced by ANY source table (in any stored URL shape) is not an orphan', async () => {
      storage.listAllFilesWithMetadata.mockResolvedValue([
        file('audio/a1/full.mp3'),
        file('audio/a1/segments/0.mp3'),
        file('voice-samples/u1/vp1.wav'),
        file('voice-samples/u1/vp1-consent.wav'),
        file('stories/cover/s1-cover.png'),
        file('avatars/u1/1-me.jpg'),
        file('stories/cover/col-1.png'),
        file('audio/a2/full.mp3'), // presigned URL stored
        file('avatars/u2/1-my pic.jpg'), // URL-encoded in DB
        file('audio/zzz/orphan.mp3'), // the only real orphan
      ]);
      wireReferences({
        audio: [
          'https://storage.googleapis.com/sesly-bucket/audio/a1/full.mp3',
          'https://storage.googleapis.com/sesly-bucket/audio/a2/full.mp3?X-Goog-Signature=abc&X-Goog-Expires=3600',
        ],
        segments: ['audio/a1/segments/0.mp3'],
        voiceProfiles: [
          {
            sampleAudioUrl: 'gs://sesly-bucket/voice-samples/u1/vp1.wav',
            consentAudioUrl: 'https://sesly-bucket.storage.googleapis.com/voice-samples/u1/vp1-consent.wav',
          },
        ],
        stories: ['https://storage.googleapis.com/sesly-bucket/stories/cover/s1-cover.png'],
        users: [
          'https://storage.googleapis.com/sesly-bucket/avatars/u1/1-me.jpg',
          'https://storage.googleapis.com/sesly-bucket/avatars/u2/1-my%20pic.jpg',
        ],
        collections: ['stories/cover/col-1.png'],
      });

      const page = await service.listOrphans(1, 50);

      expect(page.data.map((o) => o.key)).toEqual(['audio/zzz/orphan.mp3']);
      expect(page.total).toBe(1);
    });

    it('queries every reference table (voice profiles unfiltered so consent audio counts too)', async () => {
      await service.listOrphans(1, 20);

      expect(prisma.audio.findMany).toHaveBeenCalledWith({
        select: { audioUrl: true },
        where: { audioUrl: { not: null } },
      });
      expect(prisma.audioSegment.findMany).toHaveBeenCalledWith({
        select: { audioUrl: true },
        where: { audioUrl: { not: null } },
      });
      // id + userId locate the live profile folder (voice-samples/<uid>/<pid>/).
      expect(prisma.voiceProfile.findMany).toHaveBeenCalledWith({
        select: { id: true, userId: true, sampleAudioUrl: true, consentAudioUrl: true },
      });
      expect(prisma.story.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ select: { coverImageUrl: true } }),
      );
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ select: { avatarUrl: true } }),
      );
      expect(prisma.collection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ select: { coverImageUrl: true } }),
      );
    });

    it('voice-previews/ cache is never offered as orphan; everything else unreferenced is', async () => {
      storage.listAllFilesWithMetadata.mockResolvedValue([
        file('voice-previews/GOOGLE/tr-TR/tr-TR-Wavenet-A.mp3'),
        file('voice-previews/CARTESIA/tr/abc.mp3'),
        file('voice-clone-tests/job1/raw.m4a', 5),
        file('random/thing.bin', 7),
        file('avatars/u9/1-x.jpg', 3),
      ]);

      const page = await service.listOrphans(1, 20);

      expect(page.data).toEqual([
        { key: 'voice-clone-tests/job1/raw.m4a', sizeBytes: 5, updatedAt: expect.any(String), classifiedAs: 'other' },
        { key: 'random/thing.bin', sizeBytes: 7, updatedAt: expect.any(String), classifiedAs: 'other' },
        { key: 'avatars/u9/1-x.jpg', sizeBytes: 3, updatedAt: expect.any(String), classifiedAs: 'image' },
      ]);
    });

    it('a third-party avatar URL does not mark any bucket object as referenced', async () => {
      storage.listAllFilesWithMetadata.mockResolvedValue([file('avatars/u1/photo.jpg')]);
      wireReferences({ users: ['https://lh3.googleusercontent.com/avatars/u1/photo.jpg'] });

      const page = await service.listOrphans(1, 20);

      expect(page.data.map((o) => o.key)).toEqual(['avatars/u1/photo.jpg']);
    });

    it('a key that only shares a prefix with a referenced key is still an orphan', async () => {
      storage.listAllFilesWithMetadata.mockResolvedValue([
        file('audio/a1/full.mp3'),
        file('audio/a1/full.mp3.bak'),
        file('audio/a10/full.mp3'),
      ]);
      wireReferences({ audio: ['audio/a1/full.mp3'] });

      const page = await service.listOrphans(1, 20);

      expect(page.data.map((o) => o.key)).toEqual(['audio/a1/full.mp3.bak', 'audio/a10/full.mp3']);
    });

    it('paginates AFTER filtering so total is the real orphan count', async () => {
      const files = Array.from({ length: 7 }, (_, i) => file(`audio/o${i}/full.mp3`));
      files.splice(3, 0, file('audio/kept/full.mp3'));
      storage.listAllFilesWithMetadata.mockResolvedValue(files);
      wireReferences({ audio: ['audio/kept/full.mp3'] });

      const page2 = await service.listOrphans(2, 3);

      expect(page2).toMatchObject({ total: 7, page: 2, limit: 3, totalPages: 3 });
      expect(page2.data.map((o) => o.key)).toEqual([
        'audio/o3/full.mp3',
        'audio/o4/full.mp3',
        'audio/o5/full.mp3',
      ]);

      const page3 = await service.listOrphans(3, 3);
      expect(page3.data.map((o) => o.key)).toEqual(['audio/o6/full.mp3']);
    });

    it('empty bucket -> empty page with totalPages 0', async () => {
      const page = await service.listOrphans(1, 20);
      expect(page).toEqual({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    });

    // Fixed (was BUG): loadReferencedKeys only indexed sampleAudioUrl /
    // consentAudioUrl, so the raw reference upload, its `.normalized.wav` and the
    // preview cache of a LIVE profile were listed (and deletable) as orphans. Every
    // key under voice-samples/<uid>/<pid>/ of an existing profile is now referenced.
    it('files inside a live voice profile folder are not orphans', async () => {
      storage.listAllFilesWithMetadata.mockResolvedValue([
        file('voice-samples/u1/p1/reference/abc-rec.m4a'),
        file('voice-samples/u1/p1/reference/abc-rec.m4a.normalized.wav'),
        file('voice-samples/u1/p1/test-sample.mp3'),
        file('voice-samples/u1/p1/previews/default.mp3'),
      ]);
      prisma.voiceProfile.findMany.mockResolvedValue([
        {
          id: 'p1',
          userId: 'u1',
          sampleAudioUrl: 'voice-samples/u1/p1/test-sample.mp3',
          consentAudioUrl: null,
        },
      ]);

      const page = await service.listOrphans(1, 20);

      expect(page.data).toEqual([]);
    });

    it('a deleted profile folder, another user folder with the same pid prefix and a sibling pid stay orphans', async () => {
      storage.listAllFilesWithMetadata.mockResolvedValue([
        file('voice-samples/u1/p1/previews/a.mp3'), // live
        file('voice-samples/u1/p1.mp3'), // legacy flat test sample of the live profile
        file('voice-samples/u1/p10/reference/x.wav'), // pid "p10" is NOT under "p1/"
        file('voice-samples/u2/p1/reference/x.wav'), // same pid, other user
        file('voice-samples/u1/gone/reference/y.wav'), // profile deleted
      ]);
      prisma.voiceProfile.findMany.mockResolvedValue([
        { id: 'p1', userId: 'u1', sampleAudioUrl: null, consentAudioUrl: null },
      ]);

      const page = await service.listOrphans(1, 20);

      expect(page.data.map((o) => o.key)).toEqual([
        'voice-samples/u1/p10/reference/x.wav',
        'voice-samples/u2/p1/reference/x.wav',
        'voice-samples/u1/gone/reference/y.wav',
      ]);
      expect(prisma.voiceProfile.findMany).toHaveBeenCalledWith({
        select: { id: true, userId: true, sampleAudioUrl: true, consentAudioUrl: true },
      });
    });

    it('deleteOrphan refuses (409) a file inside a live voice profile folder', async () => {
      prisma.voiceProfile.findMany.mockResolvedValue([
        { id: 'p1', userId: 'u1', sampleAudioUrl: null, consentAudioUrl: null },
      ]);

      await expect(
        service.deleteOrphan('voice-samples/u1/p1/reference/abc-rec.m4a.normalized.wav'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(storage.deleteFile).not.toHaveBeenCalled();
    });

    it('listing never deletes anything', async () => {
      storage.listAllFilesWithMetadata.mockResolvedValue([file('audio/x/full.mp3')]);
      await service.listOrphans(1, 20);
      expect(storage.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe('deleteOrphan', () => {
    it('deletes an unreferenced existing object and returns { deleted, key }', async () => {
      wireReferences({ audio: ['audio/other/full.mp3'] });

      const res = await service.deleteOrphan('audio/gone/full.mp3');

      expect(res).toEqual({ deleted: true, key: 'audio/gone/full.mp3' });
      expect(storage.fileExists).toHaveBeenCalledWith('audio/gone/full.mp3');
      expect(storage.deleteFile).toHaveBeenCalledTimes(1);
      expect(storage.deleteFile).toHaveBeenCalledWith('audio/gone/full.mp3');
    });

    it.each([
      ['audio full URL', { audio: ['https://storage.googleapis.com/b/audio/a1/full.mp3'] }, 'audio/a1/full.mp3'],
      ['segment bare key', { segments: ['audio/a1/segments/3.mp3'] }, 'audio/a1/segments/3.mp3'],
      ['voice sample', { voiceProfiles: [{ sampleAudioUrl: 'voice-samples/u/v.wav' }] }, 'voice-samples/u/v.wav'],
      ['consent audio', { voiceProfiles: [{ consentAudioUrl: 'gs://b/voice-samples/u/c.wav' }] }, 'voice-samples/u/c.wav'],
      ['story cover', { stories: ['https://storage.googleapis.com/b/stories/cover/x.png'] }, 'stories/cover/x.png'],
      ['avatar', { users: ['https://storage.googleapis.com/b/avatars/u/1.jpg'] }, 'avatars/u/1.jpg'],
      ['collection cover', { collections: ['https://storage.googleapis.com/b/stories/cover/c.png'] }, 'stories/cover/c.png'],
    ])('refuses (409) to delete a key referenced as %s, and never calls deleteFile', async (_label, refs, key) => {
      wireReferences(refs as any);

      await expect(service.deleteOrphan(key)).rejects.toBeInstanceOf(ConflictException);
      expect(storage.deleteFile).not.toHaveBeenCalled();
    });

    it('re-checks references at delete time (a file attached after listing is protected)', async () => {
      storage.listAllFilesWithMetadata.mockResolvedValue([file('avatars/u1/new.jpg')]);
      const before = await service.listOrphans(1, 20);
      expect(before.data.map((o) => o.key)).toEqual(['avatars/u1/new.jpg']);

      // User saved the avatar between the admin's list and delete.
      wireReferences({ users: ['https://storage.googleapis.com/b/avatars/u1/new.jpg'] });

      await expect(service.deleteOrphan('avatars/u1/new.jpg')).rejects.toBeInstanceOf(ConflictException);
      expect(storage.deleteFile).not.toHaveBeenCalled();
    });

    it('voice-previews/ keys are refused with 409 before touching storage', async () => {
      await expect(service.deleteOrphan('voice-previews/GOOGLE/tr-TR/x.mp3')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(storage.fileExists).not.toHaveBeenCalled();
      expect(storage.deleteFile).not.toHaveBeenCalled();
    });

    it('missing object -> 404, nothing deleted', async () => {
      storage.fileExists.mockResolvedValue(false);

      await expect(service.deleteOrphan('audio/nope/full.mp3')).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.deleteFile).not.toHaveBeenCalled();
    });

    it('empty key -> 404, storage untouched', async () => {
      await expect(service.deleteOrphan('')).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.fileExists).not.toHaveBeenCalled();
      expect(storage.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('aggregates count + bytes by type, by real prefix and in total', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-28T10:00:00.000Z'));
      storage.listAllFilesWithMetadata.mockResolvedValue([
        file('audio/a1/full.mp3', 100),
        file('audio/a1/segments/0.mp3', 50),
        file('shared-audio/s1/full.mp3', 30),
        file('stories/cover/x.png', 20),
        file('avatars/u/1.jpg', 5),
        file('voice-samples/u/v.wav', 300),
        file('voice-previews/GOOGLE/tr-TR/x.mp3', 40),
        file('voice-clone-tests/j/raw.m4a', 7),
        file('misc/readme.txt', 1),
      ]);

      const stats = await service.getStats();

      expect(stats.byType).toEqual({
        audio: { count: 3, sizeBytes: 180 },
        image: { count: 2, sizeBytes: 25 },
        voiceSample: { count: 2, sizeBytes: 340 },
        other: { count: 2, sizeBytes: 8 },
      });
      expect(stats.total).toEqual({ count: 9, sizeBytes: 553 });
      expect(stats.byPrefix).toEqual({
        'audio/': { count: 2, sizeBytes: 150 },
        'shared-audio/': { count: 1, sizeBytes: 30 },
        'stories/cover/': { count: 1, sizeBytes: 20 },
        'avatars/': { count: 1, sizeBytes: 5 },
        'voice-samples/': { count: 1, sizeBytes: 300 },
        'voice-previews/': { count: 1, sizeBytes: 40 },
        'voice-clone-tests/': { count: 1, sizeBytes: 7 },
        other: { count: 1, sizeBytes: 1 },
      });
      expect(stats.generatedAt).toBe('2026-09-28T10:00:00.000Z');
    });

    it('empty bucket: every prefix bucket is present and zero', async () => {
      const stats = await service.getStats();

      expect(Object.keys(stats.byPrefix).sort()).toEqual([...Object.keys(STORAGE_PREFIXES), 'other'].sort());
      for (const b of Object.values(stats.byPrefix)) {
        expect(b).toEqual({ count: 0, sizeBytes: 0 });
      }
      expect(stats.total).toEqual({ count: 0, sizeBytes: 0 });
    });

    it('does not hit the DB (bucket listing only)', async () => {
      await service.getStats();
      expect(prisma.audio.findMany).not.toHaveBeenCalled();
    });
  });
});
