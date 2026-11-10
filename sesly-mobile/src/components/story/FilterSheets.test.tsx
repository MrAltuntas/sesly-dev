/**
 * The picker sheets of Keşfet: rows with a check, taps apply at once, a
 * single choice closes the sheet, a multi choice stays open.
 */

import React from 'react';
import { Animated } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { RADIUS, themes } from '../../theme/theme';
import { DURATION, PRESS_TINT } from '../../theme/motion';
import {
  LanguageFilterSheet,
  OptionSheet,
  SortSheet,
  filterChipLabel,
  sortLabel,
} from './FilterSheets';

const LANGUAGES = [
  { code: 'tr', nativeName: 'Türkçe' },
  { code: 'en', nativeName: 'English' },
];

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

describe('labels', () => {
  it('names the sort orders, the default one as "Önerilen"', async () => {
    expect(sortLabel(null)).toBe('Önerilen');
    expect(sortLabel('newest')).toBe('En yeni');
    expect(sortLabel('title')).toBe('Ada göre');
    await i18n.changeLanguage('en');
    expect(sortLabel(null)).toBe('Recommended');
    expect(sortLabel('duration')).toBe('Shortest');
  });

  it('builds the chip label from what is picked', () => {
    expect(filterChipLabel('Dil', [])).toBe('Dil');
    expect(filterChipLabel('Dil', ['Türkçe', 'English'])).toBe('Dil: Türkçe, English');
    expect(filterChipLabel('Seviye', ['A1', 'A2'])).toBe('Seviye: A1, A2');
  });
});

describe('OptionSheet', () => {
  it('renders nothing while hidden', () => {
    renderWithProviders(
      <OptionSheet
        visible={false}
        onClose={() => {}}
        title="Dil"
        options={[{ value: 'tr', label: 'Türkçe' }]}
        selected={[]}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByText('Türkçe')).toBeNull();
  });

  it('has a title and no apply or cancel button', () => {
    renderWithProviders(
      <OptionSheet
        visible
        onClose={() => {}}
        title="Dil"
        options={[{ value: 'tr', label: 'Türkçe' }]}
        selected={[]}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole('header', { name: 'Dil' })).toBeOnTheScreen();
    expect(screen.queryByText('Uygula')).toBeNull();
    expect(screen.queryByText('Vazgeç')).toBeNull();
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('draws the rows in the %s palette', theme => {
    renderWithProviders(
      <OptionSheet
        visible
        onClose={() => {}}
        title="Dil"
        options={[
          { value: 'tr', label: 'Türkçe' },
          { value: 'en', label: 'English' },
        ]}
        selected={['tr']}
        onSelect={() => {}}
        testID="sheet"
      />,
      { theme },
    );
    const T = themes[theme];
    expect(flatStyle(screen.getByText('Türkçe')).color).toBe(T.text);
    // A picked row is raised and carries its check in an action disc.
    const picked = screen.getByTestId('sheet-tr');
    const style = (node: { props: { style?: unknown } }) => {
      const value = node.props.style;
      const resolved = typeof value === 'function' ? value({ pressed: false }) : value;
      return Object.assign({}, ...[resolved].flat(4).filter(Boolean));
    };
    expect(style(picked).backgroundColor).toBe(T.surface2);
    expect(style(screen.getByTestId('sheet-en')).backgroundColor).toBeUndefined();
    expect(flatStyle(screen.getByTestId('sheet-tr-check')).backgroundColor).toBe(T.action);
    expect(screen.queryByTestId('sheet-en-check')).toBeNull();
  });
});

describe('OptionSheet press', () => {
  const renderRows = () =>
    renderWithProviders(
      <OptionSheet
        visible
        onClose={() => {}}
        title="Sırala"
        options={[
          { value: 'a', label: 'En yeni' },
          { value: 'b', label: 'En eski' },
        ]}
        selected={['a']}
        onSelect={() => {}}
        testID="sheet"
      />,
    );

  it('never moves a held row: it dims its label and check instead', () => {
    const timing = jest.spyOn(Animated, 'timing');
    renderRows();
    const row = screen.getByTestId('sheet-a');
    fireEvent(row, 'pressIn');
    expect(flatStyle(screen.getByTestId('sheet-a')).transform).toBeUndefined();
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: PRESS_TINT, duration: DURATION.pressIn, useNativeDriver: true }),
    );
    fireEvent(row, 'pressOut');
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 1, duration: DURATION.pressOut, useNativeDriver: true }),
    );
    // The dimming view holds the label and the check, not the row's fill.
    expect(flatStyle(screen.getByTestId('sheet-a-body')).opacity).toBeDefined();
    expect(flatStyle(screen.getByTestId('sheet-a')).opacity).toBeUndefined();
  });

  it('keeps a picked row inside the sheet gutter with a 16dp corner', () => {
    renderRows();
    expect(flatStyle(screen.getByTestId('sheet-a'))).toMatchObject({ borderRadius: RADIUS.md, paddingHorizontal: 16 });
    // The rows sit in the sheet's own gutter: the nearest padded box
    // around them is the sheet content at the screen edge padding.
    type Node = { props: { style?: unknown }; parent: Node | null };
    let at = (screen.getByTestId('sheet-a') as unknown as Node).parent;
    while (at && flatStyle(at).paddingHorizontal === undefined) at = at.parent;
    expect(at && flatStyle(at).paddingHorizontal).toBe(themes['gece-mavisi'].screenPadH);
  });
});

describe('LanguageFilterSheet', () => {
  it('lists the languages in their own names, checks the picked ones and stays open', () => {
    const onToggle = jest.fn();
    const onClose = jest.fn();
    renderWithProviders(
      <LanguageFilterSheet
        visible
        onClose={onClose}
        languages={LANGUAGES}
        selected={['en']}
        onToggle={onToggle}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Türkçe' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'English' })).toBeChecked();
    expect(screen.getByTestId('language-sheet-en-check')).toBeOnTheScreen();
    expect(screen.queryByTestId('language-sheet-tr-check')).toBeNull();

    fireEvent.press(screen.getByRole('checkbox', { name: 'Türkçe' }));
    expect(onToggle).toHaveBeenCalledWith('tr');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('SortSheet', () => {
  it('offers the backend sort keys and the default order', () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    renderWithProviders(
      <SortSheet
        visible
        onClose={onClose}
        sorts={[null, 'newest', 'oldest', 'title', 'duration', 'level']}
        selected={null}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole('header', { name: 'Sırala' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Önerilen' })).toBeSelected();
    ['En yeni', 'En eski', 'Ada göre', 'En kısa', 'En kolay'].forEach(label =>
      expect(screen.getByRole('radio', { name: label })).toBeOnTheScreen(),
    );

    fireEvent.press(screen.getByRole('radio', { name: 'En kısa' }));
    expect(onSelect).toHaveBeenLastCalledWith('duration');
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByRole('radio', { name: 'Önerilen' }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});
