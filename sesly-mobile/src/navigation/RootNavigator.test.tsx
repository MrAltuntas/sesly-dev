/**
 * RootNavigator with every screen stubbed and a real native stack whose
 * Navigator records the props it was given:
 *  - transitions, gestures and freeze come from one map and one options object,
 *  - only the launch path is imported; other routes load on first use and
 *    preloadLikelyScreens warms the likely three,
 *  - the container mounts on the BootStore's route (nothing before it is
 *    known) and releases the native splash once it drew, except on Onboarding,
 *  - losing the session resets the stack to Login,
 *  - the subscription store follows the backend user (one refresh per id),
 *  - push taps are routed once the Main shell is mounted,
 *  - the app-wide hosts render inside the container,
 *  - the five screens of the modal group carry their own dialog outlet.
 */

import React from 'react';
import { act, render, screen, within } from '@testing-library/react-native';
import { observable, runInAction } from 'mobx';

// The global navigation mock replaces NavigationContainer; this test needs
// the real navigator.
jest.mock('@react-navigation/native', () => jest.requireActual('@react-navigation/native'));
// The global safe-area mock lacks the contexts native-stack reads.
jest.mock('react-native-safe-area-context', () =>
  jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

interface CollectedScreen {
  name: string;
  options?: Record<string, unknown>;
  component?: unknown;
  getComponent?: () => unknown;
  /** screenOptions of the Stack.Group around it, if any. */
  groupOptions?: Record<string, unknown>;
}

// What the root Stack.Navigator was rendered with (last render wins).
const mockCollected = {
  navigatorProps: null as null | { screenOptions?: Record<string, unknown> },
  screens: new Map<string, CollectedScreen>(),
};

// A real native stack whose Navigator records its props and its screens.
jest.mock('@react-navigation/native-stack', () => {
  const actual = jest.requireActual('@react-navigation/native-stack');
  const ReactActual = jest.requireActual('react');
  return {
    ...actual,
    createNativeStackNavigator: () => {
      const real = actual.createNativeStackNavigator();
      const collect = (children: unknown, groupOptions?: Record<string, unknown>) => {
        ReactActual.Children.forEach(children, (child: unknown) => {
          if (!ReactActual.isValidElement(child)) return;
          const element = child as { type: unknown; props: Record<string, unknown> };
          if (element.type === real.Screen) {
            mockCollected.screens.set(element.props.name as string, {
              ...(element.props as unknown as CollectedScreen),
              groupOptions,
            });
          } else if (element.type === real.Group) {
            collect(element.props.children, element.props.screenOptions as Record<string, unknown>);
          } else if (element.type === ReactActual.Fragment) {
            collect(element.props.children, groupOptions);
          }
        });
      };
      const Navigator = (props: { screenOptions?: Record<string, unknown>; children?: unknown }) => {
        mockCollected.navigatorProps = props;
        mockCollected.screens.clear();
        collect(props.children);
        return ReactActual.createElement(real.Navigator, props);
      };
      return { ...real, Navigator };
    },
  };
});

function mockStub(name: string) {
  const { Text: RNText } = require('react-native');
  const Stub = ({ route }: { route: { params?: object } }) => (
    <RNText testID={`screen-${name}`}>{`${name} ${JSON.stringify(route.params ?? {})}`}</RNText>
  );
  Stub.displayName = `${name}Stub`;
  return Stub;
}

// Lazy screen modules note when they are first required.
const mockLoaded: string[] = [];
function mockLazyModule(name: string) {
  mockLoaded.push(name);
  return { __esModule: true, default: mockStub(name) };
}

// The launch path.
jest.mock('../screens/auth/LoginScreen', () => ({ __esModule: true, default: mockStub('Login') }));
jest.mock('../screens/onboarding/OnboardingScreen', () => ({ __esModule: true, default: mockStub('Onboarding') }));
jest.mock('../screens/splash/ForceUpdateScreen', () => ({ __esModule: true, default: mockStub('ForceUpdate') }));
jest.mock('../screens/common/NoInternetScreen', () => ({ __esModule: true, default: mockStub('NoInternet') }));
jest.mock('../screens/main', () => ({ MainScaffold: mockStub('Main') }));
// Everything else.
jest.mock('../screens/auth/RegistrationScreen', () => mockLazyModule('Registration'));
jest.mock('../screens/story/StoryDetailScreen', () => mockLazyModule('StoryDetail'));
jest.mock('../screens/story/AllStoriesScreen', () => mockLazyModule('AllStories'));
jest.mock('../screens/collections/CollectionsScreen', () => mockLazyModule('Collections'));
jest.mock('../screens/collections/CollectionDetailScreen', () => mockLazyModule('CollectionDetail'));
jest.mock('../screens/voice/CreateVoiceProfileScreen', () => mockLazyModule('CreateVoiceProfile'));
jest.mock('../screens/voice/VoiceConsentScreen', () => mockLazyModule('VoiceConsent'));
jest.mock('../screens/voice/VoiceRecordingScreen', () => mockLazyModule('VoiceRecording'));
jest.mock('../screens/voice/VoiceSuccessScreen', () => mockLazyModule('VoiceSuccess'));
jest.mock('../screens/voice/ProcessingScreen', () => mockLazyModule('Processing'));
jest.mock('../screens/voice/VoiceProfilesScreen', () => mockLazyModule('VoiceProfiles'));
jest.mock('../screens/voice/NarratorCatalogueScreen', () => mockLazyModule('NarratorCatalogue'));
jest.mock('../screens/audio/AudioPlayerScreen', () => mockLazyModule('AudioPlayer'));
jest.mock('../screens/audio/AudioGenerationScreen', () => mockLazyModule('AudioGeneration'));
jest.mock('../screens/profile/ProfileScreen', () => mockLazyModule('Profile'));
jest.mock('../screens/settings/DataDeletionScreen', () => mockLazyModule('DataDeletion'));
jest.mock('../screens/notifications/NotificationsScreen', () => mockLazyModule('Notifications'));
jest.mock('../screens/subscription/SubscriptionScreen', () => mockLazyModule('Subscription'));

// Reports whether it was rendered inside a NavigationContainer.
jest.mock('./RootHosts', () => ({
  RootHosts: () => {
    const ReactActual = jest.requireActual('react');
    const { NavigationContainerRefContext } = jest.requireActual('@react-navigation/native');
    const { Text: RNText } = require('react-native');
    const container = ReactActual.useContext(NavigationContainerRefContext);
    return <RNText testID="root-hosts">{container ? 'inside' : 'outside'}</RNText>;
  },
}));

type BootRouteLike = { name: string; params?: object } | null;
const mockBoot = { current: observable({ route: null as BootRouteLike }, undefined, { deep: false }) };
jest.mock('../boot/BootStore', () => ({ getBootStore: () => mockBoot.current }));

const mockReleaseSplash = jest.fn();
jest.mock('../boot/splash', () => ({
  releaseSplash: (...args: unknown[]) => mockReleaseSplash(...args),
}));

type MockUser = { id: string; subscriptionTier: string };
const mockAuthStore = {
  current: null as null | { isAuthenticated: boolean; backendUser: MockUser | null },
};
const mockSubscriptionStore = {
  setTierFromUser: jest.fn(),
  refresh: jest.fn(),
  reset: jest.fn(),
};
const mockPushBridge = jest.fn();

jest.mock('../hooks/useAuth', () => ({ useAuth: () => mockAuthStore.current }));
jest.mock('../hooks/useSubscription', () => ({ useSubscription: () => mockSubscriptionStore }));
jest.mock('../hooks/usePushNotifications', () => ({
  usePushNotificationBridge: (userId: string | null) => mockPushBridge(userId),
}));

import {
  LAZY_SCREENS,
  NO_GESTURE_ROUTES,
  ROOT_SCREEN_OPTIONS,
  RootNavigator,
  SCREEN_ANIMATION,
  navigationRef,
  preloadLikelyScreens,
} from './RootNavigator';
import { clearPendingNotificationOpen, queueNotificationOpen } from './pushRouting';
import { DialogProvider, useDialog } from '../hooks/useDialog';
import { ThemeProvider } from '../theme/ThemeProvider';
import { themes } from '../theme/theme';
import { getDiscoverStore } from '../hooks/useDiscover';
import { getContentLanguageStore } from '../hooks/useContentLanguage';

// Read right after the imports: which lazy screens importing the navigator loaded.
const loadedAtImport = [...mockLoaded];

const ALL_ROUTES = [
  'ForceUpdate',
  'Onboarding',
  'Login',
  'Registration',
  'Main',
  'StoryDetail',
  'AllStories',
  'Collections',
  'CollectionDetail',
  'CreateVoiceProfile',
  'VoiceConsent',
  'VoiceRecording',
  'VoiceSuccess',
  'Processing',
  'VoiceProfiles',
  'NarratorCatalogue',
  'AudioPlayer',
  'AudioGeneration',
  'Profile',
  'DataDeletion',
  'Notifications',
  'Subscription',
  'NoInternet',
];
const EAGER_ROUTES = ['Onboarding', 'Login', 'Main', 'ForceUpdate', 'NoInternet'];

const user = { id: 'u-1', subscriptionTier: 'PRO' };

function setBootRoute(route: BootRouteLike): void {
  runInAction(() => {
    mockBoot.current.route = route;
  });
}

beforeEach(() => {
  clearPendingNotificationOpen();
  mockSubscriptionStore.refresh.mockResolvedValue(undefined);
  mockAuthStore.current = observable({ isAuthenticated: true, backendUser: user as MockUser | null });
  mockBoot.current = observable({ route: { name: 'Main' } as BootRouteLike }, undefined, { deep: false });
});

async function renderNavigator() {
  const view = render(<RootNavigator />);
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  return view;
}

const rootRouteNames = () => navigationRef.getRootState().routes.map(r => r.name);

describe('transitions, gestures and freeze', () => {
  it('the navigator pushes with ios_from_right and freezes hidden screens', async () => {
    await renderNavigator();
    const options = mockCollected.navigatorProps?.screenOptions;
    expect(options).toMatchObject({
      headerShown: false,
      animation: 'ios_from_right',
      freezeOnBlur: true,
      animationDuration: 250,
    });
    expect(ROOT_SCREEN_OPTIONS).toEqual({
      headerShown: false,
      animation: 'ios_from_right',
      freezeOnBlur: true,
      animationDuration: 250,
    });
  });

  it('every screen takes its animation from SCREEN_ANIMATION; no slide is left', async () => {
    await renderNavigator();
    expect([...mockCollected.screens.keys()].sort()).toEqual([...ALL_ROUTES].sort());
    expect(Object.keys(SCREEN_ANIMATION).sort()).toEqual([...ALL_ROUTES].sort());

    for (const [name, entry] of mockCollected.screens) {
      expect({ name, animation: entry.options?.animation }).toEqual({
        name,
        animation: SCREEN_ANIMATION[name as keyof typeof SCREEN_ANIMATION],
      });
      for (const animation of [entry.options?.animation, entry.groupOptions?.animation]) {
        expect(animation).not.toBe('slide_from_right');
        expect(animation).not.toBe('slide_from_bottom');
      }
    }
    expect(Object.values(SCREEN_ANIMATION)).not.toContain('slide_from_right');
    expect(Object.values(SCREEN_ANIMATION)).not.toContain('slide_from_bottom');
  });

  it('state swaps fade, content opens rise, pushes use the default', () => {
    expect(SCREEN_ANIMATION.Main).toBe('fade');
    expect(SCREEN_ANIMATION.Login).toBe('fade');
    expect(SCREEN_ANIMATION.Onboarding).toBe('fade');
    expect(SCREEN_ANIMATION.Subscription).toBe('fade_from_bottom');
    expect(SCREEN_ANIMATION.AudioPlayer).toBe('fade_from_bottom');
    expect(SCREEN_ANIMATION.StoryDetail).toBe('fade_from_bottom');
    expect(SCREEN_ANIMATION.Profile).toBe('ios_from_right');
    expect(SCREEN_ANIMATION.Registration).toBe('ios_from_right');
  });

  it('only the shell, the gates and the flows that move on by themselves block the back swipe', async () => {
    await renderNavigator();
    const blocked = [...mockCollected.screens.values()]
      .filter(entry => entry.options?.gestureEnabled === false)
      .map(entry => entry.name)
      .sort();
    expect(blocked).toEqual(
      ['AudioGeneration', 'ForceUpdate', 'Main', 'NoInternet', 'Processing', 'VoiceRecording', 'VoiceSuccess'],
    );
    expect([...NO_GESTURE_ROUTES].sort()).toEqual(blocked);
  });

  it('the player is frozen like every other hidden screen (no exception)', async () => {
    await renderNavigator();
    expect(mockCollected.screens.get('AudioPlayer')?.options?.freezeOnBlur).toBeUndefined();
    for (const entry of mockCollected.screens.values()) {
      expect(entry.options?.freezeOnBlur).not.toBe(false);
    }
  });

  it('the voice creation flow is one modal group', async () => {
    await renderNavigator();
    const modal = [...mockCollected.screens.values()]
      .filter(entry => entry.groupOptions?.presentation === 'modal')
      .map(entry => entry.name)
      .sort();
    expect(modal).toEqual(['CreateVoiceProfile', 'Processing', 'VoiceConsent', 'VoiceRecording', 'VoiceSuccess']);
  });

  it('a render that is not a palette change keeps every options object', async () => {
    await renderNavigator();
    const screenOptions = mockCollected.navigatorProps?.screenOptions;
    const groupOptions = mockCollected.screens.get('VoiceRecording')?.groupOptions;
    const mainOptions = mockCollected.screens.get('Main')?.options;

    // The live /users/me answer re-renders the navigator (same id, new tier).
    await act(async () => {
      runInAction(() => {
        mockAuthStore.current!.backendUser = { id: 'u-1', subscriptionTier: 'FREE' };
      });
    });

    expect(mockSubscriptionStore.setTierFromUser).toHaveBeenLastCalledWith('FREE');
    expect(mockCollected.navigatorProps?.screenOptions).toBe(screenOptions);
    expect(mockCollected.screens.get('VoiceRecording')?.groupOptions).toBe(groupOptions);
    expect(mockCollected.screens.get('Main')?.options).toBe(mainOptions);
  });

  it('the content background follows the palette', async () => {
    render(
      <ThemeProvider initialPalette="kitaplik">
        <RootNavigator />
      </ThemeProvider>,
    );
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(mockCollected.navigatorProps?.screenOptions?.contentStyle).toEqual({
      backgroundColor: themes.kitaplik.bg,
    });
  });
});

describe('lazy routes', () => {
  it('only the launch path is loaded with the navigator', () => {
    expect(loadedAtImport).toEqual([]);
  });

  it('every route off the launch path uses getComponent, which returns one component', async () => {
    await renderNavigator();
    for (const [name, entry] of mockCollected.screens) {
      if (EAGER_ROUTES.includes(name)) {
        expect({ name, lazy: typeof entry.getComponent }).toEqual({ name, lazy: 'undefined' });
        expect(entry.component).toBeTruthy();
        continue;
      }
      expect({ name, lazy: typeof entry.getComponent }).toEqual({ name, lazy: 'function' });
      expect(entry.component).toBeUndefined();
      const first = entry.getComponent!();
      expect(entry.getComponent!()).toBe(first);
    }
  });

  it('a lazy screen renders inside its palette boundary when opened', async () => {
    await renderNavigator();
    await act(async () => {
      navigationRef.navigate('CollectionDetail', { slug: 'uyku' });
    });
    expect(await screen.findByTestId('screen-CollectionDetail')).toHaveTextContent(
      'CollectionDetail {"slug":"uyku"}',
    );
    const component = LAZY_SCREENS.CollectionDetail() as { displayName?: string };
    expect(component.displayName).toMatch(/^ScreenPalette\(/);
  });

  it('preloadLikelyScreens builds StoryDetail, AudioPlayer and Profile once', () => {
    // A fresh navigator module: earlier tests already opened lazy routes here.
    jest.isolateModules(() => {
      const theme = require('../theme/ThemeProvider') as typeof import('../theme/ThemeProvider');
      const wrap = jest.spyOn(theme, 'withScreenPalette');
      const fresh = require('./RootNavigator') as typeof import('./RootNavigator');
      const wrapped = () => wrap.mock.calls.map(([component]) => component.displayName);
      // Importing wraps the launch path only.
      expect(wrapped().sort()).toEqual(['ForceUpdateStub', 'LoginStub', 'NoInternetStub', 'OnboardingStub']);

      fresh.preloadLikelyScreens();
      expect(wrapped().slice(4).sort()).toEqual(['AudioPlayerStub', 'ProfileStub', 'StoryDetailStub']);

      // Cached: a second preload and the route itself reuse the same component.
      const player = fresh.LAZY_SCREENS.AudioPlayer();
      fresh.preloadLikelyScreens();
      expect(wrap).toHaveBeenCalledTimes(7);
      expect(fresh.LAZY_SCREENS.AudioPlayer()).toBe(player);
    });
    expect(() => preloadLikelyScreens()).not.toThrow();
  });
});

describe('dialog outlets on the modal group', () => {
  const MODAL_ROUTES = ['CreateVoiceProfile', 'VoiceConsent', 'VoiceRecording', 'VoiceSuccess', 'Processing'] as const;

  let dialog: ReturnType<typeof useDialog>;
  function GrabDialog() {
    dialog = useDialog();
    return null;
  }

  async function renderWithDialogs() {
    const view = render(
      <DialogProvider>
        <GrabDialog />
        <RootNavigator />
      </DialogProvider>,
    );
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    return view;
  }

  it('every modal screen is wrapped with an outlet inside its palette boundary', () => {
    for (const name of MODAL_ROUTES) {
      const component = LAZY_SCREENS[name]() as { displayName?: string };
      expect(component.displayName).toBe(`ScreenPalette(withDialogOutlet(${name}Stub))`);
    }
    // A pushed screen has no outlet of its own.
    const profile = LAZY_SCREENS.Profile() as { displayName?: string };
    expect(profile.displayName).toBe('ScreenPalette(ProfileStub)');
  });

  it.each(MODAL_ROUTES)('a dialog shown on %s renders inside that screen', async name => {
    await renderWithDialogs();
    await act(async () => {
      navigationRef.navigate(name as never);
    });
    expect(await screen.findByTestId(`screen-${name}`)).toBeTruthy();

    act(() => dialog.showDialog({ title: 'Kayıt hatası' }));

    const modalScreen = screen.UNSAFE_getByType(LAZY_SCREENS[name]() as React.ComponentType<object>);
    expect(within(modalScreen).getByText('Kayıt hatası')).toBeTruthy();
    expect(screen.getAllByText('Kayıt hatası')).toHaveLength(1);
  });

  it('on a pushed screen the dialog stays at the root, and the outlet goes with the modal screen', async () => {
    await renderWithDialogs();
    await act(async () => {
      navigationRef.navigate('Profile');
    });
    expect(await screen.findByTestId('screen-Profile')).toBeTruthy();
    act(() => dialog.showDialog({ title: 'Çıkış yap' }));
    const profile = screen.UNSAFE_getByType(LAZY_SCREENS.Profile() as React.ComponentType<object>);
    expect(within(profile).queryByText('Çıkış yap')).toBeNull();
    expect(screen.getAllByText('Çıkış yap')).toHaveLength(1);
    act(() => dialog.hideDialog());

    // Into the voice flow and back out: the root takes the dialog again.
    await act(async () => {
      navigationRef.navigate('VoiceConsent', { name: 'Annem' });
    });
    expect(await screen.findByTestId('screen-VoiceConsent')).toBeTruthy();
    await act(async () => {
      navigationRef.goBack();
    });
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(screen.queryByTestId('screen-VoiceConsent')).toBeNull();
    act(() => dialog.showDialog({ title: 'Tekrar' }));
    expect(screen.getAllByText('Tekrar')).toHaveLength(1);
    expect(within(profile).queryByText('Tekrar')).toBeNull();
  });
});

describe('boot route', () => {
  it('renders nothing while the boot route is not decided, then mounts on it', async () => {
    mockBoot.current = observable({ route: null as BootRouteLike }, undefined, { deep: false });
    const view = await renderNavigator();
    expect(view.toJSON()).toBeNull();
    expect(navigationRef.isReady()).toBe(false);
    expect(mockReleaseSplash).not.toHaveBeenCalled();

    await act(async () => {
      setBootRoute({ name: 'NoInternet', params: { reason: 'server' } });
    });
    expect(await screen.findByTestId('screen-NoInternet')).toHaveTextContent('NoInternet {"reason":"server"}');
    expect(rootRouteNames()).toEqual(['NoInternet']);
  });

  it.each([
    [{ name: 'Main' }, 'Main'],
    [{ name: 'Login', params: { firstRun: true } }, 'Login'],
    [{ name: 'ForceUpdate', params: { message: 'Güncelle', storeUrl: null } }, 'ForceUpdate'],
  ])('starts on %j with no other route', async (route, name) => {
    mockBoot.current = observable({ route: route as BootRouteLike }, undefined, { deep: false });
    await renderNavigator();
    expect(screen.getByTestId(`screen-${name}`)).toBeTruthy();
    expect(rootRouteNames()).toEqual([name]);
    expect(navigationRef.getRootState().routes[0].params).toEqual('params' in route ? route.params : undefined);
  });

  it('registers no Splash route', async () => {
    await renderNavigator();
    expect(navigationRef.getRootState().routeNames).not.toContain('Splash');
    expect(mockCollected.screens.has('Splash')).toBe(false);
  });

  it('releases the native splash once the first route drew', async () => {
    render(<RootNavigator />);
    // onReady schedules it for the next frame.
    expect(mockReleaseSplash).not.toHaveBeenCalled();
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(mockReleaseSplash).toHaveBeenCalledTimes(1);
    expect(mockReleaseSplash).toHaveBeenCalledWith('first-route');
  });

  it('on Onboarding leaves the release to the first-picture hold', async () => {
    mockBoot.current = observable({ route: { name: 'Onboarding' } as BootRouteLike }, undefined, { deep: false });
    await renderNavigator();
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(screen.getByTestId('screen-Onboarding')).toBeTruthy();
    expect(mockReleaseSplash).not.toHaveBeenCalled();
  });

  it('renders the app-wide hosts inside the navigation container', async () => {
    await renderNavigator();
    expect(screen.getByTestId('root-hosts')).toHaveTextContent('inside');
  });
});

describe('session', () => {
  it('resets to Login when the session ends', async () => {
    const discoverReset = jest.spyOn(getDiscoverStore(), 'reset');
    const languageReset = jest.spyOn(getContentLanguageStore(), 'reset');
    await renderNavigator();
    await act(async () => {
      navigationRef.navigate('Profile');
    });
    expect(rootRouteNames()).toEqual(['Main', 'Profile']);

    await act(async () => {
      runInAction(() => {
        mockAuthStore.current!.isAuthenticated = false;
        mockAuthStore.current!.backendUser = null;
      });
    });

    expect(await screen.findByTestId('screen-Login')).toBeTruthy();
    expect(rootRouteNames()).toEqual(['Login']);
    expect(navigationRef.getRootState().routes[0].params).toBeUndefined();
    expect(mockSubscriptionStore.reset).toHaveBeenCalled();
    expect(discoverReset).toHaveBeenCalledTimes(1);
    expect(languageReset).toHaveBeenCalledTimes(1);
  });

  it('does not reset while the session stays', async () => {
    await renderNavigator();
    await act(async () => {
      navigationRef.navigate('Profile');
    });
    await act(async () => {
      runInAction(() => {
        mockAuthStore.current!.backendUser = { id: 'u-1', subscriptionTier: 'PRO' };
      });
    });
    expect(rootRouteNames()).toEqual(['Main', 'Profile']);
  });

  it('syncs the subscription tier and the push bridge with the backend user', async () => {
    await renderNavigator();
    expect(mockSubscriptionStore.setTierFromUser).toHaveBeenCalledWith('PRO');
    expect(mockSubscriptionStore.refresh).toHaveBeenCalledTimes(1);
    expect(mockPushBridge).toHaveBeenLastCalledWith('u-1');
  });

  it('refreshes the subscription once per user id, and seeds a changed tier', async () => {
    await renderNavigator();
    expect(mockSubscriptionStore.refresh).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionStore.setTierFromUser).toHaveBeenCalledTimes(1);

    // The live /users/me answer replaces the cached user: same id, new object.
    await act(async () => {
      runInAction(() => {
        mockAuthStore.current!.backendUser = { id: 'u-1', subscriptionTier: 'PRO' };
      });
    });
    expect(mockSubscriptionStore.refresh).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionStore.setTierFromUser).toHaveBeenCalledTimes(1);

    // The tier changed on the backend: seeded again, still no second refresh.
    await act(async () => {
      runInAction(() => {
        mockAuthStore.current!.backendUser = { id: 'u-1', subscriptionTier: 'FREE' };
      });
    });
    expect(mockSubscriptionStore.setTierFromUser).toHaveBeenLastCalledWith('FREE');
    expect(mockSubscriptionStore.refresh).toHaveBeenCalledTimes(1);

    // Another account: a refresh of its own.
    await act(async () => {
      runInAction(() => {
        mockAuthStore.current!.backendUser = { id: 'u-2', subscriptionTier: 'FREE' };
      });
    });
    expect(mockSubscriptionStore.refresh).toHaveBeenCalledTimes(2);
    expect(mockPushBridge).toHaveBeenLastCalledWith('u-2');
  });

  it('a failing subscription refresh does not break rendering', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSubscriptionStore.refresh.mockRejectedValue(new Error('offline'));
    await renderNavigator();
    expect(screen.getByTestId('screen-Main')).toBeTruthy();
    expect(warn).toHaveBeenCalledWith('Subscription refresh after auth failed:', expect.any(Error));
  });

  it('a signed-out start resets the subscription store', async () => {
    mockAuthStore.current = observable({ isAuthenticated: false, backendUser: null as MockUser | null });
    mockBoot.current = observable({ route: { name: 'Login' } as BootRouteLike }, undefined, { deep: false });
    await renderNavigator();
    expect(mockSubscriptionStore.reset).toHaveBeenCalled();
    expect(mockSubscriptionStore.refresh).not.toHaveBeenCalled();
    expect(mockSubscriptionStore.setTierFromUser).not.toHaveBeenCalled();
    expect(mockPushBridge).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId('screen-Login')).toBeTruthy();
  });
});

describe('push taps', () => {
  it('a tap queued on the Login boot route runs once the Main shell is mounted', async () => {
    mockBoot.current = observable({ route: { name: 'Login' } as BootRouteLike }, undefined, { deep: false });
    await renderNavigator();
    queueNotificationOpen({ kind: 'player', narrationId: 'nar-1' }, null);
    expect(screen.queryByTestId('screen-AudioPlayer')).toBeNull();

    await act(async () => {
      navigationRef.reset({ index: 0, routes: [{ name: 'Main' }] });
    });
    // onStateChange flushed the queued tap; a tap never autoplays.
    expect(await screen.findByTestId('screen-AudioPlayer')).toHaveTextContent(
      'AudioPlayer {"narrationId":"nar-1"}',
    );
  });

  it('a tap from a cold start on Main runs when the container is ready', async () => {
    queueNotificationOpen({ kind: 'story', storyId: 's-1' }, null);
    await renderNavigator();
    expect(await screen.findByTestId('screen-StoryDetail')).toHaveTextContent('StoryDetail {"storyId":"s-1"}');
    expect(rootRouteNames()).toEqual(['Main', 'StoryDetail']);
  });

  it.each([
    [{ kind: 'story', storyId: 's-1' } as const, 'StoryDetail'],
    [{ kind: 'voices' } as const, 'VoiceProfiles'],
  ])('push target %j opens %s', async (target, routeName) => {
    await renderNavigator();
    await act(async () => {
      queueNotificationOpen(target, null);
    });
    expect(await screen.findByTestId(`screen-${routeName}`)).toBeTruthy();
  });

  it('a story tap over the player of that story goes back to its page', async () => {
    await renderNavigator();
    await act(async () => {
      navigationRef.navigate('StoryDetail', { storyId: 's-1' });
    });
    await act(async () => {
      navigationRef.navigate('AudioPlayer', { narrationId: 'nar-1' });
    });
    expect(rootRouteNames()).toEqual(['Main', 'StoryDetail', 'AudioPlayer']);

    await act(async () => {
      queueNotificationOpen({ kind: 'story', storyId: 's-1' }, null);
    });
    expect(rootRouteNames()).toEqual(['Main', 'StoryDetail']);
  });
});
