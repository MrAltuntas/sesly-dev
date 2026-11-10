# Mature Care Redesign — Backend Değişiklik Listesi

Bu dosya, mobil tarafın "Mature Care" redesign'ını implemente etmesi için backend'de yapılması **gereken** veya **güçlü biçimde tavsiye edilen** değişiklikleri sıralar. Sıralama, mobilin freshlanan ekranlarının kullandığı özellik sırasına göre yapılmıştır.

---

## 1. `Collection` modülü (TAMAMEN YENİ — P1)

Mobil artık "Koleksiyonlar" (`Uyku Vakti`, `Maceralar`, `Klasikler`, `Sakin Ses`) sunuyor. Bugün mobilde mock — backend gelince 1-2 satırlık swap.

### Prisma şeması
```prisma
model Collection {
  id           String   @id @default(cuid())
  slug         String   @unique                // "sleep" | "adventure" | "classics" | "calm" | ...
  title        String                          // "Uyku Vakti"
  subtitle     String?                         // "Sakin, yumuşak masallar"
  description  String?                         // Uzun metin
  tone         CollectionTone                  // ACCENT / TRUST / NATURE / SUN (UI hinting)
  coverImageUrl String?
  isActive     Boolean  @default(true)
  sortOrder    Int      @default(0)

  stories      StoryOnCollection[]

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

enum CollectionTone {
  ACCENT
  TRUST
  NATURE
  SUN
}

model StoryOnCollection {
  collection   Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  collectionId String
  story        Story      @relation(fields: [storyId], references: [id], onDelete: Cascade)
  storyId      String
  position     Int        @default(0)

  @@id([collectionId, storyId])
  @@index([collectionId, position])
}
```

### REST endpoints (public, read-only)
- `GET  /collections` → `{ data: Collection[], meta: {...} }`
- `GET  /collections/:slug` → `Collection` (includes stories count)
- `GET  /collections/:slug/stories?page=1&limit=20` → paginated stories

### Admin endpoints (protected)
- `POST   /admin/collections`
- `PATCH  /admin/collections/:id`
- `DELETE /admin/collections/:id`
- `POST   /admin/collections/:id/stories` body: `{ storyIds: string[] }`
- `DELETE /admin/collections/:id/stories/:storyId`
- `PATCH  /admin/collections/:id/reorder` body: `{ storyIds: string[] }`

### Mobil beklentisi
Response şekli (camelCase):
```ts
type Collection = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  tone: 'ACCENT' | 'TRUST' | 'NATURE' | 'SUN';
  coverImageUrl: string | null;
  storyCount: number;
};
```

**Mobil swap noktası:** `src/screens/collections/CollectionsScreen.tsx` içindeki `COLLECTION_CATALOG` sabit dizisi — `CollectionService.list()` çağrısıyla değiştirilecek.

---

## 2. `VoiceProfile.sampleAudioUrl` alanını DTO'dan dönmek (P1)

Mobil StoryDetail'deki ses dropdown'ı ve Sesim tab'ındaki profil kartları, READY durumdaki profillerde 2 saniyelik örnek ses çalabilsin diye bu alanı bekliyor. Backend schema'da var ama response DTO'dan dışa açılmıyor.

### Değişiklik
`src/modules/voice-profiles/dto/voice-profile.response.dto.ts` (veya dönüşümü yapan mapper):
```ts
export class VoiceProfileResponseDto {
  id: string;
  name: string;
  status: VoiceProfileStatus;
  provider: TTSProvider;
  voiceModelId: string | null;
  sampleAudioUrl: string | null; // ← expose
  createdAt: Date;
  updatedAt: Date;
}
```

GCS'de örnek ses genellikle eğitim sonrası saklanıyor. `GET /voice-profiles` ve `GET /voice-profiles/:id` yanıtlarında alan bulunmalı.

**Bonus:** Admin moderation sayfasının `sampleAudioUrl` TODO'sunu da bu değişiklik kapatır.

---

## 3. Favori (Favorites) REST endpoint contract doğrulaması (P1)

Mobil `useStory` store `toggleFavorite(storyId)` ve `loadFavorites()` çağırıyor. Backend'de muhtemelen var, sadece path'in mobil service'in bekledikleriyle uyuştuğundan emin olmak lazım.

### Beklenen endpoint'ler
- `POST   /stories/:id/favorite`  → toggle (response'ta yeni `isFavorite` durumu)
- `GET    /users/me/favorites?page=1&limit=20` → paginated list of `Story`
- `DELETE /stories/:id/favorite` (opsiyonel — POST toggle zaten yeterli)

Eğer backend farklı path kullanıyorsa (`/favorites/:storyId` gibi), `src/services/StoryService.ts` içindeki path'leri hizala.

---

## 4. Playlist (Çalma Listesi) modülü (P2 — NEW)

AudioPlayerScreen'deki PlaylistSheet şu an in-memory mock. "Bu gece" ve "Uyku serisi" gibi listeler + kuyruk yeniden sıralama.

### Prisma
```prisma
model Playlist {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name      String                       // "Bu gece"
  isDefault Boolean  @default(false)
  items     PlaylistItem[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}

model PlaylistItem {
  id            String     @id @default(cuid())
  playlist      Playlist   @relation(fields: [playlistId], references: [id], onDelete: Cascade)
  playlistId    String
  narrationId   String?                    // if already generated
  storyId       String?                    // if only the story is queued
  voiceProfileId String?                   // which voice to use when played
  position      Int        @default(0)
  createdAt     DateTime   @default(now())

  @@index([playlistId, position])
}
```

### Endpoints
- `GET    /playlists` → user's lists
- `POST   /playlists` body: `{ name: string }` → create
- `PATCH  /playlists/:id` body: `{ name?: string }`
- `DELETE /playlists/:id`
- `GET    /playlists/:id/items`
- `POST   /playlists/:id/items` body: `{ narrationId? | storyId?, voiceProfileId?, position? }`
- `PATCH  /playlists/:id/reorder` body: `{ itemIds: string[] }` (new order)
- `DELETE /playlists/:id/items/:itemId`

**Mobil swap noktası:** `src/components/audio/PlaylistSheet.tsx` (agent tarafından yaratılıyor) — PlaylistStore observer'ı.

---

## 5. Profile stats endpoint (P2 — NEW)

Profile ekranı 3 sayıyı gösteriyor: dinlenmiş masal / toplam saat / eğitilmiş ses. Bugün 0.

### Endpoint
`GET /users/me/stats` →
```ts
{
  storiesCompleted: number;   // narrationSession completed_at != null
  hoursListened: number;      // round(totalPlaybackSeconds / 3600, 1)
  voicesTrained: number;      // voiceProfiles where status == READY
}
```

Backend zaten `narrationSession` benzeri bir tablo tutuyorsa 1 SQL query.

---

## 6. Notifications endpoint contract (P1)

Mobil NotificationsScreen backend `/notifications` endpoint'ini kullanıyor. Mevcut contract'ı teyit:

- `GET /notifications?page=1&limit=20` → `{ data: Notification[], meta: {...} }`
- `POST /notifications/:id/read` → mark single as read
- `POST /notifications/read-all` → mark all as read (yeni — PlanDoc'ta yoktu)

Notification shape:
```ts
{
  id: string;
  type: 'VOICE_READY' | 'NARRATION_READY' | 'SYSTEM' | 'PROMO';
  title: string;
  body: string;
  data: Record<string, any> | null;      // deep-link payload
  isRead: boolean;
  createdAt: string;
}
```

---

## 7. Advanced Sleep Timer — server-side persistence (P3 — opsiyonel)

Yumuşak kısılma + "uyuyunca duraklat" kullanıcı tercihi client-side yeterli. Ama isteğe bağlı olarak user.preferences'ta saklanabilir:

```prisma
model UserPreferences {
  userId            String  @id
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  sleepTimerFadeOut Boolean @default(true)
  sleepTimerPauseWhenAsleep Boolean @default(false)
  sleepTimerLastDuration Int? // last-used duration in minutes
}
```

Endpoint: `GET /users/me/preferences`, `PATCH /users/me/preferences`.

---

## 8. Available voices (preset narrators) — mobil alan adı (P1 — küçük)

Mobil "Hazır Anlatıcılar" grid'i, backend'in `/voice-profiles/available-voices` response'ını bekliyor. Mevcut response `{ google: [...], minimax: [...] }` — mobil parser bunu bekliyor (eski azure alanından migrate edildi).

### DTO doğrulama
```ts
type AvailableVoicesResponse = {
  google: Array<{
    id: string;
    name: string;
    gender: 'MALE' | 'FEMALE' | 'NEUTRAL';
    language: string;
    sampleAudioUrl?: string | null;
  }>;
  minimax: Array<{...}>;
};
```

Gender + language alanlarının mobilde gösterildiğinden emin olunmalı (filtreleme için gerekebilir).

---

## 9. Story category enum genişletmesi (P2)

CollectionDetailScreen şu an 4 koleksiyonu story.category alanına heuristik eşliyor:
```
sleep     → BEDTIME, CALMING, LULLABY
adventure → ADVENTURE, FANTASY
classics  → CLASSIC, FAIRY_TALE
calm      → CALMING, MEDITATION, NATURE
```

Backend `StoryCategory` enum'u bu değerleri içermiyorsa:
1. Eksik enum değerlerini ekle (migration).
2. Mevcut story'leri admin üzerinden yeniden kategorilere dağıt.
3. Veya Collection tablosu kur (#1), heuristik'i sil.

**Tercih:** #1'i yap, heuristik'i tarihin çöpüne gönder.

---

## 10. Dead code / temizlik (plan Aşaması 1 ile birleşik)

Redesign ile uyumsuz olmayan ama şimdi temizleme fırsatı:
- `main.ts:31-34` yorum satırı CORS bloğu
- Google voice cloning path (bkz. ana plan Aşama 1.1)
- Migration `20251210221617_asd` rename
- Minimax `deleteVoiceClone()` "pretend success"

---

## Öncelik özeti

| # | İş | Öncelik | Tahmini süre |
|---|---|---|---|
| 1 | Collection modülü | P1 | 1 gün |
| 2 | sampleAudioUrl expose | P1 | 15 dk |
| 3 | Favorites contract doğrulama | P1 | 30 dk |
| 4 | Playlist modülü | P2 | 1 gün |
| 5 | /users/me/stats | P2 | 1 saat |
| 6 | Notifications mark-all-read | P1 | 30 dk |
| 7 | User preferences (sleep timer) | P3 | 2 saat |
| 8 | Available voices DTO audit | P1 | 15 dk |
| 9 | Story category enum / collection data | P2 | 2 saat |

**P1 paketi toplam: ~2 gün. P2 paketi: +1.5 gün. MVP için P1 yeterli — P2 "nice to have".**
