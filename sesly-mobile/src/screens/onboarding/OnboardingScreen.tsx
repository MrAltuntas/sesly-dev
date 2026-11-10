/**
 * OnboardingScreen: three welcome pages (design v4 playful, frame f
 * "Tanışma, 2. adım").
 *
 * A fixed top row holds the segmented progress (one pill per page, the
 * action colour up to the current page) and "Atla"; on the last page an
 * empty slot of the same size takes its place, so nothing moves. Each page
 * is a rounded picture card on its lip, a Baloo 2 headline and one Nunito
 * sentence. The own-voice page adds the recording pill that overlaps the
 * picture's bottom edge and a small privacy line.
 *
 * The footer starts with the app language switch (Türkçe / English, a
 * compact segmented control behind a globe): a user whose phone is in
 * another language picks the app's language before signing in. It is the
 * same setting as the profile's "Uygulama dili" (`setUiLanguage`), and the
 * pages re-measure in the new language. Under it, one primary button: "Devam" on the first page, "Sesimi
 * kaydet" on the voice page and "Başla" on the last page. "Sesimi kaydet"
 * keeps the intent to record (`setOnboardingIntent('record')`) and ends
 * onboarding, so the first sign-in opens Sesim; "Atla" and "Başla" end it
 * with no intent. Every end replaces the screen with Login on its first-run
 * title. Recording itself happens after sign in (Sesim), so nothing here
 * asks for the microphone.
 *
 * The pictures are expo-image views drawn without a fade. On the Onboarding
 * boot route BootStore decodes them ahead (src/boot/onboardingPictures.ts)
 * and the views show the decoded pictures; otherwise each view loads its
 * file at its own size. The first one's load ends the splash hold of the
 * boot route (`markOnboardingPictureReady`), so the illustration lands under
 * the splash. The first card stays hidden (its place kept) until its picture
 * has drawn, so an empty card never shows (ONB-PIC-LATE); when the hold gave
 * up first (a slow device, a development build), card and picture fade in
 * together instead of popping in. Picture cards are as tall as the tallest
 * page's text allows, the same on every page.
 *
 * The page index follows the pager's offset while it moves (rounded to the
 * nearest page), so the progress and the button label change as the page
 * passes the middle, together with the slide, for a swipe and for "Devam"
 * alike (ONB-LABEL-EARLY). A "Devam" slide that sends no scroll events still
 * shows its page after PAGE_SETTLE_MS.
 */

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Animated,
  ImageSourcePropType,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { LIP, SPACE, Theme, dockBottom, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { Button } from '../../components/design/Button';
import { Icon } from '../../components/design/Icon';
import { Tactile } from '../../components/design/Tactile';
import { SegmentedControl } from '../../components/design/controls';
import { setUiLanguage } from '../../i18n';
import { UI_LANGUAGES, UI_LANGUAGE_NAMES, UiLanguage } from '../../i18n/language';
import { currentLanguage } from '../../i18n/text';
import { isOnboardingPictureLate, markOnboardingPictureReady } from '../../boot/splash';
import {
  ONBOARDING_PICTURES,
  ONBOARDING_PICTURE_WAIT_MS,
  OnboardingPictureKey,
  onboardingPictureSources,
  releaseOnboardingPictures,
  subscribeOnboardingPictures,
} from '../../boot/onboardingPictures';
import { OnboardingIntent, setOnboardingIntent } from '../../boot/onboardingIntent';
import { DURATION } from '../../theme/motion';

type RootStackParamList = {
  Onboarding: undefined;
  Login: { firstRun?: boolean } | undefined;
};

type OnboardingScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'Onboarding'
>;

interface OnboardingScreenProps {
  navigation: OnboardingScreenNavigationProp;
}

interface OnboardingPage {
  /** Key under `onboarding:pages` and of the picture. */
  key: OnboardingPictureKey;
  /** The bundled file (what the view loads when nothing was decoded ahead). */
  picture: ImageSourcePropType;
}

export const ONBOARDING_PAGES: readonly OnboardingPage[] = [
  { key: 'house', picture: ONBOARDING_PICTURES.house },
  { key: 'voice', picture: ONBOARDING_PICTURES.voice },
  { key: 'sleep', picture: ONBOARDING_PICTURES.sleep },
];

export const ONBOARDING_SEEN_KEY = 'hasSeenOnboarding';

/** Height of the picture card in the mockup (`.ob .pic`). */
export const PICTURE_HEIGHT = 290;
/** Lip under the picture card (an object taller than 72dp). */
export const PICTURE_LIP = LIP.lg;
const PICTURE_MIN_HEIGHT = 160;

/** Padding above and below a page's content. */
export const PAGE_PAD_TOP = SPACE.sm;
export const PAGE_PAD_BOTTOM = SPACE.lg;

/** How far the recording pill (with its lip) hangs below the picture card's lip. */
const REC_OVERHANG = SPACE.xxl;
/** Recording pill face and the mic disc inside it. */
const REC_PILL_H = 50;
const REC_MIC = 38;
/** Waveform bars in the recording pill. */
const REC_BAR_W = 3;

/** Space from the picture card to the headline (the voice page clears the pill first). */
function headlineOffset(voice: boolean): number {
  return voice ? REC_OVERHANG + SPACE.xl : SPACE.xl;
}

const clampPicture = (h: number) => Math.round(Math.max(PICTURE_MIN_HEIGHT, Math.min(PICTURE_HEIGHT, h)));

/**
 * Height of the picture card for the room a page has, before the text is
 * measured. The mockup gives it 290 of about 530dp between the top row and
 * the buttons; on a shorter screen it shrinks to 55% of the page. Before
 * the page is measured the mockup value is used.
 */
export function onboardingPictureHeight(pageHeight: number): number {
  if (!(pageHeight > 0)) return PICTURE_HEIGHT;
  return clampPicture(pageHeight * 0.55);
}

/**
 * Height of the picture card once the text is measured: what the page
 * leaves above the tallest text block (headline offset, headline, body and
 * the privacy line), between the minimum and the mockup height. Every page
 * uses the same value, so the cards do not change size while swiping.
 * Rounded down: a page that fits must not overflow by a rounding fraction
 * (its persistent Android scrollbar would show on a page that does not scroll).
 */
export function pictureHeightFor(pagerHeight: number, textBlockHeight: number): number {
  const room = Math.floor(pagerHeight - PAGE_PAD_TOP - PAGE_PAD_BOTTOM - PICTURE_LIP - textBlockHeight);
  return clampPicture(room);
}

/** Bar heights of the small waveform in the recording pill (mockup `#recw`). */
const REC_BARS = [8, 14, 20, 11, 17, 7, 13, 18, 9];

/**
 * After "Devam" moves on, the next page's primary ignores presses this long:
 * the voice page's "Sesimi kaydet" ends onboarding, so a double tap on
 * "Devam" must not end it.
 */
export const PAGE_SETTLE_MS = 400;

/**
 * The first picture card shows after this long even when its picture never
 * reported a load or an error (a bug): a hidden card must not stay hidden.
 */
export const FIRST_PICTURE_REVEAL_MS = 2 * ONBOARDING_PICTURE_WAIT_MS;

const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ navigation }) => {
  const T = useT();
  const { t } = useTranslation('onboarding');
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const styles = stylesFor(T);
  const text = textStylesFor(T);

  // The measured pager wins over the window size: under edge-to-edge the
  // two can differ by the system bars.
  const [pager, setPager] = useState<{ width: number; height: number } | null>(null);
  // The text block of every page (0 until measured).
  const [blocks, setBlocks] = useState<readonly number[]>(() => ONBOARDING_PAGES.map(() => 0));
  const pageW = pager?.width ?? window.width;
  const measured = blocks.every(h => h > 0);
  const pictureH = !pager
    ? PICTURE_HEIGHT
    : measured
      ? pictureHeightFor(pager.height, Math.max(...blocks))
      : onboardingPictureHeight(pager.height);
  // The illustrations are 3:4; the card shows their top part.
  const pictureW = pageW - 2 * T.screenPadH;

  const onPagerLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0 && (width !== pager?.width || height !== pager?.height)) {
      setPager({ width, height });
    }
  };

  const onBlockLayout = (i: number) => (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    setBlocks(prev => (prev[i] === h ? prev : prev.map((old, j) => (j === i ? h : old))));
  };

  // Decoded ahead on the boot route, else the bundled files; dropped on unmount.
  const pictures = useSyncExternalStore(subscribeOnboardingPictures, onboardingPictureSources);
  useEffect(() => releaseOnboardingPictures, []);
  // The first card is hidden until its picture drew (never an empty card);
  // when the splash went before that, it fades in as the picture lands.
  const firstCardOpacity = useRef(new Animated.Value(0)).current;
  const firstCardShown = useRef(false);
  const revealFirstCard = useRef(() => {
    if (firstCardShown.current) return;
    firstCardShown.current = true;
    if (isOnboardingPictureLate()) {
      Animated.timing(firstCardOpacity, {
        toValue: 1,
        duration: DURATION.enter,
        useNativeDriver: true,
      }).start();
    } else {
      // Under the splash: there from its first visible frame.
      firstCardOpacity.setValue(1);
    }
  }).current;
  const onFirstPictureLoad = useRef(() => {
    markOnboardingPictureReady();
    revealFirstCard();
  }).current;
  useEffect(() => {
    const timer = setTimeout(revealFirstCard, FIRST_PICTURE_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [revealFirstCard]);

  const [index, setIndex] = useState(0);
  // The shown page, current between renders (scroll events come every frame).
  const shownIndex = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const finishing = useRef(false);
  // When "Devam" last moved on (0 before it ever did).
  const movedAt = useRef(0);
  // The page a "Devam" slide is heading to, until it gets there or a drag takes over.
  const slideTarget = useRef<number | null>(null);
  // Shows the slide's page should the pager send no scroll events for it.
  const slideFallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endSlide = () => {
    slideTarget.current = null;
    if (slideFallback.current !== null) {
      clearTimeout(slideFallback.current);
      slideFallback.current = null;
    }
  };
  useEffect(
    () => () => {
      if (slideFallback.current !== null) clearTimeout(slideFallback.current);
    },
    [],
  );
  const isLast = index === ONBOARDING_PAGES.length - 1;
  const onVoicePage = ONBOARDING_PAGES[index]?.key === 'voice';

  const showPage = (page: number) => {
    if (page === shownIndex.current || page < 0 || page >= ONBOARDING_PAGES.length) return;
    shownIndex.current = page;
    setIndex(page);
  };

  const pageAt = (x: number) => Math.round(x / pageW);

  const finish = async (intent?: OnboardingIntent) => {
    if (finishing.current) return;
    finishing.current = true;
    const seen = AsyncStorage.setItem(ONBOARDING_SEEN_KEY, 'true').catch(() => {
      // Non-fatal; proceed anyway.
    });
    // Never throws (a failed write only means Home after sign-in).
    await Promise.all([seen, intent ? setOnboardingIntent(intent) : undefined]);
    navigation.replace('Login', { firstRun: true });
  };

  const handlePrimary = () => {
    // The second tap of a double tap on "Devam".
    if (Date.now() - movedAt.current < PAGE_SETTLE_MS) return;
    if (isLast) {
      void finish();
      return;
    }
    if (onVoicePage) {
      void finish('record');
      return;
    }
    const next = index + 1;
    movedAt.current = Date.now();
    endSlide();
    slideTarget.current = next;
    // The label and the progress move with the page (at the middle of the
    // slide, in onScroll), not in this frame ahead of it.
    slideFallback.current = setTimeout(() => {
      slideFallback.current = null;
      const target = slideTarget.current;
      slideTarget.current = null;
      if (target !== null) showPage(target);
    }, PAGE_SETTLE_MS);
    scrollRef.current?.scrollTo({ x: next * pageW, animated: true });
  };

  // Every frame while the pager moves: the page nearest the offset is shown,
  // so the progress and the label change as the page passes the middle, for
  // a swipe and for the "Devam" slide alike.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const page = pageAt(x);
    const target = slideTarget.current;
    if (target !== null && page === target && Math.abs(x - target * pageW) < 1) endSlide();
    showPage(page);
  };

  // A drag takes over from a "Devam" slide.
  const onScrollBeginDrag = () => {
    endSlide();
  };

  // Where the pager came to rest is the page.
  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    endSlide();
    showPage(pageAt(e.nativeEvent.contentOffset.x));
  };

  const primaryLabel = isLast ? t('start') : onVoicePage ? t('recordVoice') : t('next');
  // Each language in its own name, so it reads in either UI language.
  const languageSegments = UI_LANGUAGES.map(value => ({ value, label: UI_LANGUAGE_NAMES[value] }));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="onboarding">
      <View style={styles.top} testID="onboarding-top">
        <View
          style={styles.segs}
          accessible
          accessibilityLabel={t('pageOf', { current: index + 1, total: ONBOARDING_PAGES.length })}
        >
          {ONBOARDING_PAGES.map((page, i) => (
            <View
              key={page.key}
              testID={i <= index ? 'onboarding-seg-on' : 'onboarding-seg'}
              style={[styles.seg, i <= index && styles.segOn]}
            />
          ))}
        </View>
        {!isLast ? (
          <Pressable
            onPress={() => void finish()}
            accessibilityRole="button"
            accessibilityLabel={t('skip')}
            testID="onboarding-skip"
            hitSlop={8}
            style={({ pressed }) => [styles.skip, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={styles.skipText}>{t('skip')}</Text>
          </Pressable>
        ) : (
          // The last page keeps Skip's room, so the row and the pages stay put.
          <View
            style={styles.skipSlot}
            testID="onboarding-skip-slot"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={onScrollBeginDrag}
        onMomentumScrollEnd={onMomentumEnd}
        onLayout={onPagerLayout}
        style={styles.pager}
        testID="onboarding-pager"
      >
        {ONBOARDING_PAGES.map((page, i) => {
          const voice = page.key === 'voice';
          return (
            <ScrollView
              key={page.key}
              style={{ width: pageW, height: pager?.height }}
              contentContainerStyle={styles.page}
              // Only a very large font still overflows: then the bar shows it scrolls.
              persistentScrollbar
              bounces={false}
              testID={`onboarding-page-${i}`}
            >
              <View>
                <Animated.View
                  style={i === 0 ? { opacity: firstCardOpacity } : undefined}
                  testID={`onboarding-picture-slot-${i}`}
                >
                  <Tactile
                    color={T.surface}
                    lipColor={T.lip}
                    lip={PICTURE_LIP}
                    radius={T.r.sheet}
                    clip
                    testID={`onboarding-picture-${i}`}
                    faceStyle={{ height: pictureH }}
                  >
                    <ExpoImage
                      source={pictures[page.key]}
                      contentFit="cover"
                      contentPosition="top"
                      // The first card fades as a whole (card and picture together).
                      transition={0}
                      priority={i === 0 ? 'high' : 'normal'}
                      onLoad={i === 0 ? onFirstPictureLoad : undefined}
                      onError={i === 0 ? revealFirstCard : undefined}
                      accessibilityIgnoresInvertColors
                      testID={`onboarding-image-${i}`}
                      style={{ width: pictureW, height: pictureH }}
                    />
                  </Tactile>
                </Animated.View>
                {voice ? (
                  <View style={styles.recWrap} pointerEvents="none">
                    <Tactile
                      color={T.surface2}
                      lipColor={T.lip}
                      lip={LIP.md}
                      radius={REC_PILL_H / 2}
                      testID="onboarding-rec-pill"
                      faceStyle={styles.recFace}
                    >
                      <View style={styles.recMic} testID="onboarding-rec-mic">
                        <Icon name="mic" size={20} color={T.onRec} />
                      </View>
                      <View
                        style={styles.recWave}
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      >
                        {REC_BARS.map((h, b) => (
                          <View key={b} style={[styles.recBar, { height: h }]} />
                        ))}
                      </View>
                      <Text style={text.label}>{t('recordPill')}</Text>
                    </Tactile>
                  </View>
                ) : null}
              </View>

              <View
                style={{ paddingTop: headlineOffset(voice) }}
                onLayout={onBlockLayout(i)}
                testID={`onboarding-text-${i}`}
              >
                <Text accessibilityRole="header" style={styles.headline}>
                  {t(`pages.${page.key}.title`)}
                </Text>
                <Text style={[text.body, styles.body]}>{t(`pages.${page.key}.body`)}</Text>
                {voice ? (
                  <View style={styles.safe}>
                    <Icon name="lock" size={16} color={T.text3} />
                    <Text style={styles.safeText}>{t('privacy')}</Text>
                  </View>
                ) : null}
              </View>
            </ScrollView>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: dockBottom(insets.bottom) }]} testID="onboarding-footer">
        <View style={styles.language} testID="onboarding-language">
          <Icon name="globe" size={20} color={T.text2} />
          <SegmentedControl<UiLanguage>
            compact
            segments={languageSegments}
            value={currentLanguage()}
            onChange={next => setUiLanguage(next)}
            accessibilityLabel={t('language')}
            testID="onboarding-language-switch"
          />
        </View>
        <Button
          label={primaryLabel}
          size="lg"
          block
          icon={onVoicePage ? 'mic' : undefined}
          onPress={handlePrimary}
          testID="onboarding-next"
        />
      </View>
    </View>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    top: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: T.screenPadH,
      marginTop: SPACE.md,
      // Skip's touch target: the row is as tall with and without it.
      minHeight: T.touch,
    },
    segs: { flexDirection: 'row', gap: SPACE.tight, paddingVertical: SPACE.sm },
    seg: { width: 30, height: 9, borderRadius: T.r.pill, backgroundColor: T.line },
    segOn: { backgroundColor: T.action },
    skip: {
      minHeight: T.touch,
      minWidth: T.touch,
      paddingHorizontal: SPACE.xs,
      marginRight: -SPACE.xs,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    skipSlot: { width: T.touch, height: T.touch, marginRight: -SPACE.xs },
    skipText: { fontFamily: T.fontLabel, fontSize: 14, lineHeight: 19, color: T.text2 },
    pager: { flex: 1 },
    page: { paddingHorizontal: T.screenPadH, paddingTop: PAGE_PAD_TOP, paddingBottom: PAGE_PAD_BOTTOM },
    recWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      // The pill, with its lip, ends REC_OVERHANG below the card's lip.
      bottom: -REC_OVERHANG,
      alignItems: 'center',
    },
    recFace: {
      height: REC_PILL_H,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.sm,
      paddingLeft: SPACE.tight,
      paddingRight: SPACE.lg,
    },
    recMic: {
      width: REC_MIC,
      height: REC_MIC,
      borderRadius: REC_MIC / 2,
      backgroundColor: T.rec,
      alignItems: 'center',
      justifyContent: 'center',
    },
    recWave: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xxs, height: 20 },
    recBar: { width: REC_BAR_W, borderRadius: REC_BAR_W / 2, backgroundColor: T.rec },
    headline: {
      fontFamily: T.fontDisplay,
      fontSize: 32,
      // Baloo 2 needs at least 1.3 times the size or Android clips it.
      lineHeight: 42,
      color: T.text,
    },
    body: { marginTop: SPACE.md },
    safe: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.md },
    safeText: {
      flexShrink: 1,
      fontFamily: T.fontBody,
      fontSize: 12.5,
      lineHeight: 17,
      color: T.text3,
    },
    footer: { paddingHorizontal: T.screenPadH, paddingTop: SPACE.sm },
    language: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACE.sm,
      marginBottom: SPACE.md,
    },
  });

const stylesFor = themedStyles(makeStyles);

export default OnboardingScreen;
