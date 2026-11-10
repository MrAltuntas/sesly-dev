import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiUrl: process.env.API_URL || 'http://localhost:3000',
  frontendUrl: process.env.FRONTEND_URL || 'https://sesly.io',
  mobileDeepLink: process.env.MOBILE_DEEP_LINK || 'sesly://',
  corsOrigins: [
    ...(process.env.CORS_ORIGINS?.split(',') || []),
    'https://sesly.io',
    'https://api.sesly.io',
    'https://admin.sesly.io',
    'http://localhost:3000',
    'http://localhost:3001',
  ].filter((v, i, a) => a.indexOf(v) === i), // Remove duplicates
}));
