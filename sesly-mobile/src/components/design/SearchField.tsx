/**
 * SearchField: the one search field of the app (Keşfet, Kütüphane;
 * docs/release-pass/SPEC-design.md 3.7). A 52dp inset face on its lip
 * (`FieldFrame`, the same shape as `TextField`), the search glyph, the input
 * and, only while there is text, a 36dp clear tile on its own 2dp lip.
 *
 *   <SearchField
 *     value={query}
 *     onChangeText={setQuery}
 *     placeholder={t('search.placeholder')}
 *     clearLabel={t('search.clear')}
 *     testID="discover-search"
 *   />
 *
 * `testID` goes on the input; the frame is `${testID}-field` (face
 * `${testID}-field-face`, lip `${testID}-field-lip`), the clear tile
 * `${testID}-clear` and the close tile `${testID}-close`. The owner of the
 * text (debounce, store) is the caller.
 *
 * A field that folds away (Keşfet's search behind its icon) passes `onClose`
 * and `closeLabel`: while the field is empty the same tile closes it instead
 * of clearing, so there is always a visible way to put the search away.
 */

import React, { useState } from 'react';
import { StyleProp, StyleSheet, TextInput, ViewStyle } from 'react-native';
import { LIP, RADIUS, Theme, themedStyles, useT } from '../../theme/theme';
import { SurfaceLevel, raisedFace } from '../../theme/surfaces';
import { Icon } from './Icon';
import { FieldFrame, fieldRingColor } from './rows';
import { useSurfaceLevel } from './SurfaceLevel';
import { Tactile } from './Tactile';

/** Edge of the clear tile (dp). */
export const SEARCH_CLEAR_SIZE = 36;

/**
 * The level of the field's face (one step below its container, see
 * `insetFace`), so the clear tile on it is raised from the face it sits on.
 */
const FACE_LEVEL: Record<SurfaceLevel, SurfaceLevel> = { bg: 'surface', surface: 'bg', surface2: 'surface' };

export interface SearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  /** The keyboard's search key. */
  onSubmitEditing?: () => void;
  placeholder: string;
  /** Accessibility label of the clear tile ("Aramayı temizle"). */
  clearLabel: string;
  /** Accessibility label of the input; the placeholder by default. */
  accessibilityLabel?: string;
  autoFocus?: boolean;
  /** The input, for a caller that focuses or blurs it (a field opened from an icon). */
  inputRef?: React.Ref<TextInput>;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Shown as a close tile while the field is empty (with `closeLabel`). */
  onClose?: () => void;
  /** Accessibility label of the close tile ("Aramayı kapat"). */
  closeLabel?: string;
  testID?: string;
  /** Outer box: margins (the screens put it 12dp under their title). */
  style?: StyleProp<ViewStyle>;
}

export const SearchField: React.FC<SearchFieldProps> = ({
  value,
  onChangeText,
  onSubmitEditing,
  placeholder,
  clearLabel,
  accessibilityLabel,
  autoFocus,
  inputRef,
  onFocus,
  onBlur,
  onClose,
  closeLabel,
  testID,
  style,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const level = useSurfaceLevel();
  const [focused, setFocused] = useState(false);
  // Empty, a field that folds away shows its close tile in the clear tile's place.
  const closes = value.length === 0 && !!onClose && !!closeLabel;
  return (
    <FieldFrame
      ringColor={fieldRingColor(T, focused, false)}
      testID={testID ? `${testID}-field` : undefined}
      style={style}
    >
      <Icon name="search" size={20} color={T.text3} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing ? () => onSubmitEditing() : undefined}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        placeholder={placeholder}
        placeholderTextColor={T.text3}
        selectionColor={T.action}
        selectionHandleColor={T.action}
        cursorColor={T.action}
        underlineColorAndroid="transparent"
        accessibilityLabel={accessibilityLabel ?? placeholder}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        testID={testID}
        style={styles.input}
      />
      {value.length > 0 || closes ? (
        <Tactile
          color={raisedFace(T, FACE_LEVEL[level])}
          lipColor={T.lip}
          lip={LIP.sm}
          radius={RADIUS.sm}
          onPress={closes ? onClose : () => onChangeText('')}
          hitSlop={{ top: 5, bottom: 5, left: 6, right: 6 }}
          accessibilityLabel={closes ? closeLabel : clearLabel}
          testID={testID ? `${testID}-${closes ? 'close' : 'clear'}` : undefined}
          faceStyle={styles.clear}
        >
          <Icon name="close" size={20} color={T.text} />
        </Tactile>
      ) : null}
    </FieldFrame>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    input: {
      flex: 1,
      minWidth: 0,
      minHeight: 48,
      fontFamily: T.fontBody,
      fontSize: 15,
      color: T.text,
      paddingVertical: 8,
      paddingHorizontal: 0,
    },
    clear: {
      width: SEARCH_CLEAR_SIZE,
      height: SEARCH_CLEAR_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

const stylesFor = themedStyles(makeStyles);
