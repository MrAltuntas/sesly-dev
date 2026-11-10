/**
 * ConnectivityStore: NetInfo states mapped to `offline`, and reconnect edges.
 * NetInfo is driven by hand: the test keeps the listener the store registers.
 */
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { autorun } from 'mobx';

import { ConnectivityStore, connectivityStore, getConnectivityStore, isOfflineState } from './ConnectivityStore';

type Listener = (state: NetInfoState) => void;

let listener: Listener | null = null;
const unsubscribe = jest.fn();

function netState(
  isConnected: boolean | null,
  isInternetReachable: boolean | null,
): NetInfoState {
  return { isConnected, isInternetReachable } as unknown as NetInfoState;
}

function emit(isConnected: boolean | null, isInternetReachable: boolean | null = null) {
  if (!listener) throw new Error('the store never subscribed to NetInfo');
  listener(netState(isConnected, isInternetReachable));
}

beforeEach(() => {
  listener = null;
  unsubscribe.mockReset();
  jest
    .spyOn(NetInfo, 'addEventListener')
    .mockImplementation(((cb: Listener) => {
      listener = cb;
      return unsubscribe;
    }) as unknown as typeof NetInfo.addEventListener);
});

describe('isOfflineState', () => {
  it.each([
    [false, null, true],
    [false, false, true],
    [true, false, true],
    [null, false, true],
    [true, true, false],
    [true, null, false],
    [null, null, false],
    [null, true, false],
  ])('isConnected %p, isInternetReachable %p: offline %p', (connected, reachable, expected) => {
    expect(isOfflineState(netState(connected, reachable))).toBe(expected);
  });
});

describe('ConnectivityStore', () => {
  it('starts online and subscribes to NetInfo once, however often start() runs', () => {
    const store = new ConnectivityStore();
    expect(store.offline).toBe(false);
    expect(store.isStarted).toBe(false);

    store.start();
    store.start();

    expect(NetInfo.addEventListener).toHaveBeenCalledTimes(1);
    expect(store.isStarted).toBe(true);
  });

  it('follows offline, online and unknown transitions', () => {
    const store = new ConnectivityStore();
    store.start();

    emit(true, true);
    expect(store.offline).toBe(false);

    emit(false);
    expect(store.offline).toBe(true);

    // Unknown reachability counts as online.
    emit(true, null);
    expect(store.offline).toBe(false);

    emit(true, false);
    expect(store.offline).toBe(true);

    emit(null, null);
    expect(store.offline).toBe(false);
  });

  it('offline is observable', () => {
    const store = new ConnectivityStore();
    store.start();
    const seen: boolean[] = [];
    const dispose = autorun(() => {
      seen.push(store.offline);
    });

    emit(false);
    emit(false);
    emit(true, true);
    dispose();

    expect(seen).toEqual([false, true, false]);
  });

  it('onReconnect fires once per offline-to-online edge', () => {
    const store = new ConnectivityStore();
    store.start();
    const onReconnect = jest.fn();
    store.onReconnect(onReconnect);

    // First state online, then online again: no edge.
    emit(true, true);
    emit(true, null);
    expect(onReconnect).not.toHaveBeenCalled();

    emit(false);
    emit(false, false);
    expect(onReconnect).not.toHaveBeenCalled();

    emit(true, true);
    expect(onReconnect).toHaveBeenCalledTimes(1);
    emit(true, true);
    expect(onReconnect).toHaveBeenCalledTimes(1);

    emit(true, false);
    emit(null, null);
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  it('an unsubscribed reconnect listener is not called; a throwing one does not stop others', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = new ConnectivityStore();
    store.start();
    const removed = jest.fn();
    const broken = jest.fn(() => {
      throw new Error('listener bug');
    });
    const healthy = jest.fn();
    const off = store.onReconnect(removed);
    store.onReconnect(broken);
    store.onReconnect(healthy);
    off();

    emit(false);
    emit(true, true);

    expect(removed).not.toHaveBeenCalled();
    expect(broken).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it('stop() drops the NetInfo subscription and start() can subscribe again', () => {
    const store = new ConnectivityStore();
    store.start();
    store.stop();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(store.isStarted).toBe(false);

    store.start();
    expect(NetInfo.addEventListener).toHaveBeenCalledTimes(2);
  });

  it('a NetInfo subscription failure leaves the store online and not started', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (NetInfo.addEventListener as jest.Mock).mockImplementation(() => {
      throw new Error('native module missing');
    });
    const store = new ConnectivityStore();

    expect(() => store.start()).not.toThrow();
    expect(store.offline).toBe(false);
    expect(store.isStarted).toBe(false);
  });

  it('exports one shared instance', () => {
    expect(getConnectivityStore()).toBe(connectivityStore);
    expect(connectivityStore).toBeInstanceOf(ConnectivityStore);
  });
});
