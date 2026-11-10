import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { AudioService } from '../src/modules/audio/audio.service';
import { NarrationCacheService } from '../src/modules/audio/narration-cache.service';
import { NARRATION_AUDIO_REMOVED_MESSAGE } from '../src/common/constants/messages.constants';
import { createSettingsStub } from '../src/test-utils/settings-stub';

/**
 * Shared ready-made voice audio against a real Postgres (migration
 * 20261021180000_shared_preset_audio applied): the unique share key, the
 * transaction of the first request, reuse, attach, the retry claim, the
 * per-user release and the admin cache clear. Uses E2E_DATABASE_URL, or
 * DATABASE_URL from .env, and refuses anything but a local server. Queue,
 * storage (no GCS call is ever made), push and socket are stubs. Every row
 * carries a per-run marker and is deleted afterwards.
 */
function databaseUrl(): string | undefined {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const envFile = path.join(__dirname, '../.env');
  if (!fs.existsSync(envFile)) return undefined;
  return dotenv.parse(fs.readFileSync(envFile)).DATABASE_URL;
}

const url = databaseUrl();
const isLocal = !!url && /@(localhost|127\.0\.0\.1|\[::1\]):\d+\//.test(url);
const describeDb = isLocal ? describe : describe.skip;

describeDb('shared ready-made voice audio (Postgres)', () => {
  let prisma: PrismaClient;
  const run = `e2e-shared-${Date.now()}`;
  const storyIds: string[] = [];
  const userIds: string[] = [];

  let queue: { add: jest.Mock };
  let storage: { uploadFile: jest.Mock; deleteFile: jest.Mock; generatePresignedUrl: jest.Mock };
  let notifications: { notifyNarrationReady: jest.Mock; notifyNarrationFailed: jest.Mock };
  let gateway: { sendToUser: jest.Mock };
  let settings: ReturnType<typeof createSettingsStub>;

  const makeService = () =>
    new AudioService(
      prisma as any,
      storage as any,
      notifications as any,
      gateway as any,
      queue as any,
      { ensureSegments: jest.fn() } as any,
      settings as any,
    );

  beforeAll(() => {
    prisma = new PrismaClient({ datasourceUrl: url });
  });

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue({}) };
    storage = {
      uploadFile: jest.fn(async (_b: Buffer, key: string) => `https://storage.googleapis.com/e2e/${key}`),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      generatePresignedUrl: jest.fn(async (key: string) => `signed:${key}`),
    };
    notifications = {
      notifyNarrationReady: jest.fn().mockResolvedValue(undefined),
      notifyNarrationFailed: jest.fn().mockResolvedValue(undefined),
    };
    gateway = { sendToUser: jest.fn() };
    settings = createSettingsStub();
  });

  afterAll(async () => {
    if (storyIds.length > 0) {
      await prisma.audio.deleteMany({ where: { storyId: { in: storyIds } } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.story.deleteMany({ where: { id: { in: storyIds } } });
    await prisma.$disconnect();
  });

  async function story(name: string) {
    const row = await prisma.story.create({
      data: {
        title: `Paylaşılan ${name} ${run}`,
        content: 'Bir varmış. Bir yokmuş.',
        ageGroup: 'THREE_TO_SIX',
        category: 'BEDTIME',
        estimatedDuration: 1,
        status: 'PUBLISHED',
        language: 'tr',
        sourceUrl: `https://e2e.sesly.test/${run}/${name}`,
        preprocessedSegments: [{ text: 'Bir varmış.' }, { text: 'Bir yokmuş.' }],
        preprocessedModel: 'manual',
        segmentationVersion: 1,
      },
    });
    storyIds.push(row.id);
    return row;
  }

  /** A user with one voice and one PENDING narration of the story. */
  async function listener(storyId: string, name: string, voice: 'preset' | 'clone' = 'preset') {
    const user = await prisma.user.create({ data: { email: `${run}-${name}@sesly.test` } });
    userIds.push(user.id);
    const profile = await prisma.voiceProfile.create({
      data:
        voice === 'preset'
          ? { userId: user.id, name: 'Achernar', provider: 'GOOGLE', kind: 'PRESET', voiceId: 'tr-TR-Chirp3-HD-Achernar', language: 'tr-TR' }
          : { userId: user.id, name: 'Annem', provider: 'CARTESIA', kind: 'CLONE', voiceId: 'cartesia-e2e', language: 'tr-TR' },
    });
    const narration = await prisma.storyNarration.create({
      data: { userId: user.id, storyId, voiceProfileId: profile.id, status: 'PENDING' },
    });
    return { userId: user.id, voiceProfileId: profile.id, narrationId: narration.id };
  }

  const request = (service: AudioService, storyId: string, l: { userId: string; voiceProfileId: string; narrationId: string }) =>
    service.generateAudio({
      text: 'ignored',
      voiceProfileId: l.voiceProfileId,
      userId: l.userId,
      storyId,
      narrationId: l.narrationId,
      share: true,
    });

  /** Runs every queued segment job through the completion path (no TTS). */
  async function completeQueuedSegments(service: AudioService) {
    for (const [name, job] of queue.add.mock.calls) {
      if (name !== 'generate-segment') continue;
      await service.onSegmentComplete(job.audioId, job.segmentIndex, `https://storage.googleapis.com/e2e/shared-audio/${job.audioId}/segments/${job.segmentIndex}.mp3`, 3);
    }
  }

  it('two simultaneous first requests create one shared audio and one synthesis; both users are told; a third reuses it', async () => {
    const s = await story('ayni-anda');
    const [a, b] = await Promise.all([listener(s.id, 'a'), listener(s.id, 'b')]);
    const service = makeService();

    const [ra, rb] = await Promise.all([request(service, s.id, a), request(makeService(), s.id, b)]);

    expect(ra.shared && rb.shared).toBe(true);
    expect(ra.audioId).toBe(rb.audioId);
    const audios = await prisma.audio.findMany({ where: { storyId: s.id } });
    expect(audios).toHaveLength(1);
    expect(audios[0]).toMatchObject({ shared: true, userId: null, voiceProfileId: null });
    // One synthesis: the Google request of one audio (grouping puts both segments in one request).
    const jobs = queue.add.mock.calls.filter(([n]) => n === 'generate-segment');
    expect(jobs).toHaveLength(1);
    expect(jobs[0][1]).toMatchObject({ audioId: audios[0].id, voiceProfileId: null, shared: true });

    const linked = await prisma.storyNarration.findMany({ where: { id: { in: [a.narrationId, b.narrationId] } } });
    expect(linked.every((n) => n.audioId === audios[0].id && n.status === 'GENERATING')).toBe(true);

    await completeQueuedSegments(service);

    const done = await prisma.storyNarration.findMany({ where: { id: { in: [a.narrationId, b.narrationId] } } });
    expect(done.map((n) => n.status)).toEqual(['READY', 'READY']);
    expect(notifications.notifyNarrationReady.mock.calls.map((c) => c[0]).sort()).toEqual([a.userId, b.userId].sort());
    expect((await prisma.audio.findUnique({ where: { id: audios[0].id } }))?.status).toBe('READY');

    // A third user: READY at once, no new job.
    const c = await listener(s.id, 'c');
    queue.add.mockClear();
    await expect(request(makeService(), s.id, c)).resolves.toEqual({ audioId: audios[0].id, status: 'READY', shared: true });
    expect(queue.add).not.toHaveBeenCalled();
    expect((await prisma.storyNarration.findUnique({ where: { id: c.narrationId } }))?.status).toBe('READY');

    // Streaming: only users with a narration of it.
    await expect(service.getStreamUrl(audios[0].id, c.userId)).resolves.toContain(`shared-audio/${audios[0].id}/segments/0.mp3`);
    const stranger = await listener(s.id, 'x');
    await expect(service.getStreamUrl(audios[0].id, stranger.userId)).rejects.toThrow();

    // One user leaving keeps the audio for the others.
    await service.releaseAudio(audios[0].id, a.userId);
    await prisma.storyNarration.delete({ where: { id: a.narrationId } });
    expect(await prisma.audio.count({ where: { id: audios[0].id } })).toBe(1);
    expect(storage.deleteFile).not.toHaveBeenCalled();

    // The admin cache clear removes it and flags every remaining narration.
    const cache = new NarrationCacheService(prisma as any, service, settings as any);
    await expect(cache.summary(s.id)).resolves.toMatchObject({ sharedAudios: 1, sharedNarrations: 2 });
    const cleared = await cache.clear(s.id, 'e2e');
    expect(cleared).toMatchObject({ removedAudios: 1, sharedAudios: 1 });
    expect(await prisma.audio.count({ where: { storyId: s.id } })).toBe(0);
    const flagged = await prisma.storyNarration.findMany({ where: { id: { in: [b.narrationId, c.narrationId] } } });
    expect(flagged.every((n) => n.status === 'FAILED' && n.freeRegeneration && n.audioId === null)).toBe(true);
    expect(flagged[0].errorMessage).toBe(NARRATION_AUDIO_REMOVED_MESSAGE);
  });

  it('a FAILED shared audio is generated again by exactly one of two simultaneous requests', async () => {
    const s = await story('hata');
    const first = await listener(s.id, 'f1');
    const service = makeService();
    const created = await request(service, s.id, first);
    await service.onSegmentFailed(created.audioId, 0, 'tts down');
    expect((await prisma.audio.findUnique({ where: { id: created.audioId } }))?.status).toBe('FAILED');
    expect((await prisma.storyNarration.findUnique({ where: { id: first.narrationId } }))?.status).toBe('FAILED');

    const [x, y] = await Promise.all([listener(s.id, 'f2'), listener(s.id, 'f3')]);
    queue.add.mockClear();
    const [rx, ry] = await Promise.all([request(makeService(), s.id, x), request(makeService(), s.id, y)]);

    expect(rx.audioId).toBe(created.audioId);
    expect(ry.audioId).toBe(created.audioId);
    expect(queue.add.mock.calls.filter(([n]) => n === 'generate-segment')).toHaveLength(1);
    expect(await prisma.audio.count({ where: { storyId: s.id } })).toBe(1);
    expect(await prisma.audioSegment.count({ where: { audioId: created.audioId } })).toBe(1);
    // The narration that failed with the old attempt was detached.
    expect((await prisma.storyNarration.findUnique({ where: { id: first.narrationId } }))?.audioId).toBeNull();
  });

  it('a cloned voice never shares and the database refuses a half-shared row', async () => {
    const s = await story('klon');
    const clone = await listener(s.id, 'k', 'clone');
    const result = await request(makeService(), s.id, clone);
    expect(result.shared).toBe(false);
    const own = await prisma.audio.findUnique({ where: { id: result.audioId } });
    expect(own).toMatchObject({ shared: false, userId: clone.userId, voiceProfileId: clone.voiceProfileId, shareKey: null });

    await expect(
      prisma.audio.create({ data: { shared: true, userId: clone.userId, originalText: 'x', storyId: s.id } }),
    ).rejects.toThrow();
    await expect(prisma.audio.create({ data: { shared: false, originalText: 'x', storyId: s.id } })).rejects.toThrow();
  });
});
