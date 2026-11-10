/**
 * SearchField (SPEC-design 3.7): the inset face on its lip, the clear tile
 * only while there is text, clearing, submitting and the focus ring.
 */

import React, { useState } from 'react';
import { configure, fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { PALETTE_KEYS } from '../../theme/palettes';
import { LIP, RADIUS, themes } from '../../theme/theme';
import { insetFace } from '../../theme/surfaces';
import { SEARCH_CLEAR_SIZE, SearchField } from './SearchField';
import { SurfaceLevelProvider } from './SurfaceLevel';

// Icons are decorative and hidden from accessibility; these tests look at them.
configure({ defaultIncludeHiddenElements: true });

const gece = themes['gece-mavisi'];
const flat = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(5).filter(Boolean));

/** A caller that owns the text, like the two library screens. */
const Controlled: React.FC<{ initial?: string; onSubmit?: () => void; onChange?: (text: string) => void }> = ({
  initial = '',
  onSubmit,
  onChange,
}) => {
  const [value, setValue] = useState(initial);
  return (
    <SearchField
      value={value}
      onChangeText={text => {
        onChange?.(text);
        setValue(text);
      }}
      onSubmitEditing={onSubmit}
      placeholder="Masal ara"
      clearLabel="Aramayı temizle"
      testID="search"
    />
  );
};

describe('SearchField', () => {
  it('shows the clear tile only while there is text, and clearing empties the field', () => {
    const onChange = jest.fn();
    renderWithProviders(<Controlled onChange={onChange} />);
    expect(screen.queryByTestId('search-clear')).toBeNull();

    fireEvent.changeText(screen.getByTestId('search'), 'ay');
    expect(onChange).toHaveBeenLastCalledWith('ay');
    expect(screen.getByTestId('search-clear')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Aramayı temizle' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.getByTestId('search').props.value).toBe('');
    expect(screen.queryByTestId('search-clear')).toBeNull();
  });

  it('submits from the keyboard search key', () => {
    const onSubmit = jest.fn();
    renderWithProviders(<Controlled initial="ay" onSubmit={onSubmit} />);
    expect(screen.getByTestId('search').props.returnKeyType).toBe('search');
    fireEvent(screen.getByTestId('search'), 'submitEditing');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('works without a submit handler', () => {
    renderWithProviders(
      <SearchField value="ay" onChangeText={jest.fn()} placeholder="Masal ara" clearLabel="Temizle" testID="search" />,
    );
    expect(screen.getByTestId('search').props.onSubmitEditing).toBeUndefined();
  });

  it('the face: 52dp, radius 20, padding 16 / 8, gap 8, on a 3dp lip, inset from the canvas', () => {
    renderWithProviders(<Controlled />);
    expect(flat(screen.getByTestId('search-field-face'))).toMatchObject({
      backgroundColor: insetFace(gece, 'bg'),
      minHeight: 52,
      borderRadius: RADIUS.lg,
      paddingLeft: 16,
      paddingRight: 8,
      gap: 8,
      borderWidth: 2,
      borderColor: 'transparent',
    });
    expect(flat(screen.getByTestId('search-field-lip'))).toMatchObject({ top: LIP.md, backgroundColor: gece.lip });
    expect(flat(screen.getByTestId('icon-search')).width).toBe(20);
  });

  it.each(PALETTE_KEYS)('in %s the face inside a sheet is the canvas colour, never the sheet', key => {
    const T = themes[key];
    renderWithProviders(
      <SurfaceLevelProvider level="surface">
        <SearchField value="ay" onChangeText={jest.fn()} placeholder="Masal ara" clearLabel="Temizle" testID="search" />
      </SurfaceLevelProvider>,
      { theme: key },
    );
    expect(flat(screen.getByTestId('search-field-face')).backgroundColor).toBe(T.bg);
    // The clear tile is raised from the face it sits on.
    expect(flat(screen.getByTestId('search-clear-face')).backgroundColor).toBe(T.surface);
  });

  it('the clear tile: 36dp, radius 12, raised on a 2dp lip, a 48dp target', () => {
    renderWithProviders(<Controlled initial="ay" />);
    expect(SEARCH_CLEAR_SIZE).toBe(36);
    expect(flat(screen.getByTestId('search-clear-face'))).toMatchObject({
      width: 36,
      height: 36,
      borderRadius: RADIUS.sm,
      backgroundColor: gece.surface2,
    });
    expect(flat(screen.getByTestId('search-clear-lip')).top).toBe(LIP.sm);
    expect(screen.getByTestId('search-clear').props.hitSlop).toEqual({ top: 5, bottom: 5, left: 6, right: 6 });
  });

  it('shows the focus ring while focused', () => {
    renderWithProviders(<Controlled />);
    fireEvent(screen.getByTestId('search'), 'focus');
    expect(flat(screen.getByTestId('search-field-face')).borderColor).toBe(gece.text2);
    fireEvent(screen.getByTestId('search'), 'blur');
    expect(flat(screen.getByTestId('search-field-face')).borderColor).toBe('transparent');
  });

  it('passes the placeholder, its label and autoFocus to the input', () => {
    const view = renderWithProviders(
      <SearchField value="" onChangeText={jest.fn()} placeholder="Masal ara" clearLabel="Temizle" autoFocus testID="search" />,
    );
    expect(screen.getByTestId('search').props).toMatchObject({
      placeholder: 'Masal ara',
      accessibilityLabel: 'Masal ara',
      autoFocus: true,
      placeholderTextColor: gece.text3,
      underlineColorAndroid: 'transparent',
      autoCorrect: false,
      autoCapitalize: 'none',
    });
    view.rerender(
      <SearchField
        value=""
        onChangeText={jest.fn()}
        placeholder="Masal ara"
        accessibilityLabel="Masallarımda ara"
        clearLabel="Temizle"
        testID="search"
      />,
    );
    expect(screen.getByTestId('search').props.accessibilityLabel).toBe('Masallarımda ara');
  });
});
