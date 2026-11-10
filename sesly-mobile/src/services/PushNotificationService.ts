/**
 * Push Notification Service (FCM via @react-native-firebase/messaging)
 *
 * Device side of the backend push contract:
 *   POST /notifications/register   { token, platform: 'ios' | 'android' }  (idempotent)
 *   POST /notifications/unregister { token }  (sign-out, with the JWT read before it was cleared)
 *
 * Rules:
 *  - Never blocks auth: every native/network call is caught and time-boxed.
 *  - Never prompts on its own. The system dialog is shown only by
 *    `ensurePushPermission()` (first story generation / voice clone) or by an
 *    explicit tap in Settings. A denied permission is never asked again; the
 *    Settings screen offers the system settings page instead.
 *  - UI work (toast, store refresh, navigation) is injected with
 *    `setHandlers()`, so this file does not import screens or stores.
 *
 * Android: messages arrive on channel `sesly-default`, created natively in
 * MainApplication.kt. No expo-notifications / notifee (conflicts with the
 * RNFirebase messaging service).
 */

import {
  AppState,
  AppStateStatus,
  Linking,
  NativeEventSubscription,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AuthorizationStatus,
  deleteToken,
  getAPNSToken,
  getInitialNotification,
  getMessaging,
  getToken,
  hasPermission,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
  setBackgroundMessageHandler,
} from '@react-native-firebase/messaging';
import type { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import ApiClient from './ApiClient';
import { PushPayload, parsePushPayload } from '../models/Notification';

type Messaging = FirebaseMessagingTypes.Module;
type RemoteMessage = FirebaseMessagingTypes.RemoteMessage;

/** iOS: how long the FCM token waits for the APNs token after a permission grant. */
export const APNS_TOKEN_WAIT_MS = 3000;
const APNS_TOKEN_POLL_MS = 250;

/**
 * The FCM token. On iOS FCM needs the APNs device token first, which arrives
 * a moment after the permission grant; asking before it is there fails with
 * "No APNS token", so wait for it (briefly) and ask once it is set.
 */
async function fetchFcmToken(messaging: Messaging): Promise<string> {
  if (Platform.OS === 'ios') {
    const deadline = Date.now() + APNS_TOKEN_WAIT_MS;
    while (!(await getAPNSToken(messaging).catch(() => null)) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, APNS_TOKEN_POLL_MS));
    }
  }
  return getToken(messaging);
}

export type PushPermissionStatus = 'granted' | 'denied' | 'undetermined';

export interface PushHandlers {
  /** A message arrived while the app is in the foreground (no system banner). */
  onForegroundMessage?: (payload: PushPayload) => void;
  /** The user tapped a notification (from background or a cold start). */
  onNotificationOpened?: (payload: PushPayload) => void;
}

/** Set once the in-context prompt has been shown; we never nag after that. */
export const PUSH_PROMPTED_STORAGE_KEY = 'push_permission_prompted';

const REGISTER_TIMEOUT_MS = 5000;
const UNREGISTER_TIMEOUT_MS = 4000;
const DELETE_TOKEN_TIMEOUT_MS = 3000;

/** Android 13 (API 33) introduced the POST_NOTIFICATIONS runtime permission. */
const ANDROID_POST_NOTIFICATIONS_API = 33;

// ============================================================================
// Pure helpers
// ============================================================================

/**
 * Map the platform permission reading to the three states the UI cares about.
 * `authStatus` is a messaging AuthorizationStatus (Android: 1 when the app's
 * notifications are enabled, 0 otherwise); null when it could not be read.
 * Android has no "not determined" state, so before the first in-context
 * prompt on Android 13+ "off" reads as undetermined.
 */
export function resolvePushPermissionStatus(
  authStatus: number | null,
  platform: string,
  androidApiLevel: number,
  prompted: boolean,
): PushPermissionStatus {
  if (platform === 'android') {
    if (authStatus === AuthorizationStatus.AUTHORIZED) return 'granted';
    if (androidApiLevel >= ANDROID_POST_NOTIFICATIONS_API && !prompted) {
      return 'undetermined';
    }
    return authStatus === null ? 'undetermined' : 'denied';
  }
  switch (authStatus) {
    case AuthorizationStatus.AUTHORIZED:
    case AuthorizationStatus.PROVISIONAL:
    case AuthorizationStatus.EPHEMERAL:
      return 'granted';
    case AuthorizationStatus.DENIED:
      return 'denied';
    default:
      return 'undetermined';
  }
}

export function getDevicePlatform(): 'ios' | 'android' {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

function androidApiLevel(): number {
  if (Platform.OS !== 'android') return 0;
  const version = Platform.Version;
  return typeof version === 'number' ? version : parseInt(String(version), 10) || 0;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// ============================================================================
// Service
// ============================================================================

class PushNotificationService {
  private static instance: PushNotificationService;

  private initialized = false;
  private sessionActive = false;
  private registeredToken: string | null = null;
  private registerInFlight: Promise<void> | null = null;
  // The sign-out's unregister and token delete; a new registration waits for it.
  private unregisterInFlight: Promise<void> | null = null;
  private handlers: PushHandlers = {};
  private pendingOpened: PushPayload | null = null;
  private lastOpenedKey: string | null = null;
  private unsubscribers: Array<() => void> = [];
  private appStateSub: NativeEventSubscription | null = null;
  private messagingUnavailableLogged = false;

  private constructor() {}

  public static getInstance(): PushNotificationService {
    if (!PushNotificationService.instance) {
      PushNotificationService.instance = new PushNotificationService();
    }
    return PushNotificationService.instance;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Attach FCM listeners and read the notification that cold-started the app.
   * Idempotent. Does not ask for permission and does not register a token.
   */
  public initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    const messaging = this.getMessagingInstance();
    if (messaging) {
      try {
        this.unsubscribers.push(
          onMessage(messaging, message => this.handleForegroundMessage(message)),
          onNotificationOpenedApp(messaging, message =>
            this.handleOpenedMessage(message),
          ),
          onTokenRefresh(messaging, token => {
            this.handleTokenRefresh(token).catch(() => {});
          }),
        );
      } catch (error) {
        console.warn('[Push] listener setup failed:', error);
      }

      getInitialNotification(messaging)
        .then(message => {
          if (message) this.handleOpenedMessage(message);
        })
        .catch(error => console.warn('[Push] getInitialNotification failed:', error));
    }

    // Permission may be granted from the system settings while the app is in
    // the background: register as soon as the user comes back.
    this.appStateSub = AppState.addEventListener('change', this.handleAppStateChange);
  }

  /**
   * Inject the UI side. An opened notification that arrived before the
   * handlers existed (cold start) is delivered immediately.
   */
  public setHandlers(handlers: PushHandlers): () => void {
    this.handlers = handlers;
    if (this.pendingOpened && handlers.onNotificationOpened) {
      const payload = this.pendingOpened;
      this.pendingOpened = null;
      this.safeCall(() => handlers.onNotificationOpened?.(payload));
    }
    return () => {
      if (this.handlers === handlers) this.handlers = {};
    };
  }

  /** Test/teardown helper. */
  public dispose(): void {
    this.unsubscribers.forEach(unsubscribe => {
      try {
        unsubscribe();
      } catch {
        // ignore
      }
    });
    this.unsubscribers = [];
    this.appStateSub?.remove();
    this.appStateSub = null;
    this.initialized = false;
    this.sessionActive = false;
    this.registeredToken = null;
    this.registerInFlight = null;
    this.unregisterInFlight = null;
    this.handlers = {};
    this.pendingOpened = null;
    this.lastOpenedKey = null;
  }

  // ==========================================================================
  // Session (called by the navigator when the backend user appears/disappears)
  // ==========================================================================

  /**
   * A backend session exists (fresh login or restored on app start). Registers
   * the FCM token when permission is already granted; never prompts.
   */
  public async onSessionStarted(): Promise<void> {
    this.sessionActive = true;
    await this.registerIfPermitted();
  }

  /**
   * The backend session is gone. After an explicit sign-out `unregisterDevice`
   * already ran; after a session expiry the JWT is gone, so the best we can do
   * is invalidate the token locally (the backend prunes it on the next send).
   * No-op when no session was started in this app run (cold start).
   */
  public onSessionEnded(): void {
    if (!this.sessionActive && !this.registeredToken) return;
    this.sessionActive = false;
    this.pendingOpened = null;
    const hadToken = this.registeredToken !== null;
    this.registeredToken = null;
    if (hadToken) {
      this.deleteLocalToken().catch(() => {});
    }
  }

  /**
   * Sign-out: POST /notifications/unregister with the token, then delete the
   * token so this device stops receiving the old user's pushes.
   *
   * The session state is taken synchronously, at the call: the sign-out
   * does not wait for the rest and ends the local session at once. The POST
   * carries `accessToken`, the JWT the sign-out read before it cleared the
   * stored tokens (no POST without one), outside the ApiClient interceptors:
   * a 401 neither refreshes nor ends a session started meanwhile. A new
   * session registers only after this has finished, so its token is never
   * the one being deleted here. Never throws; every step is time-boxed.
   */
  public unregisterDevice(accessToken: string | null): Promise<void> {
    this.sessionActive = false;
    this.pendingOpened = null;
    const registered = this.registeredToken;
    this.registeredToken = null;

    const run = this.runUnregister(registered, accessToken);
    this.unregisterInFlight = run;
    const release = () => {
      if (this.unregisterInFlight === run) this.unregisterInFlight = null;
    };
    run.then(release, release);
    return run;
  }

  private async runUnregister(registered: string | null, accessToken: string | null): Promise<void> {
    const messaging = this.getMessagingInstance();
    if (!messaging) return;

    let token = registered;
    if (!token && accessToken) {
      // Not registered in this run (e.g. offline at start). Only ask FCM for
      // the token when we could have registered it in the first place.
      try {
        if ((await this.getPermissionStatus()) === 'granted') {
          token = await withTimeout(fetchFcmToken(messaging), REGISTER_TIMEOUT_MS, 'getToken');
        }
      } catch (error) {
        console.warn('[Push] token lookup for unregister failed:', error);
      }
    }

    if (token && accessToken) {
      try {
        await withTimeout(
          ApiClient.postDetached('/notifications/unregister', { token }, accessToken, {
            timeout: UNREGISTER_TIMEOUT_MS,
          }),
          UNREGISTER_TIMEOUT_MS,
          'unregister',
        );
      } catch (error) {
        console.warn('[Push] unregister failed:', error);
      }
    }

    await this.deleteLocalToken();
  }

  // ==========================================================================
  // Permission
  // ==========================================================================

  public async getPermissionStatus(): Promise<PushPermissionStatus> {
    const [authStatus, prompted] = await Promise.all([
      this.readAuthorizationStatus(),
      this.wasPrompted(),
    ]);
    return resolvePushPermissionStatus(authStatus, Platform.OS, androidApiLevel(), prompted);
  }

  /**
   * In-context permission ask (first story generation / voice clone).
   * Shows the system dialog at most once per install; afterwards it only
   * reports the current state. Registers the token when granted.
   * Never throws.
   */
  public async ensurePermission(): Promise<boolean> {
    try {
      const status = await this.getPermissionStatus();
      if (status === 'granted') {
        this.registerIfPermitted().catch(() => {});
        return true;
      }
      if (status === 'denied') return false;
      if (await this.wasPrompted()) return false;

      await this.markPrompted();
      const granted = await this.requestSystemPermission();
      if (granted) {
        this.registerIfPermitted().catch(() => {});
      }
      return granted;
    } catch (error) {
      console.warn('[Push] ensurePermission failed:', error);
      return false;
    }
  }

  /**
   * Explicit request from Settings. Undetermined: show the system dialog.
   * Denied: open the app's system settings page (the OS will not show the
   * dialog again). Returns the resulting status.
   */
  public async requestPermissionFromSettings(): Promise<PushPermissionStatus> {
    try {
      const status = await this.getPermissionStatus();
      if (status === 'granted') {
        this.registerIfPermitted().catch(() => {});
        return 'granted';
      }
      if (status === 'undetermined') {
        await this.markPrompted();
        const granted = await this.requestSystemPermission();
        if (granted) {
          this.registerIfPermitted().catch(() => {});
          return 'granted';
        }
        return 'denied';
      }
      await this.openSystemSettings();
      return 'denied';
    } catch (error) {
      console.warn('[Push] requestPermissionFromSettings failed:', error);
      return 'denied';
    }
  }

  public async openSystemSettings(): Promise<void> {
    try {
      await Linking.openSettings();
    } catch (error) {
      console.warn('[Push] openSettings failed:', error);
    }
  }

  // ==========================================================================
  // Internals: registration
  // ==========================================================================

  private async registerIfPermitted(explicitToken?: string): Promise<void> {
    if (!this.sessionActive) return;
    if (this.registerInFlight) {
      await this.registerInFlight;
      if (!explicitToken || explicitToken === this.registeredToken) return;
    }

    const run = async (): Promise<void> => {
      try {
        // The previous session's sign-out still deletes the device token:
        // registering before it ends would hand the backend a token that is
        // about to die (never rejects).
        if (this.unregisterInFlight) {
          await this.unregisterInFlight;
          if (!this.sessionActive) return;
        }
        const status = await this.getPermissionStatus();
        if (status !== 'granted' || !this.sessionActive) return;

        const messaging = this.getMessagingInstance();
        if (!messaging) return;

        const token =
          explicitToken ??
          (await withTimeout(fetchFcmToken(messaging), REGISTER_TIMEOUT_MS, 'getToken'));
        if (!token || !this.sessionActive) return;
        if (token === this.registeredToken) return;

        await withTimeout(
          ApiClient.post('/notifications/register', {
            token,
            platform: getDevicePlatform(),
          }),
          REGISTER_TIMEOUT_MS,
          'register',
        );
        if (this.sessionActive) {
          this.registeredToken = token;
        } else {
          // The session ended while the POST was in flight: onSessionEnded
          // saw no registered token, but the backend now has it for the old
          // user. Without a JWT we cannot unregister, so invalidate the token
          // locally (the backend prunes it on the next send).
          await this.deleteLocalToken().catch(() => {});
        }
      } catch (error) {
        // iOS without APNs (simulator, missing capability) lands here too.
        console.warn('[Push] register failed:', error);
      }
    };

    const promise = run();
    this.registerInFlight = promise;
    try {
      await promise;
    } finally {
      if (this.registerInFlight === promise) this.registerInFlight = null;
    }
  }

  private async handleTokenRefresh(token: string): Promise<void> {
    if (!this.sessionActive || !token || token === this.registeredToken) return;
    await this.registerIfPermitted(token);
  }

  private handleAppStateChange = (next: AppStateStatus): void => {
    if (next !== 'active') return;
    if (!this.sessionActive || this.registeredToken) return;
    this.registerIfPermitted().catch(() => {});
  };

  private async deleteLocalToken(): Promise<void> {
    const messaging = this.getMessagingInstance();
    if (!messaging) return;
    try {
      await withTimeout(deleteToken(messaging), DELETE_TOKEN_TIMEOUT_MS, 'deleteToken');
    } catch (error) {
      console.warn('[Push] deleteToken failed:', error);
    }
  }

  // ==========================================================================
  // Internals: permission
  // ==========================================================================

  private async readAuthorizationStatus(): Promise<number | null> {
    const messaging = this.getMessagingInstance();
    if (messaging) {
      try {
        return await hasPermission(messaging);
      } catch (error) {
        console.warn('[Push] hasPermission failed:', error);
      }
    }
    if (Platform.OS === 'android') {
      if (androidApiLevel() < ANDROID_POST_NOTIFICATIONS_API) {
        return AuthorizationStatus.AUTHORIZED;
      }
      try {
        const granted = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
        return granted ? AuthorizationStatus.AUTHORIZED : AuthorizationStatus.DENIED;
      } catch {
        return null;
      }
    }
    return null;
  }

  private async requestSystemPermission(): Promise<boolean> {
    try {
      if (Platform.OS === 'android') {
        if (androidApiLevel() < ANDROID_POST_NOTIFICATIONS_API) {
          // No runtime permission below Android 13: enabled unless the user
          // turned notifications off for the app.
          return (await this.getPermissionStatus()) === 'granted';
        }
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
        return result === PermissionsAndroid.RESULTS.GRANTED;
      }
      const messaging = this.getMessagingInstance();
      if (!messaging) return false;
      const status = await requestPermission(messaging);
      return (
        status === AuthorizationStatus.AUTHORIZED ||
        status === AuthorizationStatus.PROVISIONAL
      );
    } catch (error) {
      console.warn('[Push] permission request failed:', error);
      return false;
    }
  }

  private async wasPrompted(): Promise<boolean> {
    try {
      return (await AsyncStorage.getItem(PUSH_PROMPTED_STORAGE_KEY)) === '1';
    } catch {
      return false;
    }
  }

  private async markPrompted(): Promise<void> {
    try {
      await AsyncStorage.setItem(PUSH_PROMPTED_STORAGE_KEY, '1');
    } catch {
      // ignore: worst case we may ask once more
    }
  }

  // ==========================================================================
  // Internals: incoming messages
  // ==========================================================================

  private handleForegroundMessage(message: RemoteMessage): void {
    const payload = parsePushPayload(message);
    if (!payload) return;
    this.safeCall(() => this.handlers.onForegroundMessage?.(payload));
  }

  private handleOpenedMessage(message: RemoteMessage): void {
    const payload = parsePushPayload(message);
    if (!payload) return;

    // getInitialNotification and onNotificationOpenedApp can both report the
    // same tap (Android activity re-creation): act once.
    const key = message.messageId ?? payload.notificationId;
    if (key && key === this.lastOpenedKey) return;
    this.lastOpenedKey = key ?? null;

    const handler = this.handlers.onNotificationOpened;
    if (handler) {
      this.safeCall(() => handler(payload));
    } else {
      this.pendingOpened = payload;
    }
  }

  private safeCall(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      console.warn('[Push] handler failed:', error);
    }
  }

  private getMessagingInstance(): Messaging | null {
    try {
      return getMessaging();
    } catch (error) {
      if (!this.messagingUnavailableLogged) {
        this.messagingUnavailableLogged = true;
        console.warn('[Push] Firebase messaging unavailable:', error);
      }
      return null;
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

const pushNotificationService = PushNotificationService.getInstance();

export default pushNotificationService;
export { PushNotificationService };

/**
 * Ask for notification permission in context: call it when the user starts a
 * story generation or a voice clone. Shows the system dialog only the first
 * time; never throws; resolves true when notifications are allowed.
 */
export function ensurePushPermission(): Promise<boolean> {
  return pushNotificationService.ensurePermission();
}

/**
 * Must run at module scope in index.ts, before the root component is
 * registered (RNFirebase requirement for background / quit-state messages).
 * Our messages carry a `notification` block, so the OS shows them; data is
 * re-read from the backend when the user opens the app.
 */
export function registerBackgroundMessageHandler(): void {
  try {
    setBackgroundMessageHandler(getMessaging(), async message => {
      console.log('[Push] background message:', message.data?.type ?? 'unknown');
    });
  } catch (error) {
    console.warn('[Push] background handler registration failed:', error);
  }
}
