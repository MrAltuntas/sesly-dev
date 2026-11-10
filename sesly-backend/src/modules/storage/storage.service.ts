import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage, Bucket } from '@google-cloud/storage';
import { extractStorageKey } from '../../common/utils/storage-key';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly storage: Storage;
  private readonly bucket: Bucket;
  private readonly bucketName: string;

  constructor(private configService: ConfigService) {
    this.bucketName = this.configService.get<string>('googleStorage.bucket') || 'sesly-storage';

    const projectId = this.configService.get<string>('googleStorage.projectId');
    const keyFilename = this.configService.get<string>('googleStorage.keyFilename');

    if (keyFilename) {
      this.storage = new Storage({ keyFilename, projectId });
    } else {
      // Falls back to Application Default Credentials when running on GCP
      this.storage = new Storage({ projectId });
    }

    this.bucket = this.storage.bucket(this.bucketName);
    this.logger.log(`Storage Service initialized for bucket: ${this.bucketName}`);
  }

  async uploadFile(
    file: Buffer,
    key: string,
    contentType: string = 'application/octet-stream',
  ): Promise<string> {
    try {
      const fileRef = this.bucket.file(key);
      
      await fileRef.save(file, {
        contentType,
        resumable: false, // Disable resumable uploads for small files to reduce requests
        metadata: {
          contentType,
        },
      });

      const url = `https://storage.googleapis.com/${this.bucketName}/${key}`;

      this.logger.log(`File uploaded successfully: ${key}`);
      return url;
    } catch (error) {
      this.logger.error(`Failed to upload file: ${key}`, error);
      throw error;
    }
  }

  async getFileUrl(key: string): Promise<string | null> {
    try {
      const file = this.bucket.file(key);
      const [exists] = await file.exists();

      if (exists) {
        const url = `https://storage.googleapis.com/${this.bucketName}/${key}`;
        this.logger.debug(`File exists: ${key}`);
        return url;
      }

      return null;
    } catch (error) {
      this.logger.debug(`File not found: ${key}`);
      return null;
    }
  }

  async fileExists(key: string): Promise<boolean> {
    try {
      const file = this.bucket.file(key);
      const [exists] = await file.exists();
      return exists;
    } catch (error) {
      this.logger.debug(`File check failed for ${key}:`, error);
      return false;
    }
  }

  /**
   * Download a GCS object into memory. Used by the voice training
   * pipeline to transcode samples before sending to Minimax.
   */
  async downloadFile(key: string): Promise<Buffer> {
    try {
      const file = this.bucket.file(key);
      const [contents] = await file.download();
      return contents;
    } catch (error) {
      this.logger.error(`Failed to download file: ${key}`, error);
      throw error;
    }
  }

  async deleteFile(key: string): Promise<void> {
    try {
      const file = this.bucket.file(key);
      const [exists] = await file.exists();

      if (exists) {
        await file.delete();
        this.logger.log(`File deleted successfully: ${key}`);
      } else {
        this.logger.warn(`File not found for deletion: ${key}`);
      }
    } catch (error) {
      this.logger.error(`Failed to delete file: ${key}`, error);
      throw error;
    }
  }

  async generatePresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const file = this.bucket.file(key);
      
      // Get a v4 signed URL for reading the file
      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + expiresIn * 1000, // Expires in 'expiresIn' seconds
      });

      this.logger.log(`Presigned URL generated for: ${key}`);
      return url;
    } catch (error) {
      this.logger.error(`Failed to generate presigned URL: ${key}`, error);
      throw error;
    }
  }

  /**
   * Object key for a stored URL/key, or null when the value does not point
   * into our bucket (third-party avatar, external CDN link, ...).
   */
  extractKey(value: string | null | undefined): string | null {
    return extractStorageKey(value, this.bucketName);
  }

  /**
   * Client-facing read URL for a value stored in the DB.
   *   - our GCS object  -> short-lived presigned URL (null if signing fails)
   *   - external URL    -> returned unchanged
   *   - empty           -> null
   * Never throws, so it is safe inside list mappers.
   */
  async getReadUrl(
    value: string | null | undefined,
    expiresIn: number = 3600,
  ): Promise<string | null> {
    if (!value) return null;
    const key = extractStorageKey(value, this.bucketName);
    if (!key) {
      return /^https?:\/\//i.test(value) ? value : null;
    }
    try {
      return await this.generatePresignedUrl(key, expiresIn);
    } catch (error) {
      this.logger.warn(`Could not presign ${key}: ${(error as Error)?.message ?? error}`);
      return null;
    }
  }

  async listFiles(prefix: string): Promise<string[]> {
    try {
      const [files] = await this.bucket.getFiles({ prefix });
      return files.map(file => file.name);
    } catch (error) {
      this.logger.error(`Failed to list files with prefix: ${prefix}`, error);
      throw error;
    }
  }

  /**
   * List all files in the bucket with their GCS metadata
   * (name, sizeBytes, updatedAt). Used by admin storage endpoints
   * (stats / orphan detection). Streams via autoPaginate, OK for
   * MVP (<100k objects).
   */
  async listAllFilesWithMetadata(): Promise<
    Array<{ name: string; sizeBytes: number; updatedAt: string }>
  > {
    try {
      const [files] = await this.bucket.getFiles({ autoPaginate: true });
      return files.map((file) => {
        const rawSize = (file.metadata as { size?: string | number } | undefined)?.size;
        const sizeBytes =
          typeof rawSize === 'string' ? parseInt(rawSize, 10) || 0
            : typeof rawSize === 'number' ? rawSize
              : 0;
        const updated =
          (file.metadata as { updated?: string } | undefined)?.updated ?? '';
        return {
          name: file.name,
          sizeBytes,
          updatedAt: updated,
        };
      });
    } catch (error) {
      this.logger.error('Failed to list all files in bucket', error);
      throw error;
    }
  }

  /**
   * Expose the configured GCS bucket name (read-only).
   */
  getBucketName(): string {
    return this.bucketName;
  }

  async deleteFolder(prefix: string): Promise<void> {
    try {
      await this.bucket.deleteFiles({ prefix });
      this.logger.log(`Folder deleted successfully: ${prefix}`);
    } catch (error) {
      this.logger.error(`Failed to delete folder: ${prefix}`, error);
      throw error;
    }
  }
}