/**
 * LegalSheet: bottom sheet that shows a legal document fetched from the
 * backend (Terms, Privacy, Data Deletion), rendered as themed markdown
 * (design v4 playful: a quiet "Yasal" eyebrow, a Baloo 2 title, Nunito body,
 * one button at the bottom).
 *
 * The sheet is 88% of the screen from its first frame (`BottomSheet fill`),
 * so it never grows when the document arrives; while it loads the body is a
 * pulse of text bones. The title is the slug's own name in the UI language,
 * so it is there at once too.
 *
 * The document text mounts only once the sheet has opened (`onOpened`):
 * a long markdown tree mounted with the sheet held its first frame for
 * seconds. Until then a ready document also shows the bones, so the slide
 * starts right after the tap and the size never changes.
 *
 * Documents come cache-first from LegalService: a saved copy (or one kept
 * in memory this session) draws at once and is refreshed in the background;
 * a failed refresh while offline says the saved copy is shown. An
 * unpublished document says so and offers no retry.
 *
 * Documents are asked for in the UI language. While a document's English
 * text is unpublished the backend serves the Turkish one; the English UI
 * then says so in one muted line above the text (the Turkish UI never
 * shows it).
 *
 * The shown state is tagged with its slug and language: a sheet that leaves
 * keeps its document, and a state that belongs to another slug or language
 * renders as loading, so the sheet never blanks while closing or shows the
 * previous document.
 *
 * Contexts:
 * - 'profile' (default): reading only, one secondary "Kapat".
 * - 'consent': one primary "Anladım" that calls `onAccept(slug)` and closes
 *   (Registration ticks its consent box with it). It accepts only a document
 *   on screen: while loading, before the text is shown or after a failure it
 *   only closes.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { SPACE, Theme, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { withAlpha } from '../../theme/color';
import { currentLanguage } from '../../i18n/text';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Icon } from './Icon';
import { LegalMarkdown } from './LegalMarkdown';
import { Bone, SkeletonPulse, TextBones } from './Skeleton';
import legalService from '../../services/LegalService';
import { hasApiStatus, isApiError } from '../../services/ApiError';
import {
  LegalDocument,
  LegalLanguage,
  LegalRefresh,
  LegalSlug,
  isLegalLanguageFallback,
} from '../../models/Legal';

export type LegalSheetContext = 'profile' | 'consent';

export interface LegalSheetProps {
  slug: LegalSlug | null;
  onClose: () => void;
  /** Overrides the slug's own title. */
  title?: string;
  /** 'profile' (default): "Kapat" only. 'consent': "Anladım", which calls `onAccept`. */
  context?: LegalSheetContext;
  /** The consent context's "Anladım" on a shown document (before the sheet closes). */
  onAccept?: (slug: LegalSlug) => void;
  testID?: string;
}

/**
 * What the sheet shows, always for one slug asked for in one language
 * (`language` is the language asked for; `doc.language` the one served).
 */
export type LegalSheetState =
  | { slug: LegalSlug; language: LegalLanguage; status: 'loading' }
  | { slug: LegalSlug; language: LegalLanguage; status: 'ready'; doc: LegalDocument; offline: boolean }
  | { slug: LegalSlug; language: LegalLanguage; status: 'unpublished' }
  | { slug: LegalSlug; language: LegalLanguage; status: 'error'; error: unknown };

/** Title key (namespace common) of each slug. */
const TITLE_KEYS: Record<LegalSlug, string> = {
  tos: 'legal.titles.tos',
  privacy: 'legal.titles.privacy',
  'data-deletion': 'legal.titles.dataDeletion',
};

/** Which translated message explains a failed fetch. */
export function legalErrorKey(err: unknown): string {
  if (hasApiStatus(err, 404)) return 'legal.notPublished';
  // An ApiError carries the backend's own sentence: branch on its status only.
  if (isApiError(err)) return err.isNetworkError ? 'legal.noConnection' : 'legal.loadFailed';
  // Not an ApiError (a raw axios or parser error): read the message.
  const msg = err instanceof Error ? err.message : '';
  if (/404/.test(msg)) return 'legal.notPublished';
  if (/network|internet|bağlantı/i.test(msg)) return 'legal.noConnection';
  return 'legal.loadFailed';
}

/** Long date in the UI language; '' for a missing or invalid value. */
export function formatLegalDate(iso: string, language: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString(language === 'en' ? 'en-GB' : 'tr-TR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

/**
 * The state to draw for `shown` in `language`: the stored state when it is
 * for that slug and language, else a document already in memory, else
 * loading. Null when nothing was ever opened.
 */
export function shownLegalState(
  state: LegalSheetState | null,
  shown: LegalSlug | null,
  language: LegalLanguage,
  known: (slug: LegalSlug, language: LegalLanguage) => LegalDocument | null,
): LegalSheetState | null {
  if (!shown) return null;
  if (state && state.slug === shown && state.language === language) return state;
  const doc = known(shown, language);
  return doc
    ? { slug: shown, language, status: 'ready', doc, offline: false }
    : { slug: shown, language, status: 'loading' };
}

/** The state after a background refresh of the saved copy of `slug` in `language`. */
export function applyLegalRefresh(
  prev: LegalSheetState | null,
  slug: LegalSlug,
  language: LegalLanguage,
  refresh: LegalRefresh,
): LegalSheetState | null {
  if (!prev || prev.slug !== slug || prev.language !== language) return prev;
  if (refresh.status === 'document') return { slug, language, status: 'ready', doc: refresh.doc, offline: false };
  if (refresh.status === 'unpublished') return { slug, language, status: 'unpublished' };
  // The saved copy stays; say so only when the device is offline.
  if (prev.status !== 'ready') return prev;
  return { ...prev, offline: legalErrorKey(refresh.error) === 'legal.noConnection' };
}

/** Skeleton sections of the body: a heading line and its text lines each. */
const BONE_SECTIONS = [3, 4, 2, 3];

export const LegalSheet: React.FC<LegalSheetProps> = ({
  slug,
  onClose,
  title,
  context = 'profile',
  onAccept,
  testID = 'legal-sheet',
}) => {
  const T = useT();
  // Renders again when the UI language changes, so `language` follows it.
  const { t } = useTranslation('common');
  const styles = stylesFor(T);
  const text = textStylesFor(T);
  const language: LegalLanguage = currentLanguage();

  // The last opened slug stays shown while the sheet leaves.
  const lastSlug = useRef<LegalSlug | null>(slug);
  if (slug) lastSlug.current = slug;
  const shown = slug ?? lastSlug.current;

  const [state, setState] = useState<LegalSheetState | null>(null);
  // The sheet has opened: the document text may mount. A leaving sheet
  // keeps it; the next open starts with the bones again.
  const [opened, setOpened] = useState(false);
  const slugRef = useRef(slug);
  slugRef.current = slug;
  const handleOpened = useCallback(() => setOpened(true), []);
  const handleClosed = useCallback(() => {
    // Not when the sheet was opened again before its close was confirmed.
    if (!slugRef.current) setOpened(false);
  }, []);
  // The slug and language the latest load is for: a result of an older
  // load is dropped.
  const wanted = useRef<{ slug: LegalSlug; language: LegalLanguage } | null>(null);

  const load = useCallback(async (next: LegalSlug, lang: LegalLanguage) => {
    const target = { slug: next, language: lang };
    wanted.current = target;
    const current = () => wanted.current === target;
    // A refresh can only follow the read it belongs to: one that settles
    // first waits here.
    const pending: { settled: boolean; early: LegalRefresh | null } = { settled: false, early: null };
    const onRefresh = (refresh: LegalRefresh) => {
      if (!pending.settled) {
        pending.early = refresh;
        return;
      }
      if (current()) setState(prev => applyLegalRefresh(prev, next, lang, refresh));
    };
    let first: LegalSheetState;
    try {
      const result = await legalService.read(next, { language: lang, onRefresh });
      first =
        result.status === 'document'
          ? { slug: next, language: lang, status: 'ready', doc: result.doc, offline: false }
          : { slug: next, language: lang, status: 'unpublished' };
    } catch (error) {
      first = { slug: next, language: lang, status: 'error', error };
    }
    pending.settled = true;
    if (!current()) return;
    setState(pending.early ? applyLegalRefresh(first, next, lang, pending.early) : first);
  }, []);

  useEffect(() => {
    // Closing keeps what is shown; only a new slug (or language) loads.
    if (!slug) return;
    // An old failure of this slug is not shown again (with a retry) while
    // the new read runs.
    setState(prev =>
      prev?.slug === slug && prev.language === language && prev.status === 'error'
        ? { slug, language, status: 'loading' }
        : prev,
    );
    void load(slug, language);
  }, [slug, language, load]);

  const retry = () => {
    if (!shown) return;
    setState({ slug: shown, language, status: 'loading' });
    void load(shown, language);
  };

  const view = shownLegalState(state, shown, language, (s, lang) => legalService.peek(s, lang));

  // A ready document draws its text only once the sheet has opened.
  const textShown = view?.status === 'ready' && opened;
  const bones = view?.status === 'loading' || (view?.status === 'ready' && !opened);
  const resolvedTitle = title ?? (shown ? t(TITLE_KEYS[shown]) : '');
  const published =
    view?.status === 'ready' && view.doc.publishedAt ? formatLegalDate(view.doc.publishedAt, language) : '';
  // Asked for in English, served in Turkish: say so above the text.
  const servedInTurkish =
    textShown && view?.status === 'ready' && isLegalLanguageFallback(view.language, view.doc.language);
  const errorKey =
    view?.status === 'error' ? legalErrorKey(view.error) : view?.status === 'unpublished' ? 'legal.notPublished' : null;
  const canRetry = view?.status === 'error' && errorKey !== 'legal.notPublished';

  // "Anladım" accepts only a document that is on screen; while it loads,
  // before its text is shown or after a failure it just closes (the consent
  // box stays as it was).
  const accept = () => {
    if (shown && textShown) onAccept?.(shown);
    onClose();
  };

  return (
    <BottomSheet
      visible={slug !== null}
      onClose={onClose}
      onOpened={handleOpened}
      onClosed={handleClosed}
      fill
      testID={testID}
    >
      <Text style={text.eyebrow}>{t('legal.eyebrow')}</Text>
      <Text accessibilityRole="header" style={[text.heading, styles.title]} numberOfLines={2}>
        {resolvedTitle || ' '}
      </Text>

      {/* One meta line, reserved from the first frame. */}
      <View style={styles.metaRow}>
        {view?.status === 'loading' ? (
          <Bone tone="text" height={10} width="48%" />
        ) : published && view?.status === 'ready' ? (
          <Text style={text.meta} numberOfLines={1} testID="legal-updated">
            {t('legal.updated', { date: published, version: view.doc.version })}
          </Text>
        ) : null}
      </View>
      {view?.status === 'ready' && view.offline ? (
        <View style={styles.offline} testID="legal-offline">
          <Icon name="wifiOff" size={20} color={T.warning} />
          <Text style={[text.meta, styles.offlineText]}>{t('legal.offline')}</Text>
        </View>
      ) : null}

      <View style={styles.body}>
        {bones ? (
          <SkeletonPulse testID="legal-loading" style={styles.bones}>
            {BONE_SECTIONS.map((lines, i) => (
              <TextBones key={i} lines={lines} tone="text" />
            ))}
          </SkeletonPulse>
        ) : null}

        {errorKey ? (
          <View style={styles.message} testID={canRetry ? 'legal-error' : 'legal-unpublished'}>
            <Icon name={canRetry ? 'alert' : 'document'} size={26} color={T.text2} />
            <Text style={[text.bodySmall, styles.messageText]}>{t(errorKey)}</Text>
            {canRetry ? (
              <Button
                label={t('retry')}
                variant="secondary"
                size="sm"
                onPress={retry}
                style={styles.retry}
                testID="legal-retry"
              />
            ) : null}
          </View>
        ) : null}

        {servedInTurkish ? (
          <Text style={[text.meta, styles.fallback]} testID="legal-language-fallback">
            {t('legal.turkishOnly')}
          </Text>
        ) : null}
        {textShown && view?.status === 'ready' ? (
          <LegalText key={`${view.slug}:${view.language}`} markdown={view.doc.contentMd} />
        ) : null}
      </View>

      <View style={styles.footer}>
        {context === 'consent' ? (
          <Button label={t('understood')} size="md" block onPress={accept} testID="legal-accept" />
        ) : (
          <Button
            label={t('close')}
            variant="secondary"
            size="md"
            block
            onPress={onClose}
            testID="legal-close"
          />
        )}
      </View>
    </BottomSheet>
  );
};

/**
 * The document text, scrolling inside the body, with a fade over its end
 * while more is below (the text no longer stops hard at the button).
 * Keyed by slug and language, so another document starts at the top.
 * LegalMarkdown parses the whole document on every render, so it is kept
 * out of the renders of the sheet (memo) and of the fade toggling at the
 * end of the text (one element per markdown).
 */
const LegalText = React.memo(function LegalText({ markdown }: { markdown: string }) {
  const T = useT();
  const styles = stylesFor(T);
  const body = useMemo(() => <LegalMarkdown markdown={markdown} />, [markdown]);
  const [moreBelow, setMoreBelow] = useState(false);
  const box = useRef({ viewport: 0, content: 0, offset: 0 });
  const measure = (patch: Partial<typeof box.current>) => {
    const b = Object.assign(box.current, patch);
    const next = b.content - b.viewport - b.offset > 1;
    setMoreBelow(prev => (prev === next ? prev : next));
  };
  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => measure({ offset: e.nativeEvent.contentOffset.y })}
        scrollEventThrottle={32}
        onLayout={(e: LayoutChangeEvent) => measure({ viewport: e.nativeEvent.layout.height })}
        onContentSizeChange={(_w: number, h: number) => measure({ content: h })}
        testID="legal-scroll"
      >
        {body}
      </ScrollView>
      {moreBelow ? (
        <LinearGradient
          pointerEvents="none"
          colors={[withAlpha(T.surface, 0), T.surface]}
          style={styles.fade}
          testID="legal-fade"
        />
      ) : null}
    </>
  );
});

/** Height of the fade over the end of the text. */
const FADE_HEIGHT = SPACE.xxl;

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    title: { marginTop: SPACE.xxs },
    metaRow: { minHeight: textStylesFor(T).meta.lineHeight, marginTop: SPACE.tight, justifyContent: 'center' },
    offline: { flexDirection: 'row', alignItems: 'center', gap: SPACE.tight, marginTop: SPACE.sm },
    offlineText: { color: T.warning, flexShrink: 1 },
    body: { flex: 1, marginTop: SPACE.md },
    fallback: { marginBottom: SPACE.sm },
    bones: { gap: SPACE.xl, paddingTop: SPACE.xs },
    message: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACE.lg },
    messageText: { textAlign: 'center', marginTop: SPACE.sm },
    retry: { marginTop: SPACE.md, alignSelf: 'center' },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: SPACE.lg },
    fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: FADE_HEIGHT },
    footer: { marginTop: SPACE.md },
  });

const stylesFor = themedStyles(makeStyles);

export default LegalSheet;
