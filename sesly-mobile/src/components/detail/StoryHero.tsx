/**
 * StoryHero: the picture at the top of the story page, full-bleed and wide
 * like the Home "Bugünün masalı" card, with the story's title drawn over it.
 *
 *   - The cover fills the screen's width from its very top (under the status
 *     bar and the glass top bar), its upper part shown (`focus: 'top'`), as
 *     on Home; the band is much taller than Home's, so only the bottom of the
 *     picture is cut away (`storyHeroHeight`). The covers leave their bottom
 *     part quiet, which is where the title goes.
 *   - A short canvas shade under the status bar keeps the system icons and
 *     the glass buttons clear of a bright picture.
 *   - From the bottom a canvas gradient rises over the lower part of the band
 *     only (HERO_SHADE_STOPS, about its last quarter): solid at the edge,
 *     heavy where the title's lines sit, fading out upward, so the picture
 *     stays clear above it and melts into the page below.
 *   - The title (Baloo 2 28, up to two lines, shrinking a little before it
 *     would need a third) sits on that shade, centred, with a soft canvas
 *     glow behind the letters for the lighter top of the shade; it stays the
 *     screen's header for a screen reader.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PictureCover } from '../design';
import type { CoverSubject } from '../design';
import { SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { withAlpha } from '../../theme/color';

/** Height to width of the picture band (Home's hero is about 0.56; a cover is 1.5). */
export const HERO_RATIO = 1.15;
/** The band never takes more than this share of the window's height. */
export const HERO_MAX_SHARE = 0.56;
/** The canvas's opacity from where the title's last line sits down to the edge. */
export const HERO_SOLID_ALPHA = 0.92;
/**
 * The bottom shade, top to bottom, as shares of the band's height: clear
 * above 70%, light at 79%, HERO_SOLID_ALPHA from 87% (the title's last line),
 * solid canvas at the edge.
 */
export const HERO_SHADE_STOPS = {
  alphas: [0, 0.5, HERO_SOLID_ALPHA, 1],
  locations: [0.7, 0.79, 0.87, 1],
} as const;
/** Lines the title may take, and how far it follows the system font. */
export const HERO_TITLE_LINES = 2;
export const HERO_TITLE_MAX_SCALE = 1.1;
/** The shade under the status bar: this much below the inset. */
const STATUS_SHADE_EXTRA = 56;

/**
 * Height of the band for a window: the picture's share of the width (capped
 * by the window's height), plus the status bar it reaches under.
 */
export function storyHeroHeight(width: number, windowHeight: number, insetTop: number): number {
  return Math.round(Math.min(width * HERO_RATIO, windowHeight * HERO_MAX_SHARE)) + insetTop;
}

export interface StoryHeroProps {
  story: CoverSubject;
  title: string;
  width: number;
  height: number;
  /** The status bar's height (the top shade). */
  insetTop: number;
  placeholderIndex?: number;
  testID?: string;
}

export const StoryHero: React.FC<StoryHeroProps> = ({
  story,
  title,
  width,
  height,
  insetTop,
  placeholderIndex,
  testID = 'story-hero',
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const shade = HERO_SHADE_STOPS;
  return (
    <View style={{ width, height }} testID={testID}>
      <PictureCover
        story={story}
        title={title}
        width={width}
        height={height}
        shape="wide"
        radius={0}
        flat
        focus="top"
        placeholderIndex={placeholderIndex}
        testID="story-cover"
      />
      <LinearGradient
        pointerEvents="none"
        colors={[withAlpha(T.bg, 0.55), withAlpha(T.bg, 0)]}
        style={[styles.topShade, { height: insetTop + STATUS_SHADE_EXTRA }]}
        testID="story-hero-top-shade"
      />
      <LinearGradient
        pointerEvents="none"
        colors={[
          withAlpha(T.bg, shade.alphas[0]),
          withAlpha(T.bg, shade.alphas[1]),
          withAlpha(T.bg, shade.alphas[2]),
          withAlpha(T.bg, shade.alphas[3]),
        ]}
        locations={shade.locations}
        style={StyleSheet.absoluteFill}
        testID="story-hero-shade"
      />
      <View pointerEvents="none" style={styles.titleBox} testID="story-hero-title">
        <Text
          accessibilityRole="header"
          numberOfLines={HERO_TITLE_LINES}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          maxFontSizeMultiplier={HERO_TITLE_MAX_SCALE}
          style={styles.title}
        >
          {title}
        </Text>
      </View>
    </View>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    topShade: { position: 'absolute', left: 0, right: 0, top: 0 },
    titleBox: {
      position: 'absolute',
      left: T.screenPadH,
      right: T.screenPadH,
      bottom: SPACE.xs,
    },
    title: {
      fontFamily: T.fontDisplay,
      fontSize: 28,
      lineHeight: 37,
      color: T.text,
      textAlign: 'center',
      textShadowColor: withAlpha(T.bg, 0.85),
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 10,
    },
  });

const stylesFor = themedStyles(makeStyles);
