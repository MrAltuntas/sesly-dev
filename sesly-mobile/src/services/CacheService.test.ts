// In-memory fake of the expo-file-system v19 object API (Paths / File /
// Directory). The global mock only covers the legacy functional API.
jest.mock('expo-file-system', () => {
  const files = new Map<string, { content: string; size: number }>();
  const dirs = new Set<string>();

  const parentUri = (parent: unknown): string =>
    typeof parent === 'string' ? parent : (parent as { uri: string }).uri;
  const join = (parent: unknown, name: string): string => {
    const base = parentUri(parent);
    return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`;
  };

  class File {
    uri: string;
    constructor(parent: unknown, name: string) {
      this.uri = join(parent, name);
    }
    get exists(): boolean {
      return files.has(this.uri);
    }
    get name(): string {
      return this.uri.split('/').pop() as string;
    }
    get size(): number {
      return files.get(this.uri)?.size ?? 0;
    }
    async text(): Promise<string> {
      return (files.get(this.uri) as { content: string }).content;
    }
    write(content: string): void {
      files.set(this.uri, { content, size: content.length });
    }
    static downloadFileAsync = jest.fn(async (_url: string, dest: File) => {
      files.set(dest.uri, { content: 'audio-bytes', size: 2048 });
      return dest;
    });
  }

  class Directory {
    uri: string;
    constructor(parent: unknown, name: string) {
      this.uri = join(parent, name);
    }
    get exists(): boolean {
      return dirs.has(this.uri);
    }
    create(): void {
      dirs.add(this.uri);
    }
    delete(): void {
      dirs.delete(this.uri);
      Array.from(files.keys())
        .filter(k => k.startsWith(`${this.uri}/`))
        .forEach(k => files.delete(k));
    }
    list(): File[] {
      return Array.from(files.keys())
        .filter(k => k.startsWith(`${this.uri}/`))
        .map(k => {
          const f = Object.create(File.prototype) as File;
          f.uri = k;
          return f;
        });
    }
  }

  return {
    __esModule: true,
    Paths: { cache: { uri: 'file:///cache' } },
    File,
    Directory,
    __fs: { files, dirs },
  };
});

jest.mock('expo-image', () => ({
  Image: {
    clearDiskCache: jest.fn(async () => true),
    clearMemoryCache: jest.fn(async () => true),
  },
}));

type FsMock = {
  File: { downloadFileAsync: jest.Mock };
  __fs: { files: Map<string, { content: string; size: number }>; dirs: Set<string> };
};
type ImageMock = { Image: { clearDiskCache: jest.Mock; clearMemoryCache: jest.Mock } };
type CacheModule = typeof import('./CacheService');

const CACHE_DIR = 'file:///cache/sesly_audio';
const MANIFEST = `${CACHE_DIR}/manifest.json`;

/** Fresh singleton + fresh fake file system per test. */
const load = () => {
  let service: CacheModule['default'] | undefined;
  let fs: FsMock | undefined;
  let image: ImageMock | undefined;
  jest.isolateModules(() => {
    service = (require('./CacheService') as CacheModule).default;
    fs = require('expo-file-system') as FsMock;
    image = require('expo-image') as ImageMock;
  });
  return { service: service as CacheModule['default'], fs: fs as FsMock, image: image as ImageMock };
};

const AUDIO_URL = 'https://storage.googleapis.com/sesly/audio/aud-1/final.mp3?X-Goog-Signature=abc';

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('CacheService.getCachedAudioUri', () => {
  it('downloads once, records it in the manifest, then serves the local file', async () => {
    const { service, fs } = load();

    const first = await service.getCachedAudioUri(AUDIO_URL);

    expect(fs.File.downloadFileAsync).toHaveBeenCalledTimes(1);
    const [url, dest, options] = fs.File.downloadFileAsync.mock.calls[0];
    expect(url).toBe(AUDIO_URL);
    expect(options).toEqual({ idempotent: true });
    expect(first).toBe((dest as { uri: string }).uri);
    expect(first).toMatch(/^file:\/\/\/cache\/sesly_audio\/[a-z0-9]+\.mp3$/);

    const manifest = JSON.parse(fs.__fs.files.get(MANIFEST)?.content as string);
    expect(manifest.entries[AUDIO_URL]).toMatchObject({ remoteUrl: AUDIO_URL, fileSize: 2048 });

    const second = await service.getCachedAudioUri(AUDIO_URL);
    expect(second).toBe(first);
    expect(fs.File.downloadFileAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps known extensions from the URL path and ignores the query string', async () => {
    const { service } = load();
    await expect(service.getCachedAudioUri('https://x.test/a/sample.WAV?sig=.mp3')).resolves.toMatch(/\.WAV$/);
    await expect(service.getCachedAudioUri('https://x.test/a/stream')).resolves.toMatch(/\.mp3$/);
  });

  it('re-downloads when the cached file was removed from disk', async () => {
    const { service, fs } = load();
    const local = await service.getCachedAudioUri(AUDIO_URL);
    fs.__fs.files.delete(local);

    await service.getCachedAudioUri(AUDIO_URL);

    expect(fs.File.downloadFileAsync).toHaveBeenCalledTimes(2);
  });

  it('falls back to the remote URL when the download fails', async () => {
    const { service, fs } = load();
    fs.File.downloadFileAsync.mockRejectedValueOnce(new Error('offline'));

    await expect(service.getCachedAudioUri(AUDIO_URL)).resolves.toBe(AUDIO_URL);
    expect(fs.__fs.files.has(MANIFEST)).toBe(false);
  });

  it('loads an existing manifest from disk', async () => {
    const { service, fs } = load();
    fs.__fs.dirs.add(CACHE_DIR);
    fs.__fs.files.set(`${CACHE_DIR}/cached.mp3`, { content: 'x', size: 10 });
    fs.__fs.files.set(MANIFEST, {
      content: JSON.stringify({
        entries: {
          [AUDIO_URL]: { remoteUrl: AUDIO_URL, localFileName: 'cached.mp3', cachedAt: 1, fileSize: 10 },
        },
      }),
      size: 1,
    });

    await expect(service.getCachedAudioUri(AUDIO_URL)).resolves.toBe(`${CACHE_DIR}/cached.mp3`);
    expect(fs.File.downloadFileAsync).not.toHaveBeenCalled();
  });

  it('treats a corrupt manifest as empty', async () => {
    const { service, fs } = load();
    fs.__fs.dirs.add(CACHE_DIR);
    fs.__fs.files.set(MANIFEST, { content: '{corrupt', size: 8 });

    await service.getCachedAudioUri(AUDIO_URL);

    expect(fs.File.downloadFileAsync).toHaveBeenCalledTimes(1);
  });
});

describe('CacheService size and clearing', () => {
  it('getCacheSize() sums the audio files, excluding the manifest', async () => {
    const { service } = load();
    await service.getCachedAudioUri(AUDIO_URL);
    await service.getCachedAudioUri('https://x.test/other.m4a');

    await expect(service.getCacheSize()).resolves.toEqual({ audio: 4096, images: 0, total: 4096 });
  });

  it('clearAudioCache() empties the directory and the manifest', async () => {
    const { service, fs } = load();
    await service.getCachedAudioUri(AUDIO_URL);

    await service.clearAudioCache();

    expect(fs.__fs.dirs.has(CACHE_DIR)).toBe(true);
    expect(JSON.parse(fs.__fs.files.get(MANIFEST)?.content as string)).toEqual({ entries: {} });
    await expect(service.getCacheSize()).resolves.toMatchObject({ audio: 0 });
    await service.getCachedAudioUri(AUDIO_URL);
    expect(fs.File.downloadFileAsync).toHaveBeenCalledTimes(2);
  });

  it('clearImageCache() clears the expo-image disk and memory caches', async () => {
    const { service, image } = load();
    await service.clearImageCache();
    expect(image.Image.clearDiskCache).toHaveBeenCalledTimes(1);
    expect(image.Image.clearMemoryCache).toHaveBeenCalledTimes(1);
  });

  it('clearImageCache() rethrows failures', async () => {
    const { service, image } = load();
    image.Image.clearDiskCache.mockRejectedValueOnce(new Error('io'));
    await expect(service.clearImageCache()).rejects.toThrow('io');
  });

  it('clearAllCache() clears audio and images', async () => {
    const { service, fs, image } = load();
    await service.getCachedAudioUri(AUDIO_URL);

    await service.clearAllCache();

    expect(image.Image.clearDiskCache).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fs.__fs.files.get(MANIFEST)?.content as string)).toEqual({ entries: {} });
  });
});
