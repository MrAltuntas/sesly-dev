/**
 * Playful design components: behaviour, the lip and press sink, and the
 * palette colours they resolve.
 */

import React from 'react';
import { Animated, Text } from 'react-native';
import { act, configure, fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { DURATION } from '../../theme/motion';
import {
  CircleButton,
  ProgressBar,
  SectionLabel,
  Spinner,
  Waveform,
  waveformBars,
  Avatar,
  BottomSheet,
  Button,
  Checkbox,
  Chip,
  ICON_NAMES,
  iconGlyph,
  Icon,
  LanguageCodes,
  ListRow,
  PictureCover,
  SegmentedControl,
  SnackbarHost,
  StateView,
  Switch,
  SwitchRow,
  TextField,
  SeslyMark,
  TopAppBar,
  TranslationBadge,
  buttonColors,
  CategoryTile,
  Card,
  IconButton,
  CoverCard,
  SectionHeader,
  Tactile,
  Tag,
  orderLanguageCodes,
  pickPlaceholderIndex,
  snackbar,
} from './index';
import { BRAND_MARK_SIZE } from './rows';
import { SMALL_MARK_MAX_SIZE } from './SeslyMark';

// Icons are decorative and hidden from accessibility; these tests look at them.
configure({ defaultIncludeHiddenElements: true });

const gece = themes['gece-mavisi'];
const kitaplik = themes.kitaplik;
const flat = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(5).filter(Boolean));

describe('Tactile: the lip and the press sink', () => {
  it('draws the face on its lip and reserves the lip below it', () => {
    renderWithProviders(
      <Tactile color="#111111" lipColor="#000000" lip={5} radius={20} onPress={jest.fn()} testID="t">
        <Text>Yüz</Text>
      </Tactile>,
    );
    expect(flat(screen.getByTestId('t'))).toMatchObject({ paddingBottom: 5 });
    expect(flat(screen.getByTestId('t-face'))).toMatchObject({ backgroundColor: '#111111', borderRadius: 20 });
    expect(flat(screen.getByTestId('t-lip'))).toMatchObject({ backgroundColor: '#000000', top: 5, borderRadius: 20 });
  });

  it('sinks onto the lip on the native driver while pressed and rises on release', () => {
    // The native driver moves the value off the JS thread; here it lands at once.
    const timing = jest.spyOn(Animated, 'timing').mockImplementation(((value: Animated.Value, config: { toValue: number }) => ({
      start: (done?: (r: { finished: boolean }) => void) => {
        value.setValue(config.toValue);
        done?.({ finished: true });
      },
      stop: () => undefined,
      reset: () => undefined,
    })) as unknown as typeof Animated.timing);
    renderWithProviders(
      <Tactile color="#111111" lipColor="#000000" lip={4} onPress={jest.fn()} testID="t" />,
    );
    fireEvent(screen.getByTestId('t'), 'pressIn');
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 1, duration: DURATION.pressIn, useNativeDriver: true }),
    );
    act(() => jest.advanceTimersByTime(DURATION.pressOut + 50));
    // Fully pressed, the face moved down by exactly the lip.
    expect(flat(screen.getByTestId('t-face')).transform).toEqual([{ translateY: 4 }]);
    fireEvent(screen.getByTestId('t'), 'pressOut');
    expect(timing).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({ toValue: 0 }));
    act(() => jest.advanceTimersByTime(DURATION.pressOut + 50));
    expect(flat(screen.getByTestId('t-face')).transform).toEqual([{ translateY: 0 }]);
  });

  it('a disabled surface does not sink and is dimmed; a static one is not a button', () => {
    const timing = jest.spyOn(Animated, 'timing');
    const view = renderWithProviders(
      <Tactile color="#111111" lipColor="#000000" onPress={jest.fn()} disabled testID="t" />,
    );
    fireEvent(screen.getByTestId('t'), 'pressIn');
    expect(timing).not.toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ toValue: 1 }));
    expect(flat(screen.getByTestId('t')).opacity).toBe(0.5);
    view.unmount();
    renderWithProviders(<Tactile color="#111111" lipColor="#000000" testID="s" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Button', () => {
  it('maps each variant to its palette colours', () => {
    expect(buttonColors(gece, 'primary')).toEqual({
      background: gece.action,
      label: gece.onAction,
      lip: gece.actionLip,
    });
    expect(buttonColors(kitaplik, 'primary').background).toBe('#FF7A52');
    expect(buttonColors(gece, 'secondary')).toEqual({ background: gece.surface, label: gece.text, lip: gece.lip });
    expect(buttonColors(gece, 'secondary', 'danger').label).toBe(gece.error);
    expect(buttonColors(gece, 'primary', 'danger').background).toBe(gece.error);
    // Opaque: a translucent ghost face showed the lip through it.
    expect(buttonColors(gece, 'ghost', 'default', 'surface2', { parentColor: gece.ownB }).background).toMatch(/^#[0-9A-F]{6}$/);
    expect(buttonColors(gece, 'text')).toMatchObject({ background: 'transparent', label: gece.text });
  });

  it('a primary button is the action colour on the action lip', () => {
    renderWithProviders(<Button label="Dinle" testID="b" />, { theme: 'erik' });
    expect(flat(screen.getByTestId('b-face')).backgroundColor).toBe(themes.erik.action);
    expect(flat(screen.getByTestId('b-lip')).backgroundColor).toBe(themes.erik.actionLip);
    expect(flat(screen.getByText('Dinle')).color).toBe(themes.erik.onAction);
  });

  it('fires onPress and exposes its label', () => {
    const onPress = jest.fn();
    renderWithProviders(<Button label="Dinle" icon="play" onPress={onPress} />);
    fireEvent.press(screen.getByRole('button', { name: 'Dinle' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('icon-play')).toBeTruthy();
  });

  it('does nothing while disabled or loading', () => {
    const onPress = jest.fn();
    renderWithProviders(
      <>
        <Button label="Kapalı" disabled onPress={onPress} />
        <Button label="Bekle" loading onPress={onPress} />
      </>,
    );
    fireEvent.press(screen.getByText('Kapalı'));
    fireEvent.press(screen.getByText('Bekle'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Kapalı' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Bekle' }).props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    });
  });

  it('a 36dp button on its 2dp lip still offers a 48dp touch target', () => {
    renderWithProviders(<Button label="Küçük" size="sm" />);
    expect(screen.getByRole('button', { name: 'Küçük' }).props.hitSlop).toEqual({ top: 5, bottom: 5 });
  });

  it('a text button has no fill and still answers the finger', () => {
    const onPress = jest.fn();
    renderWithProviders(<Button label="Hazır anlatıcıyla başla" variant="text" onPress={onPress} />);
    fireEvent.press(screen.getByRole('button', { name: 'Hazır anlatıcıyla başla' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('Chip', () => {
  it('a choice chip reports selection; the selected one is the action colour', () => {
    const onPress = jest.fn();
    renderWithProviders(
      <>
        <Chip label="Türkçe" selected onPress={onPress} testID="on" />
        <Chip label="English" onPress={onPress} testID="off" />
      </>,
    );
    expect(screen.getByRole('radio', { name: 'Türkçe' })).toBeSelected();
    expect(screen.getByRole('radio', { name: 'English' })).not.toBeSelected();
    expect(flat(screen.getByTestId('on-face')).backgroundColor).toBe(gece.action);
    expect(flat(screen.getByTestId('on-lip')).backgroundColor).toBe(gece.actionLip);
    expect(flat(screen.getByText('Türkçe')).color).toBe(gece.onAction);
    expect(flat(screen.getByTestId('off-face')).backgroundColor).toBe(gece.line);
    expect(flat(screen.getByTestId('off-lip')).backgroundColor).toBe(gece.lineLip);
    fireEvent.press(screen.getByText('English'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a filter chip is a button with a caret', () => {
    renderWithProviders(<Chip kind="filter" label="Düzey: A1, A2" selected />);
    expect(screen.getByRole('button', { name: 'Düzey: A1, A2' })).toBeTruthy();
    expect(screen.getByTestId('icon-caret')).toBeTruthy();
    expect(screen.queryByTestId('icon-check')).toBeNull();
  });

  it('a chip of a multi-select group announces itself as a checkbox', () => {
    renderWithProviders(
      <>
        <Chip label="A1" role="checkbox" selected onPress={jest.fn()} />
        <Chip label="A2" role="checkbox" onPress={jest.fn()} />
      </>,
    );
    expect(screen.getByRole('checkbox', { name: 'A1' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'A2' })).not.toBeChecked();
  });

  it('a square chip holds a short value, a leading node sits before the label', () => {
    renderWithProviders(
      <Chip label="Türkçe" square leading={<Text>TR</Text>} testID="c" />,
    );
    expect(flat(screen.getByTestId('c-face'))).toMatchObject({ minWidth: 36 });
    expect(screen.getByText('TR')).toBeTruthy();
  });
});

describe('Tag', () => {
  it.each([
    ['dim', 'surface', 'text2'],
    ['ok', 'chipOkBg', 'chipOkFg'],
    ['act', 'chipActBg', 'chipActFg'],
    ['glass', 'glass', 'text'],
  ] as const)('the %s tone', (tone, bg, fg) => {
    renderWithProviders(<Tag label="Hazır" tone={tone} testID="tag" />);
    expect(flat(screen.getByTestId('tag')).backgroundColor).toBe(gece[bg]);
    expect(flat(screen.getByText('Hazır')).color).toBe(gece[fg]);
  });

  it('a category tag carries dark text on its colour', () => {
    renderWithProviders(<Tag label="Dünya klasikleri" color={gece.catDunya} testID="tag" />);
    expect(flat(screen.getByTestId('tag')).backgroundColor).toBe(gece.catDunya);
    expect(flat(screen.getByText('Dünya klasikleri')).color).toBe(gece.onCat);
  });
});

describe('Card and CategoryTile', () => {
  it('a card is the surface on its lip; selected it is raised and ringed in the action colour', () => {
    const view = renderWithProviders(<Card testID="card"><Text>İçerik</Text></Card>);
    expect(flat(screen.getByTestId('card-face')).backgroundColor).toBe(gece.surface);
    expect(flat(screen.getByTestId('card-lip')).backgroundColor).toBe(gece.lip);
    view.unmount();
    renderWithProviders(<Card selected onPress={jest.fn()} testID="card" />);
    expect(flat(screen.getByTestId('card-face'))).toMatchObject({ backgroundColor: gece.surface2, borderColor: gece.action });
  });

  it.each(['gece-mavisi', 'orijinal', 'kitaplik'] as const)('a %s category tile is filled with the category colour', key => {
    const T = themes[key];
    renderWithProviders(
      <CategoryTile category="BEDTIME" label="Uyku masalları" onPress={jest.fn()} testID="tile" />,
      { theme: key },
    );
    expect(flat(screen.getByTestId('tile-face')).backgroundColor).toBe(T.catUyku);
    expect(flat(screen.getByTestId('tile-lip')).backgroundColor).toBe(T.catUykuLip);
    expect(flat(screen.getByText('Uyku masalları')).color).toBe(T.onCat);
    expect(screen.getByTestId('icon-moon')).toBeTruthy();
  });

  it('in murekkep the tile is a neutral card with a coloured icon', () => {
    const T = themes.murekkep;
    renderWithProviders(
      <CategoryTile category="TURKISH_CLASSICS" label="Türk klasikleri" testID="tile" />,
      { theme: 'murekkep' },
    );
    expect(flat(screen.getByTestId('tile-face')).backgroundColor).toBe(T.surface);
    expect(flat(screen.getByText('Türk klasikleri')).color).toBe(T.text);
    expect(screen.getByTestId('icon-rose')).toBeTruthy();
  });
});

describe('SegmentedControl', () => {
  const segments = [
    { value: 'tr', label: 'Türkçe' },
    { value: 'en', label: 'English' },
    { value: 'de', label: 'Deutsch' },
  ] as const;

  it('marks the selected segment and reports a change', () => {
    const onChange = jest.fn();
    renderWithProviders(
      <SegmentedControl segments={segments} value="de" onChange={onChange} accessibilityLabel="Dil" />,
    );
    expect(screen.getByRole('radio', { name: 'Deutsch' })).toBeSelected();
    expect(screen.getByRole('radio', { name: 'Türkçe' })).not.toBeSelected();
    fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    // The change reaches the caller in the next frame (controls.test.tsx).
    act(() => jest.runOnlyPendingTimers());
    expect(onChange).toHaveBeenCalledWith('en');
  });

  it('tapping the selected segment does not fire', () => {
    const onChange = jest.fn();
    renderWithProviders(<SegmentedControl compact segments={segments} value="de" onChange={onChange} />);
    fireEvent.press(screen.getByRole('radio', { name: 'Deutsch' }));
    act(() => jest.runOnlyPendingTimers());
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Switch and SwitchRow', () => {
  it('toggles to the opposite value', () => {
    const onValueChange = jest.fn();
    renderWithProviders(<Switch value={false} onValueChange={onValueChange} accessibilityLabel="Uyku zamanlayıcısı" />);
    const control = screen.getByRole('switch', { name: 'Uyku zamanlayıcısı' });
    expect(control).not.toBeChecked();
    fireEvent.press(control);
    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  it('the whole row toggles and reads label and detail together', () => {
    const onValueChange = jest.fn();
    renderWithProviders(
      <SwitchRow
        label="Bütün masallarda bu hızı kullan"
        detail="Kapalıyken yalnızca bu masalda geçerli"
        value
        onValueChange={onValueChange}
      />,
    );
    const row = screen.getByRole('switch');
    expect(row).toBeChecked();
    expect(row.props.accessibilityLabel).toBe(
      'Bütün masallarda bu hızı kullan. Kapalıyken yalnızca bu masalda geçerli',
    );
    fireEvent.press(screen.getByText('Bütün masallarda bu hızı kullan'));
    expect(onValueChange).toHaveBeenCalledWith(false);
  });

  it('a disabled row ignores presses', () => {
    const onValueChange = jest.fn();
    renderWithProviders(<SwitchRow label="Kapalı satır" value={false} disabled onValueChange={onValueChange} />);
    fireEvent.press(screen.getByText('Kapalı satır'));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe('Checkbox', () => {
  it('reports its state and toggles', () => {
    const onToggle = jest.fn();
    const { rerender } = renderWithProviders(
      <Checkbox checked={false} onToggle={onToggle} accessibilityLabel="Kabul ediyorum" />,
    );
    const box = screen.getByRole('checkbox', { name: 'Kabul ediyorum' });
    expect(box).not.toBeChecked();
    expect(screen.queryByTestId('icon-check')).toBeNull();
    fireEvent.press(box);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<Checkbox checked onToggle={onToggle} accessibilityLabel="Kabul ediyorum" />);
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByTestId('icon-check')).toBeTruthy();
  });
});

describe('ListRow', () => {
  it('a pressable row opens and reads title, subtitle and value', () => {
    const onPress = jest.fn();
    renderWithProviders(
      <ListRow icon="bell" title="Bildirimler" subtitle="Masal ve ses" value="2 yeni" chevron onPress={onPress} />,
    );
    const row = screen.getByRole('button');
    expect(row.props.accessibilityLabel).toBe('Bildirimler, Masal ve ses, 2 yeni');
    fireEvent.press(row);
    expect(onPress).toHaveBeenCalled();
    expect(screen.getByTestId('icon-bell')).toBeTruthy();
    expect(screen.getByTestId('icon-chevronRight')).toBeTruthy();
  });

  it('a static row holds a trailing control and is not a button', () => {
    renderWithProviders(
      <ListRow title="Tema" leading={<Text>L</Text>} trailing={<Text>Sağ</Text>} tone="danger" />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Sağ')).toBeTruthy();
    expect(screen.getByText('L')).toBeTruthy();
  });
});

describe('TopAppBar and Avatar', () => {
  it('the brand bar shows the wordmark and the trailing avatar', () => {
    const onPress = jest.fn();
    renderWithProviders(
      <TopAppBar variant="brand" trailing={<Avatar initial="Z" onPress={onPress} accessibilityLabel="Profil" />} />,
    );
    expect(screen.getByText('sesly')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Profil' }));
    expect(onPress).toHaveBeenCalled();
  });

  it('the brand bar puts the app mark to the left of the wordmark, 30dp and decorative', () => {
    renderWithProviders(<TopAppBar variant="brand" />);
    const mark = screen.getByTestId('appbar-mark');
    const style = Object.assign({}, ...[mark.props.style].flat(3));
    expect(BRAND_MARK_SIZE).toBe(30);
    expect(style).toMatchObject({ width: 30, height: 30 });
    // The word next to it is the name: the mark is not announced.
    expect(mark.props.accessible).toBe(false);
    expect(mark.props.accessibilityLabel).toBeUndefined();
    expect(screen.getByRole('header', { name: 'sesly' })).toBeTruthy();

    // Mark first, wordmark second, in one centred row.
    const rowStyle = Object.assign({}, ...[screen.getByTestId('appbar-brand').props.style].flat(3));
    expect(rowStyle).toMatchObject({ flexDirection: 'row', alignItems: 'center' });
  });

  it('SeslyMark uses the density-matched small bitmap up to 32dp and the master above', () => {
    const small = renderWithProviders(<SeslyMark size={28} testID="mark" />);
    // A small mark is a frame holding the vector under the bitmap.
    const smallSource = screen.getByTestId('mark-bitmap').props.source;
    expect(smallSource).toBeDefined();
    expect(screen.getByTestId('mark').props.accessibilityLabel).toBe('Sesly');
    small.unmount();
    renderWithProviders(<SeslyMark size={44} testID="mark" />);
    const largeSource = screen.getByTestId('mark').props.source;
    expect(largeSource).toBeDefined();
    expect(screen.queryByTestId('mark-bitmap')).toBeNull();
    expect(SMALL_MARK_MAX_SIZE).toBe(32);
    expect(largeSource).not.toEqual(smallSource);
  });

  it('the tab bar shows a Baloo 2 32 title', () => {
    renderWithProviders(<TopAppBar variant="tab" title="Kütüphane" />);
    expect(screen.getByRole('header', { name: 'Kütüphane' })).toBeTruthy();
    expect(flat(screen.getByText('Kütüphane'))).toMatchObject({ fontFamily: 'Baloo2-SemiBold', fontSize: 32 });
  });

  it('the back bar goes back and translates its label', async () => {
    const onBack = jest.fn();
    const { rerender } = renderWithProviders(<TopAppBar title="Ses kaydı" onBack={onBack} />);
    fireEvent.press(screen.getByRole('button', { name: 'Geri' }));
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByText('Ses kaydı')).toBeTruthy();

    await act(async () => {
      await i18n.changeLanguage('en');
    });
    rerender(<TopAppBar onBack={onBack} noInset />);
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });

  it('a plain avatar is not pressable', () => {
    renderWithProviders(<Avatar initial="D" size={40} />);
    expect(screen.getByText('D')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('TextField', () => {
  it('shows label and helper, and replaces the helper with an error', () => {
    const { rerender } = renderWithProviders(
      <TextField label="Şifre" helper="En az 6 karakter" value="" onChangeText={() => {}} />,
    );
    expect(screen.getByText('Şifre')).toBeTruthy();
    expect(screen.getByText('En az 6 karakter')).toBeTruthy();

    rerender(<TextField label="Şifre" helper="En az 6 karakter" error="Şifreni gir" value="" onChangeText={() => {}} />);
    expect(screen.getByText('Şifreni gir')).toBeTruthy();
    expect(screen.queryByText('En az 6 karakter')).toBeNull();
  });

  it('a secure field is masked until the toggle is pressed', () => {
    renderWithProviders(<TextField label="Şifre" secure value="gizli" onChangeText={() => {}} testID="pw" />);
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: 'Şifreyi göster' }));
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(false);
    fireEvent.press(screen.getByRole('button', { name: 'Şifreyi gizle' }));
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(true);
  });

  it('forwards typing', () => {
    const onChangeText = jest.fn();
    renderWithProviders(<TextField label="E-posta" value="" onChangeText={onChangeText} testID="mail" />);
    fireEvent.changeText(screen.getByTestId('mail'), 'a@b.co');
    expect(onChangeText).toHaveBeenCalledWith('a@b.co');
  });
});

describe('StateView', () => {
  it('shows one icon, title, sentence and action', () => {
    const onAction = jest.fn();
    renderWithProviders(
      <StateView
        icon="wifiOff"
        title="İnternete bağlı değilsin"
        message="Masalları açmak için bağlantı gerekiyor."
        actionLabel="Tekrar dene"
        onAction={onAction}
      />,
    );
    expect(screen.getByTestId('icon-wifiOff')).toBeTruthy();
    expect(screen.getByText('İnternete bağlı değilsin')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(onAction).toHaveBeenCalled();
  });

  it('renders without icon, message or action', () => {
    renderWithProviders(<StateView title="Bildirim yok" />);
    expect(screen.getByText('Bildirim yok')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('BottomSheet', () => {
  it('shows title, header control and content, and closes on the scrim', () => {
    const onClose = jest.fn();
    renderWithProviders(
      <BottomSheet visible onClose={onClose} title="Oynatma hızı" headerTrailing={<Text>Sağ</Text>}>
        <Text>İçerik</Text>
      </BottomSheet>,
    );
    expect(screen.getByRole('header', { name: 'Oynatma hızı' })).toBeTruthy();
    expect(screen.getByText('Sağ')).toBeTruthy();
    expect(screen.getByText('İçerik')).toBeTruthy();
    fireEvent.press(screen.getByTestId('sheet-scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while hidden', () => {
    renderWithProviders(
      <BottomSheet visible={false} onClose={() => {}}>
        <Text>Gizli</Text>
      </BottomSheet>,
    );
    expect(screen.queryByText('Gizli')).toBeNull();
  });
});

describe('Snackbar', () => {
  afterEach(() => {
    act(() => {
      snackbar.dismiss();
      snackbar.setBottomInset(0);
    });
  });

  it('shows a message and hides it after its duration', () => {
    renderWithProviders(<SnackbarHost />);
    expect(screen.queryByTestId('snackbar')).toBeNull();

    act(() => {
      snackbar.show({ message: 'Masal kaydedildi' });
    });
    expect(screen.getByText('Masal kaydedildi')).toBeTruthy();
    expect(screen.queryByTestId('snackbar-action')).toBeNull();

    act(() => {
      jest.advanceTimersByTime(3999);
    });
    expect(screen.getByText('Masal kaydedildi')).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(2);
    });
    // It leaves in DURATION.exit, then unmounts (Snackbar.test.tsx).
    act(() => {
      jest.advanceTimersByTime(DURATION.exit + 50);
    });
    expect(screen.queryByText('Masal kaydedildi')).toBeNull();
  });

  it('runs the action once and dismisses', () => {
    const onAction = jest.fn();
    renderWithProviders(<SnackbarHost />);
    act(() => {
      snackbar.show({ message: 'Parmak Kız kaydedildi', actionLabel: 'Göster', onAction });
    });
    expect(snackbar.getState().current?.duration).toBe(6000);
    fireEvent.press(screen.getByRole('button', { name: 'Göster' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(DURATION.exit + 50);
    });
    expect(screen.queryByTestId('snackbar')).toBeNull();
  });

  it('a new snackbar replaces the current one and ignores blank messages', () => {
    renderWithProviders(<SnackbarHost />);
    act(() => {
      snackbar.show({ message: 'Birinci' });
      snackbar.show({ message: 'İkinci', duration: 1000 });
    });
    expect(screen.queryByText('Birinci')).toBeNull();
    expect(screen.getByText('İkinci')).toBeTruthy();
    let id = 0;
    act(() => {
      id = snackbar.show({ message: '   ' });
    });
    expect(id).toBe(-1);
    expect(screen.getByText('İkinci')).toBeTruthy();
  });

  it('dismiss(id) only removes the snackbar it names', () => {
    renderWithProviders(<SnackbarHost />);
    let first = 0;
    act(() => {
      first = snackbar.show({ message: 'Eski' });
      snackbar.show({ message: 'Yeni' });
      snackbar.dismiss(first);
    });
    expect(screen.getByText('Yeni')).toBeTruthy();
  });

  it('sits above the bottom chrome the shell reports', () => {
    renderWithProviders(<SnackbarHost />);
    act(() => {
      snackbar.setBottomInset(144);
      snackbar.show({ message: 'Üstte' });
    });
    const host = screen.getByTestId('snackbar-host');
    const flat = Object.assign({}, ...[host.props.style].flat(3).filter(Boolean));
    expect(flat.bottom).toBe(152);
  });
});

describe('PictureCover and CoverCard', () => {
  const story = { id: 'story-1', category: 'BEDTIME' };

  it('an upright cover is a 2:3 rounded card on its lip with the cover ring', () => {
    renderWithProviders(<PictureCover story={story} title="Uykulu Ay" width={100} testID="cv" />);
    expect(flat(screen.getByTestId('cv'))).toMatchObject({ width: 100, height: 153 });
    expect(flat(screen.getByTestId('cv-lip'))).toMatchObject({ backgroundColor: gece.lip, borderRadius: 20, height: 150 });
    expect(flat(screen.getByTestId('cover-ring'))).toMatchObject({ borderColor: gece.coverRing, borderWidth: 1 });
    expect(screen.getByLabelText('Uykulu Ay kapağı')).toBeTruthy();
    // No title on the picture.
    expect(screen.queryByText('Uykulu Ay')).toBeNull();
    expect(screen.getByTestId(`cover-placeholder-${pickPlaceholderIndex('story-1') + 1}`)).toBeTruthy();
  });

  it('carries the duration chip and the level badge', () => {
    renderWithProviders(<PictureCover story={story} width={96} durationLabel="5 dk" levelLabel="A2" />);
    expect(flat(screen.getByTestId('cover-duration')).backgroundColor).toBe(gece.glass);
    expect(flat(screen.getByTestId('cover-level')).backgroundColor).toBe(gece.badge);
    expect(flat(screen.getByText('A2')).color).toBe(gece.onBadge);
    expect(screen.getByText('5 dk')).toBeTruthy();
  });

  it('a flat square has no lip and no ring', () => {
    renderWithProviders(<PictureCover story={story} width={44} shape="square" flat testID="sq" />);
    expect(flat(screen.getByTestId('sq'))).toMatchObject({ width: 44, height: 44 });
    expect(screen.queryByTestId('sq-lip')).toBeNull();
    expect(screen.queryByTestId('cover-ring')).toBeNull();
  });

  it('shows the story image when there is one and falls back when it fails', () => {
    renderWithProviders(
      <PictureCover story={{ id: 'x', coverImageUrl: 'https://cdn/x.jpg?sig=1' }} width={100} />,
    );
    const remote = screen.getByTestId('cover-remote');
    expect(remote.props.source).toMatchObject({ uri: 'https://cdn/x.jpg?sig=1', cacheKey: 'https://cdn/x.jpg' });
    act(() => remote.props.onError());
    expect(screen.queryByTestId('cover-remote')).toBeNull();
  });

  it('a cover card puts the title and meta under the cover and opens on press', () => {
    const onPress = jest.fn();
    renderWithProviders(
      <CoverCard story={story} title="Uykulu Ay" width={100} onPress={onPress} testID="card">
        <Text>5 dk</Text>
      </CoverCard>,
    );
    expect(screen.getByText('Uykulu Ay')).toBeTruthy();
    expect(screen.getByTestId('card-meta')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Uykulu Ay' }));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('LanguageCodes', () => {
  it('orders codes with the shown language first and removes duplicates', () => {
    expect(orderLanguageCodes(['en', 'tr', 'de'], 'tr')).toEqual(['TR', 'EN', 'DE']);
    expect(orderLanguageCodes(['tr', 'TR', 'en-GB', ''], null)).toEqual(['TR', 'EN']);
    expect(orderLanguageCodes([], 'it')).toEqual(['IT']);
    expect(orderLanguageCodes([], undefined)).toEqual([]);
  });

  it('renders the codes and reads them as one label', () => {
    renderWithProviders(<LanguageCodes codes={['tr', 'en', 'de']} shown="en" />);
    expect(screen.getByText('EN')).toBeTruthy();
    expect(screen.getByText('TR')).toBeTruthy();
    expect(screen.getByLabelText('Diller: EN, TR, DE')).toBeTruthy();
  });

  it('renders nothing without codes, and supports the filled variant', () => {
    const { rerender } = renderWithProviders(<LanguageCodes codes={[]} />);
    expect(screen.queryByText(/[A-Z]{2}/)).toBeNull();
    rerender(<LanguageCodes codes={['en']} variant="own" />);
    expect(screen.getByText('EN')).toBeTruthy();
  });
});

describe('TranslationBadge', () => {
  it('labels human and machine translations in the UI language', async () => {
    const { rerender } = renderWithProviders(
      <>
        <TranslationBadge kind="human" />
        <TranslationBadge kind="machine" size="lg" />
      </>,
    );
    expect(screen.getByText('Çeviri')).toBeTruthy();
    expect(screen.getByText('Yapay zekâ ile çevrildi')).toBeTruthy();

    await act(async () => {
      await i18n.changeLanguage('en');
    });
    rerender(<TranslationBadge kind="machine" />);
    expect(screen.getByText('Translated with AI')).toBeTruthy();
  });

  it('the icon-only form keeps the label for screen readers', () => {
    renderWithProviders(<TranslationBadge kind="human" iconOnly />);
    expect(screen.queryByText('Çeviri')).toBeNull();
    expect(screen.getByLabelText('Çeviri')).toBeTruthy();
  });
});

// MiniPlayerBar has its own suite (MiniPlayerBar.test.tsx).

describe('Icon', () => {
  it('every icon is an Ionicons glyph and renders in a box of its size', () => {
    const glyphs = require('@expo/vector-icons/Ionicons').default.glyphMap as Record<string, number>;
    expect(ICON_NAMES.length).toBeGreaterThan(20);
    for (const name of ICON_NAMES) {
      expect(glyphs[iconGlyph(name)]).toBeDefined();
      expect(glyphs[iconGlyph(name, true)]).toBeDefined();
      const view = renderWithProviders(<Icon name={name} color="#123456" size={20} />);
      expect(flat(screen.getByTestId(`icon-${name}`))).toMatchObject({ width: 20, height: 20 });
      view.unmount();
    }
  });

  it('outline by default, the filled twin on request', () => {
    expect(iconGlyph('book')).toBe('book-outline');
    expect(iconGlyph('book', true)).toBe('book');
    expect(iconGlyph('heart')).toBe('heart-outline');
    expect(iconGlyph('heartOn')).toBe('heart');
  });

  it('the skip icons carry the number', () => {
    renderWithProviders(<Icon name="back15" color="#123456" />);
    expect(screen.getByText('15')).toBeTruthy();
  });
});

describe('feedback pieces', () => {
  const flatten = (style: unknown) => Object.assign({}, ...[style].flat(4).filter(Boolean));

  it('waveformBars is deterministic per seed and stays in range', () => {
    expect(waveformBars(40, 3)).toEqual(waveformBars(40, 3));
    expect(waveformBars(40, 3)).not.toEqual(waveformBars(40, 4));
    waveformBars(60, 0).forEach(h => {
      expect(h).toBeGreaterThanOrEqual(0.18);
      expect(h).toBeLessThanOrEqual(1);
    });
  });

  it('Waveform colours the played bars', () => {
    renderWithProviders(<Waveform bars={10} progress={0.5} testID="wave" playedColor="#111111" color="#222222" />);
    const bars = (screen.getByTestId('wave') as any).children;
    expect(bars).toHaveLength(10);
    expect(flatten(bars[4].props.style).backgroundColor).toBe('#111111');
    expect(flatten(bars[5].props.style).backgroundColor).toBe('#222222');
  });

  it('ProgressBar reports its value, and has an indeterminate form', () => {
    renderWithProviders(<ProgressBar value={0.45} testID="bar" accessibilityLabel="Seslendiriliyor" />);
    expect(screen.getByTestId('bar').props.accessibilityValue).toEqual({ min: 0, max: 100, now: 45 });
    expect(flatten(screen.getByTestId('bar-fill').props.style).width).toBe('45%');
    renderWithProviders(<ProgressBar testID="busy" />);
    expect(screen.getByTestId('busy').props.accessibilityValue).toBeUndefined();
    expect(screen.queryByTestId('busy-fill')).toBeNull();
  });

  it('ProgressBar follows an animated value with a transform once it knows its width', () => {
    const progress = new Animated.Value(0.4);
    renderWithProviders(<ProgressBar progress={progress} testID="live" />);
    // Nothing is drawn before the track is measured (a full bar would flash).
    expect(screen.queryByTestId('live-fill')).toBeNull();
    expect(screen.getByTestId('live').props.accessibilityValue).toBeUndefined();

    fireEvent(screen.getByTestId('live'), 'layout', {
      nativeEvent: { layout: { width: 50, height: 4, x: 0, y: 0 } },
    });
    const fill = flatten(screen.getByTestId('live-fill').props.style);
    expect(fill.width).toBe(50);
    expect(fill.transform).toEqual([{ translateX: -30 }]);

    // Out of range values are clamped to the track.
    act(() => progress.setValue(1.4));
    expect(flatten(screen.getByTestId('live-fill').props.style).transform).toEqual([{ translateX: 0 }]);
  });

  it('CircleButton presses, and not while busy or disabled', () => {
    const onPress = jest.fn();
    const view = renderWithProviders(
      <CircleButton icon="play" accessibilityLabel="Oynat" onPress={onPress} testID="circle" />,
    );
    fireEvent.press(screen.getByTestId('circle'));
    expect(onPress).toHaveBeenCalledTimes(1);
    view.rerender(<CircleButton icon="play" accessibilityLabel="Oynat" onPress={onPress} busy variant="action" testID="circle" />);
    fireEvent.press(screen.getByTestId('circle'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('spinner-indicator')).toBeTruthy();
  });

  it('SectionLabel is a Baloo 2 heading, never uppercased; Spinner renders', () => {
    renderWithProviders(
      <>
        <SectionLabel>Senin sesin</SectionLabel>
        <Spinner testID="spin" />
      </>,
    );
    expect(screen.getByRole('header', { name: 'Senin sesin' })).toBeTruthy();
    expect(flat(screen.getByText('Senin sesin')).fontFamily).toBe('Baloo2-SemiBold');
    expect(screen.getByTestId('spin')).toBeTruthy();
  });

  it('SectionHeader shows a category dot and a "Tümü" link', () => {
    const onLink = jest.fn();
    renderWithProviders(
      <SectionHeader title="Türk klasikleri" dotColor={gece.catTurk} linkLabel="Tümü" onLinkPress={onLink} testID="sec" />,
    );
    expect(flat(screen.getByTestId('sec-dot')).backgroundColor).toBe(gece.catTurk);
    fireEvent.press(screen.getByRole('button', { name: 'Tümü' }));
    expect(onLink).toHaveBeenCalled();
  });

  it('the SectionHeader link can say which shelf it opens', () => {
    renderWithProviders(
      <SectionHeader
        title="Türk klasikleri"
        linkLabel="Tümü"
        linkAccessibilityLabel="Türk klasikleri, tümünü gör"
        onLinkPress={jest.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Türk klasikleri, tümünü gör' })).toBeTruthy();
    expect(screen.getByText('Tümü')).toBeTruthy();
  });

  it('CircleButton faces: neutral surface-2, surface (on a surface-2 row), action', () => {
    const view = renderWithProviders(<CircleButton icon="play" accessibilityLabel="a" testID="c" />);
    expect(flat(screen.getByTestId('c-face')).backgroundColor).toBe(gece.surface2);
    view.rerender(<CircleButton icon="play" variant="surface" accessibilityLabel="a" testID="c" />);
    expect(flat(screen.getByTestId('c-face')).backgroundColor).toBe(gece.surface);
    view.rerender(<CircleButton icon="pause" variant="action" accessibilityLabel="a" testID="c" />);
    expect(flat(screen.getByTestId('c-face')).backgroundColor).toBe(gece.action);
    expect(flat(screen.getByTestId('c-lip')).backgroundColor).toBe(gece.actionLip);
  });

  it('a glass icon button has an opaque face, so its lip never shows through', () => {
    renderWithProviders(<IconButton variant="glass" icon="more" accessibilityLabel="Daha fazla" testID="g" />);
    expect(flat(screen.getByTestId('g-face')).backgroundColor).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('BottomSheet messages', () => {
  it('shows a snackbar inside the sheet, whose Modal window covers the app-level one', () => {
    renderWithProviders(
      <BottomSheet visible onClose={jest.fn()} title="Anlatıcı">
        <Text>icerik</Text>
      </BottomSheet>,
    );
    expect(screen.queryByTestId('sheet-snackbar')).toBeNull();
    act(() => {
      snackbar.show({ message: 'Örnek çalınamadı.' });
    });
    expect(screen.getByTestId('sheet-snackbar')).toHaveTextContent('Örnek çalınamadı.');
    act(() => snackbar.dismiss());
    act(() => {
      jest.advanceTimersByTime(DURATION.exit + 50);
    });
    expect(screen.queryByTestId('sheet-snackbar')).toBeNull();
  });
});
