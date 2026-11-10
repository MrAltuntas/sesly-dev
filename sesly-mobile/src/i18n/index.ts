/**
 * i18n setup: i18next + react-i18next, resources bundled with the app.
 *
 * Namespaces (one JSON per namespace under ./tr and ./en):
 *   common      shared words, errors, accessibility labels
 *   nav         bottom navigation, mini player
 *   onboarding  the three welcome pages
 *   auth        sign in, register, password reset, consent sheets
 *   home        the Masallar tab
 *   story       labels derived from story data (age, category, duration)
 *   discover    the Keşfet tab, all stories, collections
 *   detail      story detail, narrator sheet, translation requests
 *   library     the Kütüphane tab
 *   voices      the Sesim tab
 *   player      player, playback speed, sleep timer, playlist
 *   voiceFlow   voice creation: intro, consent, recording, processing, ready
 *   generation  the narration wait screen
 *   plans       the plans screen
 *   profile     profile and settings
 *   notifications  the notification list
 *   states      full screen error, offline, force update
 *   messages    snackbar and store messages
 *
 * Usage in a component:
 *   const { t } = useTranslation('auth');
 *   t('login.title')            // own namespace
 *   t('common:retry')           // another namespace
 *
 * Outside React: `import i18n from '../i18n'; i18n.t('common:retry')`.
 *
 * Do not name an interpolation variable `count`: i18next then resolves
 * plural forms through Intl.PluralRules, which Hermes does not ship. Turkish
 * and the strings used so far need one form, so variables are named for
 * what they hold (`minutes`).
 *
 * The instance initialises synchronously at import with the device language,
 * so the first frame is already translated. `initUiLanguage()` then applies
 * the stored preference (BootStore runs it before App renders).
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import {
  UiLanguage,
  getDeviceUiLanguage,
  isUiLanguage,
  readStoredUiLanguage,
  storeUiLanguage,
} from './language';

import trCommon from './tr/common.json';
import trNav from './tr/nav.json';
import trOnboarding from './tr/onboarding.json';
import trAuth from './tr/auth.json';
import trHome from './tr/home.json';
import trStory from './tr/story.json';
import trDiscover from './tr/discover.json';
import trDetail from './tr/detail.json';
import trLibrary from './tr/library.json';
import trVoices from './tr/voices.json';
import trPlayer from './tr/player.json';
import trVoiceFlow from './tr/voiceFlow.json';
import trGeneration from './tr/generation.json';
import trPlans from './tr/plans.json';
import trProfile from './tr/profile.json';
import trNotifications from './tr/notifications.json';
import trStates from './tr/states.json';
import trMessages from './tr/messages.json';
import enCommon from './en/common.json';
import enNav from './en/nav.json';
import enOnboarding from './en/onboarding.json';
import enAuth from './en/auth.json';
import enHome from './en/home.json';
import enStory from './en/story.json';
import enDiscover from './en/discover.json';
import enDetail from './en/detail.json';
import enLibrary from './en/library.json';
import enVoices from './en/voices.json';
import enPlayer from './en/player.json';
import enVoiceFlow from './en/voiceFlow.json';
import enGeneration from './en/generation.json';
import enPlans from './en/plans.json';
import enProfile from './en/profile.json';
import enNotifications from './en/notifications.json';
import enStates from './en/states.json';
import enMessages from './en/messages.json';

export const resources = {
  tr: {
    common: trCommon,
    nav: trNav,
    onboarding: trOnboarding,
    auth: trAuth,
    home: trHome,
    story: trStory,
    discover: trDiscover,
    detail: trDetail,
    library: trLibrary,
    voices: trVoices,
    player: trPlayer,
    voiceFlow: trVoiceFlow,
    generation: trGeneration,
    plans: trPlans,
    profile: trProfile,
    notifications: trNotifications,
    states: trStates,
    messages: trMessages,
  },
  en: {
    common: enCommon,
    nav: enNav,
    onboarding: enOnboarding,
    auth: enAuth,
    home: enHome,
    story: enStory,
    discover: enDiscover,
    detail: enDetail,
    library: enLibrary,
    voices: enVoices,
    player: enPlayer,
    voiceFlow: enVoiceFlow,
    generation: enGeneration,
    plans: enPlans,
    profile: enProfile,
    notifications: enNotifications,
    states: enStates,
    messages: enMessages,
  },
} as const;

export const NAMESPACES = [
  'common',
  'nav',
  'onboarding',
  'auth',
  'home',
  'story',
  'discover',
  'detail',
  'library',
  'voices',
  'player',
  'voiceFlow',
  'generation',
  'plans',
  'profile',
  'notifications',
  'states',
  'messages',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: getDeviceUiLanguage(),
    fallbackLng: 'tr',
    ns: [...NAMESPACES],
    defaultNS: 'common',
    // Resources are in memory: initialise synchronously.
    initAsync: false,
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  });
}

/**
 * Apply the stored UI language, or the device language when the user never
 * chose one. Call once at startup. BootStore passes the value its boot
 * snapshot already read (`preRead`, null when nothing is stored), so storage
 * is not read again; without it the stored pick is read here.
 */
export async function initUiLanguage(preRead?: string | null): Promise<UiLanguage> {
  const stored =
    preRead === undefined ? await readStoredUiLanguage() : isUiLanguage(preRead) ? preRead : null;
  const language = stored ?? getDeviceUiLanguage();
  if (i18n.language !== language) {
    await i18n.changeLanguage(language);
  }
  return language;
}

/**
 * Change the UI language. `null` means "follow the device" and clears the
 * stored pick. The settings control for this arrives with the profile screen.
 */
export async function setUiLanguage(language: UiLanguage | null): Promise<UiLanguage> {
  await storeUiLanguage(language);
  const next = language ?? getDeviceUiLanguage();
  await i18n.changeLanguage(next);
  return next;
}

export default i18n;
