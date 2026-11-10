/**
 * LegalSheet: 88% from the first frame with a skeleton of text bones, the
 * slug- and language-tagged state (a leaving sheet keeps its document,
 * another slug or language never shows the previous one), cache-first
 * documents with a background refresh, documents asked for in the UI
 * language with the Turkish-only line in the English UI, the unpublished
 * message without a retry, and the one button of each context
 * (docs/release-pass/SPEC-design.md 3.16 and 2.2, r8a-13, r8a-14, btn-3).
 */

import React from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { act, configure, fireEvent, screen } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { ApiError } from '../../services/ApiError';
import type { LegalDocument, LegalLanguage, LegalRefresh, LegalResult, LegalSlug } from '../../models/Legal';
import { BUTTON_METRICS, buttonColors } from './Button';
import { resetSheetPresence } from './sheetPresence';
import LegalSheet, {
  LegalSheetState,
  applyLegalRefresh,
  formatLegalDate,
  legalErrorKey,
  shownLegalState,
} from './LegalSheet';

jest.setTimeout(60000);

// The scrim and the handle sit beside an accessibilityViewIsModal sheet.
configure({ defaultIncludeHiddenElements: true });

type ReadOptions = { language: LegalLanguage; onRefresh?: (refresh: LegalRefresh) => void };
const mockRead = jest.fn<Promise<LegalResult>, [string, ReadOptions?]>();
const mockPeek = jest.fn<LegalDocument | null, [string, LegalLanguage]>();
jest.mock('../../services/LegalService', () => ({
  __esModule: true,
  default: {
    read: (slug: string, options?: ReadOptions) => mockRead(slug, options),
    peek: (slug: string, language: LegalLanguage) => mockPeek(slug, language),
  },
}));

// The real markdown view, with a count of its renders.
const mockMarkdownRenders = { n: 0 };
jest.mock('./LegalMarkdown', () => {
  const actual = jest.requireActual('./LegalMarkdown');
  const { createElement } = jest.requireActual('react');
  const LegalMarkdown = (props: { markdown: string }) => {
    mockMarkdownRenders.n += 1;
    return createElement(actual.LegalMarkdown, props);
  };
  return { __esModule: true, ...actual, LegalMarkdown, default: LegalMarkdown };
});

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

const docFor = (slug: string, overrides: Partial<LegalDocument> = {}): LegalDocument => ({
  slug,
  language: 'tr',
  title: `Baslik ${slug}`,
  contentMd: `Metin ${slug}.`,
  version: 3,
  publishedAt: '2026-09-01T12:00:00.000Z',
  fromCache: false,
  ...overrides,
});

const found = (doc: LegalDocument): LegalResult => ({ status: 'document', doc });

/** A read the test settles by hand, with the refresh callback it was given. */
function pendingRead() {
  let resolve!: (result: LegalResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<LegalResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The onRefresh the sheet passed with its latest read. */
const lastRefresh = () => {
  const options = mockRead.mock.calls[mockRead.mock.calls.length - 1]?.[1];
  if (!options?.onRefresh) throw new Error('no onRefresh passed');
  return options.onRefresh;
};

const layout = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height } } });

/** Holds every withTiming, so a closing sheet stays until the test ends its exit. */
function holdTimings(): Array<{ toValue: number; callback?: (finished?: boolean) => void }> {
  const held: Array<{ toValue: number; callback?: (finished?: boolean) => void }> = [];
  jest.spyOn(Reanimated, 'withTiming').mockImplementation(((
    toValue: number,
    _config?: unknown,
    callback?: (finished?: boolean) => void,
  ) => {
    held.push({ toValue, callback });
    return toValue;
  }) as unknown as typeof Reanimated.withTiming);
  return held;
}

interface SheetProps {
  slug: LegalSlug | null;
  onClose?: () => void;
  onAccept?: (slug: LegalSlug) => void;
  context?: 'profile' | 'consent';
}

function Sheet({ slug, onClose = jest.fn(), onAccept, context }: SheetProps) {
  return <LegalSheet slug={slug} onClose={onClose} onAccept={onAccept} context={context} />;
}

/**
 * The sheet lays out: its enter runs (Reanimated's mock ends it at once,
 * held timings wait for the test) and, once it has opened, the text mounts.
 */
function openSheet() {
  fireEvent(screen.getByTestId('legal-sheet'), 'layout', layout(600));
}

/** Renders, settles the first read and opens the sheet (when a slug is shown). */
async function renderSheet(props: SheetProps, theme?: 'gece-mavisi' | 'erik') {
  const view = renderWithProviders(<Sheet {...props} />, { theme });
  await act(async () => undefined);
  if (props.slug) openSheet();
  return view;
}

beforeEach(() => {
  mockRead.mockReset();
  mockPeek.mockReset();
  mockPeek.mockReturnValue(null);
});

afterEach(() => resetSheetPresence());

describe('LegalSheet size and loading', () => {
  it('is 88% tall while loading, on error and on success', async () => {
    const read = pendingRead();
    mockRead.mockReturnValueOnce(read.promise);
    const view = await renderSheet({ slug: 'tos' });
    expect(flat(screen.getByTestId('legal-sheet')).height).toBe('88%');

    await act(async () => read.reject(new ApiError({ status: 500, message: 'Sunucu hatasi.' })));
    expect(screen.getByText('Belge yüklenemedi. Tekrar dene.')).toBeOnTheScreen();
    expect(flat(screen.getByTestId('legal-sheet')).height).toBe('88%');

    mockRead.mockResolvedValueOnce(found(docFor('privacy')));
    view.rerender(<Sheet slug="privacy" />);
    await act(async () => undefined);
    expect(screen.getByText('Metin privacy.')).toBeOnTheScreen();
    expect(flat(screen.getByTestId('legal-sheet')).height).toBe('88%');
  });

  it('loads as text bones under the title, with no spinner', async () => {
    mockRead.mockReturnValue(new Promise(() => undefined));
    await renderSheet({ slug: 'tos' });

    const bones = screen.getByTestId('legal-loading');
    expect(bones.props.accessibilityRole).toBe('progressbar');
    expect(bones.props.accessibilityLabel).toBe('Yükleniyor...');
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
    // The title is the slug's own name, there before the document.
    expect(screen.getByRole('header', { name: 'Kullanım Şartları' })).toBeOnTheScreen();
    expect(screen.getByText('Yasal')).toBeOnTheScreen();
    expect(mockRead).toHaveBeenCalledWith('tos', { language: 'tr', onRefresh: expect.any(Function) });
  });

  it('shows the document with its date and version and no offline note', async () => {
    mockRead.mockResolvedValue(found(docFor('privacy')));
    await renderSheet({ slug: 'privacy' });

    expect(screen.getByText('Metin privacy.')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Gizlilik Politikası' })).toBeOnTheScreen();
    expect(screen.getByText('Son güncelleme: 1 Eylül 2026, sürüm 3')).toBeOnTheScreen();
    expect(screen.queryByTestId('legal-loading')).toBeNull();
    expect(screen.queryByTestId('legal-offline')).toBeNull();
  });

  it('fades the end of a text that scrolls, and drops the fade at the end', async () => {
    mockRead.mockResolvedValue(found(docFor('tos')));
    await renderSheet({ slug: 'tos' });
    const scroll = screen.getByTestId('legal-scroll');
    expect(screen.queryByTestId('legal-fade')).toBeNull();

    fireEvent(scroll, 'layout', layout(400));
    fireEvent(scroll, 'contentSizeChange', 360, 900);
    expect(screen.getByTestId('legal-fade')).toBeOnTheScreen();

    fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { x: 0, y: 500 } } });
    expect(screen.queryByTestId('legal-fade')).toBeNull();
  });

  it('renders the markdown once: the fade and a re-render of the sheet do not parse it again', async () => {
    mockRead.mockResolvedValue(found(docFor('tos')));
    const onClose = jest.fn();
    const view = await renderSheet({ slug: 'tos', onClose });
    const scroll = screen.getByTestId('legal-scroll');
    const after = mockMarkdownRenders.n;
    expect(after).toBeGreaterThan(0);

    fireEvent(scroll, 'layout', layout(400));
    fireEvent(scroll, 'contentSizeChange', 360, 900);
    fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { x: 0, y: 500 } } });
    // The parent renders again with a new onClose (a keystroke on Registration).
    view.rerender(<Sheet slug="tos" onClose={jest.fn()} />);
    expect(screen.getByText('Metin tos.')).toBeOnTheScreen();
    expect(mockMarkdownRenders.n).toBe(after);

    // A new text is rendered.
    await act(async () => lastRefresh()({ status: 'document', doc: docFor('tos', { contentMd: 'Yeni metin.' }) }));
    expect(screen.getByText('Yeni metin.')).toBeOnTheScreen();
    expect(mockMarkdownRenders.n).toBeGreaterThan(after);
  });

  it('mounts the document text only once the sheet has opened: bones while it slides in (LA-6)', async () => {
    const held = holdTimings();
    mockRead.mockResolvedValue(found(docFor('tos')));
    const before = mockMarkdownRenders.n;
    // The document is ready before the sheet has even laid out.
    await renderSheet({ slug: 'tos' });
    expect(held).toEqual([expect.objectContaining({ toValue: 1 })]);

    // The slide runs: the chrome is there, the long text is not.
    expect(mockMarkdownRenders.n).toBe(before);
    expect(screen.queryByTestId('legal-scroll')).toBeNull();
    expect(screen.getByTestId('legal-loading')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Kullanım Şartları' })).toBeOnTheScreen();
    expect(screen.getByText('Son güncelleme: 1 Eylül 2026, sürüm 3')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Kapat' })).toBeOnTheScreen();
    expect(flat(screen.getByTestId('legal-sheet')).height).toBe('88%');

    // Opened: the text replaces the bones, at the same size.
    act(() => held[0].callback?.(true));
    expect(screen.getByText('Metin tos.')).toBeOnTheScreen();
    expect(mockMarkdownRenders.n).toBeGreaterThan(before);
    expect(screen.queryByTestId('legal-loading')).toBeNull();
    expect(flat(screen.getByTestId('legal-sheet')).height).toBe('88%');
  });

  it('does not read while closed', async () => {
    await renderSheet({ slug: null });
    expect(mockRead).not.toHaveBeenCalled();
  });
});

describe('LegalSheet cache-first documents', () => {
  it('a saved copy renders at once and the background refresh replaces it', async () => {
    mockRead.mockResolvedValue(found(docFor('tos', { contentMd: 'Eski metin.', fromCache: true })));
    await renderSheet({ slug: 'tos' });
    expect(screen.getByText('Eski metin.')).toBeOnTheScreen();
    // A copy from the device while the refresh runs is not an offline note.
    expect(screen.queryByTestId('legal-offline')).toBeNull();

    await act(async () => lastRefresh()({ status: 'document', doc: docFor('tos', { contentMd: 'Yeni metin.' }) }));
    expect(screen.getByText('Yeni metin.')).toBeOnTheScreen();
    expect(screen.queryByText('Eski metin.')).toBeNull();
  });

  it('a document known in memory is ready at once: it draws as soon as the sheet has opened, before the read settles', () => {
    mockPeek.mockImplementation((slug, language) =>
      slug === 'privacy' && language === 'tr' ? docFor('privacy', { contentMd: 'Bellekte.' }) : null,
    );
    mockRead.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<Sheet slug="privacy" />);
    // Its date is there with the first frame; the text waits for the slide.
    expect(screen.getByTestId('legal-updated')).toBeOnTheScreen();
    expect(screen.queryByText('Bellekte.')).toBeNull();

    openSheet();
    expect(screen.getByText('Bellekte.')).toBeOnTheScreen();
    expect(screen.queryByTestId('legal-loading')).toBeNull();
  });

  it('a refresh that fails while offline keeps the copy and says so; a server failure stays quiet', async () => {
    mockRead.mockResolvedValue(found(docFor('tos', { fromCache: true })));
    await renderSheet({ slug: 'tos' });

    await act(async () => lastRefresh()({ status: 'failed', error: new ApiError({ status: 500, message: 'x' }) }));
    expect(screen.getByText('Metin tos.')).toBeOnTheScreen();
    expect(screen.queryByTestId('legal-offline')).toBeNull();

    await act(async () => lastRefresh()({ status: 'failed', error: new ApiError({ status: 0, message: 'x' }) }));
    expect(screen.getByText('Metin tos.')).toBeOnTheScreen();
    expect(screen.getByText('İnternet bağlantısı yok. Cihazında kayıtlı sürüm gösteriliyor.')).toBeOnTheScreen();
  });

  it('a refresh that finds the document unpublished shows that message', async () => {
    mockRead.mockResolvedValue(found(docFor('tos', { fromCache: true })));
    await renderSheet({ slug: 'tos' });
    await act(async () => lastRefresh()({ status: 'unpublished' }));
    expect(screen.queryByText('Metin tos.')).toBeNull();
    expect(screen.getByText('Bu belge henüz yayımlanmadı.')).toBeOnTheScreen();
  });

  it('a refresh that arrives before its read settles is not overwritten by the saved copy', async () => {
    mockRead.mockImplementation(async (_slug, options) => {
      options?.onRefresh?.({ status: 'document', doc: docFor('tos', { contentMd: 'Taze.' }) });
      return found(docFor('tos', { contentMd: 'Kayitli.', fromCache: true }));
    });
    await renderSheet({ slug: 'tos' });
    expect(screen.getByText('Taze.')).toBeOnTheScreen();
    expect(screen.queryByText('Kayitli.')).toBeNull();
  });
});

describe('LegalSheet slug-tagged state', () => {
  it('a closing sheet keeps its document and title until it has left', async () => {
    const held = holdTimings();
    mockRead.mockResolvedValue(found(docFor('tos')));
    const view = await renderSheet({ slug: 'tos' });
    act(() => held[held.length - 1].callback?.(true));
    expect(screen.getByText('Metin tos.')).toBeOnTheScreen();

    view.rerender(<Sheet slug={null} />);
    await act(async () => undefined);
    expect(screen.getByText('Metin tos.')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Kullanım Şartları' })).toBeOnTheScreen();
    expect(screen.queryByTestId('legal-loading')).toBeNull();
    expect(mockRead).toHaveBeenCalledTimes(1);

    act(() => held[held.length - 1].callback?.(true));
    expect(screen.queryByText('Metin tos.')).toBeNull();
  });

  it('switching the slug while closing never renders the other document', async () => {
    const held = holdTimings();
    mockRead.mockResolvedValueOnce(found(docFor('tos')));
    const view = await renderSheet({ slug: 'tos' });
    act(() => held[held.length - 1].callback?.(true));
    view.rerender(<Sheet slug={null} />);

    const privacy = pendingRead();
    mockRead.mockReturnValueOnce(privacy.promise);
    view.rerender(<Sheet slug="privacy" />);
    await act(async () => undefined);
    // Back from where it was: no new layout, the enter ends and it has opened.
    act(() => held[held.length - 1].callback?.(true));
    expect(screen.queryByText('Metin tos.')).toBeNull();
    expect(screen.getByTestId('legal-loading')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Gizlilik Politikası' })).toBeOnTheScreen();

    await act(async () => privacy.resolve(found(docFor('privacy'))));
    expect(screen.getByText('Metin privacy.')).toBeOnTheScreen();
    expect(screen.queryByText('Metin tos.')).toBeNull();
  });

  it('a late answer for a slug the sheet no longer shows is dropped', async () => {
    const tos = pendingRead();
    mockRead.mockReturnValueOnce(tos.promise);
    const view = await renderSheet({ slug: 'tos' });

    mockRead.mockResolvedValueOnce(found(docFor('privacy')));
    view.rerender(<Sheet slug="privacy" />);
    await act(async () => undefined);
    expect(screen.getByText('Metin privacy.')).toBeOnTheScreen();

    await act(async () => tos.resolve(found(docFor('tos'))));
    expect(screen.getByText('Metin privacy.')).toBeOnTheScreen();
    expect(screen.queryByText('Metin tos.')).toBeNull();
  });

  it('opened again on the same document, it shows it as soon as the sheet is up, while it reads again', async () => {
    mockRead.mockResolvedValueOnce(found(docFor('tos')));
    const view = await renderSheet({ slug: 'tos' });
    view.rerender(<Sheet slug={null} />);
    await act(async () => undefined);

    mockRead.mockReturnValueOnce(new Promise(() => undefined));
    view.rerender(<Sheet slug="tos" />);
    // A fresh window: the bones during the slide, the text once it is up.
    expect(screen.getByTestId('legal-loading')).toBeOnTheScreen();
    expect(screen.queryByText('Metin tos.')).toBeNull();
    openSheet();
    expect(screen.getByText('Metin tos.')).toBeOnTheScreen();
    expect(screen.queryByTestId('legal-loading')).toBeNull();
    expect(mockRead).toHaveBeenCalledTimes(2);
  });
});

describe('LegalSheet errors', () => {
  it('an unpublished document says so and offers no retry', async () => {
    mockRead.mockResolvedValue({ status: 'unpublished' });
    await renderSheet({ slug: 'data-deletion' });
    expect(screen.getByText('Bu belge henüz yayımlanmadı.')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Veri Silme Politikası' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Tekrar dene' })).toBeNull();
  });

  it('a thrown 404 is the same message, also without a retry', async () => {
    mockRead.mockRejectedValue(new ApiError({ status: 404, message: 'İstenen içerik bulunamadı.' }));
    await renderSheet({ slug: 'tos' });
    expect(screen.getByText('Bu belge henüz yayımlanmadı.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Tekrar dene' })).toBeNull();
  });

  it('no connection and no saved copy: the message, and a small retry that loads again', async () => {
    mockRead.mockRejectedValueOnce(new ApiError({ status: 0, message: 'İnternet bağlantısı kurulamadı' }));
    await renderSheet({ slug: 'tos' });
    expect(
      screen.getByText('İnternete bağlanılamadı ve cihazında kayıtlı bir sürüm yok. Biraz sonra tekrar dene.'),
    ).toBeOnTheScreen();
    expect(flat(screen.getByTestId('legal-retry-face')).minHeight).toBe(BUTTON_METRICS.sm.height);

    const again = pendingRead();
    mockRead.mockReturnValueOnce(again.promise);
    fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(screen.getByTestId('legal-loading')).toBeOnTheScreen();
    expect(mockRead).toHaveBeenCalledTimes(2);

    await act(async () => again.resolve(found(docFor('tos'))));
    expect(screen.getByText('Metin tos.')).toBeOnTheScreen();
  });

  it('opened again after a failure, it loads instead of showing the old error', async () => {
    mockRead.mockRejectedValueOnce(new ApiError({ status: 0, message: 'x' }));
    const view = await renderSheet({ slug: 'tos' });
    expect(screen.getByTestId('legal-error')).toBeOnTheScreen();
    view.rerender(<Sheet slug={null} />);
    await act(async () => undefined);

    const again = pendingRead();
    mockRead.mockReturnValueOnce(again.promise);
    view.rerender(<Sheet slug="tos" />);
    await act(async () => undefined);
    openSheet();
    expect(screen.getByTestId('legal-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('legal-error')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tekrar dene' })).toBeNull();

    await act(async () => again.resolve(found(docFor('tos'))));
    expect(screen.getByText('Metin tos.')).toBeOnTheScreen();
  });
});

describe('LegalSheet buttons', () => {
  it.each(['gece-mavisi', 'erik'] as const)(
    'the profile context has one secondary md "Kapat" (%s)',
    async key => {
      mockRead.mockResolvedValue(found(docFor('tos')));
      const onClose = jest.fn();
      await renderSheet({ slug: 'tos', onClose }, key);
      const T = themes[key];

      expect(screen.queryByRole('button', { name: 'Anladım' })).toBeNull();
      const face = flat(screen.getByTestId('legal-close-face'));
      expect(face.backgroundColor).toBe(buttonColors(T, 'secondary', 'default', 'surface').background);
      expect(face.minHeight).toBe(BUTTON_METRICS.md.height);

      fireEvent.press(screen.getByRole('button', { name: 'Kapat' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it('the consent context has one primary md "Anladım" that accepts, then closes', async () => {
    mockRead.mockResolvedValue(found(docFor('privacy')));
    const calls: string[] = [];
    const onAccept = jest.fn(() => calls.push('accept'));
    const onClose = jest.fn(() => calls.push('close'));
    await renderSheet({ slug: 'privacy', context: 'consent', onAccept, onClose });

    expect(screen.queryByRole('button', { name: 'Kapat' })).toBeNull();
    const face = flat(screen.getByTestId('legal-accept-face'));
    expect(face.backgroundColor).toBe(themes['gece-mavisi'].action);
    expect(face.minHeight).toBe(BUTTON_METRICS.md.height);

    fireEvent.press(screen.getByRole('button', { name: 'Anladım' }));
    expect(onAccept).toHaveBeenCalledWith('privacy');
    expect(calls).toEqual(['accept', 'close']);
  });

  it('"Anladım" accepts nothing it did not show: while loading and after a failure it only closes', async () => {
    const onAccept = jest.fn();
    const onClose = jest.fn();
    const read = pendingRead();
    mockRead.mockReturnValueOnce(read.promise);
    await renderSheet({ slug: 'tos', context: 'consent', onAccept, onClose });
    expect(screen.getByTestId('legal-loading')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Anladım' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => read.reject(new ApiError({ status: 0, message: 'x' })));
    expect(screen.getByTestId('legal-error')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Anladım' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('"Anladım" before the text is on screen only closes, though the document is ready', async () => {
    holdTimings();
    const onAccept = jest.fn();
    const onClose = jest.fn();
    mockRead.mockResolvedValue(found(docFor('privacy')));
    await renderSheet({ slug: 'privacy', context: 'consent', onAccept, onClose });
    expect(screen.getByTestId('legal-loading')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Anladım' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('"Anladım" on an unpublished document only closes', async () => {
    const onAccept = jest.fn();
    const onClose = jest.fn();
    mockRead.mockResolvedValue({ status: 'unpublished' });
    await renderSheet({ slug: 'privacy', context: 'consent', onAccept, onClose });
    fireEvent.press(screen.getByRole('button', { name: 'Anladım' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('is translated', async () => {
    await i18n.changeLanguage('en');
    mockRead.mockReturnValue(new Promise(() => undefined));
    await renderSheet({ slug: 'privacy' });
    expect(screen.getByRole('header', { name: 'Privacy Policy' })).toBeOnTheScreen();
    expect(screen.getByText('Legal')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Close' })).toBeOnTheScreen();
  });
});

describe('LegalSheet language', () => {
  const FALLBACK_EN = 'This document is currently available in Turkish only.';

  /** Whether `first` is rendered before `second` (tree order of the testIDs). */
  const comesBefore = (first: string, second: string) => {
    const ids: string[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const n = node as { props?: { testID?: string }; children?: unknown[] | null };
      if (n.props?.testID) ids.push(n.props.testID);
      (n.children ?? []).forEach(walk);
    };
    walk(screen.toJSON());
    const a = ids.indexOf(first);
    const b = ids.indexOf(second);
    return a !== -1 && b !== -1 && a < b;
  };

  it('the Turkish UI asks for Turkish and shows no language line', async () => {
    mockRead.mockResolvedValue(found(docFor('tos')));
    await renderSheet({ slug: 'tos' });
    expect(mockRead).toHaveBeenCalledWith('tos', expect.objectContaining({ language: 'tr' }));
    expect(mockPeek).toHaveBeenCalledWith('tos', 'tr');
    expect(screen.getByText('Metin tos.')).toBeOnTheScreen();
    expect(screen.queryByTestId('legal-language-fallback')).toBeNull();
  });

  it('the English UI asks for English and an English text has no language line', async () => {
    await i18n.changeLanguage('en');
    mockRead.mockResolvedValue(found(docFor('tos', { language: 'en', contentMd: 'English text.' })));
    await renderSheet({ slug: 'tos' });
    expect(mockRead).toHaveBeenCalledWith('tos', expect.objectContaining({ language: 'en' }));
    expect(mockPeek).toHaveBeenCalledWith('tos', 'en');
    expect(screen.getByText('English text.')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Terms of Use' })).toBeOnTheScreen();
    expect(screen.queryByTestId('legal-language-fallback')).toBeNull();
    expect(screen.queryByText(FALLBACK_EN)).toBeNull();
  });

  it('the English UI served the Turkish text shows one muted line above the text', async () => {
    await i18n.changeLanguage('en');
    mockRead.mockResolvedValue(found(docFor('privacy', { language: 'tr', contentMd: 'Turkce metin.' })));
    await renderSheet({ slug: 'privacy' });

    const line = screen.getByTestId('legal-language-fallback');
    expect(line).toHaveTextContent(FALLBACK_EN);
    expect(screen.getAllByText(FALLBACK_EN)).toHaveLength(1);
    expect(flat(line)).toMatchObject({ color: themes['gece-mavisi'].text3, fontSize: 12 });
    expect(screen.getByText('Turkce metin.')).toBeOnTheScreen();
    expect(comesBefore('legal-language-fallback', 'legal-scroll')).toBe(true);
  });

  it('the line goes once the refresh brings the English text', async () => {
    await i18n.changeLanguage('en');
    mockRead.mockResolvedValue(found(docFor('tos', { language: 'tr', fromCache: true })));
    await renderSheet({ slug: 'tos' });
    expect(screen.getByTestId('legal-language-fallback')).toBeOnTheScreen();

    await act(async () =>
      lastRefresh()({ status: 'document', doc: docFor('tos', { language: 'en', contentMd: 'Now in English.' }) }),
    );
    expect(screen.getByText('Now in English.')).toBeOnTheScreen();
    expect(screen.queryByTestId('legal-language-fallback')).toBeNull();
  });

  it('no line while loading, on an error or for an unpublished document', async () => {
    await i18n.changeLanguage('en');
    const read = pendingRead();
    mockRead.mockReturnValueOnce(read.promise);
    const view = await renderSheet({ slug: 'tos' });
    expect(screen.getByTestId('legal-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('legal-language-fallback')).toBeNull();

    await act(async () => read.reject(new ApiError({ status: 0, message: 'x' })));
    expect(screen.getByTestId('legal-error')).toBeOnTheScreen();
    expect(screen.queryByTestId('legal-language-fallback')).toBeNull();

    mockRead.mockResolvedValueOnce({ status: 'unpublished' });
    view.rerender(<Sheet slug="privacy" />);
    await act(async () => undefined);
    expect(screen.getByTestId('legal-unpublished')).toBeOnTheScreen();
    expect(screen.queryByTestId('legal-language-fallback')).toBeNull();
  });

  it('opened again after a language switch, it reads in the new language and never shows the old text', async () => {
    mockRead.mockResolvedValueOnce(found(docFor('tos', { contentMd: 'Turkce metin.' })));
    const view = await renderSheet({ slug: 'tos' });
    expect(screen.getByText('Turkce metin.')).toBeOnTheScreen();
    view.rerender(<Sheet slug={null} />);
    await act(async () => undefined);

    await act(async () => {
      await i18n.changeLanguage('en');
    });
    const english = pendingRead();
    mockRead.mockReturnValueOnce(english.promise);
    view.rerender(<Sheet slug="tos" />);
    await act(async () => undefined);
    openSheet();
    expect(mockRead).toHaveBeenLastCalledWith('tos', expect.objectContaining({ language: 'en' }));
    expect(screen.queryByText('Turkce metin.')).toBeNull();
    expect(screen.getByTestId('legal-loading')).toBeOnTheScreen();

    await act(async () => english.resolve(found(docFor('tos', { language: 'en', contentMd: 'English text.' }))));
    expect(screen.getByText('English text.')).toBeOnTheScreen();
    expect(screen.queryByTestId('legal-language-fallback')).toBeNull();
  });

  it('a late answer in the old language is dropped', async () => {
    const turkish = pendingRead();
    mockRead.mockReturnValueOnce(turkish.promise);
    await renderSheet({ slug: 'tos' });

    mockRead.mockResolvedValueOnce(found(docFor('tos', { language: 'en', contentMd: 'English text.' })));
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(mockRead).toHaveBeenLastCalledWith('tos', expect.objectContaining({ language: 'en' }));
    expect(screen.getByText('English text.')).toBeOnTheScreen();

    await act(async () => turkish.resolve(found(docFor('tos', { contentMd: 'Turkce metin.' }))));
    expect(screen.getByText('English text.')).toBeOnTheScreen();
    expect(screen.queryByText('Turkce metin.')).toBeNull();
  });
});

describe('LegalSheet helpers', () => {
  it('maps errors to messages: an ApiError by its status only, the message text of other errors', () => {
    expect(legalErrorKey(new ApiError({ status: 404, message: 'İstenen içerik bulunamadı.' }))).toBe(
      'legal.notPublished',
    );
    expect(legalErrorKey(new ApiError({ status: 0, message: 'x' }))).toBe('legal.noConnection');
    // A backend sentence that mentions a connection is still a server failure.
    expect(legalErrorKey(new ApiError({ status: 500, message: 'Veritabanı bağlantısı kurulamadı.' }))).toBe(
      'legal.loadFailed',
    );
    expect(legalErrorKey(new ApiError({ status: 500, message: 'network down' }))).toBe('legal.loadFailed');
    expect(legalErrorKey(new ApiError({ status: 500, message: 'Sunucu hatasi 404.' }))).toBe('legal.loadFailed');
    expect(legalErrorKey(new ApiError({ status: 500, message: 'Sunucu hatasi.' }))).toBe('legal.loadFailed');
    expect(legalErrorKey(new Error('Request failed with status code 404'))).toBe('legal.notPublished');
    expect(legalErrorKey(new Error('Network Error'))).toBe('legal.noConnection');
    expect(legalErrorKey(new Error('boom'))).toBe('legal.loadFailed');
    expect(legalErrorKey(null)).toBe('legal.loadFailed');
    expect(legalErrorKey('404')).toBe('legal.loadFailed');
  });

  it('formats dates for the UI language', () => {
    expect(formatLegalDate('2026-09-01T12:00:00.000Z', 'en')).toBe('1 September 2026');
    expect(formatLegalDate('2026-09-01T12:00:00.000Z', 'tr')).toBe('1 Eylül 2026');
    expect(formatLegalDate('', 'tr')).toBe('');
    expect(formatLegalDate('not a date', 'tr')).toBe('');
  });

  it('shownLegalState draws only a state of the shown slug and language', () => {
    const tos: LegalSheetState = { slug: 'tos', language: 'tr', status: 'ready', doc: docFor('tos'), offline: false };
    const none = () => null;
    expect(shownLegalState(tos, null, 'tr', none)).toBeNull();
    expect(shownLegalState(tos, 'tos', 'tr', none)).toBe(tos);
    expect(shownLegalState(tos, 'privacy', 'tr', none)).toEqual({ slug: 'privacy', language: 'tr', status: 'loading' });
    expect(shownLegalState(null, 'privacy', 'tr', none)).toEqual({ slug: 'privacy', language: 'tr', status: 'loading' });
    // The same slug in another UI language is not that document.
    expect(shownLegalState(tos, 'tos', 'en', none)).toEqual({ slug: 'tos', language: 'en', status: 'loading' });
    const known = docFor('privacy');
    const peek = jest.fn(() => known);
    expect(shownLegalState(tos, 'privacy', 'en', peek)).toEqual({
      slug: 'privacy',
      language: 'en',
      status: 'ready',
      doc: known,
      offline: false,
    });
    expect(peek).toHaveBeenCalledWith('privacy', 'en');
  });

  it('applyLegalRefresh changes only the state of its own slug and language', () => {
    const tos: LegalSheetState = { slug: 'tos', language: 'tr', status: 'ready', doc: docFor('tos'), offline: false };
    const fresh = docFor('tos', { version: 4 });
    expect(applyLegalRefresh(tos, 'privacy', 'tr', { status: 'unpublished' })).toBe(tos);
    expect(applyLegalRefresh(tos, 'tos', 'en', { status: 'unpublished' })).toBe(tos);
    expect(applyLegalRefresh(null, 'tos', 'tr', { status: 'unpublished' })).toBeNull();
    expect(applyLegalRefresh(tos, 'tos', 'tr', { status: 'document', doc: fresh })).toEqual({
      slug: 'tos',
      language: 'tr',
      status: 'ready',
      doc: fresh,
      offline: false,
    });
    expect(applyLegalRefresh(tos, 'tos', 'tr', { status: 'unpublished' })).toEqual({
      slug: 'tos',
      language: 'tr',
      status: 'unpublished',
    });
    expect(
      applyLegalRefresh(tos, 'tos', 'tr', { status: 'failed', error: new ApiError({ status: 0, message: 'x' }) }),
    ).toEqual({ ...tos, offline: true });
    expect(
      applyLegalRefresh(tos, 'tos', 'tr', {
        status: 'failed',
        error: new ApiError({ status: 502, message: 'Sunucu bağlantısı kurulamadı.' }),
      }),
    ).toEqual({ ...tos, offline: false });
    const loading: LegalSheetState = { slug: 'tos', language: 'tr', status: 'loading' };
    expect(applyLegalRefresh(loading, 'tos', 'tr', { status: 'failed', error: new Error('x') })).toBe(loading);
  });
});
