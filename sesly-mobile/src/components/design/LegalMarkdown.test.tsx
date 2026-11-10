/**
 * LegalMarkdown renders backend legal markdown as authored (the library's
 * default markdown-it has typographer ON, which turned plain quotes into
 * curly ones on device, a forbidden UI glyph), in the playful system:
 * Baloo 2 headings, Nunito body, cards for quotes and code, dot bullets.
 */

import React from 'react';
import { screen } from '@testing-library/react-native';

// Counts the parsers LegalMarkdown builds through the library's MarkdownIt. A
// plain counter: the global afterEach clears jest mock calls between tests.
const mockParserBuilds = { count: 0 };
jest.mock('react-native-markdown-display', () => {
  const actual = jest.requireActual('react-native-markdown-display');
  return {
    ...actual,
    __esModule: true,
    default: actual.default,
    MarkdownIt: (...args: unknown[]) => {
      mockParserBuilds.count += 1;
      return actual.MarkdownIt(...args);
    },
  };
});

import { renderWithProviders } from '../../test-utils/render-helpers';
import { themes } from '../../theme/theme';
import { LegalMarkdown, getLegalParser } from './LegalMarkdown';

// Read right after the imports ran: importing the module builds nothing.
const buildsAtImport = mockParserBuilds.count;

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

describe('LegalMarkdown', () => {
  // First in the file, so no render has happened yet.
  it('builds its parser on the first render, not at import, and only once', () => {
    expect(buildsAtImport).toBe(0);
    expect(mockParserBuilds.count).toBe(0);

    renderWithProviders(<LegalMarkdown markdown={'Birinci metin.'} />);
    expect(mockParserBuilds.count).toBe(1);

    renderWithProviders(<LegalMarkdown markdown={'İkinci metin.'} />);
    expect(screen.getByText('İkinci metin.')).toBeOnTheScreen();
    expect(mockParserBuilds.count).toBe(1);
    expect(getLegalParser()).toBe(getLegalParser());
    expect(mockParserBuilds.count).toBe(1);
  });

  it('keeps straight quotes and plain hyphens', () => {
    renderWithProviders(
      <LegalMarkdown markdown={'Sesly "masal" uygulamasının \'gizlilik\' metni -- sürüm 1.'} />,
      { theme: 'kitaplik' },
    );

    expect(
      screen.getByText('Sesly "masal" uygulamasının \'gizlilik\' metni -- sürüm 1.'),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/[“”‘’–—]/)).toBeNull();
  });

  it('uses a parser with the typographer disabled', () => {
    expect(getLegalParser().options.typographer).toBe(false);
  });

  it.each(['gece-mavisi', 'kitaplik', 'murekkep'] as const)(
    'draws headings, body, links and code with the %s palette',
    key => {
      renderWithProviders(
        <LegalMarkdown
          markdown={'# Şartlar\n\nGövde metni [bağlantı](https://sesly.io).\n\n`kod`'}
        />,
        { theme: key },
      );
      const T = themes[key];
      expect(flatStyle(screen.getByText('Şartlar'))).toMatchObject({
        fontFamily: T.fontDisplay,
        color: T.text,
      });
      const heading = flatStyle(screen.getByText('Şartlar'));
      expect(heading.lineHeight).toBeGreaterThanOrEqual(heading.fontSize * 1.3);
      expect(flatStyle(screen.getByText('bağlantı'))).toMatchObject({
        color: T.text,
        textDecorationLine: 'underline',
      });
      // No monospace: code is Nunito on a surface card.
      expect(flatStyle(screen.getByText('kod'))).toMatchObject({
        fontFamily: T.fontLabel,
        backgroundColor: T.surface2,
      });
    },
  );

  it('draws bullet lists with dots, not a bullet character', () => {
    renderWithProviders(<LegalMarkdown markdown={'- birinci\n- ikinci'} />);
    expect(screen.getAllByTestId('legal-bullet')).toHaveLength(2);
    expect(screen.getByText('birinci')).toBeOnTheScreen();
    expect(screen.queryByText(/[•·]/)).toBeNull();
  });

  it('keeps the numbers of an ordered list', () => {
    renderWithProviders(<LegalMarkdown markdown={'1. bir\n2. iki'} />);
    expect(screen.getByText('bir')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('legal-bullet')).toHaveLength(0);
    expect(screen.getByText('2.')).toBeOnTheScreen();
  });

  it('the bullet dot is a 6dp circle', () => {
    renderWithProviders(<LegalMarkdown markdown={'- bir'} />);
    const dot = flatStyle(screen.getByTestId('legal-bullet'));
    expect(dot).toMatchObject({ width: 6, height: 6, borderRadius: 3 });
  });

  /** Props of the library's Markdown element (a memo, found by its parser). */
  const markdownProps = () => screen.UNSAFE_getAllByProps({ markdownit: getLegalParser() })[0].props;

  it('builds its styles and rules once per palette, shared by every document', () => {
    const first = renderWithProviders(<LegalMarkdown markdown="bir" />);
    const a = markdownProps();
    first.unmount();
    const second = renderWithProviders(<LegalMarkdown markdown="iki" />);
    const b = markdownProps();
    // Another document in the same palette: the very same objects.
    expect(b.style).toBe(a.style);
    expect(b.rules).toBe(a.rules);
    second.unmount();

    renderWithProviders(<LegalMarkdown markdown="bir" />, { theme: 'kitaplik' });
    const c = markdownProps();
    expect(c.style).not.toBe(a.style);
    expect(c.style.body.color).toBe(themes.kitaplik.text2);
    expect(a.style.body.color).toBe(themes['gece-mavisi'].text2);
  });
});
