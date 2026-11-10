/**
 * Profile components (design/v4/playful): the plan and usage card (the
 * GET /usage meters, their skeleton and the limit lines when they cannot be
 * read), the setting row and its card, the choice sheet, the name sheet, the
 * palette picker and the small helpers.
 */

import React from 'react';
import { Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { UsageBucket, parseUsageSummary, renewalLine } from '../../models/Quota';
import { backendUsageFree, backendUsageMini } from '../../test-utils/contract-fixtures';
import { PALETTE_STORAGE_KEY } from '../../theme/ThemeProvider';
import { PALETTE_KEYS, PaletteKey } from '../../theme/palettes';
import { Icon } from '../design/Icon';
import { withAlpha } from '../../theme/color';
import {
  PlanUsageCard,
  PlanUsageMeters,
  USAGE_BAR_HEIGHT,
  USAGE_METER_HEIGHT,
  usageCaption,
  usageValue,
} from './PlanUsageCard';
import { SegmentedControl } from '../design';
import {
  LABEL_MIN_WIDTH,
  ROW_GAP,
  ROW_ICON_TILE,
  ROW_LABEL_INSET,
  ROW_PAD_H,
  SETTING_ROW_MIN_HEIGHT,
  SettingRow,
  SettingsGroup,
} from './SettingRow';
import { ChoiceSheet } from './ChoiceSheet';
import { NAME_MAX_LENGTH, NameEditSheet } from './NameEditSheet';
import { PalettePicker } from './PalettePicker';
import { SUPPORT_EMAIL, formatBytes, supportMailUrl } from './support';

jest.setTimeout(60000);

// The name sheet saves through UserService and the auth store.
const mockUpdateProfile = jest.fn();
jest.mock('../../services/UserService', () => ({
  __esModule: true,
  default: { updateProfile: (...args: unknown[]) => mockUpdateProfile(...args) },
}));
const mockAuth: { backendUser: { id: string; firstName: string | null } | null; updateBackendUser: jest.Mock } = {
  backendUser: null,
  updateBackendUser: jest.fn(),
};
jest.mock('../../hooks/useAuth', () => ({ useAuth: () => mockAuth }));
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
jest.mock('../../utils/toast', () => ({
  showToast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    info: jest.fn(),
  },
}));

// PalettePicker tests that need to see when the palette is applied replace
// the picker's `usePalette()`; every other test uses the real provider.
const mockPaletteOverride: {
  current: { palette: PaletteKey; setPalette: jest.Mock } | null;
} = { current: null };
jest.mock('../../theme/ThemeProvider', () => {
  const actual = jest.requireActual('../../theme/ThemeProvider');
  return { ...actual, usePalette: () => mockPaletteOverride.current ?? actual.usePalette() };
});

// Renders per Tactile testID, to see which swatches a tap re-renders. The
// wrapper only counts and renders the real Tactile.
const mockTactileRenders: Record<string, number> = {};
jest.mock('../design/Tactile', () => {
  const ReactActual: typeof React = jest.requireActual('react');
  const actual = jest.requireActual('../design/Tactile');
  const Counted = (props: { testID?: string }) => {
    if (props.testID) mockTactileRenders[props.testID] = (mockTactileRenders[props.testID] ?? 0) + 1;
    return ReactActual.createElement(actual.Tactile, props);
  };
  return { ...actual, Tactile: Counted };
});

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

const meter = (patch: Partial<UsageBucket> = {}): UsageBucket => {
  const base = { used: 12, limit: 20 as number | null, period: 'month' as const, renewsAt: new Date(2026, 10, 1), ...patch };
  return { ...base, remaining: base.limit === null ? null : Math.max(0, base.limit - base.used) };
};

// The numbers of frame 23: 12 of 20 this month, and the single lifetime story used.
const FRAME_USAGE: PlanUsageMeters = {
  preset: meter(),
  cloned: meter({ used: 1, limit: 1, period: 'lifetime', renewsAt: null }),
};

/** The card's meters from a GET /usage body, as ProfileScreen passes them. */
function metersFrom(json: unknown): PlanUsageMeters {
  const usage = parseUsageSummary(json);
  if (!usage) throw new Error('fixture did not parse');
  return { preset: usage.buckets.presetNarrations, cloned: usage.buckets.cloneNarrations };
}

beforeEach(async () => {
  await i18n.changeLanguage('tr');
});

describe('usage lines', () => {
  const t = i18n.getFixedT('tr', 'profile');

  it('writes the renewal date with the right Turkish suffix for every month (models/Quota)', () => {
    expect(renewalLine(new Date(2026, 10, 1))).toBe("1 Kasım'da yenilenir.");
    expect(renewalLine(new Date(2026, 9, 1))).toBe("1 Ekim'de yenilenir.");
    expect(renewalLine(new Date(2027, 0, 15))).toBe("15 Ocak'ta yenilenir.");
    expect(renewalLine(new Date(2027, 8, 1))).toBe("1 Eylül'de yenilenir.");
    for (let month = 0; month < 12; month++) {
      expect(renewalLine(new Date(2027, month, 1))).toMatch(/^1 \S+'(ta|te|da|de) yenilenir\.$/);
    }
  });

  it('writes the value with or without a limit', () => {
    expect(usageValue(meter(), t)).toBe('12 / 20 masal');
    expect(usageValue(meter({ limit: null }), t)).toBe('12 masal');
    expect(usageValue(meter({ used: 0, limit: 1 }), t)).toBe('0 / 1 masal');
  });

  it('uses the One variants at 1 in English (no plural rules on Hermes)', () => {
    const en = i18n.getFixedT('en', 'profile');
    expect(usageValue(meter({ used: 1, limit: null }), en)).toBe('1 story');
    expect(usageValue(meter({ used: 2, limit: null }), en)).toBe('2 stories');
    expect(usageValue(meter({ used: 0, limit: 1 }), en)).toBe('0 / 1 story');
    expect(usageCaption(meter({ limit: 1, period: 'lifetime', renewsAt: null }), 'free', en)).toBe(
      'The free plan includes 1 story in total. It does not renew.',
    );
    expect(usageCaption(meter({ limit: 3, period: 'lifetime', renewsAt: null }), 'mini', en)).toBe(
      '3 stories in total. They do not renew.',
    );
  });

  it('explains when a meter renews, or that it never does', () => {
    expect(usageCaption(meter(), 'free', t)).toBe("1 Kasım'da yenilenir.");
    expect(usageCaption(meter({ renewsAt: null }), 'free', t)).toBeNull();
    expect(usageCaption(meter({ limit: null }), 'premium', t)).toBe('Sınırsız.');
    expect(usageCaption(meter({ limit: 1, period: 'lifetime', renewsAt: null }), 'free', t)).toBe(
      'Ücretsiz planda toplam 1 masal. Yenilenmez.',
    );
    expect(usageCaption(meter({ limit: 3, period: 'lifetime', renewsAt: null }), 'mini', t)).toBe(
      'Toplam 3 masal. Yenilenmez.',
    );
  });

  it('writes the renewal date in English', async () => {
    await i18n.changeLanguage('en');
    const en = i18n.getFixedT('en', 'profile');
    expect(renewalLine(new Date(2026, 10, 1))).toBe('Renews on 1 November.');
    expect(usageCaption(meter(), 'free', en)).toBe('Renews on 1 November.');
    expect(usageValue(meter(), en)).toBe('12 / 20 stories');
  });
});

describe('PlanUsageCard', () => {
  it('shows the two bars from GET /usage (free plan, nothing used yet)', () => {
    const onSeePlans = jest.fn();
    renderWithProviders(
      <PlanUsageCard planId="free" meters={metersFrom(backendUsageFree)} onSeePlans={onSeePlans} />,
    );
    expect(screen.getByText('Ücretsiz plan')).toBeOnTheScreen();
    const preset = within(screen.getByTestId('usage-preset'));
    expect(preset.getByText('0 / 20 masal')).toBeOnTheScreen();
    // The fixture renews on an ISO date; the caption is its local day.
    expect(preset.getByText(/yenilenir\.$/)).toBeOnTheScreen();
    const cloned = within(screen.getByTestId('usage-cloned'));
    expect(cloned.getByText('Kendi sesinle')).toBeOnTheScreen();
    expect(cloned.getByText('0 / 1 masal')).toBeOnTheScreen();
    expect(cloned.getByText('Ücretsiz planda toplam 1 masal. Yenilenmez.')).toBeOnTheScreen();
    expect(screen.getByTestId('usage-preset-bar').props.accessibilityValue.now).toBe(0);
    expect(screen.queryByTestId('usage-loading')).toBeNull();
    expect(screen.queryByTestId('usage-limits')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Planları gör' }));
    expect(onSeePlans).toHaveBeenCalledTimes(1);
  });

  it('shows Mini from GET /usage: no bar for unlimited, the monthly own-voice bar', () => {
    renderWithProviders(<PlanUsageCard planId="mini" meters={metersFrom(backendUsageMini)} onSeePlans={jest.fn()} />);
    expect(screen.getByText('Mini planı')).toBeOnTheScreen();
    expect(screen.getByText('12 masal')).toBeOnTheScreen();
    expect(screen.getByText('Sınırsız.')).toBeOnTheScreen();
    expect(screen.queryByTestId('usage-preset-bar')).toBeNull();
    expect(screen.getByText('Kendi sesinle, bu ay')).toBeOnTheScreen();
    expect(screen.getByText('3 / 5 masal')).toBeOnTheScreen();
    expect(screen.getByTestId('usage-cloned-bar').props.accessibilityValue.now).toBe(60);
  });

  it('while loading with nothing known: two skeleton rows of the meter height', () => {
    renderWithProviders(<PlanUsageCard planId="free" meters={null} loading onSeePlans={jest.fn()} />);
    expect(screen.getByTestId('usage-loading')).toBeOnTheScreen();
    for (const i of [0, 1]) {
      const row = flatStyle(screen.getByTestId(`usage-skeleton-${i}`));
      expect(row.height).toBe(USAGE_METER_HEIGHT);
      expect(row.marginTop).toBe(12);
    }
    expect(screen.queryByTestId('usage-preset')).toBeNull();
    expect(screen.queryByText(/masal/)).toBeNull();
  });

  it('a real meter is never shorter than its skeleton, so nothing jumps when the numbers land', () => {
    renderWithProviders(<PlanUsageCard planId="mini" meters={metersFrom(backendUsageMini)} onSeePlans={jest.fn()} />);
    for (const id of ['preset', 'cloned']) {
      const row = flatStyle(screen.getByTestId(`usage-${id}`));
      expect(row.minHeight).toBe(USAGE_METER_HEIGHT);
      expect(row.marginTop).toBe(12);
    }
    // A label line, the bar with its gap, the caption with its gap.
    expect(USAGE_METER_HEIGHT).toBe(19 + 8 + USAGE_BAR_HEIGHT + 6 + 16);
  });

  it.each([
    ['free', ['Hazır anlatıcılarla ayda 20 masal', 'Kendi sesinle toplam 1 masal']],
    ['mini', ['Hazır anlatıcılarla sınırsız masal', 'Kendi sesinle ayda 5 masal']],
    ['premium', ['Hazır anlatıcılarla sınırsız masal', 'Kendi sesinle ayda 20 masal']],
  ] as const)('when the numbers cannot be read: the %s plan limits as plain lines', (planId, lines) => {
    renderWithProviders(<PlanUsageCard planId={planId} meters={null} onSeePlans={jest.fn()} />);
    const limits = within(screen.getByTestId('usage-limits'));
    const T = themes['gece-mavisi'];
    for (const line of lines) {
      expect(flatStyle(limits.getByText(line))).toMatchObject({
        fontFamily: T.fontBody,
        fontSize: 13.5,
        lineHeight: 19,
        color: T.text2,
      });
    }
    expect(flatStyle(screen.getByTestId('usage-limits')).marginTop).toBe(4);
    // Only the narration limits: no counter, no bar, no skeleton.
    expect(screen.queryByText(/\d+ \/ \d+/)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('draws both bars as in the frame once the numbers exist', () => {
    renderWithProviders(<PlanUsageCard planId="free" meters={FRAME_USAGE} onSeePlans={jest.fn()} />);

    const preset = within(screen.getByTestId('usage-preset'));
    expect(preset.getByText('Hazır anlatıcılarla, bu ay')).toBeOnTheScreen();
    expect(preset.getByText('12 / 20 masal')).toBeOnTheScreen();
    expect(preset.getByText("1 Kasım'da yenilenir.")).toBeOnTheScreen();
    expect(screen.getByTestId('usage-preset-bar').props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 60,
    });

    const cloned = within(screen.getByTestId('usage-cloned'));
    expect(cloned.getByText('Kendi sesinle')).toBeOnTheScreen();
    expect(cloned.getByText('1 / 1 masal')).toBeOnTheScreen();
    expect(cloned.getByText('Ücretsiz planda toplam 1 masal. Yenilenmez.')).toBeOnTheScreen();
    expect(screen.getByTestId('usage-cloned-bar').props.accessibilityValue.now).toBe(100);
  });

  it('shows a paid plan: no bar for unlimited, a monthly own-voice bar', () => {
    renderWithProviders(
      <PlanUsageCard
        planId="premium"
        meters={{
          preset: meter({ used: 31, limit: null }),
          cloned: meter({ used: 4, limit: 20 }),
        }}
        onSeePlans={jest.fn()}
      />,
    );
    expect(screen.getByText('Premium planı')).toBeOnTheScreen();
    expect(screen.getByText('31 masal')).toBeOnTheScreen();
    expect(screen.getByText('Sınırsız.')).toBeOnTheScreen();
    expect(screen.queryByTestId('usage-preset-bar')).toBeNull();
    expect(screen.getByText('Kendi sesinle, bu ay')).toBeOnTheScreen();
    expect(screen.getByText('4 / 20 masal')).toBeOnTheScreen();
    expect(screen.getByTestId('usage-cloned-bar').props.accessibilityValue.now).toBe(20);
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', scheme => {
    renderWithProviders(
      <PlanUsageCard planId="free" meters={FRAME_USAGE} onSeePlans={jest.fn()} testID="card" />,
      { theme: scheme },
    );
    const T = themes[scheme];
    // A `.card` on its lip, no visible border (Card may keep a transparent
    // ring so a selection never changes its size).
    const cardFace = flatStyle(screen.getByTestId('card-face'));
    expect(cardFace).toMatchObject({ backgroundColor: T.surface, borderRadius: 24 });
    expect(cardFace.borderWidth === 0 || cardFace.borderColor === 'transparent').toBe(true);
    expect(flatStyle(screen.getByTestId('card-lip')).backgroundColor).toBe(T.lip);
    // The plan name is Baloo 2.
    expect(flatStyle(screen.getByText('Ücretsiz plan'))).toMatchObject({
      color: T.text,
      fontFamily: T.fontDisplay,
    });
    expect(flatStyle(screen.getByTestId('profile-see-plans-face')).backgroundColor).toBe(T.action);
    expect(flatStyle(screen.getByText('Planları gör')).color).toBe(T.onAction);
    expect(flatStyle(screen.getByText('12 / 20 masal')).color).toBe(T.text);
    expect(flatStyle(screen.getByText('Hazır anlatıcılarla, bu ay')).color).toBe(T.text);
    expect(flatStyle(screen.getByText("1 Kasım'da yenilenir.")).color).toBe(T.text3);
    expect(flatStyle(screen.getByTestId('usage-preset-bar')).height).toBe(USAGE_BAR_HEIGHT);
    expect(flatStyle(screen.getByTestId('usage-preset-bar')).backgroundColor).toBe(T.line);
    expect(flatStyle(screen.getByTestId('usage-preset-bar-fill')).backgroundColor).toBe(T.action);
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<PlanUsageCard planId="free" meters={FRAME_USAGE} onSeePlans={jest.fn()} />);
    expect(screen.getByText('Free plan')).toBeOnTheScreen();
    expect(screen.getByText('Ready-made narrators, this month')).toBeOnTheScreen();
    expect(screen.getByText('Renews on 1 November.')).toBeOnTheScreen();
    expect(screen.getByText('1 / 1 story')).toBeOnTheScreen();
    expect(screen.getByText('The free plan includes 1 story in total. It does not renew.')).toBeOnTheScreen();
  });
});

describe('SettingRow', () => {
  it('is a button with the value in its label when it can be pressed', () => {
    const onPress = jest.fn();
    renderWithProviders(
      <SettingRow icon="bell" label="Bildirimler" value="2 yeni" chevron onPress={onPress} />,
    );
    fireEvent.press(screen.getByRole('button', { name: 'Bildirimler, 2 yeni' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('icon-bell', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByTestId('icon-chevronRight', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('is plain content without onPress and shows its control', () => {
    renderWithProviders(
      <SettingRow label="Tema" testID="row" trailing={<SettingRow label="iç" testID="inner" />} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('inner')).toBeOnTheScreen();
  });

  it('does not react while disabled', () => {
    const onPress = jest.fn();
    renderWithProviders(<SettingRow label="Önbelleği temizle" disabled onPress={onPress} />);
    expect(screen.getByRole('button', { name: 'Önbelleği temizle' })).toBeDisabled();
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('uses the error colour for a danger row in the %s theme', scheme => {
    renderWithProviders(
      <>
        <SettingRow icon="trash" tone="danger" label="Hesabı sil" onPress={jest.fn()} />
        <SettingRow icon="signOut" label="Çıkış yap" value="deger" indent onPress={jest.fn()} />
      </>,
      { theme: scheme },
    );
    const T = themes[scheme];
    expect(flatStyle(screen.getByText('Hesabı sil')).color).toBe(T.error);
    expect(flatStyle(screen.getByText('Çıkış yap')).color).toBe(T.text);
    expect(flatStyle(screen.getByText('deger')).color).toBe(T.text2);
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('puts the icon in a rounded tile in the %s theme', scheme => {
    renderWithProviders(
      <>
        <SettingRow icon="bell" label="Bildirimler" testID="plain" />
        <SettingRow icon="trash" tone="danger" label="Hesabı sil" testID="danger" />
      </>,
      { theme: scheme },
    );
    const T = themes[scheme];
    expect(flatStyle(screen.getByTestId('plain-tile'))).toMatchObject({
      backgroundColor: T.surface2,
      width: 40,
      height: 40,
      borderRadius: 12,
    });
    expect(flatStyle(screen.getByTestId('danger-tile')).backgroundColor).toBe(withAlpha(T.error, 0.14));
  });

  it('lines an indented row up with the labels of rows that have an icon', () => {
    renderWithProviders(<SettingRow label="Önbellek" indent testID="row" />);
    expect(flatStyle(screen.getByTestId('row')).paddingLeft).toBe(ROW_LABEL_INSET);
    expect(ROW_LABEL_INSET).toBe(ROW_PAD_H + 40 + 12);
  });

  it('dims while pressed and never moves (a row has no lip)', () => {
    const timing = jest.spyOn(Animated, 'timing').mockImplementation(((
      value: Animated.Value,
      config: { toValue: number },
    ) => ({
      start: () => value.setValue(config.toValue),
      stop: () => undefined,
      reset: () => undefined,
    })) as unknown as typeof Animated.timing);
    renderWithProviders(<SettingRow label="Bize ulaşın" onPress={jest.fn()} testID="row" />);
    const face = () => flatStyle(screen.getByTestId('row-face'));
    fireEvent(screen.getByTestId('row'), 'pressIn');
    expect(face().opacity).toBe(0.6);
    expect(face().transform).toBeUndefined();
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 0.6, useNativeDriver: true }));
    fireEvent(screen.getByTestId('row'), 'pressOut');
    expect(face().opacity).toBe(1);
    timing.mockRestore();
  });

  it('a disabled row starts no tint', () => {
    const timing = jest.spyOn(Animated, 'timing');
    renderWithProviders(<SettingRow label="Önbelleği temizle" disabled onPress={jest.fn()} testID="row" />);
    fireEvent(screen.getByTestId('row'), 'pressIn');
    expect(timing).not.toHaveBeenCalled();
    expect(flatStyle(screen.getByTestId('row-face')).opacity).toBe(1);
    timing.mockRestore();
  });

  it('is 56dp tall with 12dp side padding and a 72dp label minimum', () => {
    renderWithProviders(<SettingRow icon="bell" label="Bildirimler" testID="row" />);
    expect(SETTING_ROW_MIN_HEIGHT).toBe(56);
    expect(ROW_PAD_H).toBe(12);
    expect(LABEL_MIN_WIDTH).toBe(72);
    expect(flatStyle(screen.getByTestId('row'))).toMatchObject({ minHeight: 56, paddingHorizontal: 12 });
  });

  it('the language rows fit one line at 360dp with the compact segments', () => {
    // 360 - 2 x 16 gutter - 2 x 2 card ring - 2 x 12 row padding.
    const rowInner = 360 - 2 * 16 - 2 * 2 - 2 * ROW_PAD_H;
    // "Uygulama dili" at 15 and the compact Türkçe / English control (Nunito 800 13).
    const label = Math.max(98.6, LABEL_MIN_WIDTH);
    const compactControl = 131.3;
    expect(ROW_ICON_TILE + ROW_GAP + label + ROW_GAP + compactControl).toBeLessThanOrEqual(rowInner);
  });
});

describe('SettingsGroup', () => {
  it.each(['gece-mavisi', 'kitaplik'] as const)('is a surface card on its lip in the %s theme', scheme => {
    renderWithProviders(
      <SettingsGroup testID="group">
        <SettingRow icon="bell" label="Bildirimler" />
      </SettingsGroup>,
      { theme: scheme },
    );
    const T = themes[scheme];
    expect(flatStyle(screen.getByTestId('group-face'))).toMatchObject({
      backgroundColor: T.surface,
      borderRadius: 24,
    });
    expect(flatStyle(screen.getByTestId('group-lip')).backgroundColor).toBe(T.lip);
    expect(flatStyle(screen.getByTestId('group'))).toMatchObject({ marginHorizontal: T.screenPadH, marginBottom: 16 });
    expect(flatStyle(screen.getByTestId('group-face'))).toMatchObject({ paddingHorizontal: 0, paddingVertical: 4 });
    expect(screen.getByText('Bildirimler')).toBeOnTheScreen();
  });
});

describe('ChoiceSheet', () => {
  const options = [
    { value: 'tr', label: 'Türkçe' },
    { value: 'en', label: 'English' },
    { value: 'de', label: 'Deutsch' },
  ];

  it('lists the options, marks the current one and reports a new pick', () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    renderWithProviders(
      <ChoiceSheet
        visible
        title="Masal dili"
        options={options}
        value="en"
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('header', { name: 'Masal dili' })).toBeOnTheScreen();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    // The list sits in the sheet's own scrolling container.
    expect(within(screen.getByTestId('sheet-scroll')).getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'English' })).toBeSelected();
    expect(screen.getByRole('radio', { name: 'Deutsch' })).not.toBeSelected();

    fireEvent.press(screen.getByRole('radio', { name: 'Deutsch' }));
    expect(onSelect).toHaveBeenCalledWith('de');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes without a change when the current option is picked again', () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    renderWithProviders(
      <ChoiceSheet visible title="Masal dili" options={options} value="tr" onSelect={onSelect} onClose={onClose} />,
    );
    fireEvent.press(screen.getByRole('radio', { name: 'Türkçe' }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('rings the current option in the %s action colour', scheme => {
    renderWithProviders(
      <ChoiceSheet
        visible
        title="Masal dili"
        options={options}
        value="en"
        onSelect={jest.fn()}
        onClose={jest.fn()}
        testID="sheet"
      />,
      { theme: scheme },
    );
    const T = themes[scheme];
    expect(flatStyle(screen.getByTestId('sheet-en-face'))).toMatchObject({
      backgroundColor: T.surface2,
      borderColor: T.action,
    });
    expect(flatStyle(screen.getByTestId('sheet-en-lip')).backgroundColor).toBe(T.actionLip);
    expect(flatStyle(screen.getByTestId('sheet-de-face'))).toMatchObject({
      backgroundColor: T.surface2,
      borderWidth: 2,
      borderColor: 'transparent',
    });
    expect(flatStyle(screen.getByTestId('sheet-de-lip')).backgroundColor).toBe(T.lip);
  });

  it('renders nothing while hidden', () => {
    renderWithProviders(
      <ChoiceSheet visible={false} title="Masal dili" options={options} value={null} onSelect={jest.fn()} onClose={jest.fn()} />,
    );
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

describe('NameEditSheet', () => {
  beforeEach(() => {
    mockAuth.backendUser = { id: 'u-1', firstName: 'Zeynep' };
    mockAuth.updateBackendUser.mockReset();
    mockUpdateProfile.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
  });

  const renderSheet = (onClose = jest.fn()) => {
    renderWithProviders(<NameEditSheet visible onClose={onClose} testID="name-sheet" />);
    return onClose;
  };

  it('starts from the current first name, limited to 50 characters', () => {
    renderSheet();
    expect(screen.getByRole('header', { name: 'Adını değiştir' })).toBeOnTheScreen();
    const input = screen.getByTestId('profile-name-input');
    expect(input.props.value).toBe('Zeynep');
    expect(input.props.maxLength).toBe(NAME_MAX_LENGTH);
    expect(NAME_MAX_LENGTH).toBe(50);
    expect(screen.getByText('Adın')).toBeOnTheScreen();
  });

  it('saves the trimmed name, hands it to the auth store, says so and closes', async () => {
    const saved = { id: 'u-1', firstName: 'Elif' };
    mockUpdateProfile.mockResolvedValue(saved);
    const onClose = renderSheet();
    fireEvent.changeText(screen.getByTestId('profile-name-input'), '  Elif  ');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Kaydet' }));
    });
    expect(mockUpdateProfile).toHaveBeenCalledWith({ firstName: 'Elif' });
    expect(mockAuth.updateBackendUser).toHaveBeenCalledWith(saved);
    expect(mockToastSuccess).toHaveBeenCalledWith('Adın güncellendi');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the sheet open with the typed name when the save fails', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockUpdateProfile.mockRejectedValue(new Error('500'));
    const onClose = renderSheet();
    fireEvent.changeText(screen.getByTestId('profile-name-input'), 'Elif');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Kaydet' }));
    });
    expect(mockToastError).toHaveBeenCalledWith('Adın kaydedilemedi');
    expect(onClose).not.toHaveBeenCalled();
    expect(mockAuth.updateBackendUser).not.toHaveBeenCalled();
    expect(screen.getByTestId('profile-name-input').props.value).toBe('Elif');
    // A second try is one tap.
    expect(screen.getByRole('button', { name: 'Kaydet' })).toBeEnabled();
  });

  it('an unchanged name closes without a request; an empty one cannot be saved', async () => {
    const onClose = renderSheet();
    fireEvent.changeText(screen.getByTestId('profile-name-input'), ' Zeynep ');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Kaydet' }));
    });
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.changeText(screen.getByTestId('profile-name-input'), '   ');
    expect(screen.getByRole('button', { name: 'Kaydet' })).toBeDisabled();
    await act(async () => {
      fireEvent(screen.getByTestId('profile-name-input'), 'submitEditing');
    });
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('the return key saves too', async () => {
    mockUpdateProfile.mockResolvedValue({ id: 'u-1', firstName: 'Ece' });
    renderSheet();
    fireEvent.changeText(screen.getByTestId('profile-name-input'), 'Ece');
    await act(async () => {
      fireEvent(screen.getByTestId('profile-name-input'), 'submitEditing');
    });
    expect(mockUpdateProfile).toHaveBeenCalledWith({ firstName: 'Ece' });
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    renderSheet();
    expect(screen.getByRole('header', { name: 'Change your name' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Save' })).toBeOnTheScreen();
  });
});

describe('support helpers', () => {
  it('builds the support mail link', () => {
    expect(SUPPORT_EMAIL).toBe('info@sesly.io');
    expect(supportMailUrl()).toBe('mailto:info@sesly.io');
    expect(supportMailUrl('Sesly Destek')).toBe('mailto:info@sesly.io?subject=Sesly%20Destek');
  });

  it('formats byte counts with the decimal mark of the language', () => {
    expect(formatBytes(0, 'tr')).toBe('0 B');
    expect(formatBytes(-5, 'tr')).toBe('0 B');
    expect(formatBytes(Number.NaN, 'tr')).toBe('0 B');
    expect(formatBytes(512, 'tr')).toBe('512 B');
    expect(formatBytes(1536, 'tr')).toBe('1,5 KB');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(formatBytes(13002342, 'tr')).toBe('12,4 MB');
    expect(formatBytes(3 * 1024 ** 3, 'en')).toBe('3.0 GB');
    // Larger than the last unit stays in GB.
    expect(formatBytes(5 * 1024 ** 4, 'en')).toBe('5120.0 GB');
  });
});

describe('profile rows fit the screen (360dp wide, large fonts)', () => {
  it('the plan card centres its first row and lets the name give way', () => {
    renderWithProviders(
      <PlanUsageCard planId="free" meters={null} onSeePlans={jest.fn()} testID="card" />,
    );
    // The same 16dp inset on every side of the face.
    const face = flatStyle(screen.getByTestId('card-face'));
    expect(face.padding).toBe(16);
    expect(face.paddingTop).toBeUndefined();
    expect(face.paddingRight).toBeUndefined();
    expect(flatStyle(screen.getByTestId('card')).marginHorizontal).toBe(themes['gece-mavisi'].screenPadH);

    const top = flatStyle(screen.getByTestId('profile-plan-top'));
    expect(top).toMatchObject({ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' });

    // The plan name gives way; it never pushes the link off the card.
    const name = flatStyle(screen.getByTestId('profile-plan-name'));
    expect(name).toMatchObject({ flexShrink: 1, minWidth: 0 });
    // Baloo 2 needs at least 1.3 times its size (Android clips it).
    expect(name.lineHeight).toBeGreaterThanOrEqual(name.fontSize * 1.3);

    // The button keeps its size; it wraps under the name instead.
    expect(flatStyle(screen.getByTestId('profile-see-plans')).flexShrink).toBe(0);
  });

  it('a row lets its control shrink or wrap under the label instead of overflowing', () => {
    renderWithProviders(
      <SettingRow
        icon="language"
        label="Masal dili"
        testID="row"
        trailing={
          <SegmentedControl
            compact
            segments={[
              { value: 'tr', label: 'Türkçe' },
              { value: 'en', label: 'English' },
              { value: 'de', label: 'Deutsch' },
            ]}
            value="tr"
            onChange={jest.fn()}
            testID="seg"
          />
        }
      />,
    );
    const row = flatStyle(screen.getByTestId('row'));
    expect(row).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
    // Inside its card the row keeps the card's own inset.
    expect(row.paddingHorizontal).toBe(ROW_PAD_H);

    const label = flatStyle(screen.getByTestId('row-label'));
    expect(label.minWidth).toBe(LABEL_MIN_WIDTH);
    expect(label.flexShrink).toBe(1);

    const seg = screen.getByTestId('seg');
    expect(flatStyle(seg).maxWidth).toBe('100%');
    // The wrapper that holds the control: bounded by the row, right-aligned.
    expect(flatStyle(screen.getByTestId('row-trailing'))).toMatchObject({
      flexShrink: 1,
      maxWidth: '100%',
      marginLeft: 'auto',
    });
    // Segments shrink, and their labels stop growing with the system font
    // before the control outgrows the row.
    const first = screen.getByRole('radio', { name: 'Türkçe' });
    expect(flatStyle(first).flexShrink).toBe(1);
    expect(screen.getByText('Türkçe').props.maxFontSizeMultiplier).toBe(1.3);
  });
});

describe('PalettePicker', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });
  afterEach(() => {
    mockPaletteOverride.current = null;
  });

  /** The picker on a stand-in palette state whose setter only records. */
  const renderWithMockedPalette = (palette: PaletteKey = 'gece-mavisi') => {
    const setPalette = jest.fn(() => Promise.resolve());
    mockPaletteOverride.current = { palette, setPalette };
    const view = renderWithProviders(<PalettePicker />);
    return { ...view, setPalette };
  };
  const nextFrame = () => act(() => jest.runOnlyPendingTimers());
  const radio = (name: string) => screen.getByRole('radio', { name });

  it('offers the six palettes by name as a radio group', () => {
    renderWithProviders(<PalettePicker />);
    const picker = screen.getByTestId('palette-picker');
    expect(picker.props.accessibilityRole).toBe('radiogroup');
    expect(picker).toHaveProp('accessibilityLabel', 'Renk paleti');
    expect(within(picker).getAllByRole('radio')).toHaveLength(6);
    expect(PALETTE_KEYS).toHaveLength(6);
    for (const key of PALETTE_KEYS) {
      expect(screen.getByTestId(`palette-option-${key}`)).toBeOnTheScreen();
    }
    expect(radio('Gece mavisi')).toBeSelected();
    expect(screen.getByText('Seçimin bu cihazda saklanır.')).toBeOnTheScreen();
  });

  it('applies a pick and stores it on the device: the ring first, the palette on the next frame', async () => {
    renderWithProviders(<PalettePicker />);
    fireEvent.press(radio('Kitaplık'));
    // The ring has moved; the app (the picker too) still draws the old palette.
    expect(radio('Kitaplık')).toBeSelected();
    expect(radio('Gece mavisi')).not.toBeSelected();
    expect(flatStyle(screen.getByTestId('palette-option-kitaplik-face')).borderColor).toBe(
      themes['gece-mavisi'].action,
    );
    await expect(AsyncStorage.getItem(PALETTE_STORAGE_KEY)).resolves.toBeNull();

    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(radio('Kitaplık')).toBeSelected();
    await expect(AsyncStorage.getItem(PALETTE_STORAGE_KEY)).resolves.toBe('kitaplik');
    // The picker itself is drawn in the new palette: the pick rings in its action colour.
    expect(flatStyle(screen.getByTestId('palette-option-kitaplik-face')).borderColor).toBe(
      themes.kitaplik.action,
    );
  });

  it('pressing Kitaplık selects it before setPalette runs', () => {
    const { setPalette } = renderWithMockedPalette();
    fireEvent.press(radio('Kitaplık'));
    expect(radio('Kitaplık')).toBeSelected();
    expect(radio('Gece mavisi')).not.toBeSelected();
    expect(setPalette).not.toHaveBeenCalled();

    nextFrame();
    expect(setPalette).toHaveBeenCalledTimes(1);
    expect(setPalette).toHaveBeenCalledWith('kitaplik');
  });

  it('three quick presses apply once, the last key', () => {
    const { setPalette } = renderWithMockedPalette();
    fireEvent.press(radio('Kitaplık'));
    fireEvent.press(radio('Orman'));
    fireEvent.press(radio('Erik'));
    expect(radio('Erik')).toBeSelected();
    expect(screen.getAllByRole('radio').filter(node => node.props.accessibilityState?.selected)).toHaveLength(1);
    expect(setPalette).not.toHaveBeenCalled();

    nextFrame();
    expect(setPalette).toHaveBeenCalledTimes(1);
    expect(setPalette).toHaveBeenCalledWith('erik');
  });

  it('a tap re-renders only the two swatches whose ring moves', () => {
    const { setPalette } = renderWithMockedPalette();
    const before = { ...mockTactileRenders };
    const rendersOf = (key: PaletteKey) =>
      (mockTactileRenders[`palette-option-${key}`] ?? 0) - (before[`palette-option-${key}`] ?? 0);

    fireEvent.press(radio('Kitaplık'));
    expect(rendersOf('kitaplik')).toBe(1);
    expect(rendersOf('gece-mavisi')).toBe(1);
    for (const key of PALETTE_KEYS.filter(k => k !== 'kitaplik' && k !== 'gece-mavisi')) {
      expect(rendersOf(key)).toBe(0);
    }

    // The frame that applies the palette does not touch the swatches either
    // (the stand-in setter changes nothing).
    nextFrame();
    expect(setPalette).toHaveBeenCalledWith('kitaplik');
    expect(rendersOf('orman')).toBe(0);
  });

  it('pressing the selected palette does nothing', () => {
    const { setPalette } = renderWithMockedPalette('orman');
    fireEvent.press(radio('Orman'));
    nextFrame();
    expect(setPalette).not.toHaveBeenCalled();
    expect(radio('Orman')).toBeSelected();
  });

  it('a pick still waiting for its frame is dropped when the picker unmounts', () => {
    const { setPalette, unmount } = renderWithMockedPalette();
    fireEvent.press(radio('Erik'));
    unmount();
    nextFrame();
    expect(setPalette).not.toHaveBeenCalled();
  });

  it('the ring follows a palette set elsewhere (the stored pick, another picker)', () => {
    const { rerender } = renderWithMockedPalette('gece-mavisi');
    expect(radio('Gece mavisi')).toBeSelected();
    mockPaletteOverride.current = { palette: 'murekkep', setPalette: jest.fn() };
    rerender(<PalettePicker />);
    expect(radio('Mürekkep')).toBeSelected();
    expect(radio('Gece mavisi')).not.toBeSelected();
  });

  it('marks the selected palette with a check badge inside its preview only', () => {
    renderWithProviders(<PalettePicker />);
    const T = themes['gece-mavisi'];
    const check = within(screen.getByTestId('palette-preview-gece-mavisi')).getByTestId(
      'palette-check-gece-mavisi',
    );
    expect(flatStyle(check)).toMatchObject({
      position: 'absolute',
      top: 4,
      right: 4,
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: T.action,
    });
    expect(within(check).UNSAFE_getByType(Icon).props).toMatchObject({ name: 'check', color: T.onAction });
    for (const key of PALETTE_KEYS.filter(k => k !== 'gece-mavisi')) {
      expect(screen.queryByTestId(`palette-check-${key}`)).toBeNull();
    }

    // The badge moves with the ring, before the palette is applied.
    fireEvent.press(radio('Orman'));
    expect(
      within(screen.getByTestId('palette-preview-orman')).getByTestId('palette-check-orman'),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('palette-check-gece-mavisi')).toBeNull();
  });

  it('the name row holds only the name, which shrinks to fit instead of being cut', () => {
    renderWithProviders(<PalettePicker />);
    for (const key of PALETTE_KEYS) {
      const row = screen.getByTestId(`palette-name-row-${key}`);
      expect(within(row).UNSAFE_queryAllByType(Icon)).toHaveLength(0);
      expect(flatStyle(row).marginTop).toBe(4);
      expect(screen.getByTestId(`palette-name-${key}`).props).toMatchObject({
        numberOfLines: 1,
        adjustsFontSizeToFit: true,
        minimumFontScale: 0.85,
        maxFontSizeMultiplier: 1.3,
      });
    }
    expect(flatStyle(screen.getByTestId('palette-name-gece-mavisi')).color).toBe(themes['gece-mavisi'].text);
    expect(flatStyle(screen.getByTestId('palette-name-orman')).color).toBe(themes['gece-mavisi'].text2);
  });

  it('keeps face padding 8 and a 2dp ring in both states, so a pick never moves the content', () => {
    renderWithProviders(<PalettePicker />);
    const T = themes['gece-mavisi'];
    const selected = flatStyle(screen.getByTestId('palette-option-gece-mavisi-face'));
    const idle = flatStyle(screen.getByTestId('palette-option-kitaplik-face'));
    expect(selected).toMatchObject({ padding: 8, borderWidth: 2, borderColor: T.action, borderRadius: 16 });
    expect(idle).toMatchObject({ padding: 8, borderWidth: 2, borderColor: 'transparent', borderRadius: 16 });
    expect(flatStyle(screen.getByTestId('palette-preview-kitaplik'))).toMatchObject({
      height: 44,
      borderRadius: 12,
      padding: 4,
    });
    expect(flatStyle(screen.getByTestId('palette-picker-grid')).gap).toBe(8);
  });

  it('each swatch previews its own palette whatever the active one', () => {
    renderWithProviders(<PalettePicker />, { theme: 'erik' });
    expect(flatStyle(screen.getByTestId('palette-preview-kitaplik')).backgroundColor).toBe(themes.kitaplik.bg);
    expect(flatStyle(screen.getByTestId('palette-option-erik-face')).backgroundColor).toBe(themes.erik.surface2);
    expect(flatStyle(screen.getByTestId('palette-option-kitaplik-face')).backgroundColor).toBe(themes.erik.surface);
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<PalettePicker />);
    expect(screen.getByTestId('palette-picker')).toHaveProp('accessibilityLabel', 'Colour palette');
    expect(radio('Night blue')).toBeSelected();
    expect(screen.getByText('Your choice is kept on this device.')).toBeOnTheScreen();
  });
});
