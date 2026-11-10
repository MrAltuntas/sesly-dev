/**
 * Mobile App - Mock Data Factory Definitions
 * Generates valid JSON payloads that fully conform to the parsers inside src/models/*.ts
 */

// 1. User JSON Mock
export const mockUserJSON = {
  id: 'user-123',
  email: 'user@test.sesly.io',
  firstName: 'John',
  lastName: 'Doe',
  profileImageUrl: 'https://images.sesly.io/avatars/user-123.jpg',
  provider: 'EMAIL',
  emailVerified: true,
  subscriptionTier: 'FREE',
  subscriptionExpiresAt: null,
  createdAt: '2026-05-22T21:00:00.000Z',
  updatedAt: '2026-05-22T21:00:00.000Z',
};

export const mockUserProfileJSON = {
  id: 'user-123',
  email: 'user@test.sesly.io',
  firstName: 'John',
  lastName: 'Doe',
  subscription: {
    plan: 'FREE',
    status: 'ACTIVE',
    currentPeriodEnd: null,
  },
  usage: {
    audioGenerated: 1,
    limit: 5,
    voiceProfiles: 1,
    voiceProfileLimit: 2,
  },
};

// 2. Story JSON Mock
export const mockStoryJSON = {
  id: 'story-123',
  title: 'Küçük Tavşan ile Havuç Macerası',
  content: 'Bir varmış bir yokmuş, yeşil bir ormanda küçük bir tavşan yaşarmış...',
  ageGroup: 'THREE_TO_SIX',
  category: 'BEDTIME',
  language: 'tr',
  estimatedDuration: 5,
  coverImageUrl: 'https://images.sesly.io/covers/story-123.jpg',
  isPremium: false,
  hasPreGeneratedNarration: true,
  createdAt: '2026-05-22T21:00:00.000Z',
  updatedAt: '2026-05-22T21:00:00.000Z',
};

export const mockStoryDetailJSON = {
  ...mockStoryJSON,
  chunks: [
    {
      id: 'chunk-1',
      chunkIndex: 0,
      content: 'Bir varmış bir yokmuş, yeşil bir ormanda küçük bir tavşan yaşarmış...',
      startTime: 0,
      endTime: 10,
    },
  ],
};

// 3. VoiceProfile JSON Mock
export const mockVoiceProfileJSON = {
  id: 'voice-123',
  name: 'Babamın Sesi',
  profileIcon: 'mic',
  provider: 'CARTESIA',
  voiceId: 'cartesia-voice-abc',
  language: 'tr-TR',
  status: 'READY',
  errorReason: null,
  createdAt: '2026-05-22T21:00:00.000Z',
  updatedAt: '2026-05-22T21:00:00.000Z',
};

// 4. Audio JSON Mock
export const mockAudioJSON = {
  id: 'audio-123',
  title: 'Ses Dosyası',
  originalText: 'Kısa bir ses klonlama denemesi.',
  duration: 45,
  audioUrl: 'https://storage.googleapis.com/sesly-bucket/audio-123.mp3',
  status: 'READY',
  createdAt: '2026-05-22T21:00:00.000Z',
  completedAt: '2026-05-22T21:00:00.000Z',
};

// 5. Collection JSON Mock
export const mockCollectionJSON = {
  id: 'collection-123',
  slug: 'uyku-masallari',
  title: 'Uyku Masalları',
  subtitle: 'Tatlı rüyalar için yumuşak hikayeler',
  description: 'Çocuklarınızın huzurla uykuya dalmasını sağlayacak özenle seçilmiş uyku masalları koleksiyonu.',
  tone: 'NATURE',
  coverImageUrl: 'https://images.sesly.io/collections/sleep.jpg',
  isActive: true,
  sortOrder: 1,
  stories: [mockStoryJSON],
  createdAt: '2026-05-22T21:00:00.000Z',
  updatedAt: '2026-05-22T21:00:00.000Z',
};

// 6. Narration JSON Mock
export const mockNarrationJSON = {
  id: 'narration-123',
  userId: 'user-123',
  storyId: 'story-123',
  voiceProfileId: 'voice-123',
  title: 'Küçük Tavşan (Babamın Sesiyle)',
  status: 'READY',
  audioUrl: 'https://storage.googleapis.com/sesly-bucket/narration-123.mp3',
  duration: 300,
  story: mockStoryJSON,
  voiceProfile: mockVoiceProfileJSON,
  createdAt: '2026-05-22T21:00:00.000Z',
  completedAt: '2026-05-22T21:00:00.000Z',
};

// 7. Notification JSON Mock
export const mockNotificationJSON = {
  id: 'notification-123',
  type: 'VOICE_READY',
  title: 'Sesi Klonlama Tamamlandı!',
  body: 'Yeni ses profiliniz kullanıma hazır.',
  data: {
    voiceProfileId: 'voice-123',
  },
  read: false,
  readAt: null,
  createdAt: '2026-05-22T21:00:00.000Z',
};

// 9. Subscription JSON Mock
export const mockSubscriptionJSON = {
  userId: 'user-123',
  plan: 'FREE',
  status: 'ACTIVE',
  extraVoiceSlots: 0,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

// 10. UserPreferences JSON Mock
export const mockUserPreferencesJSON = {
  sleepTimerFadeOut: true,
  sleepTimerPauseWhenAsleep: false,
  sleepTimerLastDuration: 30,
  voiceReadyNotifications: true,
  narrationReadyNotifications: true,
  promoNotifications: false,
  settings: {},
};

// 11. UserStats JSON Mock
export const mockUserStatsJSON = {
  storiesListened: 12,
  minutesListened: 120,
  voicesCreated: 1,
};

// 12. Legal JSON Mock
export const mockLegalDocumentJSON = {
  id: 'legal-123',
  slug: 'tos',
  language: 'tr',
  title: 'Kullanım Koşulları',
  contentMd: '# Kullanım Koşulları\n\nSesly uygulamasını kullanarak aşağıdaki şartları kabul etmiş olursunuz.',
  version: 1,
  publishedAt: '2026-05-22T21:00:00.000Z',
};

// Factory Helpers to easily get customizable copies
export function getMockUserJSON(overrides = {}) {
  return { ...mockUserJSON, ...overrides };
}

export function getMockStoryJSON(overrides = {}) {
  return { ...mockStoryJSON, ...overrides };
}

export function getMockVoiceProfileJSON(overrides = {}) {
  return { ...mockVoiceProfileJSON, ...overrides };
}

export function getMockNarrationJSON(overrides = {}) {
  return { ...mockNarrationJSON, ...overrides };
}
