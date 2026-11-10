/**
 * Icon: the one icon source of the app.
 *
 * Every glyph is an Ionicons glyph (@expo/vector-icons, the project's icon
 * library rule): outline by default, the filled twin with `filled` (the
 * selected tab, a saved heart). The names below are the app's own, so a
 * screen never names an Ionicons glyph directly and one map decides the look.
 * Ionicons has no "15 seconds" glyph; `back15` / `fwd15` are the refresh arc
 * drawn in its stroke style (`SkipIcon`), with the number set inside in the
 * label font, clear of the arrowhead.
 *
 * Sizes: 24 for navigation and actions, 20 inline (rows, chips, buttons).
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Path } from 'react-native-svg';
import { FONTS } from '../../theme/theme';

type Glyph = React.ComponentProps<typeof Ionicons>['name'];

/** [outline, filled] */
const ICONS = {
  book: ['book-outline', 'book'],
  compass: ['compass-outline', 'compass'],
  books: ['library-outline', 'library'],
  mic: ['mic-outline', 'mic'],
  play: ['play', 'play'],
  pause: ['pause', 'pause'],
  // Drawn by SkipIcon (its own arc around the number); the glyph is a fallback name.
  back15: ['refresh', 'refresh'],
  fwd15: ['refresh', 'refresh'],
  moon: ['moon-outline', 'moon'],
  speed: ['speedometer-outline', 'speedometer'],
  search: ['search-outline', 'search'],
  back: ['chevron-back', 'chevron-back'],
  chevronLeft: ['chevron-back', 'chevron-back'],
  chevronRight: ['chevron-forward', 'chevron-forward'],
  chevronDown: ['chevron-down', 'chevron-down'],
  chevronUp: ['chevron-up', 'chevron-up'],
  more: ['ellipsis-horizontal', 'ellipsis-horizontal'],
  heart: ['heart-outline', 'heart'],
  heartOn: ['heart', 'heart'],
  download: ['download-outline', 'download'],
  check: ['checkmark', 'checkmark'],
  checkAll: ['checkmark-done', 'checkmark-done'],
  globe: ['globe-outline', 'globe'],
  bulb: ['bulb-outline', 'bulb'],
  rose: ['rose-outline', 'rose'],
  sliders: ['options-outline', 'options'],
  wave: ['pulse-outline', 'pulse'],
  redo: ['refresh-outline', 'refresh'],
  lock: ['lock-closed-outline', 'lock-closed'],
  plus: ['add', 'add'],
  sort: ['filter-outline', 'filter'],
  bookmark: ['bookmark-outline', 'bookmark'],
  bookmarkOn: ['bookmark', 'bookmark'],
  caret: ['caret-down', 'caret-down'],
  minus: ['remove', 'remove'],
  close: ['close', 'close'],
  language: ['language-outline', 'language'],
  // A text translated with AI (the translation badge and the detail note).
  aiTranslation: ['sparkles-outline', 'sparkles'],
  eye: ['eye-outline', 'eye'],
  eyeOff: ['eye-off-outline', 'eye-off'],
  alert: ['alert-circle-outline', 'alert-circle'],
  wifiOff: ['cloud-offline-outline', 'cloud-offline'],
  text: ['text-outline', 'text'],
  trash: ['trash-outline', 'trash'],
  bell: ['notifications-outline', 'notifications'],
  clock: ['time-outline', 'time'],
  restart: ['refresh-outline', 'refresh'],
  prev: ['play-skip-back', 'play-skip-back'],
  next: ['play-skip-forward', 'play-skip-forward'],
  stop: ['stop', 'stop'],
  image: ['image-outline', 'image'],
  phone: ['phone-portrait-outline', 'phone-portrait'],
  palette: ['color-palette-outline', 'color-palette'],
  document: ['document-text-outline', 'document-text'],
  signOut: ['log-out-outline', 'log-out'],
  info: ['information-circle-outline', 'information-circle'],
  mail: ['mail-outline', 'mail'],
  user: ['person-outline', 'person'],
  // "Sıradakiler": the queue button, its badge and the empty queue.
  queue: ['list-outline', 'list'],
  // The drag handle of a queue row in edit mode.
  drag: ['reorder-three-outline', 'reorder-three'],
} as const satisfies Record<string, readonly [Glyph, Glyph]>;

export type IconName = keyof typeof ICONS;

export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/** The Ionicons glyph behind an app icon name. */
export function iconGlyph(name: IconName, filled = false): Glyph {
  return ICONS[name][filled ? 1 : 0];
}

/** Navigation and action icons (tab bar, app bar, icon buttons). */
export const ICON_SIZE = 24;
/** Icons inside a row, a chip or a button, next to text. */
export const ICON_SIZE_INLINE = 20;

interface IconProps {
  name: IconName;
  /** Edge length in dp: 24 for navigation and actions, 20 inline. */
  size?: number;
  color: string;
  /** The filled twin (selected tab, saved state). */
  filled?: boolean;
  testID?: string;
}

export const Icon: React.FC<IconProps> = ({ name, size = ICON_SIZE, color, filled = false, testID }) => {
  const id = testID ?? `icon-${name}`;
  const box = { width: size, height: size };
  if (name === 'back15' || name === 'fwd15') {
    return <SkipIcon forward={name === 'fwd15'} size={size} color={color} testID={id} />;
  }
  return (
    <View
      testID={id}
      style={[styles.box, box]}
      pointerEvents="none"
      // Decorative: the control that holds the icon carries the label.
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Ionicons name={iconGlyph(name, filled)} size={size} color={color} style={{ lineHeight: size }} />
    </View>
  );
};

/**
 * The skip arc in a 24-unit box (NP-20): a ring centred below the box
 * centre, open over its top right quarter, with a small chevron at its top
 * end pointing into the opening (mirrored for back). The Ionicons refresh
 * glyph put its arrowhead's lower arm 3 units into the ring, onto the
 * number; this chevron ends at `SKIP_ARROW_BOTTOM`, so the number, centred
 * on the ring, keeps a clear band above it at every size.
 */
export const SKIP_GEOMETRY = {
  box: 24,
  cx: 12,
  cy: 13.5,
  r: 8.5,
  /** Ionicons' stroke: 1/16 of the box. */
  stroke: 1.5,
  /** The chevron's tip (x) and its arms' half span around the ring's top. */
  arrowTip: 14.5,
  arrowHalf: 2.5,
} as const;

const G = SKIP_GEOMETRY;
const RING_TOP = G.cy - G.r;
/** Lowest point the chevron's stroke reaches (box units). */
export const SKIP_ARROW_BOTTOM = RING_TOP + G.arrowHalf + G.stroke / 2;
/** Radius of the ring's open inside (box units). */
export const SKIP_RING_INNER = G.r - G.stroke / 2;

const SKIP_PATH = [
  // The ring, clockwise from its right point round to its top (270 degrees).
  `M${G.cx + G.r} ${G.cy} A${G.r} ${G.r} 0 1 1 ${G.cx} ${RING_TOP}`,
  // The shaft and the chevron at the top end.
  `L${G.arrowTip} ${RING_TOP}`,
  `M${G.cx} ${RING_TOP - G.arrowHalf} L${G.arrowTip} ${RING_TOP} L${G.cx} ${RING_TOP + G.arrowHalf}`,
].join(' ');

/**
 * Where the number sits, as fractions of the icon size: on the ring's centre
 * (below the box centre), at a size whose digits clear the chevron and the
 * ring (geometry.test.tsx checks the margins).
 */
export const SKIP_NUMBER_DROP = (G.cy - G.box / 2) / G.box;
export const SKIP_NUMBER_FONT = 0.32;

/**
 * Skip 15 seconds: the arc above (mirrored for back) around the number in
 * the label font, on the ring's own centre.
 */
const SkipIcon: React.FC<{ forward: boolean; size: number; color: string; testID: string }> = ({
  forward,
  size,
  color,
  testID,
}) => {
  const fontSize = Math.round(size * SKIP_NUMBER_FONT);
  return (
    <View
      testID={testID}
      style={[styles.box, { width: size, height: size }]}
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View testID={`${testID}-arc`} style={forward ? null : styles.mirror}>
        <Svg width={size} height={size} viewBox={`0 0 ${G.box} ${G.box}`}>
          <Path
            d={SKIP_PATH}
            fill="none"
            stroke={color}
            strokeWidth={G.stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
      <Text
        testID={`${testID}-number`}
        allowFontScaling={false}
        style={[
          styles.skipNumber,
          {
            color,
            fontSize,
            lineHeight: Math.ceil(fontSize * 1.3),
            transform: [{ translateY: size * SKIP_NUMBER_DROP }],
          },
        ]}
      >
        15
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  mirror: { transform: [{ scaleX: -1 }] },
  skipNumber: {
    position: 'absolute',
    fontFamily: FONTS.label,
    textAlign: 'center',
    includeFontPadding: false,
  },
});

// ─────────────────────────────────────────────────────────────
// Brand marks. Multi-colour logos of third parties are not part of the icon
// family; they are drawn as the brands require, at 20dp.
// ─────────────────────────────────────────────────────────────

export const GoogleMark: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" testID="mark-google">
    <Path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <Path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <Path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <Path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </Svg>
);

export const AppleMark: React.FC<{ size?: number; color: string }> = ({ size = 20, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" testID="mark-apple">
    <Path
      fill={color}
      d="M16.4 12.7c0-2.1 1.7-3.1 1.8-3.2-1-1.4-2.5-1.6-3-1.7-1.3-.1-2.5.8-3.1.8-.7 0-1.7-.7-2.7-.7-1.4 0-2.7.8-3.4 2.1-1.5 2.5-.4 6.3 1 8.3.7 1 1.5 2.1 2.6 2.1 1 0 1.4-.7 2.7-.7 1.2 0 1.6.7 2.7.7s1.8-1 2.500-2c.8-1.1 1.100-2.200 1.100-2.300-.1 0-2.200-.8-2.200-3.400zM14.400 6.600c.5-.7.9-1.600.8-2.600-.8 0-1.800.5-2.400 1.200-.5.6-1 1.600-.8 2.500.9.1 1.800-.4 2.400-1.100z"
    />
  </Svg>
);
