/**
 * SpeedSheet (design v3, frame 5c): value, stepped slider, note, switch.
 */

import React from 'react';
import { Animated, PixelRatio } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';

import { renderScreen } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { DURATION } from '../../theme/motion';
import { SpeedSheet } from './SpeedSheet';
import { stopPosition } from './SteppedSlider';

jest.setTimeout(60000);

const WIDTH = 328;

/** A responder event as PanResponder reads it (one finger at `x`). */
function touchAt(x: number, previousX: number = x, startX: number = x) {
  const now = Date.now();
  const point = { pageX: x, pageY: 0, locationX: x, locationY: 0, identifier: 1, timestamp: now };
  return {
    nativeEvent: { ...point, touches: [point], changedTouches: [point] },
    touchHistory: {
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: now,
      numberActiveTouches: 1,
      touchBank: [
        {
          touchActive: true,
          startPageX: startX,
          startPageY: 0,
          startTimeStamp: now,
          currentPageX: x,
          currentPageY: 0,
          currentTimeStamp: now,
          previousPageX: previousX,
          previousPageY: 0,
          previousTimeStamp: now - 16,
        },
      ],
    },
  };
}

const flat = (node: { props: { style?: unknown } }) => {
  const style = node.props.style;
  const list = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign({}, ...list.filter(Boolean)) as Record<string, unknown>;
};

async function renderSheet(
  props: Partial<React.ComponentProps<typeof SpeedSheet>> = {},
  theme: 'gece-mavisi' | 'kitaplik' = 'gece-mavisi',
) {
  const handlers = {
    onClose: jest.fn(),
    onSpeedChange: jest.fn(),
    onForAllStoriesChange: jest.fn(),
  };
  await renderScreen(
    <SpeedSheet visible speed={1} forAllStories={false} {...handlers} {...props} />,
    { theme },
  );
  return handlers;
}

afterEach(async () => {
  jest.restoreAllMocks();
  await i18n.changeLanguage('tr');
});

describe('SpeedSheet', () => {
  it('shows the copy of the mockup', async () => {
    await renderSheet();
    expect(screen.getByText('Oynatma hızı')).toBeOnTheScreen();
    expect(screen.getByTestId('speed-value')).toHaveTextContent('1,0x');
    for (const label of ['0,5x', '0,75x', '0,9x', '1,1x', '1,25x', '1,5x', '2,0x']) {
      expect(screen.getByText(label)).toBeOnTheScreen();
    }
    expect(screen.getByText('Normal')).toBeOnTheScreen();
    expect(screen.getByText('Hız hemen değişir, ses tonu doğal kalır.')).toBeOnTheScreen();
    expect(screen.getByText('Bütün masallarda bu hızı kullan')).toBeOnTheScreen();
    expect(screen.getByText('Kapalıyken yalnızca bu masalda geçerli')).toBeOnTheScreen();
    // Everything applies at once: no confirm or cancel.
    expect(screen.queryByText('Uygula')).toBeNull();
    expect(screen.queryByText('Vazgeç')).toBeNull();
  });

  it('a stop applies its speed at once', async () => {
    const { onSpeedChange, onClose } = await renderSheet();
    fireEvent.press(screen.getByTestId('speed-slider-label-6'));
    expect(onSpeedChange).toHaveBeenLastCalledWith(1.5);
    fireEvent.press(screen.getByTestId('speed-slider-label-0'));
    expect(onSpeedChange).toHaveBeenLastCalledWith(0.5);
    // The sheet stays open so the change can be heard.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the current speed large and selected, "Normal" staying under 1,0x', async () => {
    await renderSheet({ speed: 1.25 });
    expect(screen.getByTestId('speed-value')).toHaveTextContent('1,25x');
    expect(screen.getByTestId('speed-slider-track').props.accessibilityValue.text).toBe('1,25x');
    expect(screen.getByTestId('speed-slider-label-3')).toHaveTextContent('1,0xNormal');
  });

  it('snaps a speed that is not a stop to the nearest one', async () => {
    await renderSheet({ speed: 1.3 });
    expect(screen.getByTestId('speed-value')).toHaveTextContent('1,25x');
  });

  it('the switch asks to use the speed for every story', async () => {
    const { onForAllStoriesChange } = await renderSheet();
    const row = screen.getByTestId('speed-for-all');
    expect(row.props.accessibilityState.checked).toBe(false);
    fireEvent.press(row);
    expect(onForAllStoriesChange).toHaveBeenCalledWith(true);
  });

  it('shows the switch on when the speed is used for every story', async () => {
    const { onForAllStoriesChange } = await renderSheet({ forAllStories: true });
    const row = screen.getByTestId('speed-for-all');
    expect(row.props.accessibilityState.checked).toBe(true);
    fireEvent.press(row);
    expect(onForAllStoriesChange).toHaveBeenCalledWith(false);
  });

  it('closes on the scrim', async () => {
    const { onClose } = await renderSheet();
    fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while hidden', async () => {
    await renderSheet({ visible: false });
    expect(screen.queryByTestId('speed-sheet')).toBeNull();
  });

  it('uses a decimal point and English copy in English', async () => {
    await i18n.changeLanguage('en');
    await renderSheet({ speed: 0.75 });
    expect(screen.getByText('Playback speed')).toBeOnTheScreen();
    expect(screen.getByTestId('speed-value')).toHaveTextContent('0.75x');
    expect(screen.getByText('2.0x')).toBeOnTheScreen();
    expect(screen.getByText('Use this speed for every story')).toBeOnTheScreen();
  });

  it('names the normal stop "Default" in English, short enough for its note', async () => {
    await i18n.changeLanguage('en');
    await renderSheet();
    expect(screen.getByText('Default')).toBeOnTheScreen();
    expect(screen.getByTestId('speed-slider-label-3')).toHaveTextContent('1.0xDefault');
  });

  it('a stop glides the knob in DURATION.base and a drag steps in DURATION.fast, on the native driver', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    const onSpeedChange = jest.fn();
    // The player feeds the new speed back, as the store does.
    const Host: React.FC = () => {
      const [speed, setSpeed] = React.useState(1);
      return (
        <SpeedSheet
          visible
          speed={speed}
          forAllStories={false}
          onClose={jest.fn()}
          onForAllStoriesChange={jest.fn()}
          onSpeedChange={next => {
            onSpeedChange(next);
            setSpeed(next);
          }}
        />
      );
    };
    await renderScreen(<Host />);
    fireEvent(screen.getByTestId('speed-slider'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: WIDTH, height: 100 } },
    });
    timing.mockClear();

    fireEvent.press(screen.getByTestId('speed-slider-label-6'));
    expect(onSpeedChange).toHaveBeenLastCalledWith(1.5);
    expect(screen.getByTestId('speed-value')).toHaveTextContent('1,5x');
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: stopPosition(6, 8, WIDTH), duration: DURATION.base, useNativeDriver: true }),
    );

    // A drag from 1,5x one stop to the right: 2,0x, one fast step.
    const track = screen.getByTestId('speed-slider-track');
    const from = stopPosition(6, 8, WIDTH);
    fireEvent(track, 'responderGrant', touchAt(from));
    fireEvent(track, 'responderMove', touchAt(stopPosition(7, 8, WIDTH), from, from));
    expect(onSpeedChange).toHaveBeenLastCalledWith(2);
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: stopPosition(7, 8, WIDTH), duration: DURATION.fast, useNativeDriver: true }),
    );
  });

  it('caps the slider texts at font scale 1.3 and sizes their block from the scale', async () => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1.3);
    await renderSheet();
    // The large value above the slider shows 1,0x too; the label is the slider's own.
    for (const label of ['0,5x', '0,75x', '1,25x', '2,0x']) {
      expect(screen.getByText(label).props.maxFontSizeMultiplier).toBe(1.3);
    }
    expect(screen.getByText('Normal').props.maxFontSizeMultiplier).toBe(1.3);
    // (18 + 2 + 15) * 1.3, rounded up: the note stays inside the block above the sheet's note.
    expect(flat(screen.getByTestId('speed-slider-labels')).height).toBe(46);
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', async scheme => {
    await renderSheet({}, scheme);
    const T = themes[scheme];
    expect(flat(screen.getByTestId('speed-value')).color).toBe(T.text);
    expect(flat(screen.getByTestId('speed-sheet')).backgroundColor).toBe(T.surface);
    expect(flat(screen.getByText('Normal')).color).toBe(T.text2);
    expect(flat(screen.getByTestId('speed-value')).fontFamily).toBe(T.fontDisplay);
  });
});
