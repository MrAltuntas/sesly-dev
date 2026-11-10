import { registerAs } from '@nestjs/config';

export default registerAs('googleStorage', () => ({
  bucket: process.env.GOOGLE_STORAGE_BUCKET || 'sesly-storage',
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS, // Path to service account key file
}));
