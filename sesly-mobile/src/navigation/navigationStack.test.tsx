/**
 * React Navigation 7 stack behaviour the screens rely on, with a real
 * NavigationContainer, a real native stack and the Main tabs as a real bottom
 * tab navigator (docs/release-pass/SPEC-startup.md 5.6):
 *  - `navigate` pushes a second copy of a screen that is already below;
 *    navigateSingleton goes back to it instead;
 *  - Registration's "Giriş yap" pops to the Login below (or replaces itself
 *    when it is the root), a finished sign-up resets to Main;
 *  - "Göster" in a collection pops to Main on the Library tab;
 *  - openStoryDetail goes back to the page of the same story.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => jest.requireActual('@react-navigation/native'));
jest.mock('react-native-safe-area-context', () =>
  jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

import {
  NavigationContainer,
  StackActions,
  createNavigationContainerRef,
  type NavigationState,
  type PartialState,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { RootStackParamList } from './RootNavigator';
import type { MainTabParamList } from '../screens/main/MainScaffold';
import { navigateSingleton } from './navigateSingleton';
import { openStoryDetail } from './openStory';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const ref = createNavigationContainerRef<RootStackParamList>();

const Probe = ({ route }: { route: { name: string; params?: object } }) => (
  <Text testID={`screen-${route.name}`}>{`${route.name} ${JSON.stringify(route.params ?? {})}`}</Text>
);

const MainTabs = () => (
  <Tab.Navigator screenOptions={{ headerShown: false, lazy: true, freezeOnBlur: true, animation: 'none' }}>
    <Tab.Screen name="Stories" component={Probe} />
    <Tab.Screen name="Discover" component={Probe} />
    <Tab.Screen name="Library" component={Probe} />
    <Tab.Screen name="Voices" component={Probe} />
  </Tab.Navigator>
);

type InitialState = PartialState<NavigationState>;

async function renderStack(initialState?: InitialState) {
  render(
    <NavigationContainer ref={ref} initialState={initialState}>
      <Stack.Navigator screenOptions={{ headerShown: false, freezeOnBlur: true }}>
        <Stack.Screen name="Login" component={Probe} />
        <Stack.Screen name="Registration" component={Probe} />
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="StoryDetail" component={Probe} />
        <Stack.Screen name="CollectionDetail" component={Probe} />
        <Stack.Screen name="AudioPlayer" component={Probe} />
        <Stack.Screen name="Profile" component={Probe} />
        <Stack.Screen name="Notifications" component={Probe} />
        <Stack.Screen name="Subscription" component={Probe} />
        <Stack.Screen name="DataDeletion" component={Probe} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  await settle();
}

/** Lets the stack commit and DelayedFreeze run (it freezes on setImmediate). */
async function settle() {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
}

async function run(step: () => void) {
  await act(async () => {
    step();
  });
  await settle();
}

const stackNames = () => ref.getRootState().routes.map(route => route.name);

function focusedTab(): string | undefined {
  const main = ref.getRootState().routes.find(route => route.name === 'Main');
  const tabs = main?.state as { index?: number; routes: { name: string }[] } | undefined;
  return tabs ? tabs.routes[tabs.index ?? 0]?.name : undefined;
}

const atMain = (): InitialState => ({ index: 0, routes: [{ name: 'Main' }] });

describe('screens that exist once', () => {
  it('a plain navigate stacks a second Profile (why navigateSingleton exists)', async () => {
    await renderStack(atMain());
    await run(() => ref.navigate('Profile'));
    await run(() => ref.navigate('Notifications'));
    await run(() => ref.navigate('Profile'));
    expect(stackNames()).toEqual(['Main', 'Profile', 'Notifications', 'Profile']);
  });

  it('Main, Profile, Notifications, then Profile through navigateSingleton ends at [Main, Profile]', async () => {
    await renderStack(atMain());
    await run(() => navigateSingleton(ref, 'Profile'));
    await run(() => navigateSingleton(ref, 'Notifications'));
    expect(stackNames()).toEqual(['Main', 'Profile', 'Notifications']);

    // "Bildirim tercihleri" on the empty notifications list.
    await run(() => navigateSingleton(ref, 'Profile'));

    expect(stackNames()).toEqual(['Main', 'Profile']);
    expect(screen.getByTestId('screen-Profile')).toBeTruthy();
  });

  it('pushes a singleton that is not in the stack yet', async () => {
    await renderStack(atMain());
    await run(() => navigateSingleton(ref, 'Subscription'));
    await run(() => navigateSingleton(ref, 'DataDeletion'));
    expect(stackNames()).toEqual(['Main', 'Subscription', 'DataDeletion']);
  });
});

describe('auth flow', () => {
  it('Login, Registration, then popTo Login ends at [Login]', async () => {
    await renderStack({ index: 0, routes: [{ name: 'Login' }] });
    await run(() => ref.navigate('Registration'));
    expect(stackNames()).toEqual(['Login', 'Registration']);

    await run(() => ref.dispatch(StackActions.popTo('Login')));

    expect(stackNames()).toEqual(['Login']);
  });

  it('popTo Login replaces Registration when it is the root', async () => {
    await renderStack({ index: 0, routes: [{ name: 'Registration' }] });

    await run(() => ref.dispatch(StackActions.popTo('Login')));

    expect(stackNames()).toEqual(['Login']);
    expect(screen.getByTestId('screen-Login')).toBeTruthy();
  });

  it('a reset after sign-up ends at [Main]', async () => {
    await renderStack({ index: 0, routes: [{ name: 'Login' }] });
    await run(() => ref.navigate('Registration'));

    await run(() => ref.reset({ index: 0, routes: [{ name: 'Main' }] }));

    expect(stackNames()).toEqual(['Main']);
    expect(focusedTab()).toBe('Stories');
  });

  it('a reset after sign-up with the record intent opens Sesim', async () => {
    await renderStack({ index: 0, routes: [{ name: 'Login' }] });

    await run(() => ref.reset({ index: 0, routes: [{ name: 'Main', params: { screen: 'Voices' } }] }));

    expect(stackNames()).toEqual(['Main']);
    expect(focusedTab()).toBe('Voices');
  });
});

describe('back to a tab', () => {
  it("popTo('Main', { screen: 'Library' }) from CollectionDetail ends at [Main] on the Library tab", async () => {
    await renderStack(atMain());
    expect(focusedTab()).toBe('Stories');
    await run(() => ref.navigate('CollectionDetail', { slug: 'uyku' }));
    expect(stackNames()).toEqual(['Main', 'CollectionDetail']);

    await run(() =>
      ref.dispatch(StackActions.popTo('Main', { screen: 'Library' })),
    );

    expect(stackNames()).toEqual(['Main']);
    expect(focusedTab()).toBe('Library');
    expect(screen.getByTestId('screen-Library')).toBeTruthy();
  });
});

describe('openStoryDetail', () => {
  it('from the player of the story below, goes back to that page', async () => {
    await renderStack(atMain());
    await run(() => ref.navigate('StoryDetail', { storyId: 's-1' }));
    await run(() => ref.navigate('AudioPlayer', { narrationId: 'nar-1' }));

    await run(() => openStoryDetail(ref, 's-1'));

    expect(stackNames()).toEqual(['Main', 'StoryDetail']);
  });

  it('from the player of another story, pushes the new page', async () => {
    await renderStack(atMain());
    await run(() => ref.navigate('StoryDetail', { storyId: 's-1' }));
    await run(() => ref.navigate('AudioPlayer', { narrationId: 'nar-1' }));

    await run(() => openStoryDetail(ref, 's-2'));

    expect(stackNames()).toEqual(['Main', 'StoryDetail', 'AudioPlayer', 'StoryDetail']);
    expect(ref.getCurrentRoute()?.params).toEqual({ storyId: 's-2' });
  });
});
