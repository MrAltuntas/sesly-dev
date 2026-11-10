/**
 * Cache Service
 * Handles device-level caching of audio files and images
 * Uses expo-file-system (v19 new API) for audio caching and expo-image for image caching
 */

import { Paths, File, Directory } from 'expo-file-system';
import { Image } from 'expo-image';

// ============================================================================
// Types
// ============================================================================

interface CacheManifestEntry {
  remoteUrl: string;
  localFileName: string;
  cachedAt: number;
  fileSize: number;
}

interface CacheManifest {
  entries: Record<string, CacheManifestEntry>;
}

interface CacheSize {
  audio: number;
  images: number;
  total: number;
}

// ============================================================================
// Constants
// ============================================================================

const AUDIO_CACHE_DIR_NAME = 'sesly_audio';
const MANIFEST_FILE_NAME = 'manifest.json';

// ============================================================================
// Cache Service Class (Singleton)
// ============================================================================

class CacheService {
  private static instance: CacheService;
  private manifest: CacheManifest = { entries: {} };
  private initialized = false;
  private cacheDir!: Directory;
  private manifestFile!: File;

  private constructor() {}

  public static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Ensure the cache directory and manifest exist
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.cacheDir = new Directory(Paths.cache, AUDIO_CACHE_DIR_NAME);
      this.manifestFile = new File(this.cacheDir, MANIFEST_FILE_NAME);

      if (!this.cacheDir.exists) {
        this.cacheDir.create({ intermediates: true });
      }

      await this.loadManifest();
      this.initialized = true;
    } catch (error) {
      console.error('[CacheService] Initialization failed:', error);
      this.manifest = { entries: {} };
      this.initialized = true;
    }
  }

  // ============================================================================
  // Manifest Management
  // ============================================================================

  /**
   * Load the cache manifest from disk
   */
  private async loadManifest(): Promise<void> {
    try {
      if (this.manifestFile.exists) {
        const content = await this.manifestFile.text();
        this.manifest = JSON.parse(content) as CacheManifest;
      } else {
        this.manifest = { entries: {} };
      }
    } catch (error) {
      console.error('[CacheService] Failed to load manifest:', error);
      this.manifest = { entries: {} };
    }
  }

  /**
   * Save the cache manifest to disk
   */
  private saveManifest(): void {
    try {
      this.manifestFile.write(JSON.stringify(this.manifest));
    } catch (error) {
      console.error('[CacheService] Failed to save manifest:', error);
    }
  }

  /**
   * Generate a stable local filename from a remote URL
   */
  private getLocalFileName(remoteUrl: string): string {
    // Create a simple hash from the URL to use as filename
    let hash = 0;
    for (let i = 0; i < remoteUrl.length; i++) {
      const char = remoteUrl.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    const hashStr = Math.abs(hash).toString(36);

    // Extract the file extension from the URL, defaulting to .mp3
    const urlPath = remoteUrl.split('?')[0];
    const extension = urlPath.match(/\.(mp3|wav|m4a|aac|ogg)$/i)?.[0] || '.mp3';

    return `${hashStr}${extension}`;
  }

  // ============================================================================
  // Audio Cache Methods
  // ============================================================================

  /**
   * Get cached audio URI for a remote URL
   * Returns local URI if cached, downloads and caches if not
   */
  public async getCachedAudioUri(remoteUrl: string): Promise<string> {
    await this.ensureInitialized();

    // Check if already cached
    const entry = this.manifest.entries[remoteUrl];
    if (entry) {
      const localFile = new File(this.cacheDir, entry.localFileName);

      if (localFile.exists) {
        return localFile.uri;
      }

      // File was deleted externally, remove from manifest
      delete this.manifest.entries[remoteUrl];
      this.saveManifest();
    }

    // Download and cache
    const localFileName = this.getLocalFileName(remoteUrl);
    const destinationFile = new File(this.cacheDir, localFileName);

    try {
      const downloadedFile = await File.downloadFileAsync(
        remoteUrl,
        destinationFile,
        { idempotent: true },
      );

      const fileSize = downloadedFile.size || 0;

      this.manifest.entries[remoteUrl] = {
        remoteUrl,
        localFileName,
        cachedAt: Date.now(),
        fileSize,
      };
      this.saveManifest();

      return downloadedFile.uri;
    } catch (error) {
      console.error('[CacheService] Failed to download audio:', error);
      return remoteUrl;
    }
  }

  // ============================================================================
  // Cache Size Methods
  // ============================================================================

  /**
   * Get the total cache size in bytes
   * Returns audio cache size by scanning directory and image size (0 since expo-image manages its own)
   */
  public async getCacheSize(): Promise<CacheSize> {
    await this.ensureInitialized();

    let audioSize = 0;

    // Calculate audio cache size by scanning the directory
    try {
      if (this.cacheDir.exists) {
        const items = this.cacheDir.list();
        for (const item of items) {
          if (item instanceof File && item.name !== MANIFEST_FILE_NAME) {
            const size = item.size;
            if (size > 0) {
              audioSize += size;
            }
          }
        }
      }
    } catch (error) {
      console.error('[CacheService] Failed to calculate audio cache size:', error);
    }

    // expo-image manages its own disk cache; we cannot easily read its size
    // so we report 0 for images (the clear function still works)
    const imagesSize = 0;

    return {
      audio: audioSize,
      images: imagesSize,
      total: audioSize + imagesSize,
    };
  }

  // ============================================================================
  // Cache Clear Methods
  // ============================================================================

  /**
   * Clear all cached audio files
   */
  public async clearAudioCache(): Promise<void> {
    await this.ensureInitialized();

    try {
      if (this.cacheDir.exists) {
        this.cacheDir.delete();
      }
      this.cacheDir.create({ intermediates: true });

      this.manifest = { entries: {} };
      this.saveManifest();
      console.log('[CacheService] Audio cache cleared');
    } catch (error) {
      console.error('[CacheService] Failed to clear audio cache:', error);
      throw error;
    }
  }

  /**
   * Clear cached images using expo-image's built-in cache management
   */
  public async clearImageCache(): Promise<void> {
    try {
      await Image.clearDiskCache();
      await Image.clearMemoryCache();
      console.log('[CacheService] Image cache cleared');
    } catch (error) {
      console.error('[CacheService] Failed to clear image cache:', error);
      throw error;
    }
  }

  /**
   * Clear all caches (audio + images)
   */
  public async clearAllCache(): Promise<void> {
    await Promise.all([
      this.clearAudioCache(),
      this.clearImageCache(),
    ]);
    console.log('[CacheService] All caches cleared');
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export default CacheService.getInstance();
