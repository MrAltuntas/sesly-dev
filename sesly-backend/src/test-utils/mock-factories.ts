import { faker } from '@faker-js/faker';
import {
  AuthProvider,
  AdminRole,
  VoiceProfileStatus,
  AgeGroup,
  StoryCategory,
  CollectionTone,
  AudioStatus,
  NarrationStatus,
  SubscriptionPlan,
  SubscriptionStatus,
  LegalDocumentStatus,
  VoiceDeletionRequestStatus,
  TTSProvider,
} from '@prisma/client';

// 1. User Factory
export function createMockUser(overrides: Partial<any> = {}) {
  const id = overrides.id || faker.string.uuid();
  return {
    id,
    email: overrides.email || faker.internet.email().toLowerCase(),
    passwordHash: overrides.passwordHash || faker.string.alphanumeric(60),
    firstName: overrides.firstName !== undefined ? overrides.firstName : faker.person.firstName(),
    lastName: overrides.lastName !== undefined ? overrides.lastName : faker.person.lastName(),
    avatarUrl: overrides.avatarUrl !== undefined ? overrides.avatarUrl : faker.image.avatar(),
    provider: overrides.provider || AuthProvider.EMAIL,
    providerId: overrides.providerId !== undefined ? overrides.providerId : null,
    emailVerified: overrides.emailVerified !== undefined ? overrides.emailVerified : faker.datatype.boolean(),
    tokenVersion: overrides.tokenVersion !== undefined ? overrides.tokenVersion : 0,
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
    ...overrides,
  };
}

// 2. VoiceDeletionRequest Factory
export function createMockVoiceDeletionRequest(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || faker.string.uuid(),
    userId: overrides.userId || faker.string.uuid(),
    voiceProfileId: overrides.voiceProfileId || faker.string.uuid(),
    voiceProfileName: overrides.voiceProfileName || faker.word.words(2) + ' Voice',
    provider: overrides.provider || TTSProvider.CARTESIA,
    providerVoiceId: overrides.providerVoiceId || faker.string.alphanumeric(10),
    status: overrides.status || VoiceDeletionRequestStatus.PENDING,
    notes: overrides.notes !== undefined ? overrides.notes : null,
    attemptCount: overrides.attemptCount !== undefined ? overrides.attemptCount : 0,
    requestedAt: overrides.requestedAt || new Date(),
    lastAttemptedAt: overrides.lastAttemptedAt !== undefined ? overrides.lastAttemptedAt : null,
    completedAt: overrides.completedAt !== undefined ? overrides.completedAt : null,
    ...overrides,
  };
}

// 3. VoiceProfile Factory
export function createMockVoiceProfile(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || faker.string.uuid(),
    userId: overrides.userId || faker.string.uuid(),
    name: overrides.name || faker.word.words(2) + ' Voice',
    profileIcon: overrides.profileIcon !== undefined ? overrides.profileIcon : 'mic',
    provider: overrides.provider || TTSProvider.GOOGLE,
    // Mirrors the migration backfill: Cartesia rows default to CLONE.
    kind:
      overrides.kind ||
      ((overrides.provider || TTSProvider.GOOGLE) === TTSProvider.CARTESIA ? 'CLONE' : 'PRESET'),
    consentAt: overrides.consentAt !== undefined ? overrides.consentAt : null,
    consentVersion: overrides.consentVersion !== undefined ? overrides.consentVersion : null,
    voiceId: overrides.voiceId || faker.string.alphanumeric(12),
    voiceCloningKey: overrides.voiceCloningKey !== undefined ? overrides.voiceCloningKey : null,
    language: overrides.language || 'tr-TR',
    status: overrides.status || VoiceProfileStatus.READY,
    errorReason: overrides.errorReason !== undefined ? overrides.errorReason : null,
    consentAudioUrl: overrides.consentAudioUrl !== undefined ? overrides.consentAudioUrl : faker.internet.url(),
    sampleAudioUrl: overrides.sampleAudioUrl !== undefined ? overrides.sampleAudioUrl : faker.internet.url(),
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
    ...overrides,
  };
}

// 4. Story Factory
export function createMockStory(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || faker.string.uuid(),
    title: overrides.title || faker.book.title(),
    content: overrides.content || faker.lorem.paragraphs(3),
    ageGroup: overrides.ageGroup || AgeGroup.THREE_TO_SIX,
    category: overrides.category || StoryCategory.BEDTIME,
    language: overrides.language || 'tr',
    estimatedDuration: overrides.estimatedDuration !== undefined ? overrides.estimatedDuration : faker.number.int({ min: 3, max: 15 }),
    coverImageUrl: overrides.coverImageUrl !== undefined ? overrides.coverImageUrl : faker.image.url(),
    isPremium: overrides.isPremium !== undefined ? overrides.isPremium : faker.datatype.boolean(),
    hasPreGeneratedNarration: overrides.hasPreGeneratedNarration !== undefined ? overrides.hasPreGeneratedNarration : false,
    defaultEmotion: overrides.defaultEmotion !== undefined ? overrides.defaultEmotion : 'neutral',
    defaultSpeed: overrides.defaultSpeed !== undefined ? overrides.defaultSpeed : 0.9,
    cartesiaPronunciationDictId: overrides.cartesiaPronunciationDictId !== undefined ? overrides.cartesiaPronunciationDictId : null,
    preprocessedSegments: overrides.preprocessedSegments !== undefined ? overrides.preprocessedSegments : null,
    preprocessedAt: overrides.preprocessedAt !== undefined ? overrides.preprocessedAt : null,
    preprocessedModel: overrides.preprocessedModel !== undefined ? overrides.preprocessedModel : null,
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
    ...overrides,
  };
}

// 5. Collection Factory
export function createMockCollection(overrides: Partial<any> = {}) {
  const title = overrides.title || faker.word.words(2);
  const slug = overrides.slug || faker.helpers.slugify(title).toLowerCase();
  return {
    id: overrides.id || faker.string.uuid(),
    slug,
    title,
    subtitle: overrides.subtitle !== undefined ? overrides.subtitle : faker.word.words(5),
    description: overrides.description !== undefined ? overrides.description : faker.lorem.paragraph(),
    tone: overrides.tone || CollectionTone.SUN,
    coverImageUrl: overrides.coverImageUrl !== undefined ? overrides.coverImageUrl : faker.image.url(),
    isActive: overrides.isActive !== undefined ? overrides.isActive : true,
    sortOrder: overrides.sortOrder !== undefined ? overrides.sortOrder : 0,
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
    ...overrides,
  };
}

// 6. StoryOnCollection Factory
export function createMockStoryOnCollection(overrides: Partial<any> = {}) {
  return {
    collectionId: overrides.collectionId || faker.string.uuid(),
    storyId: overrides.storyId || faker.string.uuid(),
    position: overrides.position !== undefined ? overrides.position : 0,
    createdAt: overrides.createdAt || new Date(),
    ...overrides,
  };
}

// 7. StoryChunk Factory
export function createMockStoryChunk(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || faker.string.uuid(),
    storyId: overrides.storyId || faker.string.uuid(),
    chunkIndex: overrides.chunkIndex !== undefined ? overrides.chunkIndex : 0,
    content: overrides.content || faker.lorem.sentence(),
    startTime: overrides.startTime !== undefined ? overrides.startTime : null,
    endTime: overrides.endTime !== undefined ? overrides.endTime : null,
    createdAt: overrides.createdAt || new Date(),
    ...overrides,
  };
}

// 8. Audio Factory
export function createMockAudio(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || faker.string.uuid(),
    userId: overrides.userId || faker.string.uuid(),
    voiceProfileId: overrides.voiceProfileId || faker.string.uuid(),
    status: overrides.status || AudioStatus.READY,
    title: overrides.title !== undefined ? overrides.title : faker.word.words(3),
    originalText: overrides.originalText || faker.lorem.paragraph(),
    duration: overrides.duration !== undefined ? overrides.duration : faker.number.int({ min: 60, max: 600 }),
    audioUrl: overrides.audioUrl !== undefined ? overrides.audioUrl : faker.internet.url(),
    totalSegments: overrides.totalSegments !== undefined ? overrides.totalSegments : 1,
    readySegments: overrides.readySegments !== undefined ? overrides.readySegments : 1,
    errorMessage: overrides.errorMessage !== undefined ? overrides.errorMessage : null,
    globalEmotion: overrides.globalEmotion !== undefined ? overrides.globalEmotion : 'neutral',
    globalSpeed: overrides.globalSpeed !== undefined ? overrides.globalSpeed : 1.0,
    globalVolume: overrides.globalVolume !== undefined ? overrides.globalVolume : 1.0,
    cartesiaPronunciationDictId: overrides.cartesiaPronunciationDictId !== undefined ? overrides.cartesiaPronunciationDictId : null,
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
    completedAt: overrides.completedAt !== undefined ? overrides.completedAt : new Date(),
    ...overrides,
  };
}

// 9. AudioSegment Factory
export function createMockAudioSegment(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || faker.string.uuid(),
    audioId: overrides.audioId || faker.string.uuid(),
    index: overrides.index !== undefined ? overrides.index : 0,
    content: overrides.content || faker.lorem.sentence(),
    audioUrl: overrides.audioUrl !== undefined ? overrides.audioUrl : faker.internet.url(),
    status: overrides.status || AudioStatus.READY,
    duration: overrides.duration !== undefined ? overrides.duration : faker.number.int({ min: 10, max: 60 }),
    emotion: overrides.emotion !== undefined ? overrides.emotion : null,
    speed: overrides.speed !== undefined ? overrides.speed : null,
    volume: overrides.volume !== undefined ? overrides.volume : null,
    createdAt: overrides.createdAt || new Date(),
    ...overrides,
  };
}

// 10. UserStoryProgress Factory
export function createMockUserStoryProgress(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || faker.string.uuid(),
    userId: overrides.userId || faker.string.uuid(),
    storyId: overrides.storyId || faker.string.uuid(),
    voiceProfileId: overrides.voiceProfileId || faker.string.uuid(),
    lastChunkIndex: overrides.lastChunkIndex !== undefined ? overrides.lastChunkIndex : 0,
    completedAt: overrides.completedAt !== undefined ? overrides.completedAt : null,
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
    ...overrides,
  };
}

// 11. Subscription Factory
export function createMockSubscription(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || faker.string.uuid(),
    userId: overrides.userId || faker.string.uuid(),
    plan: overrides.plan || SubscriptionPlan.FREE,
    status: overrides.status || SubscriptionStatus.ACTIVE,
    extraVoiceSlots: overrides.extraVoiceSlots !== undefined ? overrides.extraVoiceSlots : 0,
    stripeCustomerId: overrides.stripeCustomerId !== undefined ? overrides.stripeCustomerId : 'cus_' + faker.string.alphanumeric(14),
    stripeSubscriptionId: overrides.stripeSubscriptionId !== undefined ? overrides.stripeSubscriptionId : 'sub_' + faker.string.alphanumeric(14),
    stripePriceId: overrides.stripePriceId !== undefined ? overrides.stripePriceId : 'price_' + faker.string.alphanumeric(14),
    appleTransactionId: overrides.appleTransactionId !== undefined ? overrides.appleTransactionId : null,
    appleOriginalTransactionId: overrides.appleOriginalTransactionId !== undefined ? overrides.appleOriginalTransactionId : null,
    googlePurchaseToken: overrides.googlePurchaseToken !== undefined ? overrides.googlePurchaseToken : null,
    googleProductId: overrides.googleProductId !== undefined ? overrides.googleProductId : null,
    currentPeriodStart: overrides.currentPeriodStart || new Date(),
    currentPeriodEnd: overrides.currentPeriodEnd || faker.date.future(),
    cancelAtPeriodEnd: overrides.cancelAtPeriodEnd !== undefined ? overrides.cancelAtPeriodEnd : false,
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
    ...overrides,
  };
}

// 12. UsageLimit Factory
export function createMockUsageLimit(overrides: Partial<any> = {}) {
  const now = new Date();
  return {
    id: overrides.id || faker.string.uuid(),
    userId: overrides.userId || faker.string.uuid(),
    month: overrides.month !== undefined ? overrides.month : now.getMonth() + 1,
    year: overrides.year !== undefined ? overrides.year : now.getFullYear(),
    storiesGenerated: overrides.storiesGenerated !== undefined ? overrides.storiesGenerated : 0,
    textToSpeechCount: overrides.textToSpeechCount !== undefined ? overrides.textToSpeechCount : 0,
    resetAt: overrides.resetAt || faker.date.future(),
    ...overrides,
  };
}

// 13. UserDevice Factory
export function createMockUserDevice(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || faker.string.uuid(),
    userId: overrides.userId || faker.string.uuid(),
    deviceToken: overrides.deviceToken || faker.string.alphanumeric(64),
    platform: overrides.platform || faker.helpers.arrayElement(['IOS', 'ANDROID']),
    isActive: overrides.isActive !== undefined ? overrides.isActive : true,
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
    ...overrides,
  };
}

// 15. Notification Factory
export function createMockNotification(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || faker.string.uuid(),
    userId: overrides.userId || faker.string.uuid(),
    type: overrides.type || 'VOICE_READY',
    title: overrides.title || 'Sesiniz Hazır!',
    body: overrides.body || 'Ses klonlama işleminiz başarıyla tamamlandı.',
    data: overrides.data !== undefined ? overrides.data : {},
    read: overrides.read !== undefined ? overrides.read : false,
    readAt: overrides.readAt !== undefined ? overrides.readAt : null,
    createdAt: overrides.createdAt || new Date(),
    ...overrides,
  };
}

// 16. FavoriteStory Factory
export function createMockFavoriteStory(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || faker.string.uuid(),
    userId: overrides.userId || faker.string.uuid(),
    storyId: overrides.storyId || faker.string.uuid(),
    createdAt: overrides.createdAt || new Date(),
    ...overrides,
  };
}

// 17. StoryNarration Factory
export function createMockStoryNarration(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || faker.string.uuid(),
    userId: overrides.userId || faker.string.uuid(),
    storyId: overrides.storyId || faker.string.uuid(),
    voiceProfileId: overrides.voiceProfileId || faker.string.uuid(),
    title: overrides.title !== undefined ? overrides.title : faker.word.words(3),
    audioId: overrides.audioId !== undefined ? overrides.audioId : faker.string.uuid(),
    status: overrides.status || NarrationStatus.READY,
    errorMessage: overrides.errorMessage !== undefined ? overrides.errorMessage : null,
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
    completedAt: overrides.completedAt !== undefined ? overrides.completedAt : new Date(),
    ...overrides,
  };
}

// 18. Admin Factory
export function createMockAdmin(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || faker.string.uuid(),
    email: overrides.email || faker.internet.email().toLowerCase(),
    passwordHash: overrides.passwordHash || faker.string.alphanumeric(60),
    firstName: overrides.firstName !== undefined ? overrides.firstName : faker.person.firstName(),
    lastName: overrides.lastName !== undefined ? overrides.lastName : faker.person.lastName(),
    role: overrides.role || AdminRole.ADMIN,
    isActive: overrides.isActive !== undefined ? overrides.isActive : true,
    lastLoginAt: overrides.lastLoginAt !== undefined ? overrides.lastLoginAt : null,
    tokenVersion: overrides.tokenVersion !== undefined ? overrides.tokenVersion : 0,
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
    ...overrides,
  };
}

// 19. PromoCode Factory
export function createMockPromoCode(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || faker.string.uuid(),
    code: overrides.code || faker.string.alphanumeric(8).toUpperCase(),
    type: overrides.type || 'PERCENTAGE',
    value: overrides.value !== undefined ? overrides.value : 20,
    maxUses: overrides.maxUses !== undefined ? overrides.maxUses : null,
    usedCount: overrides.usedCount !== undefined ? overrides.usedCount : 0,
    expiresAt: overrides.expiresAt !== undefined ? overrides.expiresAt : faker.date.future(),
    isActive: overrides.isActive !== undefined ? overrides.isActive : true,
    createdAt: overrides.createdAt || new Date(),
    ...overrides,
  };
}

// 20. LegalDocument Factory
export function createMockLegalDocument(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || faker.string.uuid(),
    slug: overrides.slug || 'tos',
    language: overrides.language || 'tr',
    title: overrides.title || 'Kullanım Şartları',
    contentMd: overrides.contentMd || '# Kullanım Şartları\n\nSesly uygulamasına hoş geldiniz.',
    currentVersion: overrides.currentVersion !== undefined ? overrides.currentVersion : 1,
    status: overrides.status || LegalDocumentStatus.PUBLISHED,
    publishedAt: overrides.publishedAt !== undefined ? overrides.publishedAt : new Date(),
    publishedBy: overrides.publishedBy !== undefined ? overrides.publishedBy : 'admin@test.sesly.io',
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
    ...overrides,
  };
}

// 21. LegalDocumentVersion Factory
export function createMockLegalDocumentVersion(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || faker.string.uuid(),
    documentId: overrides.documentId || faker.string.uuid(),
    slug: overrides.slug || 'tos',
    language: overrides.language || 'tr',
    version: overrides.version !== undefined ? overrides.version : 1,
    title: overrides.title || 'Kullanım Şartları',
    contentMd: overrides.contentMd || '# Kullanım Şartları\n\nSesly uygulamasına hoş geldiniz.',
    publishedAt: overrides.publishedAt || new Date(),
    publishedBy: overrides.publishedBy !== undefined ? overrides.publishedBy : 'admin@test.sesly.io',
    ...overrides,
  };
}

// 22. UserPreferences Factory
export function createMockUserPreferences(overrides: Partial<any> = {}) {
  return {
    userId: overrides.userId || faker.string.uuid(),
    sleepTimerFadeOut: overrides.sleepTimerFadeOut !== undefined ? overrides.sleepTimerFadeOut : true,
    sleepTimerPauseWhenAsleep: overrides.sleepTimerPauseWhenAsleep !== undefined ? overrides.sleepTimerPauseWhenAsleep : false,
    sleepTimerLastDuration: overrides.sleepTimerLastDuration !== undefined ? overrides.sleepTimerLastDuration : null,
    voiceReadyNotifications: overrides.voiceReadyNotifications !== undefined ? overrides.voiceReadyNotifications : true,
    narrationReadyNotifications: overrides.narrationReadyNotifications !== undefined ? overrides.narrationReadyNotifications : true,
    promoNotifications: overrides.promoNotifications !== undefined ? overrides.promoNotifications : false,
    settings: overrides.settings !== undefined ? overrides.settings : {},
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
    ...overrides,
  };
}

// 23. Playlist Factory
export function createMockPlaylist(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || faker.string.uuid(),
    userId: overrides.userId || faker.string.uuid(),
    name: overrides.name || 'Bu Gece',
    isDefault: overrides.isDefault !== undefined ? overrides.isDefault : false,
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
    ...overrides,
  };
}

// 24. PlaylistItem Factory
export function createMockPlaylistItem(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || faker.string.uuid(),
    playlistId: overrides.playlistId || faker.string.uuid(),
    narrationId: overrides.narrationId !== undefined ? overrides.narrationId : null,
    storyId: overrides.storyId !== undefined ? overrides.storyId : null,
    voiceProfileId: overrides.voiceProfileId !== undefined ? overrides.voiceProfileId : null,
    position: overrides.position !== undefined ? overrides.position : 0,
    createdAt: overrides.createdAt || new Date(),
    ...overrides,
  };
}
