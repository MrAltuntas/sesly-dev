/**
 * The launch (MobX singleton, `getBootStore()`), started on App's first
 * render.
 *
 * 1. One storage round trip (readBootSnapshot). A first launch starts the
 *    decode of the onboarding pictures right then, a returning user the
 *    read of the last narrator a story page starts with.
 * 2. In parallel: the stored UI language and palette are applied, then
 *    `uiReady` (App renders once that and the fonts are done); the AuthStore
 *    starts from the snapshot without being awaited (a cached user is in the
 *    store synchronously, before `route` is set).
 * 3. The first route is decided from local data (decideBootRoute): the
 *    cached /app/config, the tokens, the cached user, the onboarding flag.
 *    Only tokens without a cached user wait for the live session check, at
 *    most BOOT_RESTORE_TIMEOUT_MS, and a timeout counts as offline.
 * 4. After routing: connectivity, push (once Firebase is configured), the
 *    background /app/config refresh (again on app foreground when the last
 *    success is older than APP_CONFIG_STALE_MS), on Main the idle preload of
 *    the screens a first tap usually opens, on Onboarding the decode of its
 *    three pictures (src/boot/onboardingPictures.ts) and the splash hold
 *    for the first one. From then on `route` follows the root route (a
 *    re-created navigator starts there) and a required update holds the
 *    ForceUpdate gate.
 *
 * The native splash stays up until the navigator has drawn the route
 * (src/boot/splash.ts); nothing here waits for a fixed time.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { action, makeObservable, observable, when } from 'mobx';
import { AppState, type NativeEventSubscription } from 'react-native';

import { readBootSnapshot, type BootSnapshot } from './bootSnapshot';
import { holdSplashForOnboardingPicture } from './splash';
import { prefetchOnboardingPictures, releaseOnboardingPictures } from './onboardingPictures';
import { loadLastNarrator } from '../components/detail/lastNarrator';
import { bootRouteToState, decideBootRoute, type BootRoute } from './decideBootRoute';
import { getAuthStore } from '../hooks/useAuth';
import AuthService from '../services/AuthService';
import ApiClient from '../services/ApiClient';
import PushNotificationService from '../services/PushNotificationService';
import {
  evaluateForceUpdateForThisApp,
  parseStoredAppConfig,
  refreshAppConfig,
} from '../services/AppConfigService';
import type { ForceUpdateInfo } from '../models/AppConfig';
import { STORAGE_KEYS } from '../config/constants';
import { connectivityStore } from '../stores/ConnectivityStore';
import { navigationRef } from '../navigation/navigationRef';
import { initUiLanguage } from '../i18n';
import { startUiLanguageSync } from '../i18n/uiLanguageSync';
import { preloadStoredPalette } from '../theme/ThemeProvider';
import { configureErrorHandler } from '../utils/errorHandler';
import { snackbar } from '../components/design/Snackbar';

/** Tokens without a cached user wait this long for GET /users/me. */
export const BOOT_RESTORE_TIMEOUT_MS = 10000;

/** On app foreground the config is fetched again once it is this old. */
export const APP_CONFIG_STALE_MS = 6 * 60 * 60 * 1000;

/** After a Main boot, the likely next screens load this much later. */
export const SCREEN_PRELOAD_DELAY_MS = 1500;

const OFFLINE_ROUTE: BootRoute = { name: 'NoInternet', params: { reason: 'offline' } };

/**
 * A focused root route as a route a fresh navigator can start on; null for
 * the routes that sit on top of one (a story, the player, settings).
 */
function asBootRoute(name: string, params: object | undefined): BootRoute | null {
  const p = (params ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'Main':
      return { name: 'Main' };
    case 'Onboarding':
      return { name: 'Onboarding' };
    case 'Login':
      return p.firstRun === true ? { name: 'Login', params: { firstRun: true } } : { name: 'Login' };
    case 'NoInternet':
      return {
        name: 'NoInternet',
        params: { reason: p.reason === 'server' || p.reason === 'maintenance' ? p.reason : 'offline' },
      };
    case 'ForceUpdate':
      return typeof p.message === 'string'
        ? {
            name: 'ForceUpdate',
            params: { message: p.message, storeUrl: typeof p.storeUrl === 'string' ? p.storeUrl : null },
          }
        : null;
    default:
      return null;
  }
}

function sameBootRoute(a: BootRoute | null, b: BootRoute): boolean {
  return a !== null && JSON.stringify(bootRouteToState(a)) === JSON.stringify(bootRouteToState(b));
}

type PrivateFields = 'setRoute' | 'markUiReady';

/** Error messages of the shared error handler go to the snackbar. */
function configureAppErrorHandler(): void {
  configureErrorHandler({
    showNotification: (error, type) => {
      if (type === 'error') {
        snackbar.show({ message: error.message || error.title || '', tone: 'error' });
      }
    },
  });
}

export class BootStore {
  /** The stored UI language and palette are applied. */
  uiReady = false;
  /** The route the navigator mounts on; null until decided. */
  route: BootRoute | null = null;

  private running: Promise<void> | null = null;
  private snapshot: BootSnapshot | null = null;
  private refreshing: Promise<void> | null = null;
  private lastConfigRefreshAt = Number.NEGATIVE_INFINITY;
  // The update the last config (stored or fetched) requires; while set, no
  // navigation leaves ForceUpdate (see followRootRoute).
  private requiredUpdate: ForceUpdateInfo | null = null;
  private appStateSubscription: NativeEventSubscription | null = null;
  private stopFollowingRoot: (() => void) | null = null;
  private preloadTimer: ReturnType<typeof setTimeout> | null = null;
  private prefetchedOnboarding = false;

  constructor() {
    makeObservable<BootStore, PrivateFields>(this, {
      uiReady: observable,
      route: observable.ref,
      setRoute: action,
      markUiReady: action,
    });
  }

  /**
   * Runs the launch once; later calls share it. Resolves when the route is
   * set and the UI is ready. Never rejects.
   */
  start(): Promise<void> {
    if (!this.running) {
      this.running = this.run().catch(error => {
        // Every step guards itself; this is the last line, so the app never
        // stays on the native splash because of a bug here.
        console.error('[boot] launch failed:', error);
        if (!this.uiReady) {
          this.markUiReady();
        }
        if (!this.route) {
          // Never sign a user out because of the app's own error.
          const snap = this.snapshot;
          this.setRoute(
            snap?.hasTokens
              ? { name: 'NoInternet', params: { reason: 'server' } }
              : snap?.hasSeenOnboarding
                ? { name: 'Login' }
                : { name: 'Onboarding' },
          );
        }
      });
    }
    return this.running;
  }

  private setRoute(route: BootRoute): void {
    this.route = route;
  }

  private markUiReady(): void {
    this.uiReady = true;
  }

  private async run(): Promise<void> {
    configureAppErrorHandler();

    const snap = await readBootSnapshot();
    this.snapshot = snap;

    // A first launch goes to Onboarding (unless an update is required): its
    // first picture starts decoding before anything else runs, so it is
    // ready when the splash goes (ONB-PIC-LATE).
    if (!snap.hasTokens && !snap.hasSeenOnboarding) this.prefetchOnboarding();
    // A returning user's story page picks the last narrator on its first
    // frame: read it now, not when the first story opens (RB-2).
    if (snap.hasTokens) void loadLastNarrator();

    const ui = this.applyUi(snap);
    this.startSession(snap);

    this.requiredUpdate = evaluateForceUpdateForThisApp(parseStoredAppConfig(snap.appConfigRaw));
    const route = await this.resolveRoute(this.requiredUpdate, snap.hasTokens, snap.hasSeenOnboarding);
    this.setRoute(route);
    this.afterRoute(route);

    await ui;
  }

  /**
   * Language and palette from the snapshot, then `uiReady`; from then on the
   * backend hears the UI language of every session. Never throws.
   */
  private async applyUi(snap: BootSnapshot): Promise<void> {
    try {
      await Promise.all([initUiLanguage(snap.uiLanguage), preloadStoredPalette(snap.palette)]);
    } catch (error) {
      console.warn('[boot] applying the stored language or palette failed:', error);
    } finally {
      this.markUiReady();
      startUiLanguageSync();
    }
  }

  /**
   * The AuthStore starts from the snapshot (not awaited: its first step puts
   * a cached user in the store synchronously). Push listeners attach once
   * Firebase is configured (AuthService.initialize is shared with the
   * AuthStore), in a detached block nothing waits for.
   */
  private startSession(snap: BootSnapshot): void {
    getAuthStore()
      .initialize({ hasTokens: snap.hasTokens, cachedUserRaw: snap.cachedUserRaw })
      .catch(error => {
        console.warn('[boot] auth initialization failed:', error);
      });

    void (async () => {
      try {
        await AuthService.initialize();
      } catch {
        // The AuthStore logs this; push still attaches its listeners.
      }
      try {
        PushNotificationService.initialize();
      } catch (error) {
        console.warn('[boot] push setup failed:', error);
      }
    })();
  }

  /**
   * decideBootRoute with the live auth state. A `'wait'` waits for the
   * session check (at most BOOT_RESTORE_TIMEOUT_MS; a timeout is offline).
   */
  private async resolveRoute(
    forceUpdate: ForceUpdateInfo | null,
    hasTokens: boolean,
    hasSeenOnboarding: boolean,
  ): Promise<BootRoute> {
    const auth = getAuthStore();
    const decide = () =>
      decideBootRoute({
        forceUpdate,
        hasTokens,
        hasCachedUser: auth.backendUser !== null,
        restore: auth.restoreOutcome,
        hasSeenOnboarding,
      });

    const first = decide();
    if (first !== 'wait') {
      return first;
    }
    try {
      await when(() => auth.restoreOutcome !== 'pending', { timeout: BOOT_RESTORE_TIMEOUT_MS });
    } catch {
      console.warn('[boot] the session check did not answer in time; showing the offline state');
      return OFFLINE_ROUTE;
    }
    const settled = decide();
    return settled === 'wait' ? OFFLINE_ROUTE : settled;
  }

  private afterRoute(route: BootRoute): void {
    this.followRootRoute();
    connectivityStore.start();
    this.watchAppState();
    void this.refreshConfig();
    if (route.name === 'Main') {
      this.schedulePreload();
    }
    if (route.name === 'Onboarding') {
      // Started right after the snapshot; a no-op then, else before the
      // navigator mounts, so the decode runs while it does.
      this.prefetchOnboarding();
      this.holdSplashOnceReady();
    } else if (this.prefetchedOnboarding) {
      // Decoded for a first launch that went elsewhere (a required update).
      releaseOnboardingPictures();
    }
  }

  /** Decodes the onboarding pictures ahead (once per launch). Never throws. */
  private prefetchOnboarding(): void {
    if (this.prefetchedOnboarding) return;
    this.prefetchedOnboarding = true;
    try {
      prefetchOnboardingPictures();
    } catch (error) {
      console.warn('[boot] onboarding picture prefetch failed:', error);
    }
  }

  /**
   * `route` follows the root route the user is on (sign-in, sign-out, a
   * gate). On Android the activity can be re-created while the JS runtime
   * lives on (the font size or the language changed in the background); App
   * then mounts a new navigator on `route`, and a launch route would put a
   * signed-out user on Main or a signed-in one back on Login. Subscribed
   * before the container mounts (the route was just decided), so the ref
   * keeps the listener and attaches it to a re-created container too.
   *
   * It also holds the force-update gate: while an update is required,
   * whatever navigates away (the session-end reset to Login, a sign-in going
   * on to Main) is reset back to ForceUpdate.
   */
  private followRootRoute(): void {
    if (this.stopFollowingRoot) {
      return;
    }
    this.stopFollowingRoot = navigationRef.addListener('state', () => {
      if (!navigationRef.isReady()) {
        return;
      }
      const state = navigationRef.getRootState();
      const focused = state?.routes[state.index];
      if (this.requiredUpdate && focused && focused.name !== 'ForceUpdate') {
        const gate = bootRouteToState({ name: 'ForceUpdate', params: this.requiredUpdate });
        navigationRef.reset({ index: 0, routes: [gate] });
        return;
      }
      const next = focused ? asBootRoute(focused.name, focused.params as object | undefined) : null;
      if (next && !sameBootRoute(this.route, next)) {
        this.setRoute(next);
      }
    });
  }

  /**
   * RootNavigator leaves the splash up on the Onboarding route; the hold
   * (first picture or ONBOARDING_PICTURE_HOLD_MS) starts once the navigator
   * has drawn it, so the screen's onLoad is not the only way out.
   */
  private holdSplashOnceReady(): void {
    if (navigationRef.isReady()) {
      void holdSplashForOnboardingPicture();
      return;
    }
    const off = navigationRef.addListener('ready', () => {
      off();
      void holdSplashForOnboardingPicture();
    });
  }

  // ==========================================================================
  // Force update in the background
  // ==========================================================================

  /**
   * GET /app/config now (single-flight). An update required sends the app to
   * ForceUpdate; a stale stored gate the backend no longer asks for is
   * lifted. A failed fetch changes nothing.
   */
  refreshConfig(): Promise<void> {
    if (!this.refreshing) {
      const run = this.runConfigRefresh();
      this.refreshing = run;
      const release = () => {
        if (this.refreshing === run) {
          this.refreshing = null;
        }
      };
      run.then(release, release);
    }
    return this.refreshing;
  }

  private async runConfigRefresh(): Promise<void> {
    let update: ForceUpdateInfo | null;
    try {
      update = await refreshAppConfig();
    } catch (error) {
      console.warn('[boot] app config refresh failed; keeping the current gate:', error);
      return;
    }
    this.lastConfigRefreshAt = Date.now();
    this.requiredUpdate = update;

    if (update) {
      // Also when ForceUpdate is up with an older sentence or link (the
      // stored config had no App Store link yet, the backend has one now).
      const gate: BootRoute = { name: 'ForceUpdate', params: update };
      if (!this.isShowing(gate)) {
        this.goTo(gate);
      }
      return;
    }
    if (this.currentRootRouteName() !== 'ForceUpdate') {
      return;
    }
    // The stored config asked for an update the backend no longer requires.
    // Tokens and the onboarding flag are read again: either may have changed
    // since the launch (onboarding finished, a sign-out).
    let hasTokens = false;
    try {
      hasTokens = await ApiClient.hasValidTokens();
    } catch (error) {
      console.warn('[boot] reading the stored tokens failed:', error);
    }
    let hasSeenOnboarding = this.snapshot?.hasSeenOnboarding ?? false;
    try {
      hasSeenOnboarding = (await AsyncStorage.getItem(STORAGE_KEYS.HAS_SEEN_ONBOARDING)) === 'true';
    } catch (error) {
      console.warn('[boot] reading the onboarding flag failed:', error);
    }
    const next = await this.resolveRoute(null, hasTokens, hasSeenOnboarding);
    if (this.currentRootRouteName() === 'ForceUpdate') {
      this.goTo(next);
    }
  }

  private watchAppState(): void {
    if (this.appStateSubscription) {
      return;
    }
    try {
      this.appStateSubscription = AppState.addEventListener('change', state => {
        if (state === 'active' && Date.now() - this.lastConfigRefreshAt >= APP_CONFIG_STALE_MS) {
          void this.refreshConfig();
        }
      });
    } catch (error) {
      console.warn('[boot] AppState listener unavailable:', error);
    }
  }

  /** The focused root route: the navigator's once it is ready, else the boot route. */
  private currentRootRoute(): { name: string; params?: object } | null {
    if (navigationRef.isReady()) {
      const state = navigationRef.getRootState();
      const focused = state?.routes[state.index];
      if (focused) {
        return { name: focused.name, params: focused.params as object | undefined };
      }
    }
    return this.route ? bootRouteToState(this.route) : null;
  }

  private currentRootRouteName(): string | null {
    return this.currentRootRoute()?.name ?? null;
  }

  /** Whether `route` is on screen (for ForceUpdate: with the same sentence and link). */
  private isShowing(route: BootRoute): boolean {
    const current = this.currentRootRoute();
    if (!current || current.name !== route.name) {
      return false;
    }
    if (route.name !== 'ForceUpdate') {
      return true;
    }
    const shown = (current.params ?? {}) as Partial<ForceUpdateInfo>;
    return shown.message === route.params.message && (shown.storeUrl ?? null) === route.params.storeUrl;
  }

  /** Replaces the whole stack with `route`. */
  private goTo(route: BootRoute): void {
    const state = bootRouteToState(route);
    if (navigationRef.isReady()) {
      navigationRef.reset({ index: 0, routes: [state] });
      return;
    }
    // Not mounted yet: the navigator mounts on this route instead. If it is
    // mounting on the previous one right now, it is reset once ready.
    this.setRoute(route);
    const off = navigationRef.addListener('ready', () => {
      off();
      if (!this.isShowing(route)) {
        navigationRef.reset({ index: 0, routes: [state] });
      }
    });
  }

  // ==========================================================================
  // Idle preload
  // ==========================================================================

  private schedulePreload(): void {
    if (this.preloadTimer !== null) {
      return;
    }
    this.preloadTimer = setTimeout(() => {
      this.preloadTimer = null;
      try {
        // Required here: RootNavigator imports this store.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const navigator = require('../navigation/RootNavigator') as {
          preloadLikelyScreens?: () => void;
        };
        navigator.preloadLikelyScreens?.();
      } catch (error) {
        console.warn('[boot] screen preload failed:', error);
      }
    }, SCREEN_PRELOAD_DELAY_MS);
  }

  /** Test and teardown helper: drops the listeners and timers. */
  stop(): void {
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.stopFollowingRoot?.();
    this.stopFollowingRoot = null;
    if (this.preloadTimer !== null) {
      clearTimeout(this.preloadTimer);
      this.preloadTimer = null;
    }
  }
}

let bootStore: BootStore | null = null;

export function getBootStore(): BootStore {
  if (!bootStore) {
    bootStore = new BootStore();
  }
  return bootStore;
}
