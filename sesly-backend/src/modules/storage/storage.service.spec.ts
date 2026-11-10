const mockFile = {
  save: jest.fn(),
  exists: jest.fn(),
  download: jest.fn(),
  delete: jest.fn(),
  getSignedUrl: jest.fn(),
};
const mockBucket = {
  file: jest.fn(),
  getFiles: jest.fn(),
  deleteFiles: jest.fn(),
};
const mockStorageBucket = jest.fn();

// Module-level mock: no real GCS client (and no credential lookup) is ever
// created in this test process.
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: (...args: unknown[]) => mockStorageBucket(...args),
  })),
}));

import { Storage } from '@google-cloud/storage';
import { StorageService } from './storage.service';

const StorageCtor = Storage as unknown as jest.Mock;
const BUCKET = 'sesly-test-bucket';
const PUBLIC = `https://storage.googleapis.com/${BUCKET}`;

describe('StorageService', () => {
  let config: Record<string, string | undefined>;

  const build = () =>
    new StorageService({ get: jest.fn((key: string) => config[key]) } as any);

  beforeEach(() => {
    config = {
      'googleStorage.bucket': BUCKET,
      'googleStorage.projectId': 'test-project',
      'googleStorage.keyFilename': '/fake/key.json',
    };
    mockStorageBucket.mockReturnValue(mockBucket);
    mockBucket.file.mockReturnValue(mockFile);
    mockBucket.getFiles.mockResolvedValue([[]]);
    mockBucket.deleteFiles.mockResolvedValue(undefined);
    mockFile.save.mockResolvedValue(undefined);
    mockFile.exists.mockResolvedValue([true]);
    mockFile.download.mockResolvedValue([Buffer.from('bytes')]);
    mockFile.delete.mockResolvedValue([{}]);
    mockFile.getSignedUrl.mockResolvedValue(['https://signed.example/url?X-Goog-Signature=abc']);
  });

  describe('constructor', () => {
    it('uses the configured key file + project id and bucket', () => {
      const service = build();
      expect(StorageCtor).toHaveBeenCalledWith({ keyFilename: '/fake/key.json', projectId: 'test-project' });
      expect(mockStorageBucket).toHaveBeenCalledWith(BUCKET);
      expect(service.getBucketName()).toBe(BUCKET);
    });

    it('falls back to ADC (no keyFilename) when no key file is configured', () => {
      config['googleStorage.keyFilename'] = undefined;
      build();
      expect(StorageCtor).toHaveBeenCalledWith({ projectId: 'test-project' });
    });

    it('defaults the bucket name to sesly-storage', () => {
      config['googleStorage.bucket'] = undefined;
      const service = build();
      expect(service.getBucketName()).toBe('sesly-storage');
      expect(mockStorageBucket).toHaveBeenCalledWith('sesly-storage');
    });
  });

  describe('uploadFile', () => {
    it('saves under the key with content type (non-resumable) and returns the public-style URL', async () => {
      const buffer = Buffer.from('audio');
      const url = await build().uploadFile(buffer, 'voice-samples/u1/p1/reference/a.wav', 'audio/wav');

      expect(mockBucket.file).toHaveBeenCalledWith('voice-samples/u1/p1/reference/a.wav');
      expect(mockFile.save).toHaveBeenCalledWith(buffer, {
        contentType: 'audio/wav',
        resumable: false,
        metadata: { contentType: 'audio/wav' },
      });
      expect(url).toBe(`${PUBLIC}/voice-samples/u1/p1/reference/a.wav`);
    });

    it('defaults the content type to application/octet-stream', async () => {
      await build().uploadFile(Buffer.from('x'), 'k.bin');
      expect(mockFile.save.mock.calls[0][1]).toMatchObject({
        contentType: 'application/octet-stream',
        metadata: { contentType: 'application/octet-stream' },
      });
    });

    it('rethrows upload errors', async () => {
      const err = new Error('quota exceeded');
      mockFile.save.mockRejectedValue(err);
      await expect(build().uploadFile(Buffer.from('x'), 'k')).rejects.toBe(err);
    });
  });

  describe('getFileUrl / fileExists', () => {
    it('getFileUrl returns the URL when the object exists', async () => {
      await expect(build().getFileUrl('a/b.mp3')).resolves.toBe(`${PUBLIC}/a/b.mp3`);
    });

    it('getFileUrl returns null when missing or when the check fails', async () => {
      mockFile.exists.mockResolvedValueOnce([false]);
      await expect(build().getFileUrl('a/b.mp3')).resolves.toBeNull();
      mockFile.exists.mockRejectedValueOnce(new Error('network'));
      await expect(build().getFileUrl('a/b.mp3')).resolves.toBeNull();
    });

    it('fileExists mirrors exists() and swallows errors as false', async () => {
      const service = build();
      await expect(service.fileExists('k')).resolves.toBe(true);
      mockFile.exists.mockResolvedValueOnce([false]);
      await expect(service.fileExists('k')).resolves.toBe(false);
      mockFile.exists.mockRejectedValueOnce(new Error('network'));
      await expect(service.fileExists('k')).resolves.toBe(false);
    });
  });

  describe('downloadFile', () => {
    it('returns the object contents', async () => {
      await expect(build().downloadFile('k')).resolves.toEqual(Buffer.from('bytes'));
      expect(mockBucket.file).toHaveBeenCalledWith('k');
    });

    it('rethrows download errors', async () => {
      const err = Object.assign(new Error('No such object'), { code: 404 });
      mockFile.download.mockRejectedValue(err);
      await expect(build().downloadFile('k')).rejects.toBe(err);
    });
  });

  describe('deleteFile', () => {
    it('deletes an existing object', async () => {
      await build().deleteFile('k');
      expect(mockFile.delete).toHaveBeenCalledTimes(1);
    });

    it('is tolerant of a missing object (no delete call, no throw)', async () => {
      mockFile.exists.mockResolvedValue([false]);
      await expect(build().deleteFile('gone')).resolves.toBeUndefined();
      expect(mockFile.delete).not.toHaveBeenCalled();
    });

    it('propagates errors from delete()', async () => {
      const err = new Error('permission denied');
      mockFile.delete.mockRejectedValue(err);
      await expect(build().deleteFile('k')).rejects.toBe(err);
    });

    it('propagates errors from exists()', async () => {
      const err = new Error('network');
      mockFile.exists.mockRejectedValue(err);
      await expect(build().deleteFile('k')).rejects.toBe(err);
      expect(mockFile.delete).not.toHaveBeenCalled();
    });
  });

  describe('generatePresignedUrl', () => {
    let nowSpy: jest.SpyInstance;
    const NOW = 1_800_000_000_000;

    beforeEach(() => {
      nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    });

    afterEach(() => {
      nowSpy.mockRestore();
    });

    it('requests a v4 read URL expiring after 1 hour by default', async () => {
      const url = await build().generatePresignedUrl('audio/a/full.mp3');
      expect(mockBucket.file).toHaveBeenCalledWith('audio/a/full.mp3');
      expect(mockFile.getSignedUrl).toHaveBeenCalledWith({
        version: 'v4',
        action: 'read',
        expires: NOW + 3600 * 1000,
      });
      expect(url).toBe('https://signed.example/url?X-Goog-Signature=abc');
    });

    it('honours a custom expiry in seconds', async () => {
      await build().generatePresignedUrl('k', 60);
      expect(mockFile.getSignedUrl.mock.calls[0][0].expires).toBe(NOW + 60_000);
    });

    it('rethrows signing errors', async () => {
      const err = new Error('Cannot sign data without client_email');
      mockFile.getSignedUrl.mockRejectedValue(err);
      await expect(build().generatePresignedUrl('k')).rejects.toBe(err);
    });
  });

  describe('extractKey', () => {
    it.each([
      ['avatars/u/1.jpg', 'avatars/u/1.jpg'],
      [`gs://${BUCKET}/audio/a/full.mp3`, 'audio/a/full.mp3'],
      [`${PUBLIC}/stories/cover/x.png`, 'stories/cover/x.png'],
      [`https://${BUCKET}.storage.googleapis.com/stories/cover/x.png`, 'stories/cover/x.png'],
      ['https://lh3.googleusercontent.com/a/photo.jpg', null],
      ['https://storage.googleapis.com/other-bucket/stories/cover/x.png', null],
      ['gs://other-bucket/audio/a/full.mp3', null],
      [null, null],
      ['', null],
    ])('%p -> %p', (value, expected) => {
      expect(build().extractKey(value)).toBe(expected);
    });
  });

  describe('getReadUrl', () => {
    it.each([[null], [undefined], ['']])('returns null for %p without signing', async (value) => {
      await expect(build().getReadUrl(value)).resolves.toBeNull();
      expect(mockFile.getSignedUrl).not.toHaveBeenCalled();
    });

    it.each([
      ['voice-samples/u/p.mp3', 'voice-samples/u/p.mp3'],
      [`gs://${BUCKET}/audio/a/full.mp3`, 'audio/a/full.mp3'],
      [`${PUBLIC}/avatars/u/my%20photo.jpg`, 'avatars/u/my photo.jpg'],
      [`${PUBLIC}/audio/a/full.mp3?X-Goog-Signature=stale`, 'audio/a/full.mp3'],
    ])('presigns our object %p (key %p)', async (value, key) => {
      const url = await build().getReadUrl(value);
      expect(mockBucket.file).toHaveBeenCalledWith(key);
      expect(url).toBe('https://signed.example/url?X-Goog-Signature=abc');
    });

    it('passes the expiry through to the signer', async () => {
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000);
      try {
        await build().getReadUrl('k', 120);
        expect(mockFile.getSignedUrl.mock.calls[0][0].expires).toBe(1_000 + 120_000);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it.each([
      'https://lh3.googleusercontent.com/a/photo.jpg',
      'http://cdn.example.com/cover.png',
      'HTTPS://CDN.EXAMPLE.COM/cover.png',
    ])('returns third-party http(s) URL %p unchanged without signing', async (value) => {
      await expect(build().getReadUrl(value)).resolves.toBe(value);
      expect(mockFile.getSignedUrl).not.toHaveBeenCalled();
    });

    it('returns null for a non-http foreign URL', async () => {
      await expect(build().getReadUrl('ftp://example.com/file.mp3')).resolves.toBeNull();
      expect(mockFile.getSignedUrl).not.toHaveBeenCalled();
    });

    it('never throws: a signing failure yields null', async () => {
      mockFile.getSignedUrl.mockRejectedValue(new Error('signBlob denied'));
      await expect(build().getReadUrl('audio/a/full.mp3')).resolves.toBeNull();
    });

    // Fixed (was BUG): extractStorageKey ignored the bucket segment, so a GCS
    // URL of SOMEONE ELSE'S bucket was presigned as `images/cat.png` in ours.
    it('returns a GCS URL of a foreign bucket unchanged instead of presigning it in ours', async () => {
      const foreign = 'https://storage.googleapis.com/some-public-bucket/images/cat.png';
      await expect(build().getReadUrl(foreign)).resolves.toBe(foreign);
      expect(mockFile.getSignedUrl).not.toHaveBeenCalled();
    });

    it.each([
      ['https://some-public-bucket.storage.googleapis.com/images/cat.png', 'https://some-public-bucket.storage.googleapis.com/images/cat.png'],
      ['gs://some-public-bucket/images/cat.png', null],
    ])('foreign bucket %p is never presigned (-> %p)', async (value, expected) => {
      await expect(build().getReadUrl(value)).resolves.toBe(expected);
      expect(mockFile.getSignedUrl).not.toHaveBeenCalled();
    });
  });

  describe('listFiles', () => {
    it('lists object names under a prefix (orphan scans)', async () => {
      mockBucket.getFiles.mockResolvedValue([[{ name: 'audio/a/1.mp3' }, { name: 'audio/a/2.mp3' }]]);
      await expect(build().listFiles('audio/a/')).resolves.toEqual(['audio/a/1.mp3', 'audio/a/2.mp3']);
      expect(mockBucket.getFiles).toHaveBeenCalledWith({ prefix: 'audio/a/' });
    });

    it('rethrows list errors', async () => {
      const err = new Error('boom');
      mockBucket.getFiles.mockRejectedValue(err);
      await expect(build().listFiles('x/')).rejects.toBe(err);
    });
  });

  describe('listAllFilesWithMetadata', () => {
    it('auto-paginates and normalizes size / updated metadata', async () => {
      mockBucket.getFiles.mockResolvedValue([
        [
          { name: 'a.mp3', metadata: { size: '1024', updated: '2026-09-01T00:00:00Z' } },
          { name: 'b.mp3', metadata: { size: 2048 } },
          { name: 'c.mp3', metadata: { size: 'not-a-number', updated: '2026-09-02T00:00:00Z' } },
          { name: 'd.mp3', metadata: undefined },
        ],
      ]);

      await expect(build().listAllFilesWithMetadata()).resolves.toEqual([
        { name: 'a.mp3', sizeBytes: 1024, updatedAt: '2026-09-01T00:00:00Z' },
        { name: 'b.mp3', sizeBytes: 2048, updatedAt: '' },
        { name: 'c.mp3', sizeBytes: 0, updatedAt: '2026-09-02T00:00:00Z' },
        { name: 'd.mp3', sizeBytes: 0, updatedAt: '' },
      ]);
      expect(mockBucket.getFiles).toHaveBeenCalledWith({ autoPaginate: true });
    });

    it('rethrows list errors', async () => {
      const err = new Error('boom');
      mockBucket.getFiles.mockRejectedValue(err);
      await expect(build().listAllFilesWithMetadata()).rejects.toBe(err);
    });
  });

  describe('deleteFolder', () => {
    it('deletes every object under the prefix', async () => {
      await build().deleteFolder('voice-samples/u1/p1/');
      expect(mockBucket.deleteFiles).toHaveBeenCalledWith({ prefix: 'voice-samples/u1/p1/' });
    });

    it('rethrows delete errors', async () => {
      const err = new Error('boom');
      mockBucket.deleteFiles.mockRejectedValue(err);
      await expect(build().deleteFolder('p/')).rejects.toBe(err);
    });
  });
});
