/**
 * Application-wide constants
 * All configuration values that don't change at runtime
 */

import Constants from 'expo-constants';
import { msg } from '../i18n/messages';

const Config = Constants.expoConfig?.extra || {};

// ============================================================================
// API Configuration
// ============================================================================

export const API_CONFIG = {
  BASE_URL: Config.BASE_URL || 'http://localhost:3000',
  BASE_URL_PRODUCTION: Config.BASE_URL_PRODUCTION || 'https://api.sesly.io',
  WEBSOCKET_URL: Config.WEBSOCKET_URL || 'ws://localhost:3000',
  WEBSOCKET_URL_PRODUCTION:
    Config.WEBSOCKET_URL_PRODUCTION || 'wss://api.sesly.io',
  CONNECTION_TIMEOUT: 30000, // 30 seconds
  RECEIVE_TIMEOUT: 30000, // 30 seconds
} as const;

// ============================================================================
// Storage Keys
// ============================================================================

export const STORAGE_KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
  FIRST_LAUNCH: 'first_launch',
  LANGUAGE: 'language',
  /** 'true' once onboarding was finished or skipped (never cleared). */
  HAS_SEEN_ONBOARDING: 'hasSeenOnboarding',
  /** The raw JSON of the last successful GET /app/config. */
  APP_CONFIG: '@sesly/appConfig',
  /** 'record' after "Sesimi kaydet" on onboarding, until the first sign-in. */
  ONBOARDING_INTENT: '@sesly/onboardingIntent',
} as const;

// ============================================================================
// Boot
// ============================================================================

/** The background GET /app/config refresh gives up after this long. */
export const APP_CONFIG_REFRESH_TIMEOUT_MS = 10000;

// ============================================================================
// Voice Cloning Configuration
// ============================================================================

// GET /voice-profiles/clone-config is the source of truth for durations, the
// reading script and the consent text. The FALLBACK_* values below are only
// used when that response omits a duration or script field. Consent fields
// have NO fallback: without the served consent text the flow refuses to record.
//
// Cartesia Sonic 3.6 learns from up to 60 s of speech (older models used only
// the first 10 s); longer takes keep the accent better. The backend only
// transcodes the take to 44.1 kHz mono 16-bit WAV (no filters), trims the
// lead-in before `speechStartMs` and caps it at 60 s. It does NOT normalize
// loudness or denoise, so the take must be clean as recorded (quiet room,
// steady distance, no long pauses).
export const VOICE_CLONING = {
  FALLBACK_MIN_SECONDS: 15,
  FALLBACK_TARGET_SECONDS: 30,
  FALLBACK_MAX_SECONDS: 60,
  // Reading script per voice language, for a config without one (the
  // backend's CLONE_SCRIPT / CLONE_SCRIPT_EN). Another language reads the
  // English one (VoiceClone.fallbackCloneScript).
  FALLBACK_SCRIPT_TITLE_TR: 'Ayışığı Ormanı',
  FALLBACK_SCRIPT_TR:
    'Bir varmış, bir yokmuş. Ayışığı Ormanı\'nın derinliklerinde, yaşlı bir çınar ağacının dibinde küçük bir tavşan yaşarmış. Her akşam güneş batarken annesi ona yıldızları gösterir, adlarını tek tek fısıldarmış. Bir gece gökyüzünde hiç görmediği parlak bir yıldız belirmiş. Küçük tavşan merakla sormuş: "Anneciğim, bu yıldız neden bize göz kırpıyor?" Annesi gülümsemiş: "Çünkü seni uyurken izlemeyi çok seviyor." Tavşan yumuşak yaprakların arasına kıvrılmış, rüzgârın ninnisini dinlemiş ve gözlerini yavaşça kapatmış. Bütün orman da onunla birlikte derin ve huzurlu bir uykuya dalmış.',
  FALLBACK_SCRIPT_TITLE_EN: 'A Starry Night',
  FALLBACK_SCRIPT_EN: [
    'When evening comes, a soft hush settles over the village. The sky turns pink, then a deep and quiet blue. Little Juniper sits by her window and waits for the first star. Leaves whisper in the garden, and far away an owl calls through the dark.',
    'Her mother brings a cup of warm milk and tucks a blanket around her shoulders. The paper boat she folded yesterday still waits on the table. Juniper closes her eyes and takes a slow, deep breath. She thinks of butterflies above the flowers, the cheerful splash of the brook, and the sweet buns she shared with friends.',
    'The moon rises slowly and fills the room with silver light. Everything is in its place, and everything is safe. Her mother kisses her cheek and dims the lamp. Sleep arrives as gently as a feather. Good night, my little treasure. Sweet dreams are waiting for you.',
  ].join('\n\n'),
  // dBFS threshold for "user actually started speaking". Phone-mic ambient
  // noise sits around -50 to -60 dBFS; speech is well above -35 on both
  // platforms. The timer does not run until speech is detected.
  VOICE_DETECT_THRESHOLD_DBFS: -35,
  // How many consecutive metering samples must clear the threshold before we
  // call it speech (prevents arming on a single click/cough).
  VOICE_DETECT_CONSECUTIVE_SAMPLES: 2,
  // Stop an armed recorder that never hears speech (mic muted, wrong input).
  SPEECH_WAIT_TIMEOUT_SECONDS: 20,
  // Input level hint. expo-audio metering differs per platform: iOS reports
  // AVAudioRecorder averagePower (RMS-like), Android reports the peak
  // amplitude since the last read (20*log10(maxAmplitude/32767)), so peaks
  // run much hotter on Android. Evaluated over a short rolling window so a
  // breath between sentences does not flash "too quiet".
  LEVEL_WINDOW_SAMPLES: 15, // 15 x 100 ms poll = 1.5 s
  LEVEL_QUIET_DBFS_IOS: -42,
  LEVEL_LOUD_DBFS_IOS: -8,
  LEVEL_QUIET_DBFS_ANDROID: -30,
  LEVEL_LOUD_DBFS_ANDROID: -1.5,
  // Samples at/above the loud threshold inside the window before we warn.
  LEVEL_LOUD_MIN_SAMPLES: 2,
  // Training status tracker (useVoiceProfile): one poll of
  // GET /voice-profiles/:id/status plus socket voice_status events.
  STATUS_POLL_INTERVAL_MS: 5000,
  STATUS_TRACK_TIMEOUT_MS: 20 * 60 * 1000,
} as const;

// ============================================================================
// Plan limits live in models/Plans.ts (PLANS) and come live from GET /usage.
// ============================================================================

// ============================================================================
// Polling
// ============================================================================

export const POLLING_INTERVALS = {
  AUDIO_GENERATION: 3000, // 3 seconds
} as const;

// ============================================================================
// Audio Playback
// ============================================================================

export const AUDIO_PLAYBACK = {
  SEEK_INTERVAL_SECONDS: 10,
} as const;

// ============================================================================
// OAuth Configuration
// ============================================================================

export const OAUTH_CONFIG = {
  GOOGLE: {
    WEB_CLIENT_ID: Config.GOOGLE_WEB_CLIENT_ID || '',
    PROJECT_NUMBER: Config.GOOGLE_PROJECT_NUMBER || '',
    PROJECT_ID: Config.GOOGLE_PROJECT_ID || '',
  },
  APPLE: {
    CLIENT_ID: Config.APPLE_CLIENT_ID || 'com.example.sesly.service',
    REDIRECT_URI: Config.APPLE_REDIRECT_URI || '',
  },
} as const;

// ============================================================================
// Firebase Configuration
// ============================================================================

export const FIREBASE_CONFIG = {
  APP_DOMAIN: Config.FIREBASE_APP_DOMAIN || '',
  STORAGE_BUCKET: Config.FIREBASE_STORAGE_BUCKET || '',
  API_KEY: Config.GOOGLE_API_KEY || '',
  projectId: Config.FIREBASE_PROJECT_ID || 'sesly-app',
  appId: Config.FIREBASE_APP_ID || '1:1234567890:android:xxxxxx',
} as const;

// ============================================================================
// Error Messages
// ============================================================================

// Getters, not constants: the text follows the UI language at the moment
// it is read.
export const ERROR_MESSAGES = {
  get NETWORK(): string {
    return msg('common.network');
  },
  get SERVER(): string {
    return msg('common.server');
  },
  get UNKNOWN(): string {
    return msg('common.unknown');
  },
  get SESSION_EXPIRED(): string {
    return msg('common.sessionExpired');
  },
  get FILE_TOO_LARGE(): string {
    return msg('common.fileTooLarge');
  },
};
