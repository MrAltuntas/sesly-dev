/**
 * Stepper: minus, number, plus with a range (sleep timer story count;
 * SPEC-design 3.9).
 */

import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { themes } from '../../theme/theme';
import { SurfaceLevelProvider } from '../design/SurfaceLevel';
import { STEPPER_VALUE_MIN_WIDTH, Stepper } from './Stepper';

function stepper(value: number, onChange: jest.Mock, max = 3) {
  return (
    <SurfaceLevelProvider level="surface">
      <Stepper
        value={value}
        min={1}
        max={max}
        onChange={onChange}
        accessibilityLabel="Kaç masal sonra"
        valueText={`${value} masal`}
        accessibilityHint="Dokununca zamanlayıcı açılır"
        decrementLabel="Bir masal azalt"
        incrementLabel="Bir masal artır"
      />
    </SurfaceLevelProvider>
  );
}

function renderStepper(
  value: number,
  onChange = jest.fn(),
  theme: 'gece-mavisi' | 'kitaplik' = 'gece-mavisi',
  max = 3,
) {
  const view = renderWithProviders(stepper(value, onChange, max), { theme });
  return { onChange, view };
}

const flat = (node: { props: { style?: unknown } }) => {
  const style = node.props.style;
  const list = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign({}, ...list.filter(Boolean)) as Record<string, unknown>;
};

/** The colour of a key's glyph (the vector icon's text). */
const glyphColor = (id: string) =>
  flat(
    screen
      .getByTestId(id, { includeHiddenElements: true })
      .findAll((node: { type: unknown }) => typeof node.type === 'string' && node.type === 'Text')[0],
  ).color;

describe('Stepper', () => {
  it('shows the value and steps by one', () => {
    const { onChange } = renderStepper(2);
    expect(screen.getByTestId('stepper-value')).toHaveTextContent('2');

    fireEvent.press(screen.getByLabelText('Bir masal artır'));
    expect(onChange).toHaveBeenLastCalledWith(3);
    fireEvent.press(screen.getByLabelText('Bir masal azalt'));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it('disables minus at the minimum and plus at the maximum, on the disabled face with a faint glyph', () => {
    const T = themes['gece-mavisi'];
    const { onChange: atMin } = renderStepper(1);
    expect(screen.getByTestId('stepper-minus')).toBeDisabled();
    expect(screen.getByTestId('stepper-plus')).toBeEnabled();
    fireEvent.press(screen.getByTestId('stepper-minus'));
    expect(atMin).not.toHaveBeenCalled();
    // Inside a sheet (surface): the disabled face and a text3 glyph; never faded as a whole.
    expect(flat(screen.getByTestId('stepper-minus-face')).backgroundColor).toBe(T.surface2);
    expect(glyphColor('stepper-minus-glyph')).toBe(T.text3);
    expect(glyphColor('stepper-plus-glyph')).toBe(T.text);
    expect(flat(screen.getByTestId('stepper-minus')).opacity).toBe(1);
    screen.unmount();

    const { onChange: atMax } = renderStepper(3);
    expect(screen.getByTestId('stepper-plus')).toBeDisabled();
    fireEvent.press(screen.getByTestId('stepper-plus'));
    expect(atMax).not.toHaveBeenCalled();
  });

  it('a single value (min = max) disables both keys', () => {
    const { onChange } = renderStepper(1, jest.fn(), 'gece-mavisi', 1);
    expect(screen.getByTestId('stepper-minus')).toBeDisabled();
    expect(screen.getByTestId('stepper-plus')).toBeDisabled();
    fireEvent(screen.getByTestId('stepper'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the keys answer at touch-down: no press delay', () => {
    renderStepper(2);
    expect(screen.getByTestId('stepper-plus').props.unstable_pressDelay ?? 0).toBe(0);
  });

  it('the value is tabular Baloo 2 in a box of 44dp at least, so the keys keep their place from 9 to 10', () => {
    const { view, onChange } = renderStepper(9, jest.fn(), 'gece-mavisi', 12);
    const T = themes['gece-mavisi'];
    const box = () => flat(screen.getByTestId('stepper-value-box'));
    const value = () => flat(screen.getByTestId('stepper-value'));
    expect(box().minWidth).toBe(STEPPER_VALUE_MIN_WIDTH);
    expect(STEPPER_VALUE_MIN_WIDTH).toBe(44);
    expect(value().fontVariant).toEqual(['tabular-nums']);
    expect(value().fontFamily).toBe(T.fontDisplay);
    const boxAt9 = box();
    const textAt9 = value();

    view.rerender(stepper(10, onChange, 12));
    expect(screen.getByTestId('stepper-value')).toHaveTextContent('10');
    // Nothing that sizes the row changes with the number.
    expect(box()).toEqual(boxAt9);
    expect(value()).toEqual(textAt9);
    expect(box().width).toBeUndefined();
  });

  it('answers the screen reader actions and carries the hint', () => {
    const { onChange } = renderStepper(2);
    const group = screen.getByTestId('stepper');
    expect(group.props.accessibilityHint).toBe('Dokununca zamanlayıcı açılır');
    expect(group.props.accessibilityValue).toEqual({ min: 1, max: 3, now: 2, text: '2 masal' });
    fireEvent(group, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onChange).toHaveBeenLastCalledWith(3);
    fireEvent(group, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', scheme => {
    renderStepper(2, jest.fn(), scheme);
    const T = themes[scheme];
    expect(flat(screen.getByTestId('stepper-value')).color).toBe(T.text);
    // Tactile round keys one step above the sheet, on the neutral 2dp lip.
    expect(flat(screen.getByTestId('stepper-plus-face')).backgroundColor).toBe(T.surface2);
    expect(flat(screen.getByTestId('stepper-plus-lip')).backgroundColor).toBe(T.lip);
    expect(flat(screen.getByTestId('stepper-plus')).paddingBottom).toBe(2);
  });
});
