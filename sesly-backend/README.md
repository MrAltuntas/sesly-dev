# Sesly Backend API


> AI-Powered Voice Cloning Backend for Bedtime Stories

## Overview

Sesly is a production-ready NestJS backend API that powers an AI voice cloning mobile application. Users can clone their voices and generate bedtime stories narrated in their own voice.

## Features

- **Authentication**: Email/password, Google OAuth, Apple Sign-In
- **Multi-Provider TTS**: Azure Speech Services, Google Cloud TTS, ElevenLabs
- **Voice Profiles**: Pre-built neural voices in Turkish and other languages
- **Story Library**: Turkish and world classic stories
- **Audio Generation**: Async TTS with Bull queues
- **Subscriptions**: Stripe payment integration
- **Usage Tracking**: Monthly limits and quota management
- **File Storage**: AWS S3 / DigitalOcean Spaces
- **Email Service**: Resend integration
- **KVKK Compliance**: Data protection and encryption

## Tech Stack

- **Runtime**: Node.js 22 LTS
- **Framework**: NestJS 10.x
- **Language**: TypeScript 5.x (strict mode)
- **Database**: PostgreSQL 16 + Prisma 5.x
- **Cache/Queue**: Redis 7.x + Bull 4.x
- **File Storage**: AWS S3 (S3-compatible)
- **TTS Providers**: Azure Speech Services (primary), Google Cloud TTS, ElevenLabs
- **Payments**: Stripe
- **Email**: Resend
- **Authentication**: Passport.js + JWT
- **Documentation**: Swagger/OpenAPI

## Prerequisites

- Node.js 22 LTS
- PostgreSQL 16
- Redis 7.x
- Docker & Docker Compose (optional)

## Quick Start

### 1. Clone Repository

```bash
git clone <repository-url>
cd sesly-backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 4. Database Setup

```bash
# Run migrations
npx prisma migrate dev

# Seed database with stories
npx prisma db seed
```

### 5. Start Development Server

```bash
npm run start:dev
```

The API will be available at:
- http://localhost:3000
- API Docs: http://localhost:3000/api/docs
- Health Check: http://localhost:3000/health

## Docker Setup

### Development

```bash
docker-compose up -d
```

### Production

```bash
# Build image
docker build -t sesly-api .

# Run container
docker run -p 3000:3000 --env-file .env sesly-api
```

## Environment Variables

See `.env.example` for all required environment variables:

- **Application**: PORT, NODE_ENV, API_URL
- **Database**: DATABASE_URL
- **Redis**: REDIS_HOST, REDIS_PORT
- **JWT**: JWT_SECRET, JWT_REFRESH_SECRET
- **S3**: S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
- **TTS**: TTS_PROVIDER (azure/google/elevenlabs)
- **Azure**: AZURE_SPEECH_KEY, AZURE_SPEECH_REGION
- **Google Cloud**: GOOGLE_TTS_CREDENTIALS, GOOGLE_CLOUD_PROJECT_ID
- **ElevenLabs**: ELEVENLABS_API_KEY
- **Stripe**: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
- **OAuth**: GOOGLE_CLIENT_ID, APPLE_CLIENT_ID
- **Email**: RESEND_API_KEY

## API Documentation

### Authentication

#### Email/Password Authentication
- `POST /auth/register` - Register new user
- `POST /auth/login` - Login with email/password
- `POST /auth/refresh` - Refresh access token
- `POST /auth/forgot-password` - Request password reset
- `POST /auth/reset-password` - Reset password
- `POST /auth/verify-email` - Verify email address

#### OAuth (Web Flow)
- `GET /auth/google` - Initiate Google OAuth (redirects to Google)
- `GET /auth/google/callback` - Google OAuth callback
- `GET /auth/apple` - Initiate Apple Sign-In (redirects to Apple)
- `POST /auth/apple/callback` - Apple Sign-In callback

#### Mobile Token Exchange (Recommended for Mobile Apps)
- `POST /auth/google/token` - Verify Google ID token from mobile SDK
- `POST /auth/apple/token` - Verify Apple identity token from mobile SDK

**Mobile Authentication Flow:**

1. **Frontend (Flutter)**: Use native Google/Apple Sign-In SDK to get ID token
2. **Frontend → Backend**: Send ID token to `/auth/google/token` or `/auth/apple/token`
3. **Backend**: Verify token, create/update user, return JWT tokens
4. **Frontend**: Store JWT tokens, navigate to app

**Example Request (Google):**
```json
POST /auth/google/token
{
  "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjE4MmU..."
}
```

**Example Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "emailVerified": true
  }
}
```

**Example Request (Apple):**
```json
POST /auth/apple/token
{
  "identityToken": "eyJraWQiOiJlWGF1bm1MIiwiYWxnIjoiUlMyNTYifQ...",
  "user": "001234.a1b2c3d4e5f6...",
  "email": "user@privaterelay.appleid.com",
  "givenName": "John",
  "familyName": "Doe"
}
```

**Note:** Apple only provides `email`, `givenName`, and `familyName` on the first sign-in. Subsequent sign-ins only provide `identityToken` and `user` (Apple user ID).

### Users

- `GET /users/me` - Get current user
- `PATCH /users/me` - Update profile
- `DELETE /users/me` - Delete account
- `GET /users/me/profile` - Extended profile with subscription

### Voice Profiles

- `GET /voice-profiles/available-voices` - Get all available voices from TTS providers
- `GET /voice-profiles` - List voice profiles
- `POST /voice-profiles/v2` - Create voice profile (v2 - multi-provider support)
- `POST /voice-profiles` - Create voice profile (legacy)
- `GET /voice-profiles/:id/training-text` - Get training text (legacy)
- `POST /voice-profiles/:id/upload-sample` - Upload audio sample (legacy)
- `GET /voice-profiles/:id/status` - Check training status
- `DELETE /voice-profiles/:id` - Delete voice profile

### Stories

- `GET /stories` - List stories (paginated, filtered)
- `GET /stories/:id` - Get story with chunks
- `POST /stories/:id/generate-audio` - Generate audio
- `GET /stories/:id/audio-status` - Check audio status
- `GET /stories/:id/play` - Get presigned audio URL

### Subscriptions

- `GET /subscriptions/current` - Get current subscription
- `POST /subscriptions/create-checkout` - Create Stripe checkout
- `POST /subscriptions/cancel` - Cancel subscription
- `POST /subscriptions/reactivate` - Reactivate subscription

### Usage

- `GET /usage/current` - Get current month usage
- `GET /usage/limits` - Get plan limits

### Webhooks

- `POST /webhooks/stripe` - Stripe webhook handler

## TTS Provider Setup

### Overview

Sesly supports three TTS providers with automatic fallback capability:
- **Azure Speech Services** (Primary - best for Turkish voices, cost-effective)
- **Google Cloud TTS** (Alternative - high quality, more expensive)
- **ElevenLabs** (Premium - voice cloning, most expensive)

### Azure Speech Services Setup

1. **Create Azure Account**: Sign up at https://portal.azure.com
2. **Create Speech Service**:
   - Navigate to "Create a resource" > "AI + Machine Learning" > "Speech"
   - Choose region (recommended: West Europe for Turkish voices)
   - Select pricing tier (F0 for free tier, S0 for production)
3. **Get Credentials**:
   - Go to your Speech Service resource
   - Copy "Key" and "Region" from "Keys and Endpoint"
4. **Configure Environment**:
```bash
AZURE_SPEECH_KEY=your-azure-key
AZURE_SPEECH_REGION=westeurope
```

**Available Turkish Voices**:
- `tr-TR-AhmetNeural` - Male, neural voice
- `tr-TR-EmelNeural` - Female, neural voice

**Pricing**: ~$1 per 1M characters (Standard), Free tier: 5M chars/month

### Google Cloud TTS Setup

1. **Create GCP Project**: https://console.cloud.google.com
2. **Enable Cloud Text-to-Speech API**:
   - Navigate to "APIs & Services" > "Library"
   - Search "Cloud Text-to-Speech API" and enable it
3. **Create Service Account**:
   - Go to "IAM & Admin" > "Service Accounts"
   - Create service account with "Cloud Text-to-Speech User" role
   - Download JSON key file
4. **Configure Environment**:
```bash
GOOGLE_TTS_CREDENTIALS=/path/to/credentials.json
GOOGLE_CLOUD_PROJECT_ID=your-project-id
```

**Ready-made voices**: the 30 Chirp 3 HD voices only (`tr-TR-Chirp3-HD-Achernar` and so on),
served from the static catalogue in `src/common/constants/google-preset-voices.ts`.
Standard and WaveNet voices are no longer offered. See CLAUDE.md, "Ready-made voices".

### ElevenLabs Setup

1. **Create Account**: https://elevenlabs.io
2. **Get API Key**: Dashboard > Profile Settings > API Key
3. **Configure Environment**:
```bash
ELEVENLABS_API_KEY=your-api-key
```

**Features**: Voice cloning, emotional speech, multilingual
**Pricing**: Starts at $5/month (30k characters), up to $330/month (2M characters)

### Setting Default Provider

Configure which provider to use by default:

```bash
TTS_PROVIDER=azure  # Options: azure, google, elevenlabs
```

### Voice Profile API Usage

**Get Available Voices**:
```bash
GET /voice-profiles/available-voices
```

Response:
```json
{
  "azure": [
    {
      "id": "tr-TR-AhmetNeural",
      "name": "Ahmet (Turkish Male)",
      "language": "Turkish",
      "languageCode": "tr-TR",
      "gender": "male",
      "provider": "azure"
    }
  ],
  "google": [...],
  "elevenlabs": [...]
}
```

**Create Voice Profile (v2)**:
```bash
POST /voice-profiles/v2
{
  "name": "Emel's Voice",
  "provider": "azure",
  "voiceId": "tr-TR-EmelNeural",
  "language": "tr-TR"
}
```

### Cost Comparison (1M characters)

| Provider | Standard | Premium | Free Tier |
|----------|----------|---------|-----------|
| Azure | $1 | $1 (neural) | 5M chars/month |
| Google | $4 | $16 (WaveNet) | 1M chars/month |
| ElevenLabs | ~$17-165 | Same | 10k chars/month |

**Recommendation**: Use Azure for production (Turkish voices), Google as fallback, ElevenLabs for premium features.

## Project Structure

```
sesly-backend/
├── src/
│   ├── common/           # Shared utilities
│   ├── config/           # Configuration modules
│   ├── modules/          # Feature modules
│   │   ├── auth/
│   │   ├── users/
│   │   ├── voice-profiles/
│   │   ├── tts-providers/  # Azure, Google, ElevenLabs
│   │   ├── stories/
│   │   ├── subscriptions/
│   │   ├── usage/
│   │   ├── email/
│   │   ├── storage/
│   │   ├── elevenlabs/
│   │   └── webhooks/
│   ├── prisma/           # Prisma service
│   ├── app.module.ts
│   └── main.ts
├── prisma/
│   ├── schema.prisma     # Database schema
│   ├── migrations/
│   └── seed.ts
├── docker-compose.yml
├── Dockerfile
└── package.json
```

## Database Schema

Main models:
- **User**: Authentication and profile
- **VoiceProfile**: Voice cloning data
- **Story**: Story library
- **StoryChunk**: Chunked story content
- **GeneratedAudio**: TTS audio files
- **Subscription**: Stripe subscriptions
- **UsageLimit**: Monthly usage tracking

## Development

```bash
# Development
npm run start:dev

# Build
npm run build

# Production
npm run start:prod

# Linting
npm run lint

# Formatting
npm run format

# Database
npx prisma studio          # Open Prisma Studio
npx prisma migrate dev     # Create migration
npx prisma db seed         # Seed database
```

## Flutter Integration

### Setup

1. Install dependencies in your Flutter `pubspec.yaml`:
```yaml
dependencies:
  http: ^1.1.0
  google_sign_in: ^6.2.1
  sign_in_with_apple: ^6.1.2
  shared_preferences: ^2.2.2
```

### Authentication Service Implementation

```dart
// lib/services/api/auth_service.dart
import 'package:http/http.dart' as http;
import 'dart:convert';

class AuthService {
  final String baseUrl = 'https://api.sesly.io';

  // Send Google ID token to backend
  Future<Map<String, dynamic>> loginWithGoogle(String idToken) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/google/token'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({'idToken': idToken}),
    );

    if (response.statusCode == 200) {
      return json.decode(response.body);
    } else {
      throw Exception('Google authentication failed');
    }
  }

  // Send Apple identity token to backend
  Future<Map<String, dynamic>> loginWithApple({
    required String identityToken,
    String? user,
    String? email,
    String? givenName,
    String? familyName,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/apple/token'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({
        'identityToken': identityToken,
        if (user != null) 'user': user,
        if (email != null) 'email': email,
        if (givenName != null) 'givenName': givenName,
        if (familyName != null) 'familyName': familyName,
      }),
    );

    if (response.statusCode == 200) {
      return json.decode(response.body);
    } else {
      throw Exception('Apple authentication failed');
    }
  }

  // Email/Password login
  Future<Map<String, dynamic>> loginWithEmail(String email, String password) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({'email': email, 'password': password}),
    );

    if (response.statusCode == 200) {
      return json.decode(response.body);
    } else {
      throw Exception('Login failed');
    }
  }
}
```

### Auth Controller (GetX)

```dart
// lib/controllers/auth_controller.dart
import 'package:get/get.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AuthController extends GetxController {
  final authService = AuthService();
  final _googleSignIn = GoogleSignIn(scopes: ['email', 'profile']);

  // Google Sign-In
  Future<void> signInWithGoogle() async {
    try {
      final googleUser = await _googleSignIn.signIn();
      if (googleUser == null) return;

      final googleAuth = await googleUser.authentication;
      final idToken = googleAuth.idToken;

      if (idToken == null) throw Exception('No ID token');

      // Send to backend
      final result = await authService.loginWithGoogle(idToken);

      // Store tokens
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('accessToken', result['accessToken']);
      await prefs.setString('refreshToken', result['refreshToken']);

      // Navigate to home
      Get.offAllNamed('/stories');
    } catch (e) {
      Get.snackbar('Error', 'Google Sign-In failed: $e');
    }
  }

  // Apple Sign-In
  Future<void> signInWithApple() async {
    try {
      final credential = await SignInWithApple.getAppleIDCredential(
        scopes: [
          AppleIDAuthorizationScopes.email,
          AppleIDAuthorizationScopes.fullName,
        ],
      );

      // Send to backend
      final result = await authService.loginWithApple(
        identityToken: credential.identityToken!,
        user: credential.userIdentifier,
        email: credential.email,
        givenName: credential.givenName,
        familyName: credential.familyName,
      );

      // Store tokens
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('accessToken', result['accessToken']);
      await prefs.setString('refreshToken', result['refreshToken']);

      // Navigate to home
      Get.offAllNamed('/stories');
    } catch (e) {
      Get.snackbar('Error', 'Apple Sign-In failed: $e');
    }
  }

  // Sign Out
  Future<void> signOut() async {
    await _googleSignIn.signOut();
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
    Get.offAllNamed('/welcome');
  }
}
```

### Making Authenticated Requests

```dart
// Add JWT token to requests
Future<http.Response> getProfile() async {
  final prefs = await SharedPreferences.getInstance();
  final accessToken = prefs.getString('accessToken');

  return await http.get(
    Uri.parse('$baseUrl/users/me'),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $accessToken',
    },
  );
}
```

## Deployment

### Ubuntu Server + Docker

1. Clone repository to `/opt/sesly-backend`
2. Configure `.env` file
3. Run: `docker-compose up -d --build`
4. Run migrations: `docker-compose exec api npx prisma migrate deploy`
5. Seed database: `docker-compose exec api npx prisma db seed`

### With Traefik Reverse Proxy

Add labels to `docker-compose.yml`:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.sesly-api.rule=Host(`api.sesly.io`)"
  - "traefik.http.routers.sesly-api.entrypoints=websecure"
  - "traefik.http.routers.sesly-api.tls.certresolver=letsencrypt"
```

## Security

- bcrypt password hashing (12 rounds)
- JWT tokens (15min access, 7day refresh)
- HTTPS only
- Helmet security headers
- CORS whitelist
- Rate limiting (10 req/min)
- Input validation
- Prisma SQL injection prevention
- S3 presigned URLs (5min expiry)
- Webhook signature verification

## Business Model

### Free Plan
- 5 stories/month
- 1 voice profile

### Pro Plan ($9.99/month)
- Unlimited stories
- 5 voice profiles

## Support

For issues and questions:
- GitHub Issues: [repository-url]/issues
- Documentation: http://localhost:3000/api/docs

## License

UNLICENSED - Private project

---

Built with ❤️ using NestJS
