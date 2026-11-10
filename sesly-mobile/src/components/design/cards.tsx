/**
 * Cards of the playful design.
 *
 * - Card: a surface card on its lip (`.card`), static or tappable. Credits,
 *   filter groups, settings groups, plan cards. It is a container of the
 *   neutral ladder (`SurfaceLevelProvider`), so the controls inside it draw
 *   one step up or down from it (docs/release-pass/SPEC-design.md 1.6.1).
 * - CategoryTile: a story category as a chunky coloured tile (`.tile`), with
 *   its icon (moon, lantern, globe, bulb).
 * - categoryIcon / CategoryDot: the category's glyph and its small dot.
 */

import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from 'react-native';
import { LIP, Theme, themedStyles, useT } from '../../theme/theme';
import { CategoryKey, categoryColors, categorySlot } from '../../theme/palettes';
import type { SurfaceLevel } from '../../theme/surfaces';
import { Icon, IconName } from './Icon';
import { SurfaceLevelProvider } from './SurfaceLevel';
import { Tactile } from './Tactile';

// ─────────────────────────────────────────────────────────────
// Card
// ─────────────────────────────────────────────────────────────

export interface CardProps {
  onPress?: () => void;
  /** 'surface' (default) or 'raised' (surface-2, a selected card). */
  tone?: 'surface' | 'raised';
  /** A fill of its own (a tinted card); the lip stays neutral. */
  color?: string;
  /**
   * Level of a card with its own `color`, for the controls inside it.
   * Default 'surface2': tinted cards are lighter than surface. Ignored
   * without `color` (the tone decides).
   */
  surfaceLevel?: SurfaceLevel;
  /** Corner radius; default `T.r.xl` (24). */
  radius?: number;
  /** Lip height; default `LIP.md` (3). */
  lip?: number;
  /** A ring in the action colour (a selected option). */
  selected?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'radio' | 'checkbox' | 'link';
  accessibilityState?: { selected?: boolean; checked?: boolean };
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** Padding and layout of the card's face. Default: 16dp padding. */
  contentStyle?: StyleProp<ViewStyle>;
  /** Clip children to the corners. */
  clip?: boolean;
  children?: React.ReactNode;
}

/** The level a card is, for the controls drawn on it. */
export function cardSurfaceLevel(
  tone: 'surface' | 'raised',
  selected: boolean | undefined,
  color: string | undefined,
  surfaceLevel: SurfaceLevel,
): SurfaceLevel {
  if (color) return surfaceLevel;
  return tone === 'raised' || selected ? 'surface2' : 'surface';
}

export const Card: React.FC<CardProps> = ({
  onPress,
  tone = 'surface',
  color,
  surfaceLevel = 'surface2',
  radius,
  lip = LIP.md,
  selected,
  disabled,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  testID,
  style,
  contentStyle,
  clip,
  children,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const level = cardSurfaceLevel(tone, selected, color, surfaceLevel);
  return (
    <Tactile
      color={color ?? (level === 'surface2' ? T.surface2 : T.surface)}
      lipColor={selected ? T.actionLip : T.lip}
      lip={lip}
      radius={radius ?? T.r.xl}
      // Every card carries the 2dp ring (transparent unless selected), so
      // selecting one never moves its content or grows the card.
      borderColor={selected ? T.action : 'transparent'}
      borderWidth={T.ring}
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      testID={testID}
      style={style}
      faceStyle={[styles.cardFace, contentStyle]}
      clip={clip}
    >
      <SurfaceLevelProvider level={level}>{children}</SurfaceLevelProvider>
    </Tactile>
  );
};

// ─────────────────────────────────────────────────────────────
// Categories
// ─────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<CategoryKey, IconName> = {
  uyku: 'moon',
  turk: 'rose',
  dunya: 'globe',
  egitici: 'bulb',
};

/** The glyph of a story category (book for an unknown one). */
export function categoryIcon(category: string | null | undefined): IconName {
  const slot = categorySlot(category);
  return slot ? CATEGORY_ICONS[slot] : 'book';
}

/** The small category dot of shelves and grid meta (`.dot`). */
export const CategoryDot: React.FC<{ category: string | null | undefined; size?: number; testID?: string }> = ({
  category,
  size = 9,
  testID,
}) => {
  const T = useT();
  return (
    <View
      testID={testID}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: categoryColors(T, category).color }}
    />
  );
};

/** How far a tile label follows the system font. */
const TILE_LABEL_MAX_SCALE = 1.3;
/**
 * Width a tile label wraps at, at font scale 1 (dp). Shorter than every
 * label, so each keeps two lines and breaks between words; Fabric then
 * measures the label as its longest line.
 */
const TILE_LABEL_WRAP = 84;

/** Width a tile label wraps at for a system font scale (capped like the label). */
export function tileLabelMaxWidth(fontScale: number): number {
  return Math.round(TILE_LABEL_WRAP * Math.min(fontScale, TILE_LABEL_MAX_SCALE));
}

export interface CategoryTileProps {
  /** Backend story category (BEDTIME, TURKISH_CLASSICS, ...). */
  category: string;
  label: string;
  onPress?: () => void;
  /** Minimum tile width (mockup 128); a longer label widens the tile. */
  width?: number;
  selected?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const CategoryTile: React.FC<CategoryTileProps> = ({
  category,
  label,
  onPress,
  width = 128,
  selected,
  testID,
  style,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const { fontScale } = useWindowDimensions();
  const colors = categoryColors(T, category);
  return (
    <Tactile
      color={colors.tileBg}
      lipColor={colors.tileLip}
      lip={LIP.md}
      radius={T.r.lg}
      borderColor={selected ? T.text : selected === false ? 'transparent' : undefined}
      borderWidth={T.ring}
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      testID={testID}
      style={[{ minWidth: width }, style]}
      faceStyle={styles.tile}
    >
      <Icon name={categoryIcon(category)} size={20} color={colors.tileIcon} />
      <Text
        numberOfLines={2}
        maxFontSizeMultiplier={TILE_LABEL_MAX_SCALE}
        testID={testID ? `${testID}-label` : undefined}
        style={[styles.tileLabel, { color: colors.tileFg, maxWidth: tileLabelMaxWidth(fontScale) }]}
      >
        {label}
      </Text>
    </Tactile>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    cardFace: { padding: T.space.lg },
    tile: {
      minHeight: 56,
      paddingHorizontal: 12,
      paddingVertical: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    tileLabel: {
      flexShrink: 1,
      fontFamily: T.fontDisplay,
      fontSize: 15,
      // Two lines of Baloo 2 in a 56dp tile: 1.3 keeps the glyphs whole.
      lineHeight: 20,
    },
  });

const stylesFor = themedStyles(makeStyles);
