/**
 * WebSocket Service
 *
 * Singleton wrapper around `socket.io-client` that connects to the backend
 * `/notifications` namespace with a JWT handshake. Used for realtime updates:
 *
 *   - `voice_status`     → voice profile training progress / final READY/FAILED
 *   - `narration_status` → narration generation progress / final READY/FAILED
 *   - `notification`     → new in-app notification inserted server-side
 *
 * Polling fallbacks (the voice-profile status tracker in useVoiceProfile and
 * `useAudioPlayer.pollAudioStatus`) stay in place; this service is additive.
 * When a WebSocket event arrives we patch store state directly so the UI
 * reacts immediately, but we never disable the polling fallback.
 */

import {io, Socket} from 'socket.io-client';
import {runInAction} from 'mobx';
import {AppState, AppStateStatus, NativeEventSubscription} from 'react-native';
import {API_CONFIG} from '../config/constants';
import {VoiceProfileStatus, AudioGenerationStatus} from '../types/enums';
import {getNotificationsStore} from '../hooks/useNotifications';
import {parseNotificationFromJSON} from '../models/Notification';
import ApiClient from './ApiClient';

// ============================================================================
// Event Payload Types
// ============================================================================

export interface VoiceStatusEvent {
  /** Null only for legacy FAILED payloads that did not carry the id. */
  voiceProfileId: string | null;
  status: VoiceProfileStatus;
  errorMessage: string | null;
}

/**
 * Pure parser for `voice_status` payloads.
 *   READY  -> { voiceProfileId, status: 'READY' }
 *   FAILED -> { voiceProfileId, status: 'FAILED', errorMessage }
 * Older backends sent FAILED as `{ status, reason }` without an id; that is
 * still accepted (voiceProfileId null) so the caller can fall back to a
 * refresh instead of leaving the UI in "processing".
 */
export function parseVoiceStatusPayload(payload: unknown): VoiceStatusEvent | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const data = payload as Record<string, unknown>;
  const voiceProfileId =
    typeof data.voiceProfileId === 'string' && data.voiceProfileId
      ? data.voiceProfileId
      : typeof data.id === 'string' && data.id
        ? data.id
        : null;
  const rawStatus =
    typeof data.status === 'string' ? data.status.toUpperCase() : null;
  if (!rawStatus) {
    return null;
  }
  const status = coerceVoiceStatus(rawStatus);
  if (!voiceProfileId && status !== VoiceProfileStatus.FAILED) {
    return null;
  }
  const errorMessage =
    typeof data.errorMessage === 'string' && data.errorMessage
      ? data.errorMessage
      : typeof data.reason === 'string' && data.reason
        ? data.reason
        : null;
  return {voiceProfileId, status, errorMessage};
}

function coerceVoiceStatus(raw: string): VoiceProfileStatus {
  switch (raw) {
    case 'READY':
      return VoiceProfileStatus.READY;
    case 'FAILED':
      return VoiceProfileStatus.FAILED;
    case 'PROCESSING':
    case 'TRAINING':
      return VoiceProfileStatus.PROCESSING;
    case 'PENDING':
    default:
      return VoiceProfileStatus.PENDING;
  }
}

// Optional hooks that the WebSocket service can call into. We keep the types
// narrow so WebSocketService never imports the concrete MobX stores directly
// (which would create a circular dependency between `services/` and `hooks/`).
export interface VoiceStatusListener {
  applyRealtimeVoiceStatus(event: VoiceStatusEvent): void;
}

/**
 * The generation part of the audio store. Playback fields are never touched
 * from here: a narration that is being generated is not the one in the player.
 */
interface AudioPlayerStoreBridge {
  generatingNarrationId: string | null;
  isGenerating: boolean;
  generationProgress: number;
  generationReadyId: string | null;
}

/** A parsed `narration_status` event, for any narration of the user. */
export interface NarrationStatusEvent {
  readonly narrationId: string;
  /** Upper case: PENDING, GENERATING, READY, FAILED. */
  readonly status: string;
  readonly progress?: number;
}

export type NarrationStatusListener = (event: NarrationStatusEvent) => void;

// Server-initiated disconnects ("io server disconnect") usually mean the
// handshake token was rejected. We refresh and reconnect, but cap the retries
// inside a sliding window so a permanently bad session cannot spin forever.
const SERVER_DISCONNECT_WINDOW_MS = 60_000;
const SERVER_DISCONNECT_MAX_RETRIES = 3;
const SERVER_DISCONNECT_BACKOFF_MS = [1000, 3000, 8000];

// ============================================================================
// WebSocket Service (Singleton)
// ============================================================================

class WebSocketService {
  private static instance: WebSocketService;

  private socket: Socket | null = null;

  // Lazy-bound store references, registered by the hooks that own the stores.
  // These are optional so the service can still log/track events without
  // coupling to MobX.
  private voiceStatusListeners = new Set<VoiceStatusListener>();
  private voiceStatusFallback: (() => void) | null = null;
  private audioPlayerStoreRef: AudioPlayerStoreBridge | null = null;
  private narrationStatusListeners = new Set<NarrationStatusListener>();

  private appStateSub: NativeEventSubscription | null = null;
  private unsubscribeTokenRefresh: (() => void) | null = null;
  private serverDisconnects: number[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor() {}

  public static getInstance(): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }

  // ==========================================================================
  // Store Registration
  // ==========================================================================

  /**
   * Register a store that wants `voice_status` events (voice profile list,
   * voice recording flow). Returns an unsubscribe function.
   */
  public addVoiceStatusListener(listener: VoiceStatusListener): () => void {
    this.voiceStatusListeners.add(listener);
    return () => {
      this.voiceStatusListeners.delete(listener);
    };
  }

  /**
   * Called when a FAILED event arrives without a voiceProfileId (legacy
   * backend payload). Typically reloads the profile list.
   */
  public setVoiceStatusFallback(fallback: (() => void) | null): void {
    this.voiceStatusFallback = fallback;
  }

  public registerAudioPlayerStore(store: AudioPlayerStoreBridge): void {
    this.audioPlayerStoreRef = store;
  }

  /**
   * Every `narration_status` event, whatever narration it is for (a Library
   * row that waits for its narration, for example). Returns an unsubscribe.
   */
  public addNarrationStatusListener(listener: NarrationStatusListener): () => void {
    this.narrationStatusListeners.add(listener);
    return () => {
      this.narrationStatusListeners.delete(listener);
    };
  }

  // ==========================================================================
  // Connection Lifecycle
  // ==========================================================================

  public isConnected(): boolean {
    return this.socket?.connected === true;
  }

  /**
   * Open the realtime connection. The handshake token is read lazily on every
   * (re)connect attempt via the callback-style `auth`, so reconnects after a
   * token refresh always present the latest access token.
   */
  public async connect(): Promise<void> {
    const token = await ApiClient.getAccessToken();
    if (!token) {
      console.warn('[WebSocket] connect() without a stored token; skipping');
      return;
    }

    this.attachLifecycleHooks();

    if (this.socket) {
      if (!this.socket.connected) {
        this.socket.connect();
      }
      return;
    }

    const baseUrl = __DEV__
      ? API_CONFIG.WEBSOCKET_URL
      : API_CONFIG.WEBSOCKET_URL_PRODUCTION;

    // Socket.IO will append the namespace to the URL automatically.
    const namespaceUrl = `${baseUrl}/notifications`;

    console.log(`[WebSocket] Connecting to ${namespaceUrl}`);

    const socket = io(namespaceUrl, {
      transports: ['websocket'],
      auth: cb => {
        ApiClient.getAccessToken()
          .then(latest => cb({token: latest ?? ''}))
          .catch(() => cb({token: ''}));
      },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 15000,
      autoConnect: true,
    });

    this.socket = socket;
    this.attachEventHandlers(socket);
  }

  /**
   * Reconnect if we have a socket that dropped. Safe to call often (app
   * foregrounded, token refreshed).
   */
  public ensureConnected(): void {
    if (!this.socket) {
      return;
    }
    if (!this.socket.connected) {
      console.log('[WebSocket] ensureConnected: reconnecting');
      this.socket.connect();
    }
  }

  public disconnect(): void {
    this.detachLifecycleHooks();
    this.clearReconnectTimer();
    this.serverDisconnects = [];
    if (!this.socket) {
      return;
    }
    try {
      this.socket.removeAllListeners();
      this.socket.disconnect();
    } catch (error) {
      console.warn('[WebSocket] disconnect error:', error);
    }
    this.socket = null;
  }

  private attachLifecycleHooks(): void {
    if (!this.appStateSub) {
      this.appStateSub = AppState.addEventListener(
        'change',
        (next: AppStateStatus) => {
          if (next === 'active') {
            this.ensureConnected();
          }
        },
      );
    }
    if (!this.unsubscribeTokenRefresh) {
      // After ApiClient refreshes tokens, a socket that was rejected (or
      // dropped while the token was stale) can come back with the new one.
      this.unsubscribeTokenRefresh = ApiClient.onTokensRefreshed(() => {
        this.serverDisconnects = [];
        this.ensureConnected();
      });
    }
  }

  private detachLifecycleHooks(): void {
    this.appStateSub?.remove();
    this.appStateSub = null;
    this.unsubscribeTokenRefresh?.();
    this.unsubscribeTokenRefresh = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * The server closed the socket on purpose (socket.io does not auto-retry
   * this case). Almost always an expired/invalid handshake token: refresh it
   * and reconnect, with a small capped backoff.
   */
  private handleServerDisconnect(socket: Socket): void {
    const now = Date.now();
    this.serverDisconnects = this.serverDisconnects.filter(
      t => now - t < SERVER_DISCONNECT_WINDOW_MS,
    );
    if (this.serverDisconnects.length >= SERVER_DISCONNECT_MAX_RETRIES) {
      console.warn(
        '[WebSocket] server keeps closing the socket; waiting for next foreground/token refresh',
      );
      return;
    }
    const attempt = this.serverDisconnects.length;
    this.serverDisconnects.push(now);

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.socket !== socket) {
        return; // torn down or replaced meanwhile
      }
      const fresh = await ApiClient.refreshSession();
      if (!fresh || this.socket !== socket) {
        return; // session gone (auth store handles logout) or offline
      }
      socket.connect();
    }, SERVER_DISCONNECT_BACKOFF_MS[Math.min(attempt, SERVER_DISCONNECT_BACKOFF_MS.length - 1)]);
  }

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  private attachEventHandlers(socket: Socket): void {
    socket.on('connect', () => {
      console.log(`[WebSocket] Connected (id=${socket.id})`);
    });

    socket.on('disconnect', reason => {
      console.log(`[WebSocket] Disconnected (${reason})`);
      if (reason === 'io server disconnect') {
        this.handleServerDisconnect(socket);
      }
    });

    socket.on('connect_error', error => {
      // Most commonly a bad token or backend is down. Polling fallback will
      // still keep the UI functional.
      console.warn('[WebSocket] connect_error:', error?.message || error);
    });

    socket.on('reconnect_attempt', attempt => {
      console.log(`[WebSocket] reconnect attempt #${attempt}`);
    });

    // Voice cloning / training updates
    socket.on('voice_status', (payload: unknown) => {
      this.handleVoiceStatus(payload);
    });

    // Narration generation updates
    socket.on('narration_status', (payload: unknown) => {
      this.handleNarrationStatus(payload);
    });

    // Generic notification push — refresh unread badge + optionally prepend.
    socket.on('notification', (payload: unknown) => {
      this.handleNotification(payload);
    });
  }

  // ==========================================================================
  // Voice Status Handler
  // ==========================================================================

  private handleVoiceStatus(payload: unknown): void {
    const event = parseVoiceStatusPayload(payload);
    if (!event) {
      return;
    }

    console.log(
      `[WebSocket] voice_status: ${event.voiceProfileId ?? '(no id)'} -> ${event.status}`,
    );

    if (!event.voiceProfileId) {
      // Legacy FAILED payload without an id: we cannot patch a specific row,
      // so reload and let the fresh statuses drive the UI.
      try {
        this.voiceStatusFallback?.();
      } catch (error) {
        console.warn('[WebSocket] voice status fallback failed:', error);
      }
      return;
    }

    this.voiceStatusListeners.forEach(listener => {
      try {
        listener.applyRealtimeVoiceStatus(event);
      } catch (error) {
        console.warn('[WebSocket] voice status listener failed:', error);
      }
    });
  }

  // ==========================================================================
  // Narration Status Handler
  // ==========================================================================

  private handleNarrationStatus(payload: unknown): void {
    if (!payload || typeof payload !== 'object') {
      return;
    }
    const data = payload as Record<string, unknown>;
    const narrationId =
      typeof data.narrationId === 'string'
        ? data.narrationId
        : typeof data.id === 'string'
          ? data.id
          : null;
    const status =
      typeof data.status === 'string' ? data.status.toUpperCase() : null;

    if (!narrationId || !status) {
      return;
    }

    const progress =
      typeof data.progress === 'number' ? data.progress : undefined;

    console.log(
      `[WebSocket] narration_status: ${narrationId} → ${status}${
        typeof progress === 'number' ? ` (${progress}%)` : ''
      }`,
    );

    // Every listener hears every narration, before the generation filter.
    const event: NarrationStatusEvent = { narrationId, status, progress };
    [...this.narrationStatusListeners].forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.warn('[WebSocket] narration status listener failed:', error);
      }
    });

    const store = this.audioPlayerStoreRef;
    if (!store) {
      return;
    }

    // Only the narration being generated moves the generation state; the
    // story in the player is never touched from here.
    if (!store.generatingNarrationId || store.generatingNarrationId !== narrationId) {
      return;
    }

    runInAction(() => {
      if (status === AudioGenerationStatus.READY) {
        store.generationProgress = 100;
        store.isGenerating = false;
        store.generationReadyId = narrationId;
      } else if (typeof progress === 'number' && Number.isFinite(progress)) {
        // Never backwards within a job: a late event must not undo progress.
        store.generationProgress = Math.max(store.generationProgress, progress);
      }
    });
  }

  // ==========================================================================
  // Notification Handler
  // ==========================================================================

  private handleNotification(payload: unknown): void {
    console.log('[WebSocket] notification push received');

    const notificationsStore = getNotificationsStore();

    // Always bump the unread badge via a fresh fetch — this is the source of
    // truth even if we also optimistically prepend the item.
    notificationsStore.refreshUnreadCount().catch(error => {
      console.warn('[WebSocket] refreshUnreadCount failed:', error);
    });

    // Try to parse the payload into a Notification and prepend it so the
    // list updates without a pull-to-refresh.
    if (payload && typeof payload === 'object') {
      try {
        const notification = parseNotificationFromJSON(payload);
        notificationsStore.prependNotification(notification);
      } catch (error) {
        // If payload doesn't match the schema, the refresh above will still
        // keep the badge accurate.
        console.warn(
          '[WebSocket] Failed to parse notification payload:',
          error,
        );
      }
    }
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export default WebSocketService.getInstance();
export {WebSocketService};
