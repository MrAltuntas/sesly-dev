// 1. ApiClient Mock
export const mockApiClient = {
  get: jest.fn().mockResolvedValue({}),
  post: jest.fn().mockResolvedValue({}),
  put: jest.fn().mockResolvedValue({}),
  delete: jest.fn().mockResolvedValue({}),
  patch: jest.fn().mockResolvedValue({}),
  setAuthToken: jest.fn(),
  clearAuthToken: jest.fn(),
  getAccessToken: jest.fn().mockResolvedValue(null),
  getRefreshToken: jest.fn().mockResolvedValue(null),
  getFreshAccessToken: jest.fn().mockResolvedValue(null),
  hasValidTokens: jest.fn().mockResolvedValue(false),
  storeTokens: jest.fn().mockResolvedValue(undefined),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  onTokensRefreshed: jest.fn(() => jest.fn()),
  onSessionExpired: jest.fn(() => jest.fn()),
  refreshSession: jest.fn().mockResolvedValue(null),
};
jest.mock('../../services/ApiClient', () => mockApiClient);

// 3. AuthService Mock
export const mockAuthService = {
  login: jest.fn().mockResolvedValue({}),
  register: jest.fn().mockResolvedValue({}),
  logout: jest.fn().mockResolvedValue(undefined),
  checkAuth: jest.fn().mockResolvedValue(true),
  currentUser: { id: 'mock-user-1', email: 'test@example.com' },
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  isAuthenticated: true,
  initialize: jest.fn().mockResolvedValue(undefined),
  restoreSession: jest.fn().mockResolvedValue({ status: 'none' }),
  getCurrentFirebaseUser: jest.fn(() => null),
};
jest.mock('../../services/AuthService', () => ({
  default: mockAuthService,
}));

// 4. CacheService Mock
export const mockCacheService = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(undefined),
  clear: jest.fn().mockResolvedValue(undefined),
  clearAudioCache: jest.fn().mockResolvedValue(undefined),
  clearAllCache: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../../services/CacheService', () => ({
  default: mockCacheService,
}));

// 5. CollectionService Mock
export const mockCollectionService = {
  list: jest.fn().mockResolvedValue([]),
  getBySlug: jest.fn().mockResolvedValue({}),
  getStories: jest.fn().mockResolvedValue({ data: [], meta: {} }),
};
jest.mock('../../services/CollectionService', () => ({
  default: mockCollectionService,
}));

// 6. LegalService Mock (cache-first reads: read, peek, prefetch, list)
export const mockLegalService = {
  list: jest.fn().mockResolvedValue([]),
  read: jest.fn().mockResolvedValue({ status: 'unpublished' }),
  peek: jest.fn(() => null),
  prefetch: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../../services/LegalService', () => ({
  default: mockLegalService,
}));

// 7. NarrationService Mock
export const mockNarrationService = {
  getNarrations: jest.fn().mockResolvedValue([]),
  getMyNarrations: jest.fn().mockResolvedValue({ data: [], meta: {} }),
  getNarrationsByStory: jest.fn().mockResolvedValue([]),
  createNarration: jest.fn().mockResolvedValue({}),
  getNarrationById: jest.fn().mockResolvedValue({}),
  deleteNarration: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../../services/NarrationService', () => ({
  default: mockNarrationService,
}));

// 8. NotificationService Mock
export const mockNotificationService = {
  getNotifications: jest.fn().mockResolvedValue([]),
  markAsRead: jest.fn().mockResolvedValue(undefined),
  markAllAsRead: jest.fn().mockResolvedValue(undefined),
  registerDeviceToken: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../../services/NotificationService', () => ({
  default: mockNotificationService,
}));

// 10. SleepTimerService Mock
export const mockSleepTimerService = {
  start: jest.fn(),
  stop: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  isActive: false,
  timeLeft: 0,
  setTime: jest.fn(),
};
jest.mock('../../services/SleepTimerService', () => ({
  default: mockSleepTimerService,
}));

// 11. StoryService Mock
export const mockStoryService = {
  getStories: jest.fn().mockResolvedValue({ data: [], meta: {} }),
  searchStories: jest.fn().mockResolvedValue({ data: [], meta: {} }),
  getStoryById: jest.fn().mockResolvedValue({}),
  toggleFavorite: jest.fn().mockResolvedValue(undefined),
  getFavoriteStories: jest.fn().mockResolvedValue({ data: [], meta: {} }),
  getLanguages: jest.fn().mockResolvedValue({ defaultLanguage: 'tr', languages: [] }),
};
jest.mock('../../services/StoryService', () => ({
  default: mockStoryService,
}));

// 13. UserPreferencesService Mock
export const mockUserPreferencesService = {
  getPreferences: jest.fn().mockResolvedValue({}),
  updatePreferences: jest.fn().mockResolvedValue({}),
};
jest.mock('../../services/UserPreferencesService', () => ({
  default: mockUserPreferencesService,
}));

// 14. UserService Mock
export const mockUserService = {
  getCurrentUser: jest.fn().mockResolvedValue({}),
  updateProfile: jest.fn().mockResolvedValue({}),
  deleteAccount: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../../services/UserService', () => ({
  default: mockUserService,
}));

// 16. VoiceProfileService Mock
export const mockVoiceProfileService = {
  getMyVoiceProfiles: jest.fn().mockResolvedValue([]),
  createVoiceProfile: jest.fn().mockResolvedValue({}),
  deleteVoiceProfile: jest.fn().mockResolvedValue(undefined),
  getVoiceSlots: jest.fn().mockResolvedValue(null),
  getAvailableVoices: jest.fn().mockResolvedValue({ cartesia: [], google: [] }),
  getCloneConfig: jest.fn().mockResolvedValue(null),
  uploadCloneSample: jest.fn().mockResolvedValue(undefined),
  getVoiceProfileStatus: jest.fn().mockResolvedValue(null),
  getVoiceSample: jest.fn().mockResolvedValue(null),
  previewVoice: jest.fn().mockResolvedValue(null),
};
jest.mock('../../services/VoiceProfileService', () => ({
  default: mockVoiceProfileService,
}));

// 17. WebSocketService Mock
export const mockWebSocketService = {
  connect: jest.fn(),
  disconnect: jest.fn(),
  ensureConnected: jest.fn(),
  addVoiceStatusListener: jest.fn(() => jest.fn()),
  setVoiceStatusFallback: jest.fn(),
  registerAudioPlayerStore: jest.fn(),
  addNarrationStatusListener: jest.fn(() => jest.fn()),
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
};
jest.mock('../../services/WebSocketService', () => ({
  default: mockWebSocketService,
}));

// 18. firebase Mock
export const mockFirebase = {
  auth: jest.fn(() => ({
    currentUser: { uid: 'mock-uid' },
  })),
};
jest.mock('../../services/firebase', () => ({
  default: mockFirebase,
}));
