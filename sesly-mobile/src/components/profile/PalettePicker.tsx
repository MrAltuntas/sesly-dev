/**
 * PalettePicker: "Renk paleti" on the Profile screen, where the user picks
 * the colours of the app (a permanent setting, kept on the device).
 *
 * Six named swatches, three per row. Each swatch previews its own palette
 * (canvas, surface, action and the four category colours).
 *
 * The ring answers the tap first: the swatch is selected in the tap's own
 * commit and the palette is applied one frame later (SPEC-design 2.4 step
 * 5), so the press shows before the app recolours. Quick taps inside that
 * frame apply once, the last one.
 */

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Theme, themedStyles, useT } from '../../theme/theme';
import { usePalette } from '../../theme/ThemeProvider';
import { PALETTE_KEYS, PaletteKey, palettes } from '../../theme/palettes';
import { Tactile } from '../design/Tactile';
import { Icon } from '../design/Icon';

/** The selected mark: a badge in the top right corner of the preview (dp). */
const CHECK_SIZE = 18;
const PREVIEW_ACTION_HEIGHT = 8;
const DOT_SIZE = 10;

export interface PalettePickerProps {
  testID?: string;
}

export const PalettePicker: React.FC<PalettePickerProps> = ({ testID = 'palette-picker' }) => {
  const T = useT();
  const styles = stylesFor(T);
  const { t } = useTranslation('profile');
  const { palette, setPalette } = usePalette();

  // The ring follows `shown`, which moves at once on a tap and follows the
  // palette when it changes from elsewhere (the stored pick, another picker).
  const [shown, setShown] = useState(palette);
  const [seen, setSeen] = useState(palette);
  if (seen !== palette) {
    setSeen(palette);
    setShown(palette);
  }

  const frame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  // Stable, so a tap re-renders only the two swatches whose ring changes.
  const pick = useCallback(
    (key: PaletteKey) => {
      setShown(key);
      if (frame.current != null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        void setPalette(key);
      });
    },
    [setPalette],
  );

  return (
    <View testID={testID} accessibilityRole="radiogroup" accessibilityLabel={t('palette.label')}>
      <Text style={styles.hint}>{t('palette.hint')}</Text>
      <View testID={`${testID}-grid`} style={styles.grid}>
        {PALETTE_KEYS.map(key => (
          <Swatch
            key={key}
            paletteKey={key}
            name={t(`palette.names.${key}`)}
            selected={key === shown}
            onSelect={pick}
            styles={styles}
            T={T}
          />
        ))}
      </View>
    </View>
  );
};

interface SwatchProps {
  paletteKey: PaletteKey;
  name: string;
  selected: boolean;
  onSelect: (key: PaletteKey) => void;
  styles: ReturnType<typeof makeStyles>;
  T: Theme;
}

const Swatch = memo(function Swatch({ paletteKey, name, selected, onSelect, styles, T }: SwatchProps) {
  const P = palettes[paletteKey];
  return (
    <Tactile
      color={selected ? T.surface2 : T.surface}
      lipColor={selected ? T.actionLip : T.lip}
      lip={T.lipSize.md}
      // The ring is always there (transparent while idle), so a pick never
      // moves the content.
      borderColor={selected ? T.action : 'transparent'}
      borderWidth={T.ring}
      radius={T.r.md}
      onPress={() => {
        if (!selected) onSelect(paletteKey);
      }}
      accessibilityRole="radio"
      accessibilityLabel={name}
      accessibilityState={{ selected }}
      testID={`palette-option-${paletteKey}`}
      style={styles.option}
      faceStyle={styles.face}
    >
      <View
        testID={`palette-preview-${paletteKey}`}
        style={[styles.preview, { backgroundColor: P.bg, borderColor: P.line }]}
      >
        <View style={[styles.previewCard, { backgroundColor: P.surface }]}>
          <View style={[styles.previewAction, { backgroundColor: P.action }]} />
        </View>
        <View style={styles.previewDots}>
          {[P.catUyku, P.catTurk, P.catDunya, P.catEgitici].map(color => (
            <View key={color} style={[styles.dot, { backgroundColor: color }]} />
          ))}
        </View>
        {selected ? (
          <View testID={`palette-check-${paletteKey}`} style={styles.check}>
            <Icon name="check" size={12} color={T.onAction} />
          </View>
        ) : null}
      </View>
      <View testID={`palette-name-row-${paletteKey}`} style={styles.nameRow}>
        <Text
          testID={`palette-name-${paletteKey}`}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
          maxFontSizeMultiplier={1.3}
          style={[styles.name, selected && styles.nameSelected]}
        >
          {name}
        </Text>
      </View>
    </Tactile>
  );
});

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    hint: {
      fontFamily: T.fontBody,
      fontSize: 12.5,
      lineHeight: 17,
      color: T.text3,
      marginBottom: T.space.sm,
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: T.space.sm },
    option: { width: '31%', flexGrow: 1 },
    face: { padding: T.space.sm, alignItems: 'stretch' },
    preview: {
      height: 44,
      borderRadius: T.r.sm,
      borderWidth: T.hairline,
      padding: T.space.xs,
      justifyContent: 'space-between',
    },
    previewCard: {
      height: 18,
      borderRadius: T.r.xs,
      justifyContent: 'center',
      paddingHorizontal: T.space.tight,
    },
    previewAction: { width: 22, height: PREVIEW_ACTION_HEIGHT, borderRadius: PREVIEW_ACTION_HEIGHT / 2 },
    previewDots: { flexDirection: 'row', gap: T.space.xs },
    dot: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2 },
    check: {
      position: 'absolute',
      top: T.space.xs,
      right: T.space.xs,
      width: CHECK_SIZE,
      height: CHECK_SIZE,
      borderRadius: CHECK_SIZE / 2,
      backgroundColor: T.action,
      alignItems: 'center',
      justifyContent: 'center',
    },
    nameRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: T.space.xs,
    },
    name: {
      fontFamily: T.fontLabel,
      fontSize: 12.5,
      lineHeight: 17,
      color: T.text2,
      textAlign: 'center',
      flexShrink: 1,
    },
    nameSelected: { color: T.text },
  });

const stylesFor = themedStyles(makeStyles);
