/**
 * Card as a container of the neutral ladder and CategoryTile sizing
 * (docs/release-pass/SPEC-design.md 3.10, 1.6.1; ui-16).
 */

import React from 'react';
import { Text, View } from 'react-native';
import * as RN from 'react-native';
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { PALETTE_KEYS } from '../../theme/palettes';
import { LIP, themes, useT } from '../../theme/theme';
import { raisedFace } from '../../theme/surfaces';
import { Button } from './Button';
import { Card, CategoryTile, cardSurfaceLevel, tileLabelMaxWidth } from './cards';
import { useSurfaceLevel } from './SurfaceLevel';

const gece = themes['gece-mavisi'];
const flat = (node: { props: { style?: unknown } }): Record<string, any> =>
  Object.assign({}, ...[node.props.style].flat(8).filter(Boolean));

/** Draws the level it sits on, and the raised face a control there takes. */
const LevelProbe: React.FC = () => {
  const T = useT();
  const level = useSurfaceLevel();
  return <View testID={`probe-${level}`} style={{ backgroundColor: raisedFace(T, level) }} />;
};

describe('Card', () => {
  it('is a container: a Button inside it reads raisedFace(surface), inside a raised card raisedFace(surface2)', () => {
    const view = renderWithProviders(
      <Card testID="card">
        <Button label="Vazgeç" variant="secondary" testID="btn" />
      </Card>,
    );
    expect(flat(screen.getByTestId('card-face')).backgroundColor).toBe(gece.surface);
    expect(flat(screen.getByTestId('btn-face')).backgroundColor).toBe(raisedFace(gece, 'surface'));
    expect(flat(screen.getByTestId('btn-face')).backgroundColor).not.toBe(gece.surface);
    view.unmount();

    renderWithProviders(
      <Card tone="raised" testID="card">
        <Button label="Vazgeç" variant="secondary" testID="btn" />
      </Card>,
    );
    expect(flat(screen.getByTestId('card-face')).backgroundColor).toBe(gece.surface2);
    expect(flat(screen.getByTestId('btn-face')).backgroundColor).toBe(raisedFace(gece, 'surface2'));
  });

  it.each(PALETTE_KEYS)('in %s a secondary button never takes the colour of the card it sits on', key => {
    const T = themes[key];
    renderWithProviders(
      <>
        <Card testID="plain">
          <Button label="Bir" variant="secondary" testID="a" />
        </Card>
        <Card selected onPress={jest.fn()} testID="picked">
          <Button label="İki" variant="secondary" testID="b" />
        </Card>
      </>,
      { theme: key },
    );
    expect(flat(screen.getByTestId('a-face')).backgroundColor).not.toBe(flat(screen.getByTestId('plain-face')).backgroundColor);
    expect(flat(screen.getByTestId('b-face')).backgroundColor).toBe(T.line);
    expect(flat(screen.getByTestId('picked-face')).backgroundColor).toBe(T.surface2);
  });

  it('a selected card is surface2 for its children; a tinted one takes surfaceLevel (default surface2)', () => {
    renderWithProviders(
      <>
        <Card selected onPress={jest.fn()}>
          <LevelProbe />
        </Card>
        <Card color={gece.ownB}>
          <View testID="tinted">
            <LevelProbe />
          </View>
        </Card>
        <Card color={gece.ownC} surfaceLevel="surface">
          <View testID="tinted-surface">
            <LevelProbe />
          </View>
        </Card>
      </>,
    );
    expect(screen.getAllByTestId('probe-surface2')).toHaveLength(2);
    expect(screen.getByTestId('probe-surface')).toBeTruthy();
    expect(cardSurfaceLevel('surface', undefined, undefined, 'surface2')).toBe('surface');
    expect(cardSurfaceLevel('raised', undefined, undefined, 'surface2')).toBe('surface2');
    expect(cardSurfaceLevel('surface', true, undefined, 'surface2')).toBe('surface2');
    expect(cardSurfaceLevel('surface', false, '#123456', 'bg')).toBe('bg');
  });

  it('the level ends at the card: a control after it is back on the canvas', () => {
    renderWithProviders(
      <>
        <Card>
          <Text>İçerik</Text>
        </Card>
        <LevelProbe />
      </>,
    );
    expect(screen.getByTestId('probe-bg')).toBeTruthy();
  });

  it('always carries the 2dp ring, transparent unless selected, so selecting never moves the content', () => {
    const view = renderWithProviders(<Card testID="card" />);
    const idle = flat(screen.getByTestId('card-face'));
    expect(idle).toMatchObject({ borderWidth: 2, borderColor: 'transparent', padding: 16, borderRadius: 24 });
    view.rerender(<Card selected onPress={jest.fn()} testID="card" />);
    const picked = flat(screen.getByTestId('card-face'));
    expect(picked).toMatchObject({ borderWidth: 2, borderColor: gece.action, padding: 16 });
    expect(flat(screen.getByTestId('card-lip'))).toMatchObject({ top: LIP.md, backgroundColor: gece.actionLip });
    view.rerender(<Card selected={false} onPress={jest.fn()} testID="card" />);
    expect(flat(screen.getByTestId('card-face'))).toMatchObject({ borderWidth: 2, borderColor: 'transparent' });
  });

  it('defaults to radius 24 on the 3dp lip; both can be set', () => {
    const view = renderWithProviders(<Card testID="card" />);
    expect(flat(screen.getByTestId('card'))).toMatchObject({ paddingBottom: 3 });
    expect(flat(screen.getByTestId('card-lip'))).toMatchObject({ top: 3, borderRadius: 24, backgroundColor: gece.lip });
    view.rerender(<Card radius={20} lip={LIP.lg} testID="card" />);
    expect(flat(screen.getByTestId('card-face')).borderRadius).toBe(20);
    expect(flat(screen.getByTestId('card'))).toMatchObject({ paddingBottom: 4 });
  });
});

describe('CategoryTile', () => {
  it('has a minimum width (no fixed width), radius 20 on its 3dp lip', () => {
    renderWithProviders(<CategoryTile category="BEDTIME" label="Uyku masalları" onPress={jest.fn()} testID="tile" />);
    const outer = flat(screen.getByTestId('tile'));
    expect(outer.minWidth).toBe(128);
    expect(outer.width).toBeUndefined();
    expect(outer.paddingBottom).toBe(3);
    expect(flat(screen.getByTestId('tile-face')).borderRadius).toBe(20);
  });

  it('the label shrinks rather than flexes, follows the font to 1.3 and wraps at a word-sized width', () => {
    renderWithProviders(<CategoryTile category="EDUCATIONAL" label="Educational stories" testID="tile" />);
    const label = screen.getByTestId('tile-label');
    const style = flat(label);
    expect(style.flexShrink).toBe(1);
    expect(style.flex).toBeUndefined();
    expect(label.props.maxFontSizeMultiplier).toBe(1.3);
    expect(label.props.numberOfLines).toBe(2);
    const { fontScale } = RN.Dimensions.get('window');
    expect(style.maxWidth).toBe(tileLabelMaxWidth(fontScale));
  });

  it('the wrap width grows with the font scale up to 1.3', () => {
    expect(tileLabelMaxWidth(1)).toBe(84);
    expect(tileLabelMaxWidth(1.15)).toBe(97);
    expect(tileLabelMaxWidth(1.3)).toBe(109);
    expect(tileLabelMaxWidth(2)).toBe(109);
    expect(tileLabelMaxWidth(0.85)).toBe(71);
  });

  it('reads the live font scale of the window', () => {
    jest.spyOn(RN.Dimensions, 'get').mockReturnValue({ width: 360, height: 800, scale: 3, fontScale: 1 });
    renderWithProviders(<CategoryTile category="BEDTIME" label="Uyku masalları" testID="tile" />);
    expect(flat(screen.getByTestId('tile-label')).maxWidth).toBe(84);
  });

  it('a wider minimum can be asked for', () => {
    renderWithProviders(<CategoryTile category="BEDTIME" label="Uyku" width={150} testID="tile" />);
    expect(flat(screen.getByTestId('tile')).minWidth).toBe(150);
  });
});
