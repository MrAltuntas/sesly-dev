/**
 * OnboardingScreen (design v4 playful, frame f): three pages with a picture
 * card, the segmented progress, "Atla" (an empty slot of its size on the
 * last page), the recording pill and privacy line on the own-voice page,
 * and one primary button. "Sesimi kaydet" keeps the record intent; every
 * end opens Login on its first-run title (SPEC-startup 7.10, r8a-5, r8a-6,
 * sp-2, ux-19, perf-25). The page follows the pager while a swipe settles
 * (LA-9); the pictures decoded at boot are shown, and the first one fades in
 * only when the splash hold gave up on it (LA-5).
 */

import React from 'react';
import { Animated, Dimensions, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { dockBottom, themes } from '../../theme/theme';
import { DURATION } from '../../theme/motion';
import type { PaletteKey } from '../../theme/palettes';
import { ONBOARDING_INTENT_STORAGE_KEY } from '../../boot/onboardingIntent';
import {
  ONBOARDING_PICTURE_HOLD_MS,
  holdSplashForOnboardingPicture,
  markOnboardingPictureReady,
  resetSplashForTests,
} from '../../boot/splash';
import {
  ONBOARDING_PICTURES,
  onboardingPictureSources,
  prefetchOnboardingPictures,
  resetOnboardingPicturesForTests,
} from '../../boot/onboardingPictures';
import OnboardingScreen, {
  ONBOARDING_PAGES,
  FIRST_PICTURE_REVEAL_MS,
  ONBOARDING_SEEN_KEY,
  PAGE_PAD_BOTTOM,
  PAGE_PAD_TOP,
  PAGE_SETTLE_MS,
  PICTURE_HEIGHT,
  PICTURE_LIP,
  onboardingPictureHeight,
  pictureHeightFor,
} from './OnboardingScreen';

jest.setTimeout(60000);

// The real hold, with the picture's ready call watched.
jest.mock('../../boot/splash', () => {
  const actual = jest.requireActual('../../boot/splash');
  return { ...actual, markOnboardingPictureReady: jest.fn(actual.markOnboardingPictureReady) };
});

// The module object itself (a namespace import would be a copy of the mock).
const SafeArea = jest.requireMock<typeof import('react-native-safe-area-context')>('react-native-safe-area-context');
// The shared expo-image mock has no loadAsync; the boot decode tests add one.
const ExpoImageStatics = jest.requireMock<{ Image: { loadAsync?: jest.Mock } }>('expo-image').Image;

const navigation = { replace: jest.fn() };

const flatStyle = (node: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;

const layout = (width: number, height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });

async function renderOnboarding(theme: PaletteKey = 'gece-mavisi') {
  const view = renderWithProviders(<OnboardingScreen navigation={navigation as never} />, { theme });
  await act(async () => undefined);
  return view;
}

/** Swipes the pager to a page (of the window's width unless the pager was laid out). */
function swipeTo(page: number, width = Dimensions.get('window').width) {
  fireEvent(screen.getByTestId('onboarding-pager'), 'momentumScrollEnd', {
    nativeEvent: { contentOffset: { x: width * page } },
  });
}

/** A pager scroll event at `x` (every frame while it moves). */
function scrollPager(x: number) {
  fireEvent.scroll(screen.getByTestId('onboarding-pager'), { nativeEvent: { contentOffset: { x, y: 0 } } });
}

const faceHeight = (i: number) => flatStyle(screen.getByTestId(`onboarding-picture-${i}-face`)).height;

const transitionOf = (i: number) => screen.getByTestId(`onboarding-image-${i}`).props.transition;

const slotOpacity = (i: number) => flatStyle(screen.getByTestId(`onboarding-picture-slot-${i}`)).opacity;

beforeEach(async () => {
  navigation.replace.mockReset();
  (markOnboardingPictureReady as jest.Mock).mockClear();
  (SplashScreen.hideAsync as jest.Mock).mockResolvedValue(undefined);
  resetSplashForTests();
  resetOnboardingPicturesForTests();
  await AsyncStorage.clear();
});

afterEach(() => {
  resetSplashForTests();
  resetOnboardingPicturesForTests();
  delete ExpoImageStatics.loadAsync;
});

describe('OnboardingScreen pages', () => {
  it('keeps its three pages and their copy', async () => {
    await renderOnboarding();
    expect(ONBOARDING_PAGES.map(page => page.key)).toEqual(['house', 'voice', 'sleep']);
    expect(screen.getByText('Uyku vakti masalı,\ntanıdık bir sesle.')).toBeOnTheScreen();
    expect(
      screen.getByText('Hazır bir anlatıcı seç ya da 30 saniyelik bir kayıtla kendi sesini ekle.'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Masalları senin sesinle anlatalım.' })).toBeOnTheScreen();
    expect(screen.getByText('Her gece bir masal.')).toBeOnTheScreen();
    expect(
      screen.getByText('Sevdiğin masalları sakla. Uyku zamanlayıcısını kur, masal bitince kendiliğinden dursun.'),
    ).toBeOnTheScreen();
    for (let i = 0; i < 3; i++) {
      expect(screen.getByTestId(`onboarding-picture-${i}`)).toBeOnTheScreen();
    }
  });

  it('draws the own-voice page of frame f: pill over the picture and the privacy line', async () => {
    await renderOnboarding();
    expect(screen.getByTestId('onboarding-rec-pill')).toBeOnTheScreen();
    expect(screen.getByText('30 saniyelik kayıt')).toBeOnTheScreen();
    expect(screen.getByText('Kaydın yalnızca senin sesini oluşturmak için kullanılır.')).toBeOnTheScreen();
    // Only the voice page has them.
    expect(screen.getAllByTestId('icon-lock', { includeHiddenElements: true })).toHaveLength(1);
    expect(faceHeight(1)).toBe(PICTURE_HEIGHT);
  });

  it('pictures are expo-image views at the card size, with no fade', async () => {
    await renderOnboarding();
    for (let i = 0; i < 3; i++) {
      const image = screen.getByTestId(`onboarding-image-${i}`);
      expect(image.props).toMatchObject({ contentFit: 'cover', contentPosition: 'top', transition: 0 });
      expect(image.props.source).toBe(ONBOARDING_PAGES[i].picture);
      expect(flatStyle(image).height).toBe(faceHeight(i));
    }
    expect(screen.getByTestId('onboarding-image-0').props.priority).toBe('high');
  });

  it("the first picture's load ends the splash hold, the others do not", async () => {
    await renderOnboarding();
    fireEvent(screen.getByTestId('onboarding-image-1'), 'load', { source: { width: 1080, height: 1440 } });
    expect(screen.getByTestId('onboarding-image-1').props.onLoad).toBeUndefined();
    expect(markOnboardingPictureReady).not.toHaveBeenCalled();

    fireEvent(screen.getByTestId('onboarding-image-0'), 'load', { source: { width: 1080, height: 1440 } });
    expect(markOnboardingPictureReady).toHaveBeenCalledTimes(1);
  });

  it('page paddings and the footer follow the dock rule', async () => {
    jest.spyOn(SafeArea, 'useSafeAreaInsets').mockReturnValue({ top: 24, right: 0, bottom: 48, left: 0 });
    await renderOnboarding();
    expect(flatStyle(screen.getByTestId('onboarding-footer')).paddingBottom).toBe(dockBottom(48));
    expect(flatStyle(screen.getByTestId('onboarding')).paddingTop).toBe(24);
    const page = screen.getByTestId('onboarding-page-0');
    expect(StyleSheet.flatten(page.props.contentContainerStyle)).toMatchObject({
      paddingTop: PAGE_PAD_TOP,
      paddingBottom: PAGE_PAD_BOTTOM,
    });
  });
});

describe('OnboardingScreen top row and footer', () => {
  it('the top row is 48 tall on every page and keeps Skip room on the last page', async () => {
    await renderOnboarding();
    fireEvent(screen.getByTestId('onboarding-pager'), 'layout', layout(360, 552));
    const before = faceHeight(0);
    expect(flatStyle(screen.getByTestId('onboarding-top')).minHeight).toBe(48);
    expect(flatStyle(screen.getByTestId('onboarding-skip')).minHeight).toBe(48);
    expect(screen.queryByTestId('onboarding-skip-slot')).toBeNull();

    swipeTo(2, 360);
    expect(screen.queryByTestId('onboarding-skip')).toBeNull();
    expect(flatStyle(screen.getByTestId('onboarding-top')).minHeight).toBe(48);
    const slot = flatStyle(screen.getByTestId('onboarding-skip-slot', { includeHiddenElements: true }));
    expect(slot).toMatchObject({ width: 48, height: 48 });
    expect(faceHeight(0)).toBe(before);
  });

  it('the footer has the language switch and only the primary lg button', async () => {
    await renderOnboarding();
    const footer = screen.getByTestId('onboarding-footer');
    expect(React.Children.count(footer.props.children)).toBe(2);
    expect(within(footer).getByTestId('onboarding-language')).toBeOnTheScreen();
    expect(flatStyle(screen.getByTestId('onboarding-next-face')).minHeight).toBe(52);
    swipeTo(1);
    expect(screen.queryByTestId('onboarding-ready')).toBeNull();
    expect(screen.queryByText('Hazır anlatıcıyla başla')).toBeNull();
    expect(React.Children.count(screen.getByTestId('onboarding-footer').props.children)).toBe(2);
  });

  it('switches the app language before sign-in, and keeps the pick', async () => {
    await renderOnboarding();
    // Each language in its own name, the current one chosen.
    expect(screen.getByLabelText('Uygulama dili')).toBeOnTheScreen();
    expect(screen.getByTestId('onboarding-language-switch-tr-label')).toHaveTextContent('Türkçe');
    expect(screen.getByTestId('onboarding-language-switch-en-label')).toHaveTextContent('English');

    try {
      fireEvent.press(screen.getByTestId('onboarding-language-switch-en'));
      await act(async () => {
        jest.advanceTimersByTime(50);
        await Promise.resolve();
      });
      expect(i18n.language).toBe('en');
      expect(await AsyncStorage.getItem('@sesly/uiLanguage')).toBe('en');
      expect(screen.getByText('Skip')).toBeOnTheScreen();
      expect(screen.getByLabelText('App language')).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('onboarding-language-switch-tr'));
      await act(async () => {
        jest.advanceTimersByTime(50);
        await Promise.resolve();
      });
      expect(i18n.language).toBe('tr');
      expect(screen.getByText('Atla')).toBeOnTheScreen();
    } finally {
      await act(async () => {
        await i18n.changeLanguage('tr');
      });
      await AsyncStorage.removeItem('@sesly/uiLanguage');
    }
  });

  it('the progress fills up to the current page and the label reads the page', async () => {
    await renderOnboarding();
    expect(screen.getByLabelText('Sayfa 1, toplam 3')).toBeOnTheScreen();
    expect(screen.getAllByTestId('onboarding-seg-on')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Atla' })).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Devam' }));
    // The slide it starts brings the next page.
    scrollPager(Dimensions.get('window').width);
    expect(screen.getByLabelText('Sayfa 2, toplam 3')).toBeOnTheScreen();
    expect(screen.getAllByTestId('onboarding-seg-on')).toHaveLength(2);
    expect(screen.getAllByTestId('onboarding-seg')).toHaveLength(1);
    // The voice page: "Sesimi kaydet" with the mic.
    expect(screen.getByRole('button', { name: 'Sesimi kaydet' })).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('onboarding-next')).getByTestId('icon-mic', { includeHiddenElements: true }),
    ).toBeTruthy();

    swipeTo(2);
    expect(screen.getByLabelText('Sayfa 3, toplam 3')).toBeOnTheScreen();
    expect(screen.getAllByTestId('onboarding-seg-on')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Başla' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Atla' })).toBeNull();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('a swipe past the pages changes nothing', async () => {
    await renderOnboarding();
    swipeTo(5);
    expect(screen.getByLabelText('Sayfa 1, toplam 3')).toBeOnTheScreen();
  });
});

describe('OnboardingScreen swipe follows the pager (LA-9)', () => {
  const W = 360;

  async function renderLaidOut() {
    await renderOnboarding();
    fireEvent(screen.getByTestId('onboarding-pager'), 'layout', layout(W, 552));
  }

  it('scroll events come every frame', async () => {
    await renderLaidOut();
    expect(screen.getByTestId('onboarding-pager').props.scrollEventThrottle).toBe(16);
  });

  it('the label and progress change while the page settles, before the momentum ends', async () => {
    await renderLaidOut();
    fireEvent(screen.getByTestId('onboarding-pager'), 'scrollBeginDrag');
    scrollPager(W * 0.4);
    expect(screen.getByRole('button', { name: 'Devam' })).toBeOnTheScreen();

    scrollPager(W * 0.6);
    expect(screen.getByRole('button', { name: 'Sesimi kaydet' })).toBeOnTheScreen();
    expect(screen.getAllByTestId('onboarding-seg-on')).toHaveLength(2);
    scrollPager(W);

    // Page 2 to 3, the audit's case: "Başla" and the full progress as page 3 lands.
    fireEvent(screen.getByTestId('onboarding-pager'), 'scrollBeginDrag');
    scrollPager(W * 1.55);
    expect(screen.getByRole('button', { name: 'Başla' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Sayfa 3, toplam 3')).toBeOnTheScreen();
    expect(screen.getAllByTestId('onboarding-seg-on')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Atla' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sesimi kaydet' })).toBeNull();

    // The momentum ending on that page changes nothing more.
    scrollPager(W * 2);
    swipeTo(2, W);
    expect(screen.getByRole('button', { name: 'Başla' })).toBeOnTheScreen();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('a drag back under half shows the page it returns to', async () => {
    await renderLaidOut();
    fireEvent(screen.getByTestId('onboarding-pager'), 'scrollBeginDrag');
    scrollPager(W * 0.7);
    expect(screen.getByRole('button', { name: 'Sesimi kaydet' })).toBeOnTheScreen();

    scrollPager(W * 0.3);
    expect(screen.getByRole('button', { name: 'Devam' })).toBeOnTheScreen();
    expect(screen.getAllByTestId('onboarding-seg-on')).toHaveLength(1);
  });

  it('"Devam" changes the label and the progress with the slide, not before it (ONB-LABEL-EARLY)', async () => {
    await renderLaidOut();
    fireEvent.press(screen.getByRole('button', { name: 'Devam' }));
    // The tap's own frame: the page has not moved, so nothing else has.
    expect(screen.getByRole('button', { name: 'Devam' })).toBeOnTheScreen();
    expect(screen.getAllByTestId('onboarding-seg-on')).toHaveLength(1);
    expect(screen.getByLabelText('Sayfa 1, toplam 3')).toBeOnTheScreen();

    // The first half of the slide still shows the page it leaves.
    scrollPager(W * 0.1);
    scrollPager(W * 0.45);
    expect(screen.getByRole('button', { name: 'Devam' })).toBeOnTheScreen();
    expect(screen.getAllByTestId('onboarding-seg-on')).toHaveLength(1);

    // Past the middle: label and progress together.
    scrollPager(W * 0.55);
    expect(screen.getByRole('button', { name: 'Sesimi kaydet' })).toBeOnTheScreen();
    expect(screen.getAllByTestId('onboarding-seg-on')).toHaveLength(2);

    // It arrives; from there the pager drives the page again, and the
    // fallback does not move it later.
    scrollPager(W);
    act(() => jest.advanceTimersByTime(PAGE_SETTLE_MS));
    scrollPager(W * 1.6);
    expect(screen.getByRole('button', { name: 'Başla' })).toBeOnTheScreen();
  });

  it('a "Devam" slide that sends no scroll events still shows its page after the settle time', async () => {
    await renderLaidOut();
    fireEvent.press(screen.getByRole('button', { name: 'Devam' }));
    act(() => jest.advanceTimersByTime(PAGE_SETTLE_MS - 1));
    expect(screen.getByRole('button', { name: 'Devam' })).toBeOnTheScreen();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByRole('button', { name: 'Sesimi kaydet' })).toBeOnTheScreen();
    expect(screen.getAllByTestId('onboarding-seg-on')).toHaveLength(2);
  });

  it('a drag during the "Devam" slide takes over', async () => {
    await renderLaidOut();
    fireEvent.press(screen.getByRole('button', { name: 'Devam' }));
    scrollPager(W * 0.6);
    expect(screen.getByRole('button', { name: 'Sesimi kaydet' })).toBeOnTheScreen();

    fireEvent(screen.getByTestId('onboarding-pager'), 'scrollBeginDrag');
    scrollPager(W * 0.2);
    expect(screen.getByRole('button', { name: 'Devam' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Sayfa 1, toplam 3')).toBeOnTheScreen();
    // The slide's fallback was dropped with it: the page stays where the drag left it.
    act(() => jest.advanceTimersByTime(PAGE_SETTLE_MS * 2));
    expect(screen.getByLabelText('Sayfa 1, toplam 3')).toBeOnTheScreen();
  });

  it('a "Devam" slide that ends in a momentum event lets the pager drive again', async () => {
    await renderLaidOut();
    fireEvent.press(screen.getByRole('button', { name: 'Devam' }));
    swipeTo(1, W);
    scrollPager(W * 0.4);
    expect(screen.getByRole('button', { name: 'Devam' })).toBeOnTheScreen();
  });

  it('offsets outside the pages change nothing', async () => {
    await renderLaidOut();
    scrollPager(-40);
    scrollPager(W * 5);
    expect(screen.getByLabelText('Sayfa 1, toplam 3')).toBeOnTheScreen();
  });

  it('a swiped voice page ends with the record intent', async () => {
    await renderLaidOut();
    fireEvent(screen.getByTestId('onboarding-pager'), 'scrollBeginDrag');
    scrollPager(W);
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Sesimi kaydet' }));
    });
    await expect(AsyncStorage.getItem(ONBOARDING_INTENT_STORAGE_KEY)).resolves.toBe('record');
    expect(navigation.replace).toHaveBeenCalledTimes(1);
  });
});

describe('OnboardingScreen pictures and the splash hold (LA-5)', () => {
  it('a late first picture: the card stays hidden, then card and picture fade in together (ONB-PIC-LATE)', async () => {
    void holdSplashForOnboardingPicture();
    await renderOnboarding();
    // No picture fades on its own: the first card fades as a whole.
    expect([0, 1, 2].map(transitionOf)).toEqual([0, 0, 0]);
    expect(slotOpacity(0)).toBe(0);
    // The other cards are not held back.
    expect(slotOpacity(1)).toBeUndefined();
    expect(slotOpacity(2)).toBeUndefined();

    // The splash gives up: still no empty card on screen.
    act(() => jest.advanceTimersByTime(ONBOARDING_PICTURE_HOLD_MS));
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(slotOpacity(0)).toBe(0);

    const timing = jest.spyOn(Animated, 'timing');
    fireEvent(screen.getByTestId('onboarding-image-0'), 'load', { source: { width: 1080, height: 1440 } });
    // A fade of the whole card on the native driver, not a pop.
    expect(slotOpacity(0)).toBe(0);
    expect(timing).toHaveBeenCalledTimes(1);
    expect(timing.mock.calls[0][1]).toMatchObject({
      toValue: 1,
      duration: DURATION.enter,
      useNativeDriver: true,
    });
    timing.mockRestore();
  });

  it('a first picture that loaded under the splash is there at once, never fading', async () => {
    void holdSplashForOnboardingPicture();
    await renderOnboarding();
    expect(slotOpacity(0)).toBe(0);
    fireEvent(screen.getByTestId('onboarding-image-0'), 'load', { source: { width: 1080, height: 1440 } });
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(slotOpacity(0)).toBe(1);

    act(() => jest.advanceTimersByTime(ONBOARDING_PICTURE_HOLD_MS * 2));
    expect(transitionOf(0)).toBe(0);
    expect(slotOpacity(0)).toBe(1);
  });

  it('a first picture that fails, or never reports, still shows its card', async () => {
    await renderOnboarding();
    fireEvent(screen.getByTestId('onboarding-image-0'), 'error', { error: 'decode' });
    expect(slotOpacity(0)).toBe(1);
  });

  it('the card is shown after FIRST_PICTURE_REVEAL_MS when the picture never reports', async () => {
    await renderOnboarding();
    act(() => jest.advanceTimersByTime(FIRST_PICTURE_REVEAL_MS - 1));
    expect(slotOpacity(0)).toBe(0);
    act(() => jest.advanceTimersByTime(1 + DURATION.enter));
    expect(slotOpacity(0)).toBe(1);
  });

  it('shows the pictures decoded at boot, nothing while they decode, and lets go of them on unmount', async () => {
    const decodes: Array<(ref: object) => void> = [];
    ExpoImageStatics.loadAsync = jest.fn(() => new Promise(resolve => decodes.push(resolve)));
    prefetchOnboardingPictures();
    const view = await renderOnboarding();

    // Still decoding: an empty view, not a second load of the file.
    expect(screen.getByTestId('onboarding-image-0').props.source).toBeNull();
    const house = { decoded: 'house' };
    await act(async () => {
      decodes[0](house);
    });
    expect(screen.getByTestId('onboarding-image-0').props.source).toBe(house);
    expect(screen.getByTestId('onboarding-image-1').props.source).toBeNull();

    const voice = { decoded: 'voice' };
    const sleep = { decoded: 'sleep' };
    await act(async () => {
      decodes[1](voice);
      decodes[2](sleep);
    });
    expect(screen.getByTestId('onboarding-image-1').props.source).toBe(voice);
    expect(screen.getByTestId('onboarding-image-2').props.source).toBe(sleep);

    // Its load still ends the hold.
    fireEvent(screen.getByTestId('onboarding-image-0'), 'load', { source: { width: 1080, height: 1440 } });
    expect(markOnboardingPictureReady).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(onboardingPictureSources()).toEqual(ONBOARDING_PICTURES);
  });
});

describe('OnboardingScreen ends', () => {
  it('"Sesimi kaydet" stores the record intent and opens Login on its first-run title', async () => {
    await renderOnboarding();
    fireEvent.press(screen.getByTestId('onboarding-next'));
    act(() => jest.advanceTimersByTime(PAGE_SETTLE_MS));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Sesimi kaydet' }));
    });
    await expect(AsyncStorage.getItem(ONBOARDING_INTENT_STORAGE_KEY)).resolves.toBe('record');
    await expect(AsyncStorage.getItem(ONBOARDING_SEEN_KEY)).resolves.toBe('true');
    expect(navigation.replace).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith('Login', { firstRun: true });
  });

  it('"Atla" ends with no intent', async () => {
    await renderOnboarding();
    await act(async () => {
      fireEvent.press(screen.getByTestId('onboarding-skip'));
    });
    await expect(AsyncStorage.getItem(ONBOARDING_SEEN_KEY)).resolves.toBe('true');
    await expect(AsyncStorage.getItem(ONBOARDING_INTENT_STORAGE_KEY)).resolves.toBeNull();
    expect(navigation.replace).toHaveBeenCalledWith('Login', { firstRun: true });
  });

  it('"Başla" on the last page ends with no intent', async () => {
    await renderOnboarding();
    swipeTo(2);
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Başla' }));
    });
    await expect(AsyncStorage.getItem(ONBOARDING_SEEN_KEY)).resolves.toBe('true');
    await expect(AsyncStorage.getItem(ONBOARDING_INTENT_STORAGE_KEY)).resolves.toBeNull();
    expect(navigation.replace).toHaveBeenCalledWith('Login', { firstRun: true });
  });

  it('a second tap while it ends does not end twice', async () => {
    await renderOnboarding();
    await act(async () => {
      fireEvent.press(screen.getByTestId('onboarding-skip'));
      fireEvent.press(screen.getByTestId('onboarding-skip'));
      fireEvent.press(screen.getByTestId('onboarding-next'));
    });
    expect(navigation.replace).toHaveBeenCalledTimes(1);
  });

  it('still opens Login when storage fails', async () => {
    // Both writes fail (seen and the intent); later tests get the store back.
    jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('disk'))
      .mockRejectedValueOnce(new Error('disk'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await renderOnboarding();
      fireEvent.press(screen.getByTestId('onboarding-next'));
      act(() => jest.advanceTimersByTime(PAGE_SETTLE_MS));
      await act(async () => {
        fireEvent.press(screen.getByTestId('onboarding-next'));
      });
      expect(navigation.replace).toHaveBeenCalledWith('Login', { firstRun: true });
      expect(warn).toHaveBeenCalledWith('[onboardingIntent] could not store the intent:', expect.any(Error));
    } finally {
      warn.mockRestore();
    }
  });

  it('a double tap on "Devam" stops on the voice page instead of ending onboarding', async () => {
    await renderOnboarding();
    await act(async () => {
      fireEvent.press(screen.getByTestId('onboarding-next'));
      fireEvent.press(screen.getByTestId('onboarding-next'));
    });
    // The slide arrives on the voice page.
    scrollPager(Dimensions.get('window').width);
    expect(screen.getByRole('button', { name: 'Sesimi kaydet' })).toBeOnTheScreen();
    expect(navigation.replace).not.toHaveBeenCalled();

    // Just inside the settle time a press is still ignored; after it, it ends.
    act(() => jest.advanceTimersByTime(PAGE_SETTLE_MS - 50));
    await act(async () => {
      fireEvent.press(screen.getByTestId('onboarding-next'));
    });
    expect(navigation.replace).not.toHaveBeenCalled();
    await expect(AsyncStorage.getItem(ONBOARDING_INTENT_STORAGE_KEY)).resolves.toBeNull();

    act(() => jest.advanceTimersByTime(50));
    await act(async () => {
      fireEvent.press(screen.getByTestId('onboarding-next'));
    });
    expect(navigation.replace).toHaveBeenCalledWith('Login', { firstRun: true });
    await expect(AsyncStorage.getItem(ONBOARDING_INTENT_STORAGE_KEY)).resolves.toBe('record');
  });

  it('"Atla" on the voice page ends with no intent', async () => {
    await renderOnboarding();
    swipeTo(1);
    expect(screen.getByRole('button', { name: 'Sesimi kaydet' })).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Atla' }));
    });
    await expect(AsyncStorage.getItem(ONBOARDING_INTENT_STORAGE_KEY)).resolves.toBeNull();
    expect(navigation.replace).toHaveBeenCalledWith('Login', { firstRun: true });
  });
});

describe('OnboardingScreen picture size', () => {
  it('sizes every picture card from the tallest measured text block', async () => {
    await renderOnboarding();
    fireEvent(screen.getByTestId('onboarding-pager'), 'layout', layout(360, 552));
    // Before the text is measured: 55% of the page, capped by the mockup height.
    expect(faceHeight(0)).toBe(onboardingPictureHeight(552));

    [180, 257, 196].forEach((h, i) => {
      fireEvent(screen.getByTestId(`onboarding-text-${i}`), 'layout', layout(328, h));
    });
    const expected = pictureHeightFor(552, 257);
    expect(expected).toBe(267);
    for (let i = 0; i < 3; i++) {
      expect(faceHeight(i)).toBe(expected);
      expect(flatStyle(screen.getByTestId(`onboarding-image-${i}`)).height).toBe(expected);
    }

    // Reaching the last page changes nothing.
    swipeTo(2, 360);
    expect(screen.getByRole('button', { name: 'Başla' })).toBeOnTheScreen();
    expect(faceHeight(0)).toBe(expected);
  });

  it('the voice page leaves room for the pill above its headline', async () => {
    await renderOnboarding();
    expect(flatStyle(screen.getByTestId('onboarding-text-1')).paddingTop).toBe(44);
    expect(flatStyle(screen.getByTestId('onboarding-text-0')).paddingTop).toBe(20);
  });
});

describe('OnboardingScreen palettes and language', () => {
  it.each(['gece-mavisi', 'kitaplik', 'erik'] as const)('takes its colours from the %s palette', async key => {
    await renderOnboarding(key);
    const T = themes[key];
    expect(flatStyle(screen.getByTestId('onboarding')).backgroundColor).toBe(T.bg);
    expect(flatStyle(screen.getAllByTestId('onboarding-seg-on')[0]).backgroundColor).toBe(T.action);
    expect(flatStyle(screen.getAllByTestId('onboarding-seg')[0]).backgroundColor).toBe(T.line);
    expect(flatStyle(screen.getByTestId('onboarding-rec-mic')).backgroundColor).toBe(T.rec);
    expect(flatStyle(screen.getByTestId('onboarding-rec-pill-face')).backgroundColor).toBe(T.surface2);
    expect(flatStyle(screen.getByTestId('onboarding-picture-0-lip')).backgroundColor).toBe(T.lip);
    expect(flatStyle(screen.getByTestId('onboarding-next-face')).backgroundColor).toBe(T.action);
    expect(flatStyle(screen.getByTestId('onboarding-next-lip')).backgroundColor).toBe(T.actionLip);
    expect(flatStyle(screen.getByText('Her gece bir masal.'))).toMatchObject({
      color: T.text,
      fontFamily: T.fontDisplay,
      fontSize: 32,
    });
  });

  it('is translated', async () => {
    await i18n.changeLanguage('en');
    await renderOnboarding();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Next' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Page 1 of 3')).toBeOnTheScreen();
    expect(screen.getByText('A story every night.')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Let us tell the stories in your voice.' })).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Keep the stories you love. Set the sleep timer and playback stops by itself when the story ends.',
      ),
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('onboarding-next'));
    scrollPager(Dimensions.get('window').width);
    expect(screen.getByRole('button', { name: 'Record my voice' })).toBeOnTheScreen();
  });
});

describe('onboardingPictureHeight', () => {
  it('is the mockup height on a normal screen and before the page is measured', () => {
    expect(onboardingPictureHeight(0)).toBe(PICTURE_HEIGHT);
    expect(onboardingPictureHeight(531)).toBe(PICTURE_HEIGHT);
    expect(onboardingPictureHeight(900)).toBe(PICTURE_HEIGHT);
  });

  it('shrinks on short screens but keeps a minimum', () => {
    expect(onboardingPictureHeight(400)).toBe(220);
    expect(onboardingPictureHeight(200)).toBe(160);
  });
});

describe('pictureHeightFor', () => {
  it('is what the page leaves above the text, between the minimum and the mockup height', () => {
    const chrome = PAGE_PAD_TOP + PAGE_PAD_BOTTOM + PICTURE_LIP;
    expect(pictureHeightFor(475, 257)).toBe(475 - chrome - 257);
    expect(pictureHeightFor(475, 257)).toBe(190);
    expect(pictureHeightFor(475, 400)).toBe(160);
    expect(pictureHeightFor(700, 200)).toBe(290);
    // Rounded down, so the tallest page never overflows by a fraction.
    expect(pictureHeightFor(500.8, 200)).toBe(Math.floor(500.8 - chrome - 200));
    expect(pictureHeightFor(500.8, 200)).toBe(272);
  });
});
