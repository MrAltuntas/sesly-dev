/**
 * The neutral ladder helpers (docs/release-pass/SPEC-design.md 1.6.1), the
 * SurfaceLevel context that feeds them, and the button colour mapping that
 * reads them.
 */

import React from 'react';
import { renderHook } from '@testing-library/react-native';

import { PALETTE_KEYS, PaletteKey, palettes } from './palettes';
import { flatten, mix } from './color';
import {
  SURFACE_LEVELS,
  WAVE_IDLE_ALPHA,
  disabledFace,
  ghostFace,
  glassRing,
  insetFace,
  raisedFace,
} from './surfaces';
import { themes } from './theme';
import { SurfaceLevelProvider, useSurfaceLevel } from '../components/design/SurfaceLevel';
import { buttonColors } from '../components/design/buttonColors';

describe('ladder faces', () => {
  it.each(PALETTE_KEYS)('%s: raised is one step up, inset one step down, disabled never above surface2', key => {
    const P = palettes[key];
    expect(raisedFace(P, 'bg')).toBe(P.surface);
    expect(raisedFace(P, 'surface')).toBe(P.surface2);
    expect(raisedFace(P, 'surface2')).toBe(P.line);

    expect(insetFace(P, 'bg')).toBe(P.surface);
    expect(insetFace(P, 'surface')).toBe(P.bg);
    expect(insetFace(P, 'surface2')).toBe(P.surface);

    expect(disabledFace(P, 'bg')).toBe(P.surface);
    expect(disabledFace(P, 'surface')).toBe(P.surface2);
    expect(disabledFace(P, 'surface2')).toBe(P.surface);
  });

  it('no face is ever drawn in the colour of its container', () => {
    for (const key of PALETTE_KEYS) {
      const P = palettes[key];
      for (const level of SURFACE_LEVELS) {
        for (const face of [raisedFace(P, level), insetFace(P, level), disabledFace(P, level)]) {
          expect({ key, level, same: face === P[level] }).toEqual({ key, level, same: false });
        }
      }
    }
  });

  it('works on any palette-shaped object, not only the registry', () => {
    const ladder = { bg: '#000001', surface: '#000002', surface2: '#000003', line: '#000004' };
    expect(raisedFace(ladder, 'surface2')).toBe('#000004');
    expect(insetFace(ladder, 'surface')).toBe('#000001');
    expect(disabledFace(ladder, 'surface2')).toBe('#000002');
  });
});

// Reference values of SPEC-design 1.6.3 (final palettes).
const REFERENCE: Record<PaletteKey, { ring: string; ghostOnOwnB: string; requested: string }> = {
  kitaplik: { ring: '#566669', ghostOnOwnB: '#182B2F', requested: '#2C4B4E' },
  orman: { ring: '#576559', ghostOnOwnB: '#18261E', requested: '#2F4833' },
  'gece-mavisi': { ring: '#5B6371', ghostOnOwnB: '#1E2638', requested: '#354554' },
  murekkep: { ring: '#5E5E5F', ghostOnOwnB: '#202124', requested: '#3C423E' },
  erik: { ring: '#685C6B', ghostOnOwnB: '#292032', requested: '#473E4C' },
  orijinal: { ring: '#615C88', ghostOnOwnB: '#1C164E', requested: '#39487A' },
};

describe('glass ring and ghost face', () => {
  it.each(PALETTE_KEYS)('%s: opaque hex values equal to the reference table', key => {
    const P = palettes[key];
    const ring = glassRing(P);
    const ghost = ghostFace(P, P.ownB);
    expect(ring).toMatch(/^#[0-9A-F]{6}$/);
    expect(ghost).toMatch(/^#[0-9A-F]{6}$/);
    expect(ring).toBe(REFERENCE[key].ring);
    expect(ghost).toBe(REFERENCE[key].ghostOnOwnB);
    expect(mix(P.success, key === 'orijinal' ? 0.18 : 0.12, P.surface2)).toBe(REFERENCE[key].requested);
  });

  it('the ghost face follows the card it sits on', () => {
    const P = palettes.erik;
    expect(ghostFace(P, P.ownA)).not.toBe(ghostFace(P, P.ownB));
    expect(ghostFace(P, '#FFFFFF')).toBe(mix(P.bar, 0.55, '#FFFFFF'));
  });

  it('the unplayed waveform is a translucent text colour', () => {
    expect(WAVE_IDLE_ALPHA).toBe(0.4);
  });
});

describe('SurfaceLevel context', () => {
  it('is the canvas outside every provider', () => {
    const { result } = renderHook(() => useSurfaceLevel());
    expect(result.current).toBe('bg');
  });

  it('reads the nearest provider', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        SurfaceLevelProvider,
        { level: 'surface' },
        React.createElement(SurfaceLevelProvider, { level: 'surface2' }, children),
      );
    const { result } = renderHook(() => useSurfaceLevel(), { wrapper });
    expect(result.current).toBe('surface2');
  });

  it('follows a provider that changes level', () => {
    let level: 'surface' | 'surface2' = 'surface';
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SurfaceLevelProvider, { level }, children);
    const { result, rerender } = renderHook(() => useSurfaceLevel(), { wrapper });
    expect(result.current).toBe('surface');
    level = 'surface2';
    rerender({});
    expect(result.current).toBe('surface2');
  });
});

describe('buttonColors', () => {
  const T = themes['gece-mavisi'];

  it('primary is the action colour on its lip at every level', () => {
    for (const level of SURFACE_LEVELS) {
      expect(buttonColors(T, 'primary', 'default', level)).toEqual({
        background: T.action,
        label: T.onAction,
        lip: T.actionLip,
      });
    }
  });

  it('a danger primary is the error colour on a darker error lip', () => {
    expect(buttonColors(T, 'primary', 'danger')).toEqual({
      background: T.error,
      label: T.onAction,
      lip: mix(T.error, 0.62, T.lip),
    });
  });

  it('secondary takes the raised face of its level, the danger tone only recolours the label', () => {
    expect(buttonColors(T, 'secondary')).toEqual({ background: T.surface, label: T.text, lip: T.lip });
    expect(buttonColors(T, 'secondary', 'default', 'surface').background).toBe(T.surface2);
    expect(buttonColors(T, 'secondary', 'default', 'surface2').background).toBe(T.line);
    expect(buttonColors(T, 'secondary', 'danger', 'surface')).toEqual({
      background: T.surface2,
      label: T.error,
      lip: T.lip,
    });
  });

  it('disabled is the grey disabled face with a text3 label in every filled variant and tone', () => {
    for (const level of SURFACE_LEVELS) {
      for (const variant of ['primary', 'secondary', 'ghost'] as const) {
        for (const tone of ['default', 'danger'] as const) {
          expect(buttonColors(T, variant, tone, level, { disabled: true })).toEqual({
            background: disabledFace(T, level),
            label: T.text3,
            lip: T.lip,
          });
        }
      }
    }
    // Never the action colour, never the error colour.
    expect(buttonColors(T, 'primary', 'default', 'bg', { disabled: true }).background).not.toBe(T.action);
    expect(buttonColors(T, 'primary', 'danger', 'bg', { disabled: true }).background).not.toBe(T.error);
  });

  it('ghost is opaque over the card it sits on, or over its container', () => {
    const onCard = buttonColors(T, 'ghost', 'default', 'surface2', { parentColor: T.ownB });
    expect(onCard).toEqual({ background: ghostFace(T, T.ownB), label: T.text, lip: T.lip });
    expect(onCard.background).toMatch(/^#[0-9A-F]{6}$/);
    expect(buttonColors(T, 'ghost', 'default', 'surface').background).toBe(ghostFace(T, T.surface));
    expect(buttonColors(T, 'ghost', 'default', 'bg', { parentColor: 'transparent' }).background).toBe(
      ghostFace(T, T.bg),
    );
    // A translucent card is flattened onto the container first.
    expect(buttonColors(T, 'ghost', 'default', 'surface', { parentColor: T.chipOkBg }).background).toBe(
      ghostFace(T, flatten(T.chipOkBg, T.surface)),
    );
    expect(buttonColors(T, 'ghost', 'danger', 'bg', { parentColor: T.ownB }).label).toBe(T.error);
  });

  it('a text button has no face and no lip, and only greys its label when disabled', () => {
    expect(buttonColors(T, 'text')).toEqual({ background: 'transparent', label: T.text, lip: 'transparent' });
    expect(buttonColors(T, 'text', 'danger').label).toBe(T.error);
    expect(buttonColors(T, 'text', 'danger', 'surface', { disabled: true })).toEqual({
      background: 'transparent',
      label: T.text3,
      lip: 'transparent',
    });
  });

  it('follows the palette', () => {
    for (const key of PALETTE_KEYS) {
      const theme = themes[key];
      expect(buttonColors(theme, 'secondary', 'default', 'surface').background).toBe(palettes[key].surface2);
    }
  });
});
