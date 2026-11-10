import { registerAs } from '@nestjs/config';

export default registerAs('google', () => ({
  // Google OAuth (for Sign-In)
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET, // Optional for backend

  // GOOGLE_APPLICATION_CREDENTIALS environment variable (path to JSON file) is used automatically
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
}));
