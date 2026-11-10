/**
 * SeslyMark (LA-7): a small mark exists on its first frame. It draws the
 * vector mark under the density-matched bitmap until the bitmap has loaded,
 * then only the bitmap; the large mark is the master bitmap. Props, testID
 * and the decorative rule (hidden from screen readers) are kept.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';
import { LinearGradient, Path } from 'react-native-svg';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { SMALL_MARK_MAX_SIZE, SeslyMark, SeslyMarkVector } from './SeslyMark';
import { SESLY_MARK_GRADIENTS, SESLY_MARK_PATHS, SESLY_MARK_VIEWBOX } from './seslyMarkVector';

const flat = (node: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;

/* eslint-disable @typescript-eslint/no-var-requires */
const SMALL_BITMAP = require('../../assets/images/logo-mark.png');
const MASTER_BITMAP = require('../../assets/images/logo.png');
/* eslint-enable @typescript-eslint/no-var-requires */

describe('SeslyMark, small (up to 32dp)', () => {
  it('has the vector mark on its first frame, under the density-matched bitmap', () => {
    renderWithProviders(<SeslyMark size={30} testID="mark" />);

    expect(flat(screen.getByTestId('mark'))).toMatchObject({ width: 30, height: 30 });
    const vector = screen.getByTestId('mark-vector');
    expect(vector.props).toMatchObject({ width: 30, height: 30 });
    const bitmap = screen.getByTestId('mark-bitmap');
    expect(bitmap.props.source).toBe(SMALL_BITMAP);
    expect(flat(bitmap)).toMatchObject({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 });
    expect(bitmap.props.fadeDuration).toBe(0);
  });

  it('drops the vector once the bitmap has loaded, and keeps the bitmap', () => {
    renderWithProviders(<SeslyMark size={SMALL_MARK_MAX_SIZE} testID="mark" />);
    fireEvent(screen.getByTestId('mark-bitmap'), 'load', { nativeEvent: { source: { width: 84, height: 84 } } });

    expect(screen.queryByTestId('mark-vector')).toBeNull();
    expect(screen.getByTestId('mark-bitmap').props.source).toBe(SMALL_BITMAP);
    expect(flat(screen.getByTestId('mark'))).toMatchObject({ width: 32, height: 32 });
  });

  it('is announced as "Sesly" by default, at 22dp', () => {
    renderWithProviders(<SeslyMark testID="mark" />);
    const mark = screen.getByLabelText('Sesly');
    expect(mark.props.testID).toBe('mark');
    expect(mark.props.accessible).toBe(true);
    expect(flat(mark)).toMatchObject({ width: 22, height: 22 });
  });

  it('decorative: hidden from screen readers with everything inside it', () => {
    renderWithProviders(<SeslyMark size={30} decorative testID="mark" />);
    expect(screen.queryByLabelText('Sesly')).toBeNull();
    const mark = screen.getByTestId('mark', { includeHiddenElements: true });
    expect(mark.props).toMatchObject({
      accessible: false,
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    });
    expect(mark.props.accessibilityLabel).toBeUndefined();
    expect(screen.queryByTestId('mark-bitmap')).toBeNull();
    expect(screen.getByTestId('mark-bitmap', { includeHiddenElements: true })).toBeTruthy();
  });

  it('without a testID nothing inside gets one', () => {
    renderWithProviders(<SeslyMark size={30} />);
    expect(screen.queryByTestId('undefined-vector')).toBeNull();
    expect(screen.UNSAFE_getAllByType(Path)).toHaveLength(SESLY_MARK_PATHS.length);
  });
});

describe('SeslyMark, large', () => {
  it('is the master bitmap alone, with the same props and label', () => {
    renderWithProviders(<SeslyMark size={44} testID="mark" />);
    const mark = screen.getByTestId('mark');
    expect(mark.props.source).toBe(MASTER_BITMAP);
    expect(flat(mark)).toMatchObject({ width: 44, height: 44 });
    expect(mark.props.accessibilityLabel).toBe('Sesly');
    expect(screen.queryByTestId('mark-vector')).toBeNull();
    expect(screen.UNSAFE_queryAllByType(Path)).toHaveLength(0);
  });

  it('decorative: hidden from screen readers', () => {
    renderWithProviders(<SeslyMark size={44} decorative testID="mark" />);
    const mark = screen.getByTestId('mark', { includeHiddenElements: true });
    expect(mark.props).toMatchObject({ accessible: false, importantForAccessibility: 'no' });
    expect(screen.queryByLabelText('Sesly')).toBeNull();
  });
});

describe('SeslyMarkVector', () => {
  it('draws every path on the logo frame, gradients from its own definitions', () => {
    renderWithProviders(<SeslyMarkVector size={30} testID="vector" />);
    expect(screen.getByTestId('vector').props).toMatchObject({ width: 30, height: 30 });

    const paths = screen.UNSAFE_getAllByType(Path);
    expect(paths).toHaveLength(SESLY_MARK_PATHS.length);
    // The dark silhouette first, as in the file.
    expect(paths[0].props.fill).toBe('#101729');

    const ids = screen.UNSAFE_getAllByType(LinearGradient).map(g => g.props.id);
    expect(ids.sort()).toEqual(Object.keys(SESLY_MARK_GRADIENTS).map(k => `sesly-mark-${k}`).sort());
    const referenced = new Set(
      paths.map(p => /^url\(#(.+)\)$/.exec(p.props.fill as string)?.[1]).filter(Boolean) as string[],
    );
    expect([...referenced].sort()).toEqual(ids.sort());
  });
});

describe('seslyMarkVector data', () => {
  it('is on the same 2000 frame as logo.png', () => {
    expect(SESLY_MARK_VIEWBOX).toBe('0 0 2000 2000');
  });

  it('every path is a closed outline of whole-unit curves, together spanning the logo.png content', () => {
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const { d } of SESLY_MARK_PATHS) {
      expect(d).toMatch(/^M-?\d+ -?\d+/);
      expect(d).toMatch(/z$/);
      expect(d).toMatch(/^[Mcz\d\s-]+$/);
      // Walk the relative curves, collecting every point.
      const tokens = d.match(/[Mcz]|-?\d+/g) ?? [];
      let x = 0;
      let y = 0;
      let start = { x: 0, y: 0 };
      const point = (px: number, py: number) => {
        box.minX = Math.min(box.minX, px);
        box.maxX = Math.max(box.maxX, px);
        box.minY = Math.min(box.minY, py);
        box.maxY = Math.max(box.maxY, py);
      };
      for (let i = 0; i < tokens.length; ) {
        if (tokens[i] === 'M') {
          x = Number(tokens[i + 1]);
          y = Number(tokens[i + 2]);
          start = { x, y };
          point(x, y);
          i += 3;
        } else if (tokens[i] === 'c') {
          const v = tokens.slice(i + 1, i + 7).map(Number);
          for (let j = 0; j < 6; j += 2) point(x + v[j], y + v[j + 1]);
          x += v[4];
          y += v[5];
          i += 7;
        } else {
          x = start.x;
          y = start.y;
          i += 1;
        }
      }
    }
    // logo.png's opaque pixels run from (0, 181) to (1999, 1836): the vector
    // sits where the bitmap does, so nothing shifts when the bitmap covers it.
    expect(box).toEqual({ minX: 0, minY: 181, maxX: 2000, maxY: 1838 });
  });

  it('fills are brand hex colours or the defined gradients', () => {
    for (const { fill } of SESLY_MARK_PATHS) {
      if ('color' in fill) expect(fill.color).toMatch(/^#[0-9A-F]{6}$/);
      else expect(Object.keys(SESLY_MARK_GRADIENTS)).toContain(fill.gradient);
    }
    for (const { x1, x2, stops } of Object.values(SESLY_MARK_GRADIENTS)) {
      expect(x2).toBeGreaterThan(x1);
      expect(stops[0][0]).toBe(0);
      expect(stops[stops.length - 1][0]).toBe(1);
      const offsets = stops.map(([o]) => o);
      expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    }
  });
});
