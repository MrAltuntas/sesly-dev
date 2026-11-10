/**
 * MainScaffold: the app shell after sign in (design v4 playful).
 *
 * A tab bar with four labelled destinations (`.tabs`):
 *
 *   Stories   "Masallar"   HomeScreen
 *   Discover  "Keşfet"     StoryLibraryScreen (search and filters over all stories)
 *   Library   "Kütüphane"  MyLibraryScreen (what the user listened to and saved)
 *   Voices    "Sesim"      VoiceProfilesScreen
 *
 * The bottom chrome is part of the layout: the offline banner (only while
 * offline) above the bar, 66dp plus the system inset, in the bar colour; the
 * active tab is a raised pill (on a 2dp lip, fully inside the bar) with the
 * filled icon in the action colour, the others show the outline icon.
 * Profile is reached from the avatar in a tab's app bar.
 *
 * The mini player is not: while a story plays (and for a moment after a
 * pause from its own button, `audio.showMiniPlayer`) it floats over the tab
 * scene on the measured chrome (`MiniPlayerOverlay`, absolute), with the
 * content fading out behind it, so showing or hiding it never changes the
 * scene's height. It rises 24dp into place while it fades in
 * (`DURATION.enter`) and sinks back while it fades out (`DURATION.exit`);
 * under reduced motion it only fades. Mounted while already shown, or
 * changed while another screen covers the shell (the player), it is drawn
 * at rest: back on the shell nothing moves. Tab lists leave room for it
 * with `useMiniPlayerInset()`, and the snackbar floats above it.
 *
 * Switching tabs is instant (no scene animation). A visited tab that is not
 * shown is frozen (`freezeOnBlur`), so it does not render on store changes
 * or a palette pick; it catches up when it is shown again. Only Home loads
 * with the shell; Keşfet, Kütüphane and Sesim load on their first visit.
 * The shell (tab bar and mini player) and every tab sit in their own palette
 * boundary.
 *
 * Press feedback: an unfocused tab dims while held (it has no lip); the
 * focused pill sinks onto its 2dp lip. A tab that becomes focused is drawn
 * undimmed at once, also when the press that focused it is still held or
 * its press-out comes late. A newly focused pill fades in and grows from 0.9
 * (DURATION.base).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  createBottomTabNavigator,
  BottomTabBarProps,
  BottomTabNavigationOptions,
} from '@react-navigation/bottom-tabs';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { withAlpha } from '../../theme/color';
import { ScreenPalette, withScreenPalette } from '../../theme/ThemeProvider';
import { animateTo, useReducedMotion } from '../../theme/motion';
import { usePressSink } from '../../components/design/Tactile';
import { usePressTint } from '../../components/design/usePressTint';
import { Icon, IconName } from '../../components/design/Icon';
import { snackbar } from '../../components/design/Snackbar';
import { MINI_PLAYER_DOCK_HEIGHT } from '../../components/design/MiniPlayerBar';
import MiniPlayerDock from '../../components/audio/MiniPlayerDock';
import { OfflineBanner } from '../../components/common/OfflineBanner';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { lazyScreen } from './lazyScreen';

// Home is on the launch path; the other tabs load on their first visit.
import HomeScreen from '../home/HomeScreen';

export type MainTabName = 'Stories' | 'Discover' | 'Library' | 'Voices';

export type MainTabParamList = {
  Stories: undefined;
  /** `category`: open filtered to one story category (Home category tiles). */
  Discover: { category?: string } | undefined;
  Library: undefined;
  Voices: undefined;
};

/** Order, icon and label key of each destination. */
export const MAIN_TABS: readonly { name: MainTabName; icon: IconName; labelKey: string }[] = [
  { name: 'Stories', icon: 'book', labelKey: 'tabs.stories' },
  { name: 'Discover', icon: 'compass', labelKey: 'tabs.discover' },
  { name: 'Library', icon: 'books', labelKey: 'tabs.library' },
  { name: 'Voices', icon: 'mic', labelKey: 'tabs.voice' },
];

export const NAV_BAR_HEIGHT = 66;

/** The active tab's pill: 56 x 32 on a 2dp lip, inside the 66dp bar. */
const TAB_PILL_W = 56;
const TAB_PILL_H = 32;
const TAB_PILL_LIP = 2;
/** A newly focused pill grows from this scale to 1. */
export const TAB_PILL_ENTER_SCALE = 0.9;

/** The mini player rises this far into place (and sinks this far when it leaves). */
export const MINI_PLAYER_ENTER_OFFSET = SPACE.xxl;
/** Height of the fade above the mini player, where the content fades out behind it. */
export const MINI_PLAYER_FADE_HEIGHT = SPACE.xxl;

const Tab = createBottomTabNavigator<MainTabParamList>();

/**
 * Tab options: no header, a tab renders on its first visit, a visited tab
 * that is not shown is frozen, and the switch is instant.
 */
export const MAIN_TAB_SCREEN_OPTIONS = {
  headerShown: false,
  lazy: true,
  freezeOnBlur: true,
  animation: 'none',
} as const satisfies BottomTabNavigationOptions;

const HomeTab = withScreenPalette(HomeScreen);

/** The tabs that load on their first visit (getComponent). */
export const LAZY_TABS = {
  Discover: lazyScreen(
    () => (require('../story/StoryLibraryScreen') as typeof import('../story/StoryLibraryScreen')).default,
  ),
  Library: lazyScreen(
    () => (require('../library/MyLibraryScreen') as typeof import('../library/MyLibraryScreen')).default,
  ),
  Voices: lazyScreen(
    () => (require('../voice/VoiceProfilesScreen') as typeof import('../voice/VoiceProfilesScreen')).default,
  ),
};

const MainShell: React.FC = () => {
  const T = useT();
  const styles = stylesFor(T);
  const insets = useSafeAreaInsets();
  // The bottom chrome as measured (offline banner and nav bar): the mini
  // player floats on it. Until the first layout: the bar with its top line.
  const [barHeight, setBarHeight] = useState(NAV_BAR_HEIGHT + T.hairline + insets.bottom);
  const screenOptions = useMemo<BottomTabNavigationOptions>(
    () => ({ ...MAIN_TAB_SCREEN_OPTIONS, sceneStyle: styles.scene }),
    [styles],
  );
  const renderTabBar = useCallback(
    (props: BottomTabBarProps) => <MainBottomBar {...props} onBarLayout={setBarHeight} />,
    [],
  );

  return (
    <View style={styles.root}>
      <Tab.Navigator tabBar={renderTabBar} screenOptions={screenOptions}>
        <Tab.Screen name="Stories" component={HomeTab} />
        <Tab.Screen name="Discover" getComponent={LAZY_TABS.Discover} />
        <Tab.Screen name="Library" getComponent={LAZY_TABS.Library} />
        <Tab.Screen name="Voices" getComponent={LAZY_TABS.Voices} />
      </Tab.Navigator>
      {/* After the navigator, inside the root view, so touches land in its bounds on Android. */}
      <MiniPlayerOverlay bottom={barHeight} />
      <SnackbarInset barHeight={barHeight} />
    </View>
  );
};

/**
 * The snackbar floats above the chrome and the mini player while the shell
 * is the top screen. Its own component (and a reaction), so neither a push
 * over the shell nor the mini player re-renders the tab navigator.
 */
const SnackbarInset: React.FC<{ barHeight: number }> = ({ barHeight }) => {
  const audio = useAudioPlayer();
  const shellFocused = useIsFocused();
  useEffect(() => {
    if (!shellFocused) {
      snackbar.setBottomInset(0);
      return undefined;
    }
    const dispose = reaction(
      () => !!audio.showMiniPlayer,
      shown => snackbar.setBottomInset(barHeight + (shown ? MINI_PLAYER_DOCK_HEIGHT : 0)),
      { fireImmediately: true },
    );
    return () => {
      dispose();
      snackbar.setBottomInset(0);
    };
  }, [shellFocused, barHeight, audio]);
  return null;
};

/** The Main route: the shell in its own palette boundary (the tab bar and the mini player follow it). */
export const MainScaffold: React.FC = () => (
  <ScreenPalette>
    <MainShell />
  </ScreenPalette>
);

// ─────────────────────────────────────────────────────────────
// Mini player overlay: floats on the bottom chrome
// ─────────────────────────────────────────────────────────────

/**
 * The mini player over the tab scene, `bottom` dp above the screen's bottom
 * edge (the measured chrome). It decides nothing itself: the store's
 * `showMiniPlayer` shows and hides it. It keeps its own `rendered` state so
 * the exit can play before the card unmounts; the motion is clipped at the
 * chrome's top edge, so the card rises from behind the bar.
 */
export const MiniPlayerOverlay: React.FC<{ bottom: number }> = observer(({ bottom }) => {
  const T = useT();
  const styles = stylesFor(T);
  const audio = useAudioPlayer();
  const shown = !!audio.showMiniPlayer;
  const reduced = useReducedMotion();
  // Read when a transition starts: a setting that changes later applies to the next one.
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  // A change while another screen covers the shell (the player) lands at
  // once: back on the shell the card is already at rest, or already gone.
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  // Drawn at rest when mounted while already shown, without a motion.
  const [rendered, setRendered] = useState(shown);
  const [motion] = useState(() => ({
    opacity: new Animated.Value(shown ? 1 : 0),
    translateY: new Animated.Value(shown ? 0 : MINI_PLAYER_ENTER_OFFSET),
  }));
  const lastShown = useRef(shown);

  useEffect(() => {
    if (lastShown.current === shown) return undefined;
    lastShown.current = shown;
    const { opacity, translateY } = motion;
    const isReduced = reducedRef.current;
    if (!focusedRef.current) {
      opacity.stopAnimation();
      translateY.stopAnimation();
      opacity.setValue(shown ? 1 : 0);
      translateY.setValue(shown ? 0 : MINI_PLAYER_ENTER_OFFSET);
      setRendered(shown);
      return undefined;
    }
    if (shown) {
      setRendered(true);
      const fade = animateTo(opacity, 1, 'enter', isReduced, { fade: true });
      const rise = animateTo(translateY, 0, 'enter', isReduced);
      return () => {
        fade?.stop();
        rise?.stop();
      };
    }
    const fade = animateTo(opacity, 0, 'exit', isReduced, {
      fade: true,
      onDone: finished => {
        if (!finished) return;
        translateY.setValue(MINI_PLAYER_ENTER_OFFSET);
        setRendered(false);
      },
    });
    // Reduced motion: it only fades, in place.
    const sink = isReduced ? null : animateTo(translateY, MINI_PLAYER_ENTER_OFFSET, 'exit', false);
    return () => {
      fade?.stop();
      sink?.stop();
    };
  }, [shown, motion]);

  if (!shown && !rendered) return null;
  const leaving = !shown;
  return (
    // Leaving, it is out of reach for touches and for screen readers alike
    // (a screen reader's activate does not go through pointerEvents).
    <View
      testID="mini-player-overlay"
      pointerEvents={leaving ? 'none' : 'box-none'}
      accessibilityElementsHidden={leaving}
      importantForAccessibility={leaving ? 'no-hide-descendants' : 'auto'}
      style={[styles.overlay, { bottom }]}
    >
      <Animated.View
        testID="mini-player-motion"
        pointerEvents="box-none"
        style={{ opacity: motion.opacity, transform: [{ translateY: motion.translateY }] }}
      >
        {/* The content fades out behind the floating mini player (`.fade`). */}
        <LinearGradient
          pointerEvents="none"
          testID="main-bottom-fade"
          colors={[withAlpha(T.bg, 0), withAlpha(T.bg, 0.94)]}
          style={styles.fade}
        />
        {/* Taps on the backdrop beside the card do not reach the hidden rows under it. */}
        <View style={styles.dock} testID="mini-player-dock">
          <MiniPlayerDock leaving={leaving} />
        </View>
      </Animated.View>
    </View>
  );
});

// ─────────────────────────────────────────────────────────────
// Bottom chrome: offline banner + navigation bar
// ─────────────────────────────────────────────────────────────

export interface MainBottomBarProps extends BottomTabBarProps {
  /** The measured height of the chrome (banner and bar), rounded. */
  onBarLayout?: (height: number) => void;
}

export const MainBottomBar: React.FC<MainBottomBarProps> = ({ state, navigation, onBarLayout }) => {
  const T = useT();
  const { t } = useTranslation('nav');
  const insets = useSafeAreaInsets();
  const styles = stylesFor(T);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      onBarLayout?.(Math.round(e.nativeEvent.layout.height));
    },
    [onBarLayout],
  );

  return (
    <View onLayout={onLayout} testID="main-bottom-chrome">
      <OfflineBanner />
      <View
        accessibilityRole="tablist"
        testID="main-nav-bar"
        style={[styles.bar, { paddingBottom: insets.bottom, minHeight: NAV_BAR_HEIGHT + insets.bottom }]}
      >
        {state.routes.map((route, index) => {
          const tab = MAIN_TABS.find(item => item.name === route.name);
          if (!tab) return null;
          const focused = state.index === index;
          const label = t(tab.labelKey);

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <TabItem
              key={route.key}
              name={tab.name}
              icon={tab.icon}
              label={label}
              focused={focused}
              onPress={onPress}
              styles={styles}
              T={T}
            />
          );
        })}
      </View>
    </View>
  );
};

const TabItem: React.FC<{
  name: MainTabName;
  icon: IconName;
  label: string;
  focused: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  T: Theme;
}> = ({ name, icon, label, focused, onPress, styles, T }) => {
  // The focused pill has a lip and sinks onto it; an unfocused tab has none
  // and only dims. The sink is inert while unfocused; only a press that
  // starts on an unfocused tab dims it.
  const { translateY, onPressIn: sinkIn, onPressOut: sinkOut } = usePressSink(TAB_PILL_LIP, focused);
  const {
    opacity: tintOpacity,
    onPressIn: tintIn,
    onPressOut: tintOut,
    reset: resetTint,
  } = usePressTint();
  const onPressIn = useCallback(() => {
    sinkIn();
    if (!focused) tintIn();
  }, [focused, sinkIn, tintIn]);
  const onPressOut = useCallback(() => {
    sinkOut();
    tintOut();
  }, [sinkOut, tintOut]);
  // A tab that becomes focused is drawn at rest at once. Most often the press
  // that focused it is still dimming it: onPress navigates at once, while
  // Pressability holds a short tap's press-out for up to 130 ms, and a tab
  // that mounts a heavy screen keeps JS busy meanwhile (V5R-01).
  useEffect(() => {
    if (focused) resetTint();
  }, [focused, resetTint]);

  const { opacity: pillOpacity, scale: pillScale } = usePillAppear(focused);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      // The bar is not inside scrolling content: answer the touch at once.
      unstable_pressDelay={0}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
      testID={`tab-${name}`}
      style={styles.item}
    >
      <Animated.View testID={`tab-content-${name}`} style={[styles.itemContent, { opacity: tintOpacity }]}>
        <View style={styles.pillWrap}>
          {focused ? (
            <Animated.View
              testID={`tab-indicator-lip-${name}`}
              style={[styles.pillLip, { opacity: pillOpacity, transform: [{ scale: pillScale }] }]}
            />
          ) : null}
          <Animated.View
            testID={`tab-indicator-${name}`}
            style={[styles.pill, { transform: [{ translateY }] }]}
          >
            {focused ? (
              // The pill's face: it fades and grows in, the icon stays put.
              <Animated.View
                testID={`tab-indicator-face-${name}`}
                style={[styles.pillFace, { opacity: pillOpacity, transform: [{ scale: pillScale }] }]}
              />
            ) : null}
            <Icon name={icon} filled={focused} size={24} color={focused ? T.action : T.text3} />
          </Animated.View>
        </View>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={[styles.label, { color: focused ? T.text : T.text3 }]}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
};

interface PillMotion {
  /** This focus came after the bar was first drawn: the pill moves in. */
  animateIn: boolean;
  opacity: Animated.Value;
  scale: Animated.Value;
}

/**
 * The pill of a tab that just became focused fades in and grows from 0.9 in
 * DURATION.base (under reduced motion the size is set at once and the fade
 * is short). The tab focused on mount shows its pill without motion.
 *
 * The pill's views exist only while the tab is focused, so every focus gets
 * fresh values: a native animation must never reach the views of an earlier
 * focus, which are unmounted.
 */
function usePillAppear(focused: boolean): PillMotion {
  const reduced = useReducedMotion();
  // False on the bar's first render only (no motion for the initial tab).
  const drawn = useRef(false);
  const motion = useMemo<PillMotion>(() => {
    const animateIn = focused && drawn.current;
    return {
      animateIn,
      opacity: new Animated.Value(animateIn ? 0 : 1),
      scale: new Animated.Value(animateIn ? TAB_PILL_ENTER_SCALE : 1),
    };
  }, [focused]);

  useEffect(() => {
    drawn.current = true;
  }, []);

  useEffect(() => {
    if (!motion.animateIn) return;
    // A motion setting that arrives meanwhile continues from where it is.
    const fade = animateTo(motion.opacity, 1, 'base', reduced, { fade: true });
    const grow = animateTo(motion.scale, 1, 'base', reduced);
    return () => {
      fade?.stop();
      grow?.stop();
    };
  }, [motion, reduced]);

  return motion;
}

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: T.bg },
    scene: { backgroundColor: T.bg },
    // Clips the motion at the chrome's top edge.
    overlay: { position: 'absolute', left: 0, right: 0, overflow: 'hidden' },
    fade: { height: MINI_PLAYER_FADE_HEIGHT },
    // Behind the card and the 4dp gap to the bar: the content, almost faded out.
    dock: { backgroundColor: withAlpha(T.bg, 0.94), paddingBottom: T.space.xs },
    bar: {
      flexDirection: 'row',
      backgroundColor: T.bar,
      borderTopWidth: T.hairline,
      borderTopColor: T.barLine,
      paddingHorizontal: T.space.tight,
    },
    item: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 0,
      paddingTop: T.space.tight,
      paddingBottom: T.space.tight,
      paddingHorizontal: T.space.xxs,
      minHeight: NAV_BAR_HEIGHT,
    },
    itemContent: { alignItems: 'center', maxWidth: '100%', gap: T.space.xs },
    pillWrap: { width: TAB_PILL_W, height: TAB_PILL_H + TAB_PILL_LIP },
    pillLip: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: TAB_PILL_LIP,
      height: TAB_PILL_H,
      borderRadius: TAB_PILL_H / 2,
      backgroundColor: T.lip,
    },
    pill: {
      width: TAB_PILL_W,
      height: TAB_PILL_H,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pillFace: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: TAB_PILL_H / 2,
      backgroundColor: T.surface2,
    },
    label: {
      fontFamily: T.fontLabel,
      fontSize: 11.5,
      lineHeight: 15,
    },
  });

const stylesFor = themedStyles(makeStyles);
