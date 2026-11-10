/**
 * Root Navigator
 *
 * - `Main` hosts the bottom navigation bar with four destinations:
 *   Masallar, Keşfet, Kütüphane, Sesim (see MainScaffold). Profile is reached
 *   from the avatar in a tab's app bar.
 * - Boot: the first route is decided by the BootStore from local data
 *   (src/boot). Until it is known this renders nothing and the native splash
 *   stays up; then the container mounts on that route as its initial state
 *   (no Splash route, no transition) and releases the splash once it drew.
 *   Losing the session resets the stack to Login.
 * - Theme: dark only. Every screen reads the active palette through `useT()`
 *   inside its own palette boundary (`withScreenPalette`), so a hidden screen
 *   recolours after a pick without rendering at the tap.
 * - Transitions: one map (`SCREEN_ANIMATION`). Pushes use `ios_from_right`
 *   (200 ms on Android, the screen below moves 30 percent); content opens
 *   (a story, a collection, the player, the plans) rise with
 *   `fade_from_bottom`; state swaps (Main, Login, Onboarding, the gates, the
 *   end of a flow) fade.
 * - Freeze: a screen two or more levels down does not render while hidden
 *   (`freezeOnBlur`; the one directly below stays live on Fabric).
 * - Lazy routes: only the launch path (Onboarding, Login, Main with the Home
 *   tab, ForceUpdate, NoInternet) is imported here; every other screen is
 *   required on first use (`getComponent`). `preloadLikelyScreens()` warms the
 *   three a first tap usually opens.
 * - Voice creation is a modal stack (intro, consent, record, training,
 *   success). Each of its screens carries a dialog outlet
 *   (`withDialogOutlet`): iOS refuses a dialog presented from the root while
 *   a `presentation: 'modal'` screen is up, so their dialogs open in the
 *   screen's own window.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import {
  createNativeStackNavigator,
  NativeStackNavigationOptions,
} from '@react-navigation/native-stack';
import type { StackAnimationTypes } from 'react-native-screens';
import { observer } from 'mobx-react-lite';
import { useT } from '../theme/theme';
import { withScreenPalette } from '../theme/ThemeProvider';
import { useAuth } from '../hooks/useAuth';
import { useSubscription } from '../hooks/useSubscription';
import { usePushNotificationBridge } from '../hooks/usePushNotifications';
import { usePurchaseBridge } from '../hooks/usePurchaseBridge';
import { navigationRef } from './navigationRef';
import { flushPendingNotificationOpen } from './pushRouting';
import { RootHosts } from './RootHosts';
import { getDiscoverStore } from '../hooks/useDiscover';
import { getContentLanguageStore } from '../hooks/useContentLanguage';
import { getBootStore } from '../boot/BootStore';
import { bootRouteToState } from '../boot/decideBootRoute';
import { releaseSplash } from '../boot/splash';
import { lazyScreen } from '../screens/main/lazyScreen';
import { withDialogOutlet } from '../components/design/DialogOutlet';

// The launch path, imported eagerly. Everything else is in LAZY_SCREENS.
import LoginScreen from '../screens/auth/LoginScreen';
import OnboardingScreen from '../screens/onboarding/OnboardingScreen';
import ForceUpdateScreen from '../screens/splash/ForceUpdateScreen';
import NoInternetScreen from '../screens/common/NoInternetScreen';
import { MainScaffold } from '../screens/main';

// ─────────────────────────────────────────────────────────────
// Route types
// ─────────────────────────────────────────────────────────────

export type RootStackParamList = {
  // Blocking gate: installed version < GET /app/config minSupportedVersion.
  ForceUpdate: { message: string | null; storeUrl: string | null };
  Onboarding: undefined;
  /** `firstRun`: reached from onboarding (the first-run title). */
  Login: { firstRun?: boolean } | undefined;
  Registration: undefined;

  // Main Navigation (hosts the 4 tabs).
  // Use the `screen` key to deep-link to a specific tab, e.g.
  //   navigate('Main', { screen: 'Stories' })
  // `params.category` opens Keşfet filtered to one story category.
  Main:
    | { screen?: 'Stories' | 'Discover' | 'Library' | 'Voices'; params?: { category?: string } }
    | undefined;

  // Story Screens
  /**
   * `selectVoiceId`: a narrator just added or recorded for this story; the
   * page selects it once its voices are loaded, then clears the param.
   */
  StoryDetail: { storyId: string; selectVoiceId?: string };
  AllStories: undefined;

  // Collections
  Collections: undefined;
  CollectionDetail: { slug: string };

  // Voice Screens
  /** `language`: list the ready-made narrators of this content language. */
  VoiceProfiles: { language?: string } | undefined;
  // Every ready-made narrator of one language, with a language filter
  // ("Tümünü gör" on Sesim). `pickForStory`: opened from StoryDetail's
  // empty-voice card; it returns once a narrator was added, so the user lands
  // back on the story (`storyId`) with the new voice.
  NarratorCatalogue: { language?: string; pickForStory?: boolean; storyId?: string } | undefined;
  // The voice flow keeps `returnToStoryId` from the first step to the last:
  // started from a story, it ends on that story with the new voice.
  CreateVoiceProfile: { returnToStoryId?: string } | undefined;
  // KVKK explicit-consent step between naming and recording. `resumeTake`
  // is set when the upload was refused with CONSENT_REQUIRED so the saved
  // take survives the re-consent round trip. `language` is the voice
  // language chosen on CreateVoiceProfile ("tr", "en"): the consent text,
  // its version and the reading script are the ones of that language.
  VoiceConsent: { name: string; resumeTake?: boolean; language?: string; returnToStoryId?: string };
  VoiceRecording: {
    name?: string;
    /**
     * Consent version the user accepted on VoiceConsent (sent with upload).
     * It belongs to `language`.
     */
    consentVersion?: string;
    resumeTake?: boolean;
    /** Voice language the take is read in; fixed once this screen is open. */
    language?: string;
    returnToStoryId?: string;
  };
  VoiceSuccess: { profileId?: string; returnToStoryId?: string };
  Processing: { profileId?: string; returnToStoryId?: string } | undefined;

  // Audio Screens
  /**
   * `autoplay`: start the narration as the player opens ("Dinle", a queue
   * row, a ready generation). A push tap and the notifications list open it
   * without starting it. The player clears the param once it acted on it.
   */
  AudioPlayer: { narrationId: string; autoplay?: boolean };
  AudioGeneration: {
    storyId: string;
    voiceProfileId: string;
    /** When true, the backend deletes any existing narration for this pair before creating fresh. */
    replace?: boolean;
  };

  // Profile (settings live on it) / account deletion / Subscription.
  // Open these with navigateSingleton: each exists at most once in the stack.
  Profile: undefined;
  DataDeletion: undefined;
  Notifications: undefined;
  /** `reason`: the plan CTA that opened it; the screen says why in one line. */
  Subscription: { reason?: 'quota' | 'voices' | 'premiumStory' | 'background' } | undefined;

  // Utility: why the app cannot reach Sesly (the copy follows the reason).
  NoInternet: { reason: 'offline' | 'server' | 'maintenance' } | undefined;
};

export type RootRouteName = keyof RootStackParamList;

// ─────────────────────────────────────────────────────────────
// Transitions, gestures, freeze
// ─────────────────────────────────────────────────────────────

/** The push transition every route uses unless the map says otherwise. */
export const DEFAULT_SCREEN_ANIMATION: StackAnimationTypes = 'ios_from_right';

/** The transition of every route (docs/release-pass/SPEC-design.md 1.7). */
export const SCREEN_ANIMATION: Record<RootRouteName, StackAnimationTypes> = {
  // State swaps fade.
  Onboarding: 'fade',
  Login: 'fade',
  Main: 'fade',
  ForceUpdate: 'fade',
  NoInternet: 'fade',
  VoiceSuccess: 'fade',
  Processing: 'fade',
  AudioGeneration: 'fade',
  // Content opens rise.
  StoryDetail: 'fade_from_bottom',
  CollectionDetail: 'fade_from_bottom',
  AudioPlayer: 'fade_from_bottom',
  Subscription: 'fade_from_bottom',
  // Pushes.
  Registration: DEFAULT_SCREEN_ANIMATION,
  AllStories: DEFAULT_SCREEN_ANIMATION,
  Collections: DEFAULT_SCREEN_ANIMATION,
  VoiceProfiles: DEFAULT_SCREEN_ANIMATION,
  NarratorCatalogue: DEFAULT_SCREEN_ANIMATION,
  CreateVoiceProfile: DEFAULT_SCREEN_ANIMATION,
  VoiceConsent: DEFAULT_SCREEN_ANIMATION,
  VoiceRecording: DEFAULT_SCREEN_ANIMATION,
  Profile: DEFAULT_SCREEN_ANIMATION,
  DataDeletion: DEFAULT_SCREEN_ANIMATION,
  Notifications: DEFAULT_SCREEN_ANIMATION,
};

/**
 * Routes a back swipe must not leave: the shell, the gates, a recording in
 * progress and the end of a flow (they move on by themselves or by a button).
 */
export const NO_GESTURE_ROUTES: ReadonlySet<RootRouteName> = new Set<RootRouteName>([
  'Main',
  'ForceUpdate',
  'NoInternet',
  'VoiceRecording',
  'VoiceSuccess',
  'Processing',
  'AudioGeneration',
]);

/**
 * The navigator's screenOptions without the palette colour (RootNavigator
 * adds `contentStyle`). `animationDuration` only applies to the iOS fades.
 * Every route is frozen while hidden, the player too: its story end and the
 * next queued story are driven by the stores, not by its renders.
 */
export const ROOT_SCREEN_OPTIONS = {
  headerShown: false,
  animation: DEFAULT_SCREEN_ANIMATION,
  freezeOnBlur: true,
  animationDuration: 250,
} as const satisfies NativeStackNavigationOptions;

function buildRouteOptions(): Record<RootRouteName, NativeStackNavigationOptions> {
  const options = {} as Record<RootRouteName, NativeStackNavigationOptions>;
  for (const name of Object.keys(SCREEN_ANIMATION) as RootRouteName[]) {
    options[name] = NO_GESTURE_ROUTES.has(name)
      ? { animation: SCREEN_ANIMATION[name], gestureEnabled: false }
      : { animation: SCREEN_ANIMATION[name] };
  }
  return options;
}

/** Per-route options, built once (stable objects across renders). */
export const ROUTE_OPTIONS = buildRouteOptions();

/** The voice creation flow's group (stable across renders too). */
const MODAL_GROUP_OPTIONS = { presentation: 'modal' } as const satisfies NativeStackNavigationOptions;

// ─────────────────────────────────────────────────────────────
// Screens
// ─────────────────────────────────────────────────────────────

/** The launch path, each in its own palette boundary (Main has its own inside). */
const S = {
  OnboardingScreen: withScreenPalette(OnboardingScreen),
  LoginScreen: withScreenPalette(LoginScreen),
  ForceUpdateScreen: withScreenPalette(ForceUpdateScreen),
  NoInternetScreen: withScreenPalette(NoInternetScreen),
};

/** Every other route: required on first render (or by preloadLikelyScreens). */
export const LAZY_SCREENS = {
  Registration: lazyScreen(
    () => (require('../screens/auth/RegistrationScreen') as typeof import('../screens/auth/RegistrationScreen')).default,
  ),
  StoryDetail: lazyScreen(
    () => (require('../screens/story/StoryDetailScreen') as typeof import('../screens/story/StoryDetailScreen')).default,
  ),
  AllStories: lazyScreen(
    () => (require('../screens/story/AllStoriesScreen') as typeof import('../screens/story/AllStoriesScreen')).default,
  ),
  Collections: lazyScreen(
    () =>
      (require('../screens/collections/CollectionsScreen') as typeof import('../screens/collections/CollectionsScreen'))
        .default,
  ),
  CollectionDetail: lazyScreen(
    () =>
      (
        require('../screens/collections/CollectionDetailScreen') as typeof import('../screens/collections/CollectionDetailScreen')
      ).default,
  ),
  // The modal group: each screen with its own dialog outlet, inside its
  // palette boundary.
  CreateVoiceProfile: lazyScreen(() =>
    withDialogOutlet(
      (require('../screens/voice/CreateVoiceProfileScreen') as typeof import('../screens/voice/CreateVoiceProfileScreen'))
        .default,
    ),
  ),
  VoiceConsent: lazyScreen(() =>
    withDialogOutlet(
      (require('../screens/voice/VoiceConsentScreen') as typeof import('../screens/voice/VoiceConsentScreen')).default,
    ),
  ),
  VoiceRecording: lazyScreen(() =>
    withDialogOutlet(
      (require('../screens/voice/VoiceRecordingScreen') as typeof import('../screens/voice/VoiceRecordingScreen')).default,
    ),
  ),
  VoiceSuccess: lazyScreen(() =>
    withDialogOutlet(
      (require('../screens/voice/VoiceSuccessScreen') as typeof import('../screens/voice/VoiceSuccessScreen')).default,
    ),
  ),
  Processing: lazyScreen(() =>
    withDialogOutlet(
      (require('../screens/voice/ProcessingScreen') as typeof import('../screens/voice/ProcessingScreen')).default,
    ),
  ),
  VoiceProfiles: lazyScreen(
    () =>
      (require('../screens/voice/VoiceProfilesScreen') as typeof import('../screens/voice/VoiceProfilesScreen')).default,
  ),
  NarratorCatalogue: lazyScreen(
    () =>
      (require('../screens/voice/NarratorCatalogueScreen') as typeof import('../screens/voice/NarratorCatalogueScreen'))
        .default,
  ),
  AudioPlayer: lazyScreen(
    () => (require('../screens/audio/AudioPlayerScreen') as typeof import('../screens/audio/AudioPlayerScreen')).default,
  ),
  AudioGeneration: lazyScreen(
    () =>
      (require('../screens/audio/AudioGenerationScreen') as typeof import('../screens/audio/AudioGenerationScreen'))
        .default,
  ),
  Profile: lazyScreen(
    () => (require('../screens/profile/ProfileScreen') as typeof import('../screens/profile/ProfileScreen')).default,
  ),
  DataDeletion: lazyScreen(
    () =>
      (require('../screens/settings/DataDeletionScreen') as typeof import('../screens/settings/DataDeletionScreen'))
        .default,
  ),
  Notifications: lazyScreen(
    () =>
      (require('../screens/notifications/NotificationsScreen') as typeof import('../screens/notifications/NotificationsScreen'))
        .default,
  ),
  Subscription: lazyScreen(
    () =>
      (require('../screens/subscription/SubscriptionScreen') as typeof import('../screens/subscription/SubscriptionScreen'))
        .default,
  ),
};

/**
 * Loads the screens a first tap usually opens (a cover, the mini player, the
 * avatar), so that tap does not pay the module load. The BootStore calls it
 * a moment after a launch on Main. Safe to call more than once.
 */
export function preloadLikelyScreens(): void {
  LAZY_SCREENS.StoryDetail();
  LAZY_SCREENS.AudioPlayer();
  LAZY_SCREENS.Profile();
}

const Stack = createNativeStackNavigator<RootStackParamList>();

// Navigation ref for imperative access from services (push taps, toasts).
// Defined in ./navigationRef so non-screen code can import it without a cycle.
export { navigationRef };

/** The focused root route's name, once the container is ready. */
function focusedRootRouteName(): string | undefined {
  const state = navigationRef.getRootState();
  return state?.routes[state.index ?? 0]?.name;
}

export const RootNavigator: React.FC = observer(() => {
  const route = getBootStore().route;
  const authStore = useAuth();
  const subscriptionStore = useSubscription();
  const previousAuthState = useRef(authStore.isAuthenticated);
  const T = useT();

  // A React Navigation theme that tracks the active palette, so the parts
  // React Navigation draws (backgrounds during transitions) never flash
  // another colour after a palette switch.
  const navTheme = useMemo(
    () => ({
      ...DarkTheme,
      dark: true,
      colors: {
        ...DarkTheme.colors,
        background: T.bg,
        card: T.bar,
        text: T.text,
        border: T.barLine,
        primary: T.action,
        notification: T.action,
      },
    }),
    [T],
  );

  const screenOptions = useMemo<NativeStackNavigationOptions>(
    () => ({ ...ROOT_SCREEN_OPTIONS, contentStyle: { backgroundColor: T.bg } }),
    [T],
  );

  // Read once, at mount: later changes of the boot route are resets (BootStore).
  const initialState = useMemo(
    () => (route ? { index: 0, routes: [bootRouteToState(route)] } : undefined),
    [route],
  );

  const userId = authStore.backendUser?.id ?? null;
  const userTier = authStore.backendUser?.subscriptionTier;

  // Push notifications: token registration follows the backend session;
  // foreground messages and taps are bridged to stores and navigation.
  usePushNotificationBridge(userId);

  // In-app purchases: the store connects for the signed-in user and sends
  // the purchases a previous run left unfinished to the backend.
  usePurchaseBridge(userId);

  // The tier from the backend user at once (the cached one on launch), again
  // whenever the user's tier changes.
  useEffect(() => {
    if (userId) {
      subscriptionStore.setTierFromUser(userTier);
    }
  }, [userId, userTier, subscriptionStore]);

  // /subscriptions/current for the authoritative plan once per signed-in
  // user: the cached user and the fresh one are two objects with one id.
  useEffect(() => {
    if (userId) {
      subscriptionStore.refresh().catch(err =>
        console.warn('Subscription refresh after auth failed:', err),
      );
    } else {
      subscriptionStore.reset();
    }
  }, [userId, subscriptionStore]);

  // Back to Login on sign-out AND on session expiry (ApiClient could not
  // refresh tokens, the auth store cleared both the Firebase and backend
  // user). Keyed on `isAuthenticated` so a session with a backend user but no
  // Firebase user is not left stuck on Main with every call failing.
  useEffect(() => {
    if (previousAuthState.current && !authStore.isAuthenticated) {
      // Filters, saved marks and the content language belong to the account.
      getDiscoverStore().reset();
      getContentLanguageStore().reset();
      if (navigationRef.isReady()) {
        navigationRef.reset({
          index: 0,
          routes: [{ name: 'Login' }],
        });
      }
    }
    previousAuthState.current = authStore.isAuthenticated;
  }, [authStore.isAuthenticated]);

  const onReady = useCallback(() => {
    // A push tap that arrived before the container existed runs now when the
    // boot route is Main, else once Main is in the stack (onStateChange).
    flushPendingNotificationOpen();
    // On the Onboarding route the splash waits for the first picture
    // (holdSplashForOnboardingPicture, started by the BootStore).
    if (focusedRootRouteName() !== 'Onboarding') {
      requestAnimationFrame(() => releaseSplash('first-route'));
    }
  }, []);

  // The boot route is not decided yet: the native splash is still up.
  if (!route) {
    return null;
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      initialState={initialState}
      onReady={onReady}
      onStateChange={flushPendingNotificationOpen}
    >
      <Stack.Navigator screenOptions={screenOptions}>
        {/* Gates and auth */}
        <Stack.Screen name="ForceUpdate" component={S.ForceUpdateScreen} options={ROUTE_OPTIONS.ForceUpdate} />
        <Stack.Screen name="Onboarding" component={S.OnboardingScreen} options={ROUTE_OPTIONS.Onboarding} />
        <Stack.Screen name="Login" component={S.LoginScreen} options={ROUTE_OPTIONS.Login} />
        <Stack.Screen
          name="Registration"
          getComponent={LAZY_SCREENS.Registration}
          options={ROUTE_OPTIONS.Registration}
        />

        {/* Main tabs */}
        <Stack.Screen name="Main" component={MainScaffold} options={ROUTE_OPTIONS.Main} />

        {/* Story */}
        <Stack.Screen
          name="StoryDetail"
          getComponent={LAZY_SCREENS.StoryDetail}
          options={ROUTE_OPTIONS.StoryDetail}
        />
        <Stack.Screen name="AllStories" getComponent={LAZY_SCREENS.AllStories} options={ROUTE_OPTIONS.AllStories} />

        {/* Collections */}
        <Stack.Screen
          name="Collections"
          getComponent={LAZY_SCREENS.Collections}
          options={ROUTE_OPTIONS.Collections}
        />
        <Stack.Screen
          name="CollectionDetail"
          getComponent={LAZY_SCREENS.CollectionDetail}
          options={ROUTE_OPTIONS.CollectionDetail}
        />

        {/* Voice creation modal flow */}
        <Stack.Group screenOptions={MODAL_GROUP_OPTIONS}>
          <Stack.Screen
            name="CreateVoiceProfile"
            getComponent={LAZY_SCREENS.CreateVoiceProfile}
            options={ROUTE_OPTIONS.CreateVoiceProfile}
          />
          <Stack.Screen
            name="VoiceConsent"
            getComponent={LAZY_SCREENS.VoiceConsent}
            options={ROUTE_OPTIONS.VoiceConsent}
          />
          <Stack.Screen
            name="VoiceRecording"
            getComponent={LAZY_SCREENS.VoiceRecording}
            options={ROUTE_OPTIONS.VoiceRecording}
          />
          <Stack.Screen
            name="VoiceSuccess"
            getComponent={LAZY_SCREENS.VoiceSuccess}
            options={ROUTE_OPTIONS.VoiceSuccess}
          />
          <Stack.Screen
            name="Processing"
            getComponent={LAZY_SCREENS.Processing}
            options={ROUTE_OPTIONS.Processing}
          />
        </Stack.Group>

        {/* Voice profile list (non-modal push) */}
        <Stack.Screen
          name="VoiceProfiles"
          getComponent={LAZY_SCREENS.VoiceProfiles}
          options={ROUTE_OPTIONS.VoiceProfiles}
        />
        <Stack.Screen
          name="NarratorCatalogue"
          getComponent={LAZY_SCREENS.NarratorCatalogue}
          options={ROUTE_OPTIONS.NarratorCatalogue}
        />

        {/* Audio */}
        <Stack.Screen
          name="AudioPlayer"
          getComponent={LAZY_SCREENS.AudioPlayer}
          options={ROUTE_OPTIONS.AudioPlayer}
        />
        <Stack.Screen
          name="AudioGeneration"
          getComponent={LAZY_SCREENS.AudioGeneration}
          options={ROUTE_OPTIONS.AudioGeneration}
        />

        {/* Profile / Settings / Subscription */}
        <Stack.Screen name="Profile" getComponent={LAZY_SCREENS.Profile} options={ROUTE_OPTIONS.Profile} />
        <Stack.Screen
          name="DataDeletion"
          getComponent={LAZY_SCREENS.DataDeletion}
          options={ROUTE_OPTIONS.DataDeletion}
        />
        <Stack.Screen
          name="Notifications"
          getComponent={LAZY_SCREENS.Notifications}
          options={ROUTE_OPTIONS.Notifications}
        />
        <Stack.Screen
          name="Subscription"
          getComponent={LAZY_SCREENS.Subscription}
          options={ROUTE_OPTIONS.Subscription}
        />

        {/* Utility */}
        <Stack.Screen name="NoInternet" component={S.NoInternetScreen} options={ROUTE_OPTIONS.NoInternet} />
      </Stack.Navigator>
      {/* App-wide hosts (audio session, queue end, sign-out cleanup). */}
      <RootHosts />
    </NavigationContainer>
  );
});
