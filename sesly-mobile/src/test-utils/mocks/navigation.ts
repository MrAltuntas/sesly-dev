export const mockNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  reset: jest.fn(),
  replace: jest.fn(),
  push: jest.fn(),
  pop: jest.fn(),
  popTo: jest.fn(),
  popToTop: jest.fn(),
  setOptions: jest.fn(),
  setParams: jest.fn(),
  dispatch: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
  removeListener: jest.fn(),
  canGoBack: jest.fn().mockReturnValue(true),
  isFocused: jest.fn(() => mockFocusState.focused),
  getParent: jest.fn(),
  getState: jest.fn(),
};

/**
 * Route params returned by the mocked `useRoute()`. Screen tests set them
 * with `setMockRouteParams({ storyId: 's-1' })`; they reset after each test.
 */
const mockRouteState: { params: Record<string, unknown> } = { params: {} };

export function setMockRouteParams(params: Record<string, unknown>): void {
  mockRouteState.params = params;
}

/**
 * Focus state behind the mocked `useIsFocused()`, `useFocusEffect()` and
 * `navigation.isFocused()`; focused by default. A test leaves the screen with
 * `act(() => setMockFocused(false))` and comes back with
 * `act(() => setMockFocused(true))`: subscribed components re-render (observer
 * screens too, no rerender needed), a focus effect's last cleanup runs on the
 * way out and its callback runs again on the way back. Resets to focused after
 * each test.
 */
const mockFocusState = { focused: true, listeners: new Set<() => void>() };

function mockSubscribeFocus(listener: () => void): () => void {
  mockFocusState.listeners.add(listener);
  return () => {
    mockFocusState.listeners.delete(listener);
  };
}

function mockUseFocused(): boolean {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react');
  return useSyncExternalStore(mockSubscribeFocus, () => mockFocusState.focused);
}

export function setMockFocused(focused: boolean): void {
  if (mockFocusState.focused === focused) return;
  mockFocusState.focused = focused;
  mockFocusState.listeners.forEach(listener => listener());
}

afterEach(() => {
  mockRouteState.params = {};
  // No notification: the test's components are being unmounted.
  mockFocusState.focused = true;
});

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
  useRoute: () => ({ key: 'mock-route', name: 'MockRoute', params: mockRouteState.params }),
  // The callback runs on every focused render (as it always did here) and not
  // while blurred, so a false-to-true flip runs it again; the cleanup it
  // returned last runs when the screen loses focus.
  useFocusEffect: jest.fn((callback: () => void | (() => void)) => {
    const { useEffect, useRef } = jest.requireActual<typeof import('react')>('react');
    const focused = mockUseFocused();
    const cleanup = useRef<(() => void) | undefined>(undefined);
    if (focused) {
      const result = callback();
      cleanup.current = typeof result === 'function' ? result : undefined;
    }
    useEffect(() => {
      if (focused) return;
      const run = cleanup.current;
      cleanup.current = undefined;
      run?.();
    }, [focused]);
  }),
  useIsFocused: () => mockUseFocused(),
  NavigationContainer: ({ children }: any) => children,
}));
