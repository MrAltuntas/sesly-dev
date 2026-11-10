/**
 * Whether the device is offline, from NetInfo (MobX singleton).
 *
 * Offline means NetInfo says so: `isConnected === false` or
 * `isInternetReachable === false`. An unknown value (null, before the first
 * reachability probe) counts as online, so nothing is shown as offline on a
 * guess. BootStore calls start() once; screens read `offline` and stores use
 * onReconnect to retry what failed while the connection was gone.
 */

import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { action, makeObservable, observable } from 'mobx';

type ReconnectListener = () => void;

export function isOfflineState(
  state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>,
): boolean {
  return state.isConnected === false || state.isInternetReachable === false;
}

export class ConnectivityStore {
  offline = false;

  private unsubscribe: (() => void) | null = null;
  private reconnectListeners = new Set<ReconnectListener>();

  constructor() {
    makeObservable<ConnectivityStore, 'apply'>(this, {
      offline: observable,
      apply: action,
    });
  }

  get isStarted(): boolean {
    return this.unsubscribe !== null;
  }

  /** Subscribes to NetInfo once; later calls do nothing. */
  start(): void {
    if (this.unsubscribe) {
      return;
    }
    try {
      // NetInfo calls the listener with the current state right away.
      this.unsubscribe = NetInfo.addEventListener(state => this.apply(state));
    } catch (error) {
      console.warn('[connectivity] NetInfo subscription failed:', error);
    }
  }

  /** Test and teardown helper: drops the NetInfo subscription. */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * Called on every offline-to-online edge (not on the first online state,
   * not on repeated online states). Returns an unsubscribe.
   */
  onReconnect(listener: ReconnectListener): () => void {
    this.reconnectListeners.add(listener);
    return () => {
      this.reconnectListeners.delete(listener);
    };
  }

  private apply(state: NetInfoState): void {
    const wasOffline = this.offline;
    this.offline = isOfflineState(state);
    if (wasOffline && !this.offline) {
      [...this.reconnectListeners].forEach(listener => {
        try {
          listener();
        } catch (error) {
          console.warn('[connectivity] reconnect listener failed:', error);
        }
      });
    }
  }
}

export const connectivityStore = new ConnectivityStore();

export function getConnectivityStore(): ConnectivityStore {
  return connectivityStore;
}
