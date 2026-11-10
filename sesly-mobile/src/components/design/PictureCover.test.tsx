/**
 * PictureCover and CoverCard: cover geometry (radius, lip, badge pills), the
 * remote image never preceded by an unrelated placeholder, the overlay that
 * sits outside the card button and sinks with the cover, and one screen
 * reader stop per card.
 */

import React from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { themes } from '../../theme/theme';
import { DURATION, PRESS_DELAY_MS } from '../../theme/motion';
import {
  COVER_CARD_MARKS_HEIGHT,
  COVER_CARD_META_GAP,
  COVER_CARD_TITLE_GAP,
  COVER_CARD_TITLE_LINE,
  CoverCard,
  PictureCover,
  coverCardCaptionHeight,
  coverCardHeight,
  coverLip,
  coverRadius,
  textLineBox,
  useCoverSpread,
} from './PictureCover';
import { pickPlaceholderIndex, resetCoverAssignments, resolveCover } from './covers';
import { LanguageCodes, TranslationBadge } from './storyMarks';

type TestNode = ReturnType<typeof screen.getByTestId>;

const gece = themes['gece-mavisi'];
const flat = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(6).filter(Boolean));

/** The press value lands at once (the native driver runs off the JS thread). */
function landTimingsAtOnce() {
  return jest.spyOn(Animated, 'timing').mockImplementation(((
    value: Animated.Value,
    config: { toValue: number },
  ) => ({
    start: (done?: (result: { finished: boolean }) => void) => {
      value.setValue(config.toValue);
      done?.({ finished: true });
    },
    stop: () => undefined,
    reset: () => undefined,
  })) as unknown as typeof Animated.timing);
}

/** Every testID of a placeholder picture drawn (host views only). */
const placeholderIds = () =>
  screen.UNSAFE_root.findAll(
    (node: TestNode) =>
      typeof node.type === 'string' &&
      typeof node.props.testID === 'string' &&
      node.props.testID.startsWith('cover-placeholder-'),
  ).map((node: TestNode) => node.props.testID as string);

/** Host views (not texts) that are their own accessibility element. */
function accessibleViews(root: TestNode): TestNode[] {
  return root.findAll(
    (node: TestNode) => typeof node.type === 'string' && node.type !== 'Text' && node.props.accessible === true,
  );
}

/** Whether `node` lies inside `ancestor`. */
function isInside(node: TestNode, ancestor: TestNode): boolean {
  for (let at: TestNode | null = node.parent; at; at = at.parent) {
    if (at === ancestor) return true;
  }
  return false;
}

beforeEach(() => resetCoverAssignments());

describe('cover geometry', () => {
  it('coverLip: 3 under 130dp, 4 from 130dp (no 5dp lip for the hero)', () => {
    expect(coverLip(98)).toBe(3);
    expect(coverLip(129)).toBe(3);
    expect(coverLip(130)).toBe(4);
    expect(coverLip(144)).toBe(4);
    expect(coverLip(320)).toBe(4);
  });

  it('coverRadius per width and shape', () => {
    expect(coverRadius(98, 'upright')).toBe(20);
    expect(coverRadius(96, 'upright')).toBe(20);
    expect(coverRadius(129, 'upright')).toBe(20);
    expect(coverRadius(130, 'upright')).toBe(24);
    expect(coverRadius(144, 'upright')).toBe(24);
    expect(coverRadius(200, 'upright')).toBe(32);
    expect(coverRadius(95, 'upright')).toBe(18);
    expect(coverRadius(40, 'upright')).toBe(10);
    expect(coverRadius(320, 'wide')).toBe(28);
    expect(coverRadius(44, 'square')).toBe(13);
    expect(coverRadius(20, 'square')).toBe(8);
  });

  it('the lip under a 144dp cover is 4 and the cover reserves it', () => {
    renderWithProviders(<PictureCover story={{ id: 'a' }} title="A" width={144} testID="cv" />);
    expect(flat(screen.getByTestId('cv'))).toMatchObject({ width: 144, height: 216 + 4 });
    expect(flat(screen.getByTestId('cv-lip'))).toMatchObject({ top: 4, height: 216, borderRadius: 24 });
  });

  it('level and duration are 22dp pills 6dp in from the edges that grow instead of clipping', () => {
    renderWithProviders(<PictureCover story={{ id: 'a' }} width={98} durationLabel="5 dk" levelLabel="A2" />);
    const level = flat(screen.getByTestId('cover-level'));
    const duration = flat(screen.getByTestId('cover-duration'));
    expect(level).toMatchObject({ left: 6, top: 6, borderRadius: 11, minHeight: 22, paddingHorizontal: 6 });
    expect(duration).toMatchObject({ left: 6, bottom: 6, borderRadius: 11, minHeight: 22, paddingHorizontal: 6 });
    expect(level.height).toBeUndefined();
    expect(duration.height).toBeUndefined();
    expect(screen.getByText('A2').props.maxFontSizeMultiplier).toBe(1.3);
    expect(screen.getByText('5 dk').props.maxFontSizeMultiplier).toBe(1.3);
  });

  it('the AI translation mark and the lock sit on the picture, on the duration glass, 6dp in', () => {
    renderWithProviders(
      <PictureCover story={{ id: 'a' }} width={100} durationLabel="5 dk" translation="machine" locked />,
    );
    const mark = screen.getByTestId('cover-translation');
    expect(flat(mark)).toMatchObject({ position: 'absolute', right: 6, bottom: 6 });
    const glass = mark.findAll((node: TestNode) => typeof node.type === 'string' && flat(node).backgroundColor === gece.glass);
    expect(glass).toHaveLength(1);
    expect(flat(glass[0])).toMatchObject({ height: 22, minWidth: 22, borderRadius: 11 });
    expect(within(mark).getByTestId('icon-aiTranslation', { includeHiddenElements: true })).toBeTruthy();
    // On its own (no card) the mark keeps its label.
    expect(screen.getByLabelText('Yapay zekâ ile çevrildi')).toBeTruthy();
    // The duration keeps the bottom left, the lock takes the top right.
    expect(flat(screen.getByTestId('cover-duration'))).toMatchObject({ left: 6, bottom: 6, backgroundColor: gece.glass });
    const lock = screen.getByTestId('cover-lock', { includeHiddenElements: true });
    expect(flat(lock)).toMatchObject({
      position: 'absolute',
      right: 6,
      top: 6,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: gece.glass,
    });
    // The lock is decoration: the card's label says the story is locked.
    expect(lock.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('a cover card reads the mark on its cover with its label, and draws none for no translation', () => {
    const view = renderWithProviders(
      <CoverCard story={{ id: 'a' }} title="Ay" width={100} translation="machine" onPress={jest.fn()} testID="card" />,
    );
    expect(screen.getByTestId('card').props.accessibilityLabel).toBe('Ay, Yapay zekâ ile çevrildi');
    expect(screen.queryByTestId('card-meta')).toBeNull();
    view.rerender(<CoverCard story={{ id: 'a' }} title="Ay" width={100} translation={null} onPress={jest.fn()} testID="card" />);
    expect(screen.getByTestId('card').props.accessibilityLabel).toBe('Ay');
    expect(screen.queryByTestId('cover-translation')).toBeNull();
    expect(screen.queryByTestId('cover-lock', { includeHiddenElements: true })).toBeNull();
  });

  it('the title sits 8 under the cover and the meta 2 under the title', () => {
    renderWithProviders(
      <CoverCard story={{ id: 'a' }} title="Uykulu Ay" width={100} testID="card">
        <Text>6 dk</Text>
      </CoverCard>,
    );
    expect(flat(screen.getByText('Uykulu Ay')).marginTop).toBe(8);
    expect(flat(screen.getByTestId('card-meta')).marginTop).toBe(2);
  });

  it('the card draws its caption with the constants its height is computed from', () => {
    renderWithProviders(
      <CoverCard story={{ id: 'a' }} title="Uykulu Ay" width={100} titleLines={2} testID="card">
        <Text>6 dk</Text>
      </CoverCard>,
    );
    const title = screen.getByText('Uykulu Ay');
    expect(flat(title)).toMatchObject({ marginTop: COVER_CARD_TITLE_GAP, lineHeight: COVER_CARD_TITLE_LINE });
    expect(title.props.numberOfLines).toBe(2);
    expect(flat(screen.getByTestId('card-meta')).marginTop).toBe(COVER_CARD_META_GAP);
    expect([COVER_CARD_TITLE_GAP, COVER_CARD_TITLE_LINE, COVER_CARD_META_GAP, COVER_CARD_MARKS_HEIGHT]).toEqual([
      8, 18, 2, 16,
    ]);
  });

  it('titles run to three lines unless the list asks for fewer', () => {
    renderWithProviders(<CoverCard story={{ id: 'a' }} title="Uykulu Ay" width={100} />);
    expect(screen.getByText('Uykulu Ay').props.numberOfLines).toBe(3);
  });
});

describe('cover card height', () => {
  it('a line of text is its line height at the font scale, in whole device pixels', () => {
    expect(textLineBox(18)).toBe(18);
    expect(textLineBox(18, 1, 2)).toBe(18);
    // Android draws an 18dp line 48px tall at 2.625x (47.25 rounded up).
    expect(textLineBox(18, 1, 2.625)).toBeCloseTo(48 / 2.625, 10);
    expect(textLineBox(28, 1, 2.625)).toBeCloseTo(74 / 2.625, 10);
    expect(textLineBox(18, 1.3, 2.625)).toBeCloseTo(62 / 2.625, 10);
    expect(textLineBox(18, 2, 2)).toBe(36);
    // A whole number of pixels never gains one from float error.
    expect(textLineBox(18, 1.5, 2)).toBe(27);
    // No font scale or pixel ratio reported: as at 1.
    expect(textLineBox(18, 0, Number.NaN)).toBe(18);
  });

  it('the caption is the gap, the reserved title lines and the meta row when there are marks', () => {
    expect(coverCardCaptionHeight()).toBe(8 + 3 * 18);
    expect(coverCardCaptionHeight({ titleLines: 1 })).toBe(8 + 18);
    expect(coverCardCaptionHeight({ titleLines: 2 })).toBe(8 + 2 * 18);
    expect(coverCardCaptionHeight({ titleLines: 2, marks: true })).toBe(8 + 2 * 18 + 2 + 16);
    expect(coverCardCaptionHeight({ titleLines: 2, fontScale: 1.3, pixelRatio: 2.625 })).toBeCloseTo(
      8 + (2 * 62) / 2.625,
      10,
    );
  });

  it('the card is its cover on the lip and the caption', () => {
    // A Home shelf card: 146 + 3 + 8 + 2 x 18 (+ 18 for the marks).
    expect(coverCardHeight({ width: 100, coverHeight: 146, titleLines: 2 })).toBe(193);
    expect(coverCardHeight({ width: 100, coverHeight: 146, titleLines: 2, marks: true })).toBe(211);
    // 2:3 by default, the 4dp lip from 130dp.
    expect(coverCardHeight({ width: 144 })).toBe(216 + 4 + 8 + 3 * 18);
    // On a 2.625x phone at font scale 1 the title lines are 48px each.
    expect(coverCardHeight({ width: 100, coverHeight: 146, titleLines: 2, pixelRatio: 2.625 })).toBeCloseTo(
      149 + 8 + 96 / 2.625,
      10,
    );
  });
});

describe('remote covers and placeholders', () => {
  const remote = { id: 'remote-1', coverImageUrl: 'https://cdn/r.jpg?sig=1' };

  it('a cover with its own image shows only the plain backdrop until the image arrives', () => {
    renderWithProviders(<PictureCover story={remote} width={100} testID="cv" />);
    expect(placeholderIds()).toEqual([]);
    expect(flat(screen.getByTestId('cv-picture')).backgroundColor).toBe(gece.surface2);
    const image = screen.getByTestId('cover-remote');
    // The real cover fades in over the backdrop.
    expect(image.props.transition).toBe(DURATION.base);
    expect(image.props.source).toMatchObject({ uri: 'https://cdn/r.jpg?sig=1', cacheKey: 'https://cdn/r.jpg' });
  });

  it('a failed image falls back to the tale placeholder; a new address tries again', () => {
    const view = renderWithProviders(<PictureCover story={remote} width={100} />);
    act(() => screen.getByTestId('cover-remote').props.onError());
    const index = resolveCover(remote).placeholderIndex;
    expect(placeholderIds()).toEqual([`cover-placeholder-${index + 1}`]);
    expect(screen.queryByTestId('cover-remote')).toBeNull();

    // A re-signed URL is a new attempt: the image again, no placeholder first.
    view.rerender(<PictureCover story={{ ...remote, coverImageUrl: 'https://cdn/r.jpg?sig=2' }} width={100} />);
    expect(screen.getByTestId('cover-remote')).toBeTruthy();
    expect(placeholderIds()).toEqual([]);
  });

  it('a story without an image shows its placeholder at once', () => {
    renderWithProviders(<PictureCover story={{ id: 'plain-1' }} width={100} />);
    expect(placeholderIds()).toEqual([`cover-placeholder-${pickPlaceholderIndex('plain-1') + 1}`]);
    expect(screen.queryByTestId('cover-remote')).toBeNull();
  });

  it('a cover without an assigned picture shows the one its shelf gave the tale', () => {
    // Find a tale whose own picture clashes with the first one's, so the
    // shelf steps it to another picture.
    const first = 'tale-0';
    let second = '';
    for (let i = 1; i < 500 && !second; i++) {
      if (pickPlaceholderIndex(`tale-${i}`) === pickPlaceholderIndex(first)) second = `tale-${i}`;
    }
    const Shelf: React.FC = () => {
      const spread = useCoverSpread([{ id: first }, { id: second }]);
      return <PictureCover story={{ id: second }} width={100} placeholderIndex={spread.get(second)} />;
    };
    const view = renderWithProviders(<Shelf />);
    const shelfPicture = placeholderIds()[0];
    expect(shelfPicture).toBe(`cover-placeholder-${((pickPlaceholderIndex(first) + 1) % 10) + 1}`);
    view.unmount();
    // The detail screen draws the tale with no list around it: same picture.
    renderWithProviders(<PictureCover story={{ id: second }} title="Detay" width={144} />);
    expect(placeholderIds()).toEqual([shelfPicture]);
  });

  it('one screen, two shelves in different orders and a hero: every tale shows one picture', () => {
    // b's own picture is a's, so the first shelf steps it; the second shelf
    // lists b first, where a spread of its own would give b a's picture.
    const a = 'tale-0';
    let b = '';
    for (let i = 1; i < 500 && !b; i++) {
      if (pickPlaceholderIndex(`tale-${i}`) === pickPlaceholderIndex(a)) b = `tale-${i}`;
    }
    const c = 'tale-other';
    const Shelf: React.FC<{ id: string; order: string[] }> = ({ id, order }) => {
      const spread = useCoverSpread(order.map(key => ({ id: key })));
      return (
        <View>
          {order.map(key => (
            <View key={key} testID={`${id}-${key}`}>
              <PictureCover story={{ id: key }} width={100} placeholderIndex={spread.get(key)} />
            </View>
          ))}
        </View>
      );
    };
    renderWithProviders(
      <View>
        <Shelf id="new" order={[a, b, c]} />
        <Shelf id="category" order={[b, c, a]} />
        <View testID={`hero-${b}`}>
          <PictureCover story={{ id: b }} width={320} shape="wide" height={184} />
        </View>
      </View>,
    );
    const pictureIn = (testID: string) => {
      const ids = screen
        .getByTestId(testID)
        .findAll(
          (node: TestNode) =>
            typeof node.type === 'string' &&
            typeof node.props.testID === 'string' &&
            node.props.testID.startsWith('cover-placeholder-'),
        )
        .map((node: TestNode) => node.props.testID as string);
      expect(ids).toHaveLength(1);
      return ids[0];
    };
    for (const key of [a, b, c]) expect(pictureIn(`category-${key}`)).toBe(pictureIn(`new-${key}`));
    expect(pictureIn(`new-${b}`)).not.toBe(pictureIn(`new-${a}`));
    expect(pictureIn(`hero-${b}`)).toBe(pictureIn(`new-${b}`));
  });
});

describe('accessibility', () => {
  it('a titled cover is one labelled image; an untitled one is no stop of its own', () => {
    const view = renderWithProviders(<PictureCover story={{ id: 'a' }} title="Uykulu Ay" width={100} testID="cv" />);
    expect(screen.getByRole('image', { name: 'Uykulu Ay kapağı' })).toBeTruthy();
    view.unmount();
    renderWithProviders(<PictureCover story={{ id: 'a' }} width={100} testID="cv" />);
    expect(screen.queryAllByRole('image')).toHaveLength(0);
    expect(screen.getByTestId('cv').props.accessible).toBe(false);
  });

  it('one accessibility element per card: the marks join the card label', () => {
    renderWithProviders(
      <CoverCard
        story={{ id: 'a' }}
        title="Uykulu Ay"
        width={100}
        levelLabel="A2"
        durationLabel="5 dk"
        onPress={jest.fn()}
        accessibilityLabel="Uykulu Ay masalını aç"
        testID="card"
      >
        <TranslationBadge kind="human" iconOnly />
        <LanguageCodes codes={['en']} shown="en" variant="own" />
      </CoverCard>,
    );
    const card = screen.getByTestId('card');
    expect(card.props.accessibilityLabel).toBe('Uykulu Ay masalını aç, Çeviri, Diller: EN');
    expect(accessibleViews(card)).toEqual([card]);
    expect(within(card).queryAllByRole('image')).toHaveLength(0);
    // The marks are drawn but are no separate stops.
    expect(within(card).getByText('EN')).toBeTruthy();
    expect(screen.queryByLabelText('Çeviri')).toBeNull();
    expect(screen.queryByLabelText('Diller: EN')).toBeNull();
  });

  it('the label follows the marks: a mark that goes away leaves it, one that changes keeps its place', () => {
    const card = (translation: 'human' | 'machine' | null, codes: string[]) => (
      <CoverCard story={{ id: 'a' }} title="Ay" width={100} onPress={jest.fn()} testID="card">
        {translation ? <TranslationBadge kind={translation} iconOnly /> : null}
        <LanguageCodes codes={codes} />
      </CoverCard>
    );
    const view = renderWithProviders(card('human', ['tr']));
    expect(screen.getByTestId('card').props.accessibilityLabel).toBe('Ay, Çeviri, Diller: TR');
    view.rerender(card('machine', ['tr']));
    expect(screen.getByTestId('card').props.accessibilityLabel).toBe('Ay, Yapay zekâ ile çevrildi, Diller: TR');
    view.rerender(card(null, ['tr', 'en']));
    expect(screen.getByTestId('card').props.accessibilityLabel).toBe('Ay, Diller: TR, EN');
    view.rerender(card(null, []));
    expect(screen.getByTestId('card').props.accessibilityLabel).toBe('Ay');
  });

  it('outside a card button the marks keep their own labels', () => {
    renderWithProviders(
      <CoverCard story={{ id: 'a' }} title="Ay" width={100} testID="card">
        <TranslationBadge kind="machine" iconOnly />
        <LanguageCodes codes={['tr', 'en']} />
      </CoverCard>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByLabelText('Yapay zekâ ile çevrildi')).toBeTruthy();
    expect(screen.getByLabelText('Diller: TR, EN')).toBeTruthy();
  });
});

describe('CoverCard', () => {
  const story = { id: 'story-1', category: 'BEDTIME' };
  const overlay = (onSave: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel="Kaydet" onPress={onSave} testID="save" />
  );

  it('draws the overlay outside the card button, over the cover face', () => {
    const onPress = jest.fn();
    const onSave = jest.fn();
    renderWithProviders(
      <CoverCard story={story} title="Uykulu Ay" width={100} onPress={onPress} overlay={overlay(onSave)} testID="card" />,
    );
    const card = screen.getByRole('button', { name: 'Uykulu Ay' });
    const save = screen.getByRole('button', { name: 'Kaydet' });
    expect(isInside(save, card)).toBe(false);
    expect(isInside(save, screen.getByTestId('card-overlay'))).toBe(true);
    expect(screen.getByTestId('card-overlay').props.pointerEvents).toBe('box-none');
    expect(flat(screen.getByTestId('card-overlay'))).toMatchObject({
      position: 'absolute',
      left: 0,
      top: 0,
      width: 100,
      height: 150,
    });

    fireEvent.press(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it.each([
    [100, 3],
    [144, 4],
  ])('a pressed %idp card sinks the cover and the overlay together by the lip (%i)', (width, lip) => {
    landTimingsAtOnce();
    renderWithProviders(
      <CoverCard story={story} title="Uykulu Ay" width={width} onPress={jest.fn()} overlay={overlay(jest.fn())} testID="card" />,
    );
    const overlayY = () => flat(screen.getByTestId('card-overlay')).transform;
    const pictureY = () => flat(screen.getByTestId('card-cover-picture')).transform;
    expect(flat(screen.getByTestId('card-cover-lip')).top).toBe(lip);
    expect(overlayY()).toEqual([{ translateY: 0 }]);
    fireEvent(screen.getByTestId('card'), 'pressIn');
    // The face covers its lip exactly, and the overlay goes down with it.
    expect(pictureY()).toEqual([{ translateY: lip }]);
    expect(overlayY()).toEqual([{ translateY: lip }]);
    fireEvent(screen.getByTestId('card'), 'pressOut');
    expect(pictureY()).toEqual([{ translateY: 0 }]);
    expect(overlayY()).toEqual([{ translateY: 0 }]);
  });

  it('an overlay on a card that cannot be pressed stays put', () => {
    renderWithProviders(<CoverCard story={story} title="Ay" width={100} overlay={overlay(jest.fn())} testID="card" />);
    expect(flat(screen.getByTestId('card-overlay')).transform).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Kaydet' })).toBeTruthy();
  });

  it('a long press fires onLongPress, also on a card without onPress', () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    const view = renderWithProviders(
      <CoverCard story={story} title="Ay" width={100} onPress={onPress} onLongPress={onLongPress} testID="card" />,
    );
    fireEvent(screen.getByTestId('card'), 'longPress');
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
    view.unmount();
    renderWithProviders(<CoverCard story={story} title="Ay" width={100} onLongPress={onLongPress} testID="card" />);
    fireEvent(screen.getByRole('button', { name: 'Ay' }), 'longPress');
    expect(onLongPress).toHaveBeenCalledTimes(2);
  });

  it('waits PRESS_DELAY_MS before the sink in a scrolling list, 0 on request', () => {
    const pressDelayOf = (testID: string) => {
      let node: TestNode | null = screen.getByTestId(testID);
      while (node && node.props.unstable_pressDelay === undefined) node = node.parent;
      return node?.props.unstable_pressDelay;
    };
    const view = renderWithProviders(<CoverCard story={story} title="Ay" width={100} onPress={jest.fn()} testID="card" />);
    expect(pressDelayOf('card')).toBe(PRESS_DELAY_MS);
    view.unmount();
    renderWithProviders(<CoverCard story={story} title="Ay" width={100} onPress={jest.fn()} pressDelay={0} testID="card" />);
    expect(pressDelayOf('card')).toBe(0);
  });
});
