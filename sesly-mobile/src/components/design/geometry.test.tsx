/**
 * Geometry of the design components in one table (SPEC-design 1.3, 1.4,
 * design-system:test-1): every face with a lip sinks by exactly that lip and
 * draws the lip the scale gives its size; the Button size table; every
 * IconButton variant's size; and no button face is ever its container's
 * colour, in any palette.
 */

import React from 'react';
import { Animated, Text } from 'react-native';
import { configure, fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { PALETTE_KEYS } from '../../theme/palettes';
import { LIP, RADIUS, SPACE, lipFor, themes } from '../../theme/theme';
import { SURFACE_LEVELS, glassRing, raisedFace } from '../../theme/surfaces';
import { contrastRatio } from '../../theme/color';
import { BUTTON_METRICS, Button, ButtonSize, ButtonTone, ButtonVariant, buttonColors, buttonHitSlop } from './Button';
import { Card, CategoryTile } from './cards';
import { Chip } from './controls';
import { CircleButton, circleLip } from './feedback';
import {
  SKIP_ARROW_BOTTOM,
  SKIP_GEOMETRY,
  SKIP_NUMBER_DROP,
  SKIP_NUMBER_FONT,
  SKIP_RING_INNER,
  Icon,
} from './Icon';
import { MINI_PLAYER_LIP, MiniPlayerBar } from './MiniPlayerBar';
import { CoverCard, coverLip } from './PictureCover';
import { Avatar, ICON_BADGE_SIZE, IconButton, ListRow, avatarLip, avatarRadius } from './rows';
import { LanguageCodes, TranslationBadge } from './storyMarks';
import { Tactile } from './Tactile';

// Icons are decorative and hidden from accessibility; these tests look at them.
configure({ defaultIncludeHiddenElements: true });

const gece = themes['gece-mavisi'];
const flat = (node: { props: { style?: unknown } }): Record<string, any> =>
  Object.assign({}, ...[node.props.style].flat(8).filter(Boolean));

/** Native-driver timings land at once (the value moves off the JS thread on a device). */
function landTimingsAtOnce() {
  return jest.spyOn(Animated, 'timing').mockImplementation(((
    value: Animated.Value,
    config: { toValue: number },
  ) => ({
    start: (done?: (r: { finished: boolean }) => void) => {
      value.setValue(config.toValue);
      done?.({ finished: true });
    },
    stop: () => undefined,
    reset: () => undefined,
  })) as unknown as typeof Animated.timing);
}

const translateY = (testID: string): number => {
  const transform = flat(screen.getByTestId(testID)).transform as { translateY?: number }[] | undefined;
  return transform?.find(t => t.translateY !== undefined)?.translateY ?? 0;
};

interface SinkCase {
  name: string;
  render: () => React.ReactElement;
  /** What the finger presses. */
  press: string;
  /** What moves. */
  face: string;
  /** The lip layer, its `top` is the lip. */
  lip: string;
  expected: number;
}

const story = { id: 's-1' };
const noop = () => undefined;

const SINKS: SinkCase[] = [
  ...[LIP.sm, LIP.md, LIP.lg].map(lip => ({
    name: `Tactile, lip ${lip}`,
    render: () => <Tactile color="#223344" lipColor="#000000" lip={lip} onPress={noop} testID="t" />,
    press: 't',
    face: 't-face',
    lip: 't-lip',
    expected: lip,
  })),
  ...(['sm', 'md', 'lg'] as ButtonSize[]).map(size => ({
    name: `Button ${size}`,
    render: () => <Button label="Dinle" size={size} onPress={noop} testID="b" />,
    press: 'b',
    face: 'b-face',
    lip: 'b-lip',
    expected: BUTTON_METRICS[size].lip,
  })),
  ...(['tactile', 'glass'] as const).map(variant => ({
    name: `IconButton ${variant}`,
    render: () => <IconButton variant={variant} icon="close" onPress={noop} accessibilityLabel="Kapat" testID="ib" />,
    press: 'ib',
    face: 'ib-face',
    lip: 'ib-lip',
    expected: LIP.sm,
  })),
  {
    name: 'Chip',
    render: () => <Chip label="Uyku" onPress={noop} testID="chip" />,
    press: 'chip',
    face: 'chip-face',
    lip: 'chip-lip',
    expected: LIP.sm,
  },
  {
    name: 'Card',
    render: () => (
      <Card onPress={noop} testID="card">
        <Text>Kart</Text>
      </Card>
    ),
    press: 'card',
    face: 'card-face',
    lip: 'card-lip',
    expected: LIP.md,
  },
  {
    name: 'CategoryTile',
    render: () => <CategoryTile category="BEDTIME" label="Uyku masalları" onPress={noop} testID="tile" />,
    press: 'tile',
    face: 'tile-face',
    lip: 'tile-lip',
    expected: LIP.md,
  },
  ...[42, 56].map(size => ({
    name: `CircleButton ${size}`,
    render: () => <CircleButton icon="play" size={size} onPress={noop} accessibilityLabel="Oynat" testID="pb" />,
    press: 'pb',
    face: 'pb-face',
    lip: 'pb-lip',
    expected: size > 48 ? LIP.md : LIP.sm,
  })),
  {
    name: 'ListRow card (row card)',
    render: () => <ListRow card title="Achernar" subtitle="Türkçe" onPress={noop} testID="row" />,
    press: 'row',
    face: 'row-face',
    lip: 'row-lip',
    expected: LIP.md,
  },
  ...[98, 144].map(width => ({
    name: `CoverCard ${width}dp`,
    render: () => <CoverCard story={story} title="Uykulu Ay" width={width} onPress={noop} testID="cc" />,
    press: 'cc',
    face: 'cc-cover-picture',
    lip: 'cc-cover-lip',
    expected: width >= 130 ? LIP.lg : LIP.md,
  })),
  {
    name: 'MiniPlayerBar card',
    render: () => (
      <MiniPlayerBar story={story} title="Bremen" isPlaying onPress={noop} onTogglePlay={noop} />
    ),
    press: 'mini-player-open',
    face: 'mini-player-card',
    lip: 'mini-player-lip',
    expected: MINI_PLAYER_LIP,
  },
  {
    name: 'MiniPlayerBar toggle',
    render: () => (
      <MiniPlayerBar story={story} title="Bremen" isPlaying onPress={noop} onTogglePlay={noop} />
    ),
    press: 'mini-player-toggle',
    face: 'mini-player-toggle-face',
    lip: 'mini-player-toggle-lip',
    expected: LIP.sm,
  },
  ...[40, 52].map(size => ({
    name: `Avatar ${size} with a lip`,
    render: () => (
      <Avatar initial="S" size={size} lipColor={gece.ownLip} onPress={noop} accessibilityLabel="Profil" testID="av" />
    ),
    press: 'av',
    face: 'av-face',
    lip: 'av-lip',
    expected: size <= 48 ? LIP.sm : LIP.md,
  })),
];

describe('a face sinks by exactly its lip', () => {
  it.each(SINKS.map(c => [c.name, c] as const))('%s', (_name, c) => {
    landTimingsAtOnce();
    renderWithProviders(c.render());
    expect(flat(screen.getByTestId(c.lip)).top).toBe(c.expected);
    expect(translateY(c.face)).toBe(0);

    fireEvent(screen.getByTestId(c.press), 'pressIn');
    expect(translateY(c.face)).toBe(c.expected);
    // The lip itself never moves.
    expect(translateY(c.lip)).toBe(0);

    fireEvent(screen.getByTestId(c.press), 'pressOut');
    expect(translateY(c.face)).toBe(0);
  });

  it('a disabled face never sinks', () => {
    const timing = landTimingsAtOnce();
    renderWithProviders(<Button label="Dinle" disabled onPress={noop} testID="b" />);
    fireEvent(screen.getByTestId('b'), 'pressIn');
    expect(timing).not.toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ toValue: 1 }));
    expect(translateY('b-face')).toBe(0);
  });
});

describe('lip by size (SPEC-design 1.3)', () => {
  it.each([
    [36, LIP.sm],
    [44, LIP.sm],
    [48, LIP.sm],
    [49, LIP.md],
    [56, LIP.md],
    [71, LIP.md],
    [72, LIP.lg],
    [80, LIP.lg],
  ])('a %ddp face takes lip %d', (height, lip) => {
    expect(lipFor(height)).toBe(lip);
    expect(avatarLip(height)).toBe(lip);
  });

  it.each([
    [42, LIP.sm],
    [48, LIP.sm],
    [52, LIP.md],
    [56, LIP.md],
  ])('a %ddp circle button takes lip %d', (size, lip) => {
    expect(circleLip(size)).toBe(lip);
  });

  it.each([
    [44, LIP.md],
    [98, LIP.md],
    [129, LIP.md],
    [130, LIP.lg],
    [320, LIP.lg],
  ])('a %ddp cover takes lip %d (never 5)', (width, lip) => {
    expect(coverLip(width)).toBe(lip);
  });

  it('no lip is thicker than LIP.lg', () => {
    for (const size of [20, 40, 60, 80, 120, 200, 400]) {
      expect(lipFor(size)).toBeLessThanOrEqual(LIP.lg);
      expect(coverLip(size)).toBeLessThanOrEqual(LIP.lg);
      expect(circleLip(size)).toBeLessThanOrEqual(LIP.lg);
    }
  });

  it.each([
    [36, 'rounded', RADIUS.sm],
    [40, 'rounded', RADIUS.sm],
    [46, 'rounded', RADIUS.md],
    [52, 'rounded', RADIUS.md],
    [72, 'rounded', RADIUS.lg],
    [40, 'circle', 20],
  ] as const)('a %ddp %s avatar has the corner of its role (%d)', (size, shape, radius) => {
    expect(avatarRadius(size, shape)).toBe(radius);
  });
});

describe('the Button size table (SPEC-design 1.4)', () => {
  it.each([
    ['sm', 36, 2, 12, 12, 14, { top: 5, bottom: 5 }],
    ['md', 44, 2, 16, 16, 15, { top: 1, bottom: 1 }],
    ['lg', 52, 3, 20, 20, 16, undefined],
  ] as const)('%s: face %d on lip %d, radius %d, padH %d, font %d', (size, height, lip, radius, padH, font, slop) => {
    expect(BUTTON_METRICS[size]).toMatchObject({ height, lip, radius, padH, font });
    expect(buttonHitSlop(size)).toEqual(slop);

    renderWithProviders(<Button label="Devam" size={size} onPress={noop} testID="b" />);
    expect(flat(screen.getByTestId('b-face'))).toMatchObject({ minHeight: height, borderRadius: radius, paddingHorizontal: padH });
    expect(flat(screen.getByTestId('b-lip'))).toMatchObject({ top: lip, borderRadius: radius });
    expect(flat(screen.getByTestId('b'))).toMatchObject({ paddingBottom: lip });
    expect(screen.getByTestId('b').props.hitSlop).toEqual(slop);
    expect(flat(screen.getByText('Devam')).fontSize).toBe(font);
    // Face and lip together reach the 48dp touch target, through the slop below 48.
    const reach = height + lip + (slop ? slop.top + slop.bottom : 0);
    expect(reach).toBeGreaterThanOrEqual(gece.touch);
  });

  it('only 36, 44 and 52 exist: no 40, 48 or 58dp button is left', () => {
    expect(Object.values(BUTTON_METRICS).map(m => m.height)).toEqual([36, 44, 52]);
    // The label line fits the face with the 8dp vertical padding.
    for (const m of Object.values(BUTTON_METRICS)) {
      expect(m.lineHeight).toBeGreaterThanOrEqual(m.font * 1.3);
      expect(m.lineHeight + 16).toBeLessThanOrEqual(m.height);
    }
  });

  it('a text button has no face and no lip and fills the 48dp target', () => {
    renderWithProviders(<Button variant="text" label="Vazgeç" size="sm" onPress={noop} testID="tb" />);
    expect(screen.queryByTestId('tb-lip')).toBeNull();
    expect(flat(screen.getByTestId('tb-face')).minHeight).toBe(gece.touch);
  });
});

describe('every IconButton variant size', () => {
  it('plain: the glyph in a 48dp target, no lip, no slop by default', () => {
    renderWithProviders(<IconButton icon="close" onPress={noop} accessibilityLabel="Kapat" testID="ib" />);
    expect(flat(screen.getByTestId('ib'))).toMatchObject({ width: 48, height: 48 });
    expect(screen.queryByTestId('ib-lip')).toBeNull();
    expect(screen.getByTestId('ib').props.hitSlop).toBeUndefined();
    expect(flat(screen.getByTestId('icon-close')).width).toBe(24);
  });

  it.each(['tactile', 'glass'] as const)('%s: a 44dp face, radius 16, on a 2dp lip, slop 1 and 2 to 48dp', variant => {
    renderWithProviders(<IconButton variant={variant} icon="close" onPress={noop} accessibilityLabel="Kapat" testID="ib" />);
    expect(flat(screen.getByTestId('ib-face'))).toMatchObject({ width: 44, height: 44, borderRadius: RADIUS.md });
    expect(flat(screen.getByTestId('ib-lip')).top).toBe(LIP.sm);
    expect(screen.getByTestId('ib').props.hitSlop).toEqual({ top: 1, bottom: 1, left: 2, right: 2 });
    const face = flat(screen.getByTestId('ib-face'));
    if (variant === 'glass') {
      expect(face).toMatchObject({ backgroundColor: gece.surface, borderWidth: 1, borderColor: glassRing(gece) });
    } else {
      expect(face.backgroundColor).toBe(raisedFace(gece, 'bg'));
    }
  });

  it('tactile with a 36dp box: radius 12, the slop brings it to 48dp', () => {
    renderWithProviders(
      <IconButton variant="tactile" box={36} icon="close" onPress={noop} accessibilityLabel="Kapat" testID="ib" />,
    );
    expect(flat(screen.getByTestId('ib-face'))).toMatchObject({ width: 36, height: 36, borderRadius: RADIUS.sm });
    expect(screen.getByTestId('ib').props.hitSlop).toEqual({ top: 5, bottom: 5, left: 6, right: 6 });
  });

  it('badge: a 28dp circle, no lip, a 16dp glyph, slop 10', () => {
    renderWithProviders(<IconButton variant="badge" icon="bookmark" onPress={noop} accessibilityLabel="Kaydet" testID="ib" />);
    expect(flat(screen.getByTestId('ib'))).toMatchObject({ width: ICON_BADGE_SIZE, height: ICON_BADGE_SIZE });
    expect(flat(screen.getByTestId('ib-face')).borderRadius).toBe(ICON_BADGE_SIZE / 2);
    expect(screen.queryByTestId('ib-lip')).toBeNull();
    expect(flat(screen.getByTestId('icon-bookmark')).width).toBe(16);
    expect(screen.getByTestId('ib').props.hitSlop).toBe(10);
  });
});

describe('button faces never take their container colour', () => {
  const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost'];
  const TONES: ButtonTone[] = ['default', 'danger'];

  it.each(PALETTE_KEYS)('%s: every variant, tone and state on every level', key => {
    const T = themes[key];
    for (const level of SURFACE_LEVELS) {
      const container = T[level];
      for (const variant of VARIANTS) {
        for (const tone of TONES) {
          for (const disabled of [false, true]) {
            const { background, label, lip } = buttonColors(T, variant, tone, level, { disabled });
            expect({ key, level, variant, tone, disabled, background }).not.toEqual(
              expect.objectContaining({ background: container }),
            );
            // Opaque, so the lip never shows through the face.
            expect(background).toMatch(/^#[0-9A-Fa-f]{6}$/);
            expect(lip).not.toBe(background);
            // The label reads on its face. An error-coloured label on a
            // neutral face follows the contract's 3:1 for the error colour
            // (orman's on surface-2's raised face is 4.33).
            const errorLabel = tone === 'danger' && variant !== 'primary' && !disabled;
            expect(contrastRatio(label, background)).toBeGreaterThanOrEqual(errorLabel ? 3 : 4.5);
          }
        }
      }
    }
  });

  it.each(PALETTE_KEYS)('%s: a secondary button drawn in a Card is one step above the card', key => {
    const T = themes[key];
    // Cards are surface: the button is surface-2, never the card colour.
    expect(buttonColors(T, 'secondary', 'default', 'surface').background).toBe(raisedFace(T, 'surface'));
    expect(raisedFace(T, 'surface')).not.toBe(T.surface);
  });

  it('rendered in a Card, the secondary face is raisedFace(surface)', () => {
    renderWithProviders(
      <Card>
        <Button variant="secondary" label="Vazgeç" onPress={noop} testID="b" />
      </Card>,
    );
    expect(flat(screen.getByTestId('b-face')).backgroundColor).toBe(raisedFace(gece, 'surface'));
    expect(flat(screen.getByTestId('b-face')).backgroundColor).not.toBe(gece.surface);
  });
});

describe('story marks on the spacing and radius scale', () => {
  type Node = ReturnType<typeof screen.getByText>;
  /** The nearest host ancestor whose style sets `key`. */
  const styledAncestor = (node: Node, key: string): Node => {
    let at: Node | null = node.parent;
    while (at && (typeof at.type !== 'string' || flat(at)[key] === undefined)) at = at.parent;
    if (!at) throw new Error(`no ancestor styles ${key}`);
    return at;
  };

  it.each([
    ['sm', 22, 6, 8],
    ['lg', 28, 8, 12],
  ] as const)('a %s translation badge: %ddp pill, padding %d by the icon and %d after the word', (size, height, left, right) => {
    renderWithProviders(<TranslationBadge kind="human" size={size} />);
    const badge = styledAncestor(screen.getByText('Çeviri'), 'minHeight');
    expect(flat(badge)).toMatchObject({
      minHeight: height,
      borderRadius: height / 2,
      paddingLeft: left,
      paddingRight: right,
      gap: SPACE.xs,
    });
  });

  it('language codes: 4dp apart, each on the 6dp corner with 4dp side padding', () => {
    renderWithProviders(<LanguageCodes codes={['tr', 'en']} shown="tr" />);
    const code = styledAncestor(screen.getByText('TR'), 'borderRadius');
    expect(flat(code)).toMatchObject({ paddingHorizontal: SPACE.xs, borderRadius: RADIUS.xs });
    expect(flat(styledAncestor(code, 'gap'))).toMatchObject({ gap: SPACE.xs, flexDirection: 'row' });
  });
});

describe('the skip icon keeps its number clear of the arrow (NP-20)', () => {
  /** Nunito ExtraBold digits: cap height 0.72 em, two digits at most 1.25 em wide (generous). */
  const DIGIT_HEIGHT = 0.72;
  const TWO_DIGITS_WIDTH = 1.25;

  it.each([20, 24, 28, 32, 40])('at %ddp the digits sit below the chevron and inside the ring', size => {
    const unit = SKIP_GEOMETRY.box / size;
    const font = Math.round(size * SKIP_NUMBER_FONT) * unit;
    const centreY = SKIP_GEOMETRY.box / 2 + SKIP_NUMBER_DROP * SKIP_GEOMETRY.box;
    expect(centreY).toBeCloseTo(SKIP_GEOMETRY.cy);
    const top = centreY - (DIGIT_HEIGHT * font) / 2;
    const bottom = centreY + (DIGIT_HEIGHT * font) / 2;
    const half = (TWO_DIGITS_WIDTH * font) / 2;
    // A clear band under the chevron's lowest stroke.
    expect(top - SKIP_ARROW_BOTTOM).toBeGreaterThan(1);
    // The digit box's corners stay inside the ring's open inside.
    const corner = Math.hypot(half, bottom - SKIP_GEOMETRY.cy);
    expect(corner).toBeLessThan(SKIP_RING_INNER - 0.5);
  });

  it('draws the arc in the glyph colour, mirrored for back, and the number on the ring centre', () => {
    const view = renderWithProviders(<Icon name="fwd15" size={28} color="#123456" />);
    expect(screen.getByTestId('icon-fwd15-arc')).toBeTruthy();
    expect(flat(screen.getByTestId('icon-fwd15-arc')).transform).toBeUndefined();
    const number = flat(screen.getByTestId('icon-fwd15-number'));
    expect(number).toMatchObject({ color: '#123456', fontSize: Math.round(28 * SKIP_NUMBER_FONT) });
    expect(number.transform).toEqual([{ translateY: 28 * SKIP_NUMBER_DROP }]);
    expect(number.lineHeight).toBeGreaterThanOrEqual(number.fontSize * 1.3);
    view.unmount();

    renderWithProviders(<Icon name="back15" size={28} color="#123456" />);
    expect(flat(screen.getByTestId('icon-back15-arc')).transform).toEqual([{ scaleX: -1 }]);
    expect(screen.getByText('15')).toBeTruthy();
  });

  it('the number is a little larger than the old 0.28 and drops to the ring centre', () => {
    expect(SKIP_NUMBER_FONT).toBeGreaterThan(0.28);
    expect(SKIP_NUMBER_DROP * 28).toBeGreaterThan(1.5);
  });
});
