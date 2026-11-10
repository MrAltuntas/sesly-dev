# Sesly Admin Panel - Backend API Dokümantasyonu

> **Base URL**: `{BACKEND_URL}/admin`  
> **Auth Header**: `Authorization: Bearer {accessToken}`  
> **Last Updated**: 2026-01-26

---

## 📋 İçindekiler

1. [Genel Bilgiler](#genel-bilgiler)
2. [Authentication](#authentication)
3. [Analytics](#analytics)
4. [Users](#users)
5. [Stories](#stories)
6. [Audio](#audio)
7. [Finance](#finance)
8. [Moderation](#moderation)
9. [Operations](#operations)
10. [Enum Referansları](#enum-referansları)

---

## Genel Bilgiler

### Authentication Akışı
1. `/admin/auth/login` ile giriş yap → `accessToken` ve `refreshToken` al
2. Tüm isteklerde `Authorization: Bearer {accessToken}` header'ı kullan
3. Token süresi dolunca `/admin/auth/refresh` ile yenile
4. `accessToken` süresi: **1 saat**, `refreshToken` süresi: **7 gün**

### Admin Rolleri & Yetkileri

| Rol | Açıklama | Erişim |
|-----|----------|--------|
| `SUPER_ADMIN` | Tam yetki | Tüm endpoint'ler (silme dahil) |
| `ADMIN` | Yönetim yetkisi | CRUD işlemleri (kalıcı silme hariç) |
| `MODERATOR` | Okuma + moderasyon | Listeleme, onay/red işlemleri |

### Standart Pagination Response

```json
{
  "data": [...],
  "total": 150,
  "page": 1,
  "limit": 20,
  "totalPages": 8
}
```

### Standart Error Response

```json
{
  "statusCode": 401,
  "message": "Invalid credentials",
  "error": "Unauthorized"
}
```

---

## Authentication

### POST `/admin/auth/login`
**Public** - Token gerekmez

**Request Body:**
```json
{
  "email": "admin@sesly.com",
  "password": "Admin@123!"
}
```

**Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJI...",
  "refreshToken": "eyJhbGciOiJI...",
  "admin": {
    "id": "uuid-string",
    "email": "admin@sesly.com",
    "firstName": "Ahmet",
    "lastName": "Yılmaz",
    "role": "SUPER_ADMIN"
  }
}
```

**Errors:**
- `401` - Invalid credentials
- `401` - Admin account is deactivated

---

### POST `/admin/auth/refresh`
**Protected** - Token gerekli

Mevcut token ile yeni token pair al.

**Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJI...",
  "refreshToken": "eyJhbGciOiJI..."
}
```

---

### POST `/admin/auth/logout`
**Protected** - Token gerekli

**Response (200):**
```json
{
  "message": "Logged out successfully"
}
```

---

## Analytics

> **Erişim**: `SUPER_ADMIN`, `ADMIN`

### GET `/admin/analytics/system`

Tüm sistem istatistiklerini döndürür.

**Response (200):**
```json
{
  "users": {
    "total": 1250,
    "verified": 980,
    "unverified": 270
  },
  "stories": {
    "total": 85,
    "premium": 25,
    "free": 60
  },
  "voiceProfiles": {
    "total": 3200,
    "byProvider": [
      { "provider": "GOOGLE", "count": 2800 },
      { "provider": "MINIMAX", "count": 400 }
    ]
  },
  "audio": {
    "total": 15000,
    "ready": 14200,
    "pending": 300,
    "generating": 150,
    "failed": 350,
    "successRate": "94.67%"
  },
  "subscriptions": {
    "total": 450,
    "byPlan": [
      { "plan": "PRO", "count": 380 },
      { "plan": "CREATOR", "count": 70 }
    ],
    "estimatedMonthlyRevenue": 5176.30
  }
}
```

---

### GET `/admin/analytics/activity`

Son platform aktivitelerini döndürür.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Sayfa numarası |
| `limit` | number | 50 | Sayfa başı kayıt |

**Response (200):**
```json
{
  "recentUsers": {
    "data": [
      {
        "id": "uuid",
        "email": "user@example.com",
        "firstName": "Ali",
        "lastName": "Kaya",
        "createdAt": "2026-01-26T10:30:00Z"
      }
    ],
    "total": 1250,
    "page": 1,
    "limit": 50,
    "totalPages": 25
  },
  "recentStories": {
    "data": [
      {
        "id": "uuid",
        "title": "Küçük Prens",
        "category": "WORLD_CLASSICS",
        "isPremium": true,
        "createdAt": "2026-01-20T14:00:00Z"
      }
    ],
    "total": 85,
    "page": 1,
    "limit": 50,
    "totalPages": 2
  },
  "recentVoiceProfiles": {
    "data": [
      {
        "id": "uuid",
        "name": "Anne Sesi",
        "provider": "GOOGLE",
        "status": "READY",
        "createdAt": "2026-01-25T09:00:00Z",
        "user": {
          "email": "user@example.com",
          "firstName": "Ayşe",
          "lastName": "Demir"
        }
      }
    ],
    "total": 3200,
    "page": 1,
    "limit": 50,
    "totalPages": 64
  }
}
```

---

### GET `/admin/analytics/popular-stories`

Popülerlik sırasına göre hikayeleri listeler.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Sayfa numarası |
| `limit` | number | 10 | Sayfa başı kayıt |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Keloğlan",
      "category": "TURKISH_CLASSICS",
      "ageGroup": "THREE_TO_SIX",
      "isPremium": false,
      "listens": 1520,
      "favorites": 340,
      "popularity": 2200
    }
  ],
  "total": 85,
  "page": 1,
  "limit": 10,
  "totalPages": 9
}
```

---

### GET `/admin/analytics/usage`

Mevcut ay kullanım istatistiklerini döndürür.

**Response (200):**
```json
{
  "currentMonth": 1,
  "currentYear": 2026,
  "totalStoriesGenerated": 8500,
  "totalTTSCount": 42000,
  "averageStoriesPerUser": "6.80",
  "averageTTSPerUser": "33.60",
  "activeUsers": 1250
}
```

---

## Users

> **Erişim**: `SUPER_ADMIN`, `ADMIN`, `MODERATOR`

### GET `/admin/users/stats`

Kullanıcı istatistiklerini döndürür.

**Response (200):**
```json
{
  "totalUsers": 1250,
  "verifiedUsers": 980,
  "unverifiedUsers": 270,
  "activeSubscriptions": 450,
  "subscriptionsByPlan": [
    { "plan": "FREE", "count": 800 },
    { "plan": "PRO", "count": 380 },
    { "plan": "CREATOR", "count": 70 }
  ],
  "totalStoryProgress": 25000,
  "totalVoiceProfiles": 3200,
  "averageVoiceProfilesPerUser": "2.56"
}
```

---

### GET `/admin/users`

Tüm kullanıcıları listeler.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Sayfa numarası |
| `limit` | number | 20 | Sayfa başı kayıt |
| `search` | string | - | Email, isim veya soyisim ile arama |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "firstName": "Ali",
      "lastName": "Kaya",
      "avatarUrl": "https://...",
      "provider": "EMAIL",
      "emailVerified": true,
      "createdAt": "2026-01-15T10:00:00Z",
      "updatedAt": "2026-01-26T12:00:00Z",
      "subscription": {
        "plan": "PRO",
        "status": "ACTIVE",
        "currentPeriodEnd": "2026-02-15T10:00:00Z"
      },
      "_count": {
        "voiceProfiles": 3,
        "storyProgress": 12,
        "favoriteStories": 5
      }
    }
  ],
  "total": 1250,
  "page": 1,
  "limit": 20,
  "totalPages": 63
}
```

---

### GET `/admin/users/:id`

Kullanıcı detaylarını döndürür.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | User UUID |

**Response (200):**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "firstName": "Ali",
  "lastName": "Kaya",
  "avatarUrl": "https://...",
  "provider": "EMAIL",
  "emailVerified": true,
  "createdAt": "2026-01-15T10:00:00Z",
  "updatedAt": "2026-01-26T12:00:00Z",
  "subscription": {
    "id": "uuid",
    "plan": "PRO",
    "status": "ACTIVE",
    "stripeCustomerId": "cus_xxx",
    "stripeSubscriptionId": "sub_xxx",
    "currentPeriodStart": "2026-01-15T10:00:00Z",
    "currentPeriodEnd": "2026-02-15T10:00:00Z",
    "cancelAtPeriodEnd": false
  },
  "voiceProfiles": [
    {
      "id": "uuid",
      "name": "Anne Sesi",
      "provider": "GOOGLE",
      "status": "READY",
      "createdAt": "2026-01-16T10:00:00Z"
    }
  ],
  "usageLimits": [
    {
      "id": "uuid",
      "month": 1,
      "year": 2026,
      "storiesGenerated": 15,
      "textToSpeechCount": 45,
      "resetAt": "2026-02-01T00:00:00Z"
    }
  ],
  "devices": [
    {
      "id": "uuid",
      "platform": "IOS",
      "isActive": true,
      "createdAt": "2026-01-15T10:00:00Z"
    }
  ],
  "_count": {
    "storyProgress": 12,
    "favoriteStories": 5
  }
}
```

**Errors:**
- `404` - User not found

---

### PATCH `/admin/users/:id/deactivate`

> **Erişim**: `SUPER_ADMIN`, `ADMIN`

Kullanıcı hesabını deaktif eder.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | User UUID |

**Response (200):**
```json
{
  "message": "User deactivated successfully"
}
```

**Errors:**
- `404` - User not found

---

### DELETE `/admin/users/:id`

> **Erişim**: Sadece `SUPER_ADMIN`

Kullanıcıyı kalıcı olarak siler (cascade delete).

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | User UUID |

**Response (200):**
```json
{
  "message": "User deleted successfully"
}
```

**Errors:**
- `404` - User not found

---

## Stories

> **Erişim**: `SUPER_ADMIN`, `ADMIN`, `MODERATOR`

### GET `/admin/stories`

Tüm hikayeleri listeler.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Sayfa numarası |
| `limit` | number | 20 | Sayfa başı kayıt |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Küçük Prens",
      "content": "Bir zamanlar...",
      "ageGroup": "SIX_TO_TEN",
      "category": "WORLD_CLASSICS",
      "language": "tr",
      "estimatedDuration": 15,
      "coverImageUrl": "https://...",
      "isPremium": true,
      "hasPreGeneratedNarration": false,
      "createdAt": "2026-01-20T14:00:00Z",
      "updatedAt": "2026-01-25T10:00:00Z",
      "_count": {
        "chunks": 5,
        "userProgress": 1520,
        "favoritedBy": 340
      }
    }
  ],
  "total": 85,
  "page": 1,
  "limit": 20,
  "totalPages": 5
}
```

---

### GET `/admin/stories/:id`

Hikaye detaylarını chunk'larla birlikte döndürür.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Story UUID |

**Response (200):**
```json
{
  "id": "uuid",
  "title": "Küçük Prens",
  "content": "Bir zamanlar küçük bir prens varmış...",
  "ageGroup": "SIX_TO_TEN",
  "category": "WORLD_CLASSICS",
  "language": "tr",
  "estimatedDuration": 15,
  "coverImageUrl": "https://...",
  "isPremium": true,
  "hasPreGeneratedNarration": false,
  "createdAt": "2026-01-20T14:00:00Z",
  "updatedAt": "2026-01-25T10:00:00Z",
  "chunks": [
    {
      "id": "uuid",
      "chunkIndex": 0,
      "content": "Bir zamanlar küçük bir prens varmış...",
      "startTime": null,
      "endTime": null,
      "createdAt": "2026-01-20T14:00:00Z"
    },
    {
      "id": "uuid",
      "chunkIndex": 1,
      "content": "Prens bir gün yolculuğa çıkmış...",
      "startTime": null,
      "endTime": null,
      "createdAt": "2026-01-20T14:00:00Z"
    }
  ],
  "_count": {
    "userProgress": 1520,
    "favoritedBy": 340
  }
}
```

**Errors:**
- `404` - Story not found

---

### POST `/admin/stories`

> **Erişim**: `SUPER_ADMIN`, `ADMIN`  
> **Content-Type**: `multipart/form-data`

Yeni hikaye oluşturur. Sistem otomatik olarak content'i chunk'lara böler.

**Form Data:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | ✅ | Hikaye başlığı |
| `content` | string | ✅ | Hikaye metni (tam metin) |
| `ageGroup` | enum | ✅ | `ZERO_TO_THREE`, `THREE_TO_SIX`, `SIX_TO_TEN`, `TEN_PLUS` |
| `category` | enum | ✅ | `TURKISH_CLASSICS`, `WORLD_CLASSICS`, `EDUCATIONAL`, `BEDTIME` |
| `estimatedDuration` | number | ✅ | Tahmini süre (dakika) |
| `language` | string | ❌ | Dil kodu (default: `tr`) |
| `coverImageUrl` | string | ❌ | Kapak resmi URL'i |
| `isPremium` | boolean | ❌ | Premium hikaye mi? (default: `false`) |
| `coverImage` | file | ❌ | Kapak resmi dosyası (jpg, png) |

**Response (201):**
Oluşturulan hikaye objesi (GET /:id response ile aynı format)

---

### PATCH `/admin/stories/:id`

> **Erişim**: `SUPER_ADMIN`, `ADMIN`  
> **Content-Type**: `multipart/form-data`

Hikaye günceller. Content değişirse chunk'lar yeniden oluşturulur.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Story UUID |

**Form Data:**
Tüm alanlar opsiyonel (CreateStoryDto'nun partial versiyonu)

**Response (200):**
Güncellenmiş hikaye objesi

**Errors:**
- `404` - Story not found

---

### DELETE `/admin/stories/:id`

> **Erişim**: Sadece `SUPER_ADMIN`

Hikayeyi kalıcı olarak siler (cover image S3'ten de silinir).

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Story UUID |

**Response (200):**
```json
{
  "message": "Story deleted successfully"
}
```

**Errors:**
- `404` - Story not found

---

## Audio

> **Erişim**: Token gerekli (Admin Guard)

### GET `/admin/audio`

Tüm audio dosyalarını listeler.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Sayfa numarası |
| `limit` | number | 20 | Sayfa başı kayıt |

**Response (200):**
Standard pagination response with Audio objects

---

### GET `/admin/audio/:id`

Audio detaylarını döndürür.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Audio UUID |

**Response (200):**
```json
{
  "id": "uuid",
  "userId": "uuid",
  "voiceProfileId": "uuid",
  "status": "READY",
  "title": "Küçük Prens - Anne Sesi",
  "originalText": "Bir zamanlar...",
  "duration": 900,
  "audioUrl": "https://storage.googleapis.com/...",
  "totalSegments": 5,
  "readySegments": 5,
  "errorMessage": null,
  "createdAt": "2026-01-25T10:00:00Z",
  "updatedAt": "2026-01-25T10:15:00Z",
  "completedAt": "2026-01-25T10:15:00Z"
}
```

**Errors:**
- `404` - Audio not found

---

### DELETE `/admin/audio/:id`

Audio'yu siler (S3'teki dosyalar dahil).

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Audio UUID |

**Response (200):**
```json
{
  "message": "Audio deleted successfully"
}
```

**Errors:**
- `404` - Audio not found

---

## Finance

> **Erişim**: Token gerekli (Admin Guard)

### POST `/admin/finance/promocodes`

Yeni promosyon kodu oluşturur.

**Request Body:**
```json
{
  "code": "SUMMER2026",
  "type": "PERCENTAGE",
  "value": 20,
  "maxUses": 100,
  "expiresAt": "2026-06-30T23:59:59Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | ✅ | Unique kod (örn: `SUMMER2026`) |
| `type` | enum | ✅ | `PERCENTAGE`, `FIXED_AMOUNT`, `FREE_TRIAL` |
| `value` | number | ✅ | Değer (%, TRY, veya gün sayısı) |
| `maxUses` | number | ❌ | Max kullanım (null = sınırsız) |
| `expiresAt` | DateTime | ❌ | Son kullanım tarihi |

**Response (201):**
```json
{
  "id": "uuid",
  "code": "SUMMER2026",
  "type": "PERCENTAGE",
  "value": 20,
  "maxUses": 100,
  "usedCount": 0,
  "expiresAt": "2026-06-30T23:59:59Z",
  "isActive": true,
  "createdAt": "2026-01-26T10:00:00Z"
}
```

**Errors:**
- `400` - Promo code already exists

---

### GET `/admin/finance/promocodes`

Tüm promosyon kodlarını listeler.

**Response (200):**
```json
[
  {
    "id": "uuid",
    "code": "SUMMER2026",
    "type": "PERCENTAGE",
    "value": 20,
    "maxUses": 100,
    "usedCount": 45,
    "expiresAt": "2026-06-30T23:59:59Z",
    "isActive": true,
    "createdAt": "2026-01-26T10:00:00Z"
  }
]
```

---

### POST `/admin/finance/grant-access`

Kullanıcıya manuel abonelik verir.

**Request Body:**
```json
{
  "userEmail": "user@example.com",
  "plan": "PRO",
  "durationDays": 30,
  "reason": "Influencer partnership"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userEmail` | string | ✅ | Kullanıcı email adresi |
| `plan` | enum | ✅ | `PRO` veya `CREATOR` |
| `durationDays` | number | ✅ | Abonelik süresi (gün) |
| `reason` | string | ✅ | Sebep (log için) |

**Response (200):**
```json
{
  "id": "uuid",
  "userId": "uuid",
  "plan": "PRO",
  "status": "ACTIVE",
  "currentPeriodEnd": "2026-02-25T10:00:00Z",
  "cancelAtPeriodEnd": false,
  "createdAt": "2026-01-26T10:00:00Z",
  "updatedAt": "2026-01-26T10:00:00Z"
}
```

**Errors:**
- `404` - User not found

---

## Moderation

> **Erişim**: Token gerekli (Admin Guard)

### GET `/admin/moderation/pending`

Onay bekleyen ses profillerini listeler.

**Response (200):**
```json
[
  {
    "id": "uuid",
    "userId": "uuid",
    "name": "Anne Sesi",
    "profileIcon": "👩",
    "provider": "GOOGLE",
    "voiceId": "voice-123",
    "language": "tr-TR",
    "status": "PENDING",
    "consentAudioUrl": "https://...",
    "sampleAudioUrl": "https://...",
    "createdAt": "2026-01-25T10:00:00Z",
    "updatedAt": "2026-01-25T10:00:00Z",
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "firstName": "Ali",
      "lastName": "Kaya"
    }
  }
]
```

---

### POST `/admin/moderation/:id/approve`

Ses profilini onaylar ve kullanıcıya bildirim gönderir.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | VoiceProfile UUID |

**Response (200):**
```json
{
  "id": "uuid",
  "name": "Anne Sesi",
  "status": "READY",
  ...
}
```

**Errors:**
- `404` - Voice profile not found

---

### POST `/admin/moderation/:id/reject`

Ses profilini reddeder ve kullanıcıya bildirim gönderir.

**Path Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | VoiceProfile UUID |

**Response (200):**
```json
{
  "id": "uuid",
  "name": "Anne Sesi",
  "status": "FAILED",
  ...
}
```

**Errors:**
- `404` - Voice profile not found

---

## Operations

> **Erişim**: Token gerekli (Admin Guard)

### POST `/admin/ops/data/broadcast`

Seçilen kullanıcı segmentine push notification gönderir.

**Request Body:**
```json
{
  "title": "Yeni Hikayeler Eklendi! 📚",
  "body": "Bu hafta 5 yeni hikaye eklendi. Hemen keşfedin!",
  "segment": "ALL"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | ✅ | Bildirim başlığı |
| `body` | string | ✅ | Bildirim içeriği |
| `segment` | enum | ✅ | `ALL`, `PREMIUM`, `FREE` |

**Response (200):**
```json
{
  "count": 1250
}
```

---

### POST `/admin/ops/system/maintenance`

Bakım modunu açar/kapatır.

**Request Body:**
```json
{
  "enabled": true
}
```

**Response (200):**
```json
{
  "enabled": true
}
```

---

### GET `/admin/ops/system/maintenance`

Bakım modu durumunu döndürür.

**Response (200):**
```json
{
  "enabled": false
}
```

---

## Enum Referansları

### AdminRole
```typescript
enum AdminRole {
  SUPER_ADMIN = "SUPER_ADMIN",
  ADMIN = "ADMIN",
  MODERATOR = "MODERATOR"
}
```

### AuthProvider
```typescript
enum AuthProvider {
  EMAIL = "EMAIL",
  GOOGLE = "GOOGLE",
  APPLE = "APPLE"
}
```

### SubscriptionPlan
```typescript
enum SubscriptionPlan {
  FREE = "FREE",
  PRO = "PRO",
  CREATOR = "CREATOR"
}
```

### SubscriptionStatus
```typescript
enum SubscriptionStatus {
  ACTIVE = "ACTIVE",
  CANCELLED = "CANCELLED",
  EXPIRED = "EXPIRED",
  PAST_DUE = "PAST_DUE"
}
```

### AgeGroup
```typescript
enum AgeGroup {
  ZERO_TO_THREE = "ZERO_TO_THREE",   // 0-3 yaş
  THREE_TO_SIX = "THREE_TO_SIX",     // 3-6 yaş
  SIX_TO_TEN = "SIX_TO_TEN",         // 6-10 yaş
  TEN_PLUS = "TEN_PLUS"              // 10+ yaş
}
```

### StoryCategory
```typescript
enum StoryCategory {
  TURKISH_CLASSICS = "TURKISH_CLASSICS",   // Türk Klasikleri
  WORLD_CLASSICS = "WORLD_CLASSICS",       // Dünya Klasikleri
  EDUCATIONAL = "EDUCATIONAL",              // Eğitici
  BEDTIME = "BEDTIME"                       // Uyku Hikayeleri
}
```

### AudioStatus / NarrationStatus
```typescript
enum AudioStatus {
  PENDING = "PENDING",
  GENERATING = "GENERATING",
  READY = "READY",
  FAILED = "FAILED"
}
```

### VoiceProfileStatus
```typescript
enum VoiceProfileStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  READY = "READY",
  FAILED = "FAILED"
}
```

### TTSProvider
```typescript
enum TTSProvider {
  GOOGLE = "GOOGLE",
  MINIMAX = "MINIMAX"
}
```

### PromoCodeType
```typescript
enum PromoCodeType {
  PERCENTAGE = "PERCENTAGE",      // Yüzde indirim
  FIXED_AMOUNT = "FIXED_AMOUNT",  // Sabit tutar indirim
  FREE_TRIAL = "FREE_TRIAL"       // Ücretsiz deneme (gün)
}
```

### BroadcastSegment
```typescript
enum BroadcastSegment {
  ALL = "ALL",         // Tüm kullanıcılar
  PREMIUM = "PREMIUM", // PRO + CREATOR
  FREE = "FREE"        // Ücretsiz kullanıcılar
}
```

---

## Frontend Önerileri

### State Management
- **Auth State**: accessToken, refreshToken, admin bilgileri
- **Dashboard State**: system stats, activity, usage
- **Entities**: users, stories, audio, promoCodes, pendingVoiceProfiles

### Sayfalar
1. **Login** - `/admin/auth/login`
2. **Dashboard** - analytics/system, analytics/usage, analytics/activity
3. **Users** - users list, user detail modal
4. **Stories** - stories list, create/edit form
5. **Audio** - audio list
6. **Finance** - promo codes, grant access
7. **Moderation** - pending voice profiles
8. **Settings** - maintenance mode

### API Client Örneği (Axios)
```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL + '/admin',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('adminAccessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Token refresh logic or redirect to login
    }
    return Promise.reject(error);
  }
);

export default api;
```

---

> **Not**: Bu doküman backend kaynak kodundan otomatik olarak oluşturulmuştur.  
> Swagger UI: `{BACKEND_URL}/api-docs`
