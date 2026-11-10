/**
 * Pieces of the voice creation flow in the playful design: level meter,
 * reading-time bar, step segments, record button, sample player, dock,
 * own-voice badge, step and status lines.
 */

import React from 'react';
import { fireEvent, screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../../test-utils/render-helpers';
import { LIP, dockBottom, themes } from '../../theme/theme';
import { withAlpha } from '../../theme/color';
import { WAVE_IDLE_ALPHA } from '../../theme/surfaces';
import { levelThresholds } from '../../models/VoiceClone';
import {
  CLONE_FLOW_STEPS,
  FlowAvatar,
  FlowDock,
  FlowSteps,
  LevelMeter,
  METER_LABEL_MAX_SCALE,
  METER_SEGMENTS,
  METER_ZONES,
  RECORD_SIZE,
  RecordButton,
  SamplePlayer,
  StatusLine,
  StepRow,
  TakeProgress,
  formatClock,
  levelColor,
  recordLip,
  zonedMeterFraction,
} from './index';

jest.setTimeout(60000);

const HIDDEN = { includeHiddenElements: true };
const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

const ZONES = { quiet: 'Kısık', good: 'İyi aralık', loud: 'Yüksek' };

describe('formatClock', () => {
  it('formats seconds as minutes and seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(18.9)).toBe('0:18');
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(125)).toBe('2:05');
    expect(formatClock(-3)).toBe('0:00');
    expect(formatClock(Number.NaN)).toBe('0:00');
  });
});

describe('zonedMeterFraction', () => {
  const quietEnd = METER_ZONES.quiet / METER_SEGMENTS;
  const goodEnd = (METER_ZONES.quiet + METER_ZONES.good) / METER_SEGMENTS;

  it.each(['android', 'ios'])('keeps the fill inside the zone of the reading on %s', platform => {
    const t = levelThresholds(platform);
    expect(zonedMeterFraction(-160, t)).toBe(0);
    expect(zonedMeterFraction(Number.NaN, t)).toBe(0);
    expect(zonedMeterFraction(-60, t)).toBe(0);

    const quiet = zonedMeterFraction(t.quiet - 5, t);
    expect(quiet).toBeGreaterThan(0);
    expect(quiet).toBeLessThan(quietEnd);

    expect(zonedMeterFraction(t.quiet, t)).toBeCloseTo(quietEnd);
    const good = zonedMeterFraction((t.quiet + t.loud) / 2, t);
    expect(good).toBeGreaterThan(quietEnd);
    expect(good).toBeLessThan(goodEnd);

    expect(zonedMeterFraction(t.loud, t)).toBeCloseTo(goodEnd);
    expect(zonedMeterFraction(0, t)).toBeCloseTo(1);
    expect(zonedMeterFraction(6, t)).toBe(1);
  });

  it('rises with the level', () => {
    const t = levelThresholds('android');
    const values = [-70, -50, -35, -25, -10, -1, 0].map(db => zonedMeterFraction(db, t));
    const sorted = [...values].sort((a, b) => a - b);
    expect(values).toEqual(sorted);
  });

  it('survives degenerate thresholds', () => {
    expect(zonedMeterFraction(-30, { quiet: -60, loud: 0 })).toBeGreaterThan(0);
    expect(zonedMeterFraction(-1, { quiet: -1, loud: -1 })).toBeLessThanOrEqual(1);
  });
});

describe('levelColor', () => {
  it.each(['gece-mavisi', 'kitaplik'] as const)('maps levels to the %s palette', scheme => {
    const T = themes[scheme];
    expect(levelColor(T, 'good')).toBe(T.success);
    expect(levelColor(T, 'quiet')).toBe(T.catDunya);
    expect(levelColor(T, 'loud')).toBe(T.error);
    expect(levelColor(T, 'idle')).toBe(T.text2);
  });
});

describe('LevelMeter', () => {
  it('draws an empty meter with the neutral state before a take', async () => {
    await renderScreen(
      <LevelMeter
        label="Ses seviyesi"
        stateLabel="Kayıt başlayınca ölçülür"
        level="good"
        active={false}
        fraction={0.8}
        zoneLabels={ZONES}
      />,
    );
    const T = themes['gece-mavisi'];

    expect(screen.getByLabelText('Ses seviyesi: Kayıt başlayınca ölçülür')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('level-meter-on')).toHaveLength(0);
    expect(screen.getAllByTestId('level-meter-off')).toHaveLength(METER_SEGMENTS);
    // Rounded pill segments on the track colour, no dimmed hairlines.
    expect(flatStyle(screen.getAllByTestId('level-meter-off')[0])).toMatchObject({
      backgroundColor: T.line,
      borderRadius: 4,
    });
    expect(flatStyle(screen.getAllByTestId('level-meter-off')[0]).opacity).toBeUndefined();
    expect(flatStyle(screen.getByTestId('level-meter-state')).color).toBe(T.text2);
    expect(screen.queryByTestId('icon-check', HIDDEN)).toBeNull();
    expect(flatStyle(screen.getByText('İyi aralık')).color).toBe(T.text3);
  });

  it.each([
    ['good', 'İyi', 'İyi aralık', 'success'],
    ['quiet', 'Kısık durum', 'Kısık', 'catDunya'],
    ['loud', 'Yüksek durum', 'Yüksek', 'error'],
  ] as const)('colours the %s level, its segments and its zone', async (level, word, zone, token) => {
    await renderScreen(
      <LevelMeter
        label="Ses seviyesi"
        stateLabel={word}
        level={level}
        active
        fraction={0.5}
        zoneLabels={ZONES}
        accessibilityLabel={`Ses seviyesi: ${word}`}
      />,
      { theme: 'kitaplik' },
    );
    const color = themes.kitaplik[token];

    expect(screen.getAllByTestId('level-meter-on')).toHaveLength(METER_SEGMENTS / 2);
    expect(flatStyle(screen.getAllByTestId('level-meter-on')[0]).backgroundColor).toBe(color);
    expect(flatStyle(screen.getByTestId('level-meter-state')).color).toBe(color);
    expect(flatStyle(screen.getByText(zone)).color).toBe(color);
    // Only the good state carries the check.
    expect(screen.queryAllByTestId('icon-check', HIDDEN)).toHaveLength(level === 'good' ? 1 : 0);
  });

  it('is no live region while a take runs, and a polite one otherwise', async () => {
    // TalkBack would speak each level change next to the open microphone.
    const view = await renderScreen(
      <LevelMeter
        label="Ses seviyesi"
        stateLabel="İyi"
        level="good"
        active
        fraction={0.5}
        zoneLabels={ZONES}
      />,
    );
    expect(screen.getByTestId('level-meter').props.accessibilityLiveRegion).toBe('none');

    view.rerender(
      <LevelMeter
        label="Ses seviyesi"
        stateLabel="Kayıt başlayınca ölçülür"
        level="idle"
        active={false}
        fraction={0}
        zoneLabels={ZONES}
      />,
    );
    expect(screen.getByTestId('level-meter').props.accessibilityLiveRegion).toBe('polite');
  });

  it('caps the zone labels at 1.3 times the font size', async () => {
    await renderScreen(
      <LevelMeter label="Ses seviyesi" stateLabel="İyi" level="good" active fraction={0.5} zoneLabels={ZONES} />,
    );
    for (const zone of Object.values(ZONES)) {
      expect(screen.getByText(zone).props.maxFontSizeMultiplier).toBe(METER_LABEL_MAX_SCALE);
    }
  });

  it('judges nothing while the level is still idle', async () => {
    await renderScreen(
      <LevelMeter
        label="Ses seviyesi"
        stateLabel="Ölçülüyor..."
        level="idle"
        active
        fraction={2}
        zoneLabels={ZONES}
      />,
    );
    const T = themes['gece-mavisi'];

    // The fill is clamped to the meter.
    expect(screen.getAllByTestId('level-meter-on')).toHaveLength(METER_SEGMENTS);
    expect(flatStyle(screen.getByTestId('level-meter-state')).color).toBe(T.text2);
    expect(flatStyle(screen.getByText('Kısık')).color).toBe(T.text3);
  });
});

describe('TakeProgress', () => {
  it('places the fill and the two markers on the same scale', async () => {
    await renderScreen(
      <TakeProgress
        progress={0.3}
        minFraction={0.25}
        targetFraction={0.5}
        minLabel="En az 15 sn"
        targetLabel="İdeal 30 sn"
        reachedMin
        active
        accessibilityLabel="Okuma süresi"
      />,
    );
    const T = themes['gece-mavisi'];

    expect(screen.getByRole('progressbar', { name: 'Okuma süresi' }).props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 30,
    });
    expect(flatStyle(screen.getByTestId('take-progress-fill'))).toMatchObject({
      width: '30%',
      backgroundColor: T.success,
    });
    // The minimum is reached: its notch and label are the good colour. The
    // ideal is the next mark: the action colour, not green before it is reached.
    expect(flatStyle(screen.getByText('En az 15 sn')).color).toBe(T.success);
    expect(flatStyle(screen.getByText('İdeal 30 sn')).color).toBe(T.action);
    expect(flatStyle(screen.getByTestId('take-progress-target')).backgroundColor).toBe(T.action);
    // Rounded notches ringed in the panel colour, not hairlines.
    expect(flatStyle(screen.getByTestId('take-progress-min'))).toMatchObject({
      left: '25%',
      width: 8,
      borderRadius: 4,
      borderColor: T.surface,
      backgroundColor: T.success,
    });
  });

  it('hangs each marker label from its own notch, so they never meet at a large font', async () => {
    await renderScreen(
      <TakeProgress
        progress={0}
        minFraction={0.25}
        targetFraction={0.5}
        minLabel="En az 15 sn"
        targetLabel="İdeal 30 sn"
        reachedMin={false}
        active={false}
      />,
    );

    const min = flatStyle(screen.getByTestId('take-progress-min-label'));
    const target = flatStyle(screen.getByTestId('take-progress-target-label'));
    // The minimum's label ends at its notch (25 % from the left)...
    expect(min).toMatchObject({ right: '75%', textAlign: 'right', marginRight: 4 });
    expect(min.left).toBeUndefined();
    expect(min.width).toBeUndefined();
    // ...the ideal's starts at its own, further right: whatever their width,
    // the two labels are on either side of the gap between the notches.
    expect(target).toMatchObject({ left: '50%', textAlign: 'left', marginLeft: 4 });
    expect(target.right).toBeUndefined();
    expect(target.width).toBeUndefined();
    // Their growth with the system font stops at 1.3.
    expect(screen.getByTestId('take-progress-min-label').props.maxFontSizeMultiplier).toBe(1.3);
    expect(screen.getByTestId('take-progress-target-label').props.maxFontSizeMultiplier).toBe(1.3);
  });

  it('highlights the minimum first at 0:00 and turns a mark green only once it is reached', async () => {
    const props = {
      minFraction: 0.25,
      targetFraction: 0.5,
      minLabel: 'En az 15 sn',
      targetLabel: 'İdeal 30 sn',
    };
    const view = await renderScreen(
      <TakeProgress {...props} progress={0} reachedMin={false} active />,
    );
    const T = themes['gece-mavisi'];

    // At 0:00 nothing is green: the minimum is the mark to reach.
    expect(flatStyle(screen.getByTestId('take-progress-min')).backgroundColor).toBe(T.action);
    expect(flatStyle(screen.getByText('En az 15 sn')).color).toBe(T.action);
    expect(flatStyle(screen.getByTestId('take-progress-target')).backgroundColor).toBe(T.text2);
    expect(flatStyle(screen.getByText('İdeal 30 sn')).color).toBe(T.text2);

    view.rerender(<TakeProgress {...props} progress={0.6} reachedMin reachedTarget active />);
    expect(flatStyle(screen.getByTestId('take-progress-min')).backgroundColor).toBe(T.success);
    expect(flatStyle(screen.getByTestId('take-progress-target')).backgroundColor).toBe(T.success);
    expect(flatStyle(screen.getByText('İdeal 30 sn')).color).toBe(T.success);
  });

  it('stays neutral before a take and uses the accent before the minimum', async () => {
    await renderScreen(
      <TakeProgress
        progress={-1}
        minFraction={0.25}
        targetFraction={3}
        minLabel="En az 15 sn"
        targetLabel="İdeal 30 sn"
        reachedMin={false}
        active={false}
      />,
      { theme: 'kitaplik' },
    );
    const T = themes.kitaplik;

    expect(flatStyle(screen.getByTestId('take-progress-fill'))).toMatchObject({
      width: '0%',
      backgroundColor: T.action,
    });
    expect(flatStyle(screen.getByText('İdeal 30 sn'))).toMatchObject({ left: '100%', color: T.text2 });
    expect(flatStyle(screen.getByTestId('take-progress-target')).backgroundColor).toBe(T.text2);
    expect(flatStyle(screen.getByTestId('take-progress-min')).backgroundColor).toBe(T.text2);
  });
});

describe('RecordButton', () => {
  it.each(['gece-mavisi', 'kitaplik'] as const)(
    'is one big round button in the recording colour of the %s palette, on its lip',
    async scheme => {
      const onPress = jest.fn();
      await renderScreen(
        <RecordButton recording={false} onPress={onPress} accessibilityLabel="Kaydı başlat" />,
        { theme: scheme },
      );
      const T = themes[scheme];

      const button = screen.getByRole('button', { name: 'Kaydı başlat' });
      expect(button).toHaveStyle({ opacity: 1 });
      // 80dp on the 4dp lip of objects 72dp and taller, in a 6dp halo: 95dp.
      expect(flatStyle(screen.getByTestId('record-button-face'))).toMatchObject({
        backgroundColor: T.rec,
        width: 80,
        height: 80,
        borderRadius: 40,
      });
      expect(RECORD_SIZE).toBe(80);
      expect(flatStyle(screen.getByTestId('record-button-lip'))).toMatchObject({
        backgroundColor: recordLip(T),
        top: LIP.lg,
      });
      expect(flatStyle(screen.getByTestId('record-button-halo'))).toMatchObject({
        padding: 6,
        borderRadius: 46,
      });
      expect(recordLip(T)).not.toBe(T.rec);
      expect(screen.getByTestId('record-button-mic', HIDDEN)).toBeOnTheScreen();
      expect(screen.queryByTestId('record-button-stop')).toBeNull();
      // No halo while idle.
      expect(flatStyle(screen.getByTestId('record-button-halo')).backgroundColor).toBeUndefined();

      fireEvent.press(button);
      expect(onPress).toHaveBeenCalledTimes(1);
    },
  );

  it('shows the stop square during a take and stays tappable while soft locked', async () => {
    const onPress = jest.fn();
    await renderScreen(
      <RecordButton
        recording
        softLocked
        onPress={onPress}
        accessibilityLabel="Kaydı durdur"
        accessibilityHint="Biraz daha oku"
      />,
      { theme: 'kitaplik' },
    );
    const T = themes.kitaplik;

    const button = screen.getByRole('button', { name: 'Kaydı durdur' });
    expect(flatStyle(screen.getByTestId('record-button-stop'))).toMatchObject({
      backgroundColor: T.onRec,
      width: 26,
      height: 26,
    });
    expect(flatStyle(screen.getByTestId('record-button-halo')).backgroundColor).toBe(withAlpha(T.rec, 0.2));
    expect(button.props.accessibilityState).toEqual({ disabled: true });
    expect(button.props.accessibilityHint).toBe('Biraz daha oku');
    // Never dimmed while a take runs.
    expect(button).toHaveStyle({ opacity: 1 });

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('blocks the press when disabled, and dims only when asked to', async () => {
    const onPress = jest.fn();
    const view = await renderScreen(
      <RecordButton recording={false} disabled onPress={onPress} accessibilityLabel="Kaydı başlat" />,
    );

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.press(screen.getByRole('button', { name: 'Kaydı başlat' }));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Kaydı başlat' })).toHaveStyle({ opacity: 1 });

    view.rerender(
      <RecordButton
        recording={false}
        disabled
        dimmed
        onPress={onPress}
        accessibilityLabel="Kaydı başlat"
      />,
    );
    expect(screen.getByRole('button', { name: 'Kaydı başlat' })).toHaveStyle({ opacity: 0.5 });
  });
});

describe('SamplePlayer', () => {
  it.each(['gece-mavisi', 'kitaplik'] as const)(
    'draws the button and the played part in the action colour of %s and shows the time',
    async scheme => {
      const onPress = jest.fn();
      await renderScreen(
        <SamplePlayer
          icon="pause"
          onPress={onPress}
          accessibilityLabel="Duraklat"
          progress={0.5}
          timeLabel="0:04 / 0:12"
          bars={10}
        />,
        { theme: scheme },
      );
      const T = themes[scheme];

      fireEvent.press(screen.getByRole('button', { name: 'Duraklat' }));
      expect(onPress).toHaveBeenCalledTimes(1);
      expect(flatStyle(screen.getByTestId('sample-player-button-face')).backgroundColor).toBe(T.action);
      expect(screen.getByTestId('sample-player-time')).toHaveTextContent('0:04 / 0:12');
      expect(flatStyle(screen.getByTestId('sample-player-time')).color).toBe(T.text2);

      const bars = screen.getByTestId('sample-player-wave', HIDDEN).children as Array<{
        props: { style?: unknown };
      }>;
      expect(bars).toHaveLength(10);
      expect(flatStyle(bars[0]).backgroundColor).toBe(T.action);
      expect(flatStyle(bars[9]).backgroundColor).toBe(withAlpha(T.text, WAVE_IDLE_ALPHA));
    },
  );

  it('leaves the time out when it is not known and blocks the press while busy', async () => {
    const onPress = jest.fn();
    await renderScreen(
      <SamplePlayer icon="play" onPress={onPress} accessibilityLabel="Dinle" busy timeLabel={null} />,
    );

    expect(screen.queryByTestId('sample-player-time')).toBeNull();
    const button = screen.getByRole('button', { name: 'Dinle' });
    expect(button).toBeDisabled();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('FlowSteps', () => {
  it.each(['gece-mavisi', 'kitaplik'] as const)(
    'fills the done and current steps with the action colour of %s',
    async scheme => {
      await renderScreen(
        <FlowSteps total={CLONE_FLOW_STEPS} current={2} accessibilityLabel="Adım 2, toplam 3 adım" />,
        { theme: scheme },
      );
      const T = themes[scheme];

      expect(screen.getByLabelText('Adım 2, toplam 3 adım')).toBeOnTheScreen();
      const on = screen.getAllByTestId('flow-steps-on');
      const off = screen.getAllByTestId('flow-steps-off');
      expect(on).toHaveLength(2);
      expect(off).toHaveLength(1);
      // The onboarding `.segs`: 30 x 9 rounded pills.
      expect(flatStyle(on[0])).toMatchObject({ width: 30, height: 9, backgroundColor: T.action });
      expect(flatStyle(off[0]).backgroundColor).toBe(T.line);
    },
  );
});

describe('FlowDock, FlowAvatar, StepRow, StatusLine', () => {
  it.each(['gece-mavisi', 'kitaplik'] as const)('use the %s palette', async scheme => {
    await renderScreen(
      <>
        <FlowDock testID="dock-surface">
          <FlowAvatar initial="Z" />
          <FlowAvatar icon="wave" testID="wave-avatar" />
        </FlowDock>
        <FlowDock variant="plain" testID="dock-plain">
          <StepRow index={2} title="Masal oku" body="Kısa bir masal gelir." testID="step" />
          <StatusLine state="done" label="Kayıt yüklendi" testID="line-done" />
          <StatusLine state="active" label="Sesin oluşturuluyor" testID="line-active" />
          <StatusLine compact state="done" label="31 saniye" testID="line-compact" />
        </FlowDock>
      </>,
      { theme: scheme },
    );
    const T = themes[scheme];

    // No hairline on the dock any more: the canvas colour, or nothing.
    const surfaceDock = flatStyle(screen.getByTestId('dock-surface'));
    expect(surfaceDock.backgroundColor).toBe(T.bg);
    expect(surfaceDock.borderTopWidth).toBeUndefined();
    // The dock rule: 8 above, dockBottom under (no inset in the tests: 20).
    expect(surfaceDock).toMatchObject({ paddingTop: 8, paddingBottom: dockBottom(0) });
    expect(flatStyle(screen.getByTestId('dock-plain')).backgroundColor).toBeUndefined();

    // The own voice wears the own colour, its glyph dark: 72dp on the 4dp
    // lip in a 12dp halo (99dp in all).
    expect(flatStyle(screen.getByTestId('flow-avatar-face', HIDDEN))).toMatchObject({
      backgroundColor: T.own,
      width: 72,
      height: 72,
    });
    expect(flatStyle(screen.getByTestId('flow-avatar-lip', HIDDEN))).toMatchObject({
      backgroundColor: T.ownLip,
      top: LIP.lg,
    });
    expect(flatStyle(screen.getByTestId('flow-avatar-halo', HIDDEN))).toMatchObject({
      padding: 12,
      borderRadius: 48,
    });
    expect(flatStyle(screen.getByText('Z', HIDDEN)).color).toBe(T.onCat);
    expect(screen.getByTestId('wave-avatar-icon', HIDDEN)).toBeOnTheScreen();
    expect(flatStyle(screen.getByTestId('wave-avatar-face', HIDDEN)).backgroundColor).toBe(T.own);

    expect(flatStyle(screen.getByTestId('step-badge'))).toMatchObject({
      backgroundColor: T.own,
      borderBottomColor: T.ownLip,
    });
    expect(flatStyle(screen.getByText('2')).color).toBe(T.onCat);
    expect(flatStyle(screen.getByText('Masal oku')).color).toBe(T.text);
    expect(flatStyle(screen.getByText('Kısa bir masal gelir.')).color).toBe(T.text2);

    expect(screen.getByTestId('line-done-check', HIDDEN)).toBeOnTheScreen();
    expect(flatStyle(screen.getByTestId('line-done-dot')).backgroundColor).toBe(withAlpha(T.success, 0.18));
    expect(flatStyle(screen.getByText('Kayıt yüklendi')).color).toBe(T.text);
    expect(screen.getByTestId('line-active-spinner')).toBeOnTheScreen();
    expect(flatStyle(screen.getByTestId('line-active-dot')).backgroundColor).toBe(T.surface2);
    expect(flatStyle(screen.getByText('Sesin oluşturuluyor')).color).toBe(T.text2);
    expect(flatStyle(screen.getByText('31 saniye')).color).toBe(T.text);
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)(
    'draws a step that has not started as a quiet dot without a spinner in %s',
    async scheme => {
      await renderScreen(
        <>
          <StatusLine state="active" label="Kayıt yükleniyor" testID="upload" />
          <StatusLine state="pending" label="Sesin oluşturuluyor" testID="create" />
        </>,
        { theme: scheme },
      );
      const T = themes[scheme];

      // Only the running step spins.
      expect(screen.getByTestId('upload-spinner')).toBeOnTheScreen();
      expect(screen.queryByTestId('create-spinner')).toBeNull();
      expect(screen.queryByTestId('create-check')).toBeNull();
      expect(flatStyle(screen.getByTestId('create-dot')).backgroundColor).toBe(T.surface2);
      expect(flatStyle(screen.getByTestId('create-pending'))).toMatchObject({
        width: 6,
        height: 6,
        backgroundColor: T.text3,
      });
      expect(flatStyle(screen.getByText('Sesin oluşturuluyor')).color).toBe(T.text3);
    },
  );

  it('keeps Baloo 2 line heights at 1.3 times the font size or more', async () => {
    await renderScreen(
      <>
        <FlowAvatar initial="Z" />
        <FlowAvatar initial="Y" size={64} />
        <StepRow index={1} title="Baslik" body="Govde" />
      </>,
    );

    for (const node of [
      screen.getByText('Z', HIDDEN),
      screen.getByText('Y', HIDDEN),
      screen.getByText('1'),
      screen.getByText('Baslik'),
    ]) {
      const style = flatStyle(node);
      expect(style.lineHeight / style.fontSize).toBeGreaterThanOrEqual(1.3);
    }
  });
});
