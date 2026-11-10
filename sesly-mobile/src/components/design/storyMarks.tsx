/**
 * Small markers that travel with a story: the language codes ("TR EN DE")
 * and the translation badge ("Yapay zekâ ile çevrildi"; on a cover the
 * sparkles alone on a glass chip).
 *
 * On their own (a detail header, a library row) each mark reads its words to
 * a screen reader. Inside an accessible parent, a story card button that
 * provides a `MarkLabelProvider`, a mark is no node of its own: it hands its
 * words to the parent, which reads them as part of its label ("Parmak Kız
 * masalını aç, Yapay zekâ ile çevrildi"), so a card is one stop.
 */

import React, { createContext, useContext, useId, useLayoutEffect, useMemo, useState } from 'react';
import { StyleProp, Text, View, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { RADIUS, SPACE, useT } from '../../theme/theme';
import { withAlpha } from '../../theme/color';
import { languageCodeLabel } from '../../i18n/text';
import { Icon } from './Icon';

// ─────────────────────────────────────────────────────────────
// Marks inside an accessible parent
// ─────────────────────────────────────────────────────────────

/** Where the marks inside a parent put their words. */
export interface MarkLabelSink {
  /** Sets the words of one mark, or with null removes them. */
  set(key: string, words: string | null): void;
}

const MarkLabelContext = createContext<MarkLabelSink | null>(null);

/** Gives the marks below it to the parent's label instead of their own nodes. */
export const MarkLabelProvider = MarkLabelContext.Provider;

type MarkEntry = readonly [key: string, words: string];
const NO_MARKS: readonly MarkEntry[] = [];

/**
 * The parent's side: a sink for `MarkLabelProvider` and the words the marks
 * below it handed in, in the order they are drawn. Append them to the
 * parent's own label.
 */
export function useMarkLabels(): { sink: MarkLabelSink; words: readonly string[] } {
  const [entries, setEntries] = useState<readonly MarkEntry[]>(NO_MARKS);
  const sink = useMemo<MarkLabelSink>(
    () => ({
      set: (key, words) =>
        setEntries(prev => {
          const at = prev.findIndex(([known]) => known === key);
          if (words === null) return at === -1 ? prev : prev.filter((_, i) => i !== at);
          if (at === -1) return [...prev, [key, words] as const];
          if (prev[at][1] === words) return prev;
          // A changed mark keeps its place in the label.
          return prev.map((entry, i) => (i === at ? ([key, words] as const) : entry));
        }),
    }),
    [],
  );
  const words = useMemo(() => entries.map(([, text]) => text), [entries]);
  return { sink, words };
}

/**
 * A mark's side: hands `words` to the parent's label while mounted. True when
 * there is such a parent, and the mark then draws no accessibility node.
 */
function useMarkLabel(words: string | null): boolean {
  const sink = useContext(MarkLabelContext);
  const key = useId();
  // Layout effects, so the parent's label is complete before the first paint.
  useLayoutEffect(() => {
    sink?.set(key, words);
  }, [sink, key, words]);
  useLayoutEffect(() => () => sink?.set(key, null), [sink, key]);
  return sink !== null;
}

/**
 * Props of a mark that a parent reads: no node of its own for a screen
 * reader. Its codes and words stay plain text inside the parent, which a
 * screen reader does not stop on separately.
 */
const MARK_IN_PARENT = { accessible: false, importantForAccessibility: 'no' } as const;

// ─────────────────────────────────────────────────────────────
// LanguageCodes
// ─────────────────────────────────────────────────────────────

/**
 * Order the codes for display: the language being shown first, the rest in
 * their given order, no duplicates, empty values dropped.
 */
export function orderLanguageCodes(
  codes: readonly string[],
  shown?: string | null,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (code: string | null | undefined) => {
    if (!code) return;
    const label = languageCodeLabel(code);
    if (!label || seen.has(label)) return;
    seen.add(label);
    out.push(label);
  };
  push(shown);
  codes.forEach(push);
  return out;
}

export interface LanguageCodesProps {
  /** Every language the story exists in (ISO codes, any case). */
  codes: readonly string[];
  /** The language being shown; listed first and drawn stronger. */
  shown?: string | null;
  /**
   * 'list': all languages of the story, the shown one stronger (default).
   * 'own': this row IS that language (Keşfet with a language filter); filled.
   */
  variant?: 'list' | 'own';
  style?: StyleProp<ViewStyle>;
}

export const LanguageCodes: React.FC<LanguageCodesProps> = ({
  codes,
  shown,
  variant = 'list',
  style,
}) => {
  const T = useT();
  const { t } = useTranslation('story');
  const ordered = orderLanguageCodes(codes, shown);
  const label = ordered.length > 0 ? t('languages', { list: ordered.join(', ') }) : null;
  const inParent = useMarkLabel(label);
  if (ordered.length === 0) return null;
  return (
    <View
      {...(inParent ? MARK_IN_PARENT : { accessible: true, accessibilityLabel: label ?? undefined })}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, alignSelf: 'flex-start' }, style]}
    >
      {ordered.map((code, index) => {
        const own = variant === 'own';
        const strong = !own && index === 0;
        // `.lg`: a small rounded badge. The shown language is brighter;
        // a row that IS that language takes the action tint.
        return (
          <View
            key={code}
            style={{
              minHeight: 17,
              paddingHorizontal: SPACE.xs,
              borderRadius: RADIUS.xs,
              justifyContent: 'center',
              backgroundColor: own ? T.chipActBg : strong ? T.line : withAlpha(T.text, 0.08),
            }}
          >
            <Text
              style={{
                fontFamily: T.fontLabel,
                fontSize: 10,
                lineHeight: 14,
                letterSpacing: 0.3,
                color: own ? T.chipActFg : strong ? T.text : T.text2,
              }}
            >
              {code}
            </Text>
          </View>
        );
      })}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// TranslationBadge
// ─────────────────────────────────────────────────────────────

export type TranslationKind = 'human' | 'machine';

/** Minimum heights of the two badge sizes (dp); the radius is half of it. */
const TRANSLATION_BADGE_HEIGHT = { sm: 22, lg: 28 } as const;

export interface TranslationBadgeProps {
  kind: TranslationKind;
  /** 'sm' 22dp (list rows), 'lg' 28dp (detail header). */
  size?: 'sm' | 'lg';
  /** Icon alone, for shelf captions where the word does not fit. */
  iconOnly?: boolean;
  /**
   * With `iconOnly`: the icon on a 22dp glass chip, like the duration chip
   * of a cover (`COVER_MARK_HEIGHT`), so it reads on any picture.
   */
  glass?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Height of a glass mark on a cover: the duration chip's 22dp. */
export const COVER_MARK_HEIGHT = 22;

export const TranslationBadge: React.FC<TranslationBadgeProps> = ({
  kind,
  size = 'sm',
  iconOnly,
  glass,
  style,
}) => {
  const T = useT();
  const { t } = useTranslation('story');
  const label = t(kind === 'machine' ? 'translation.machine' : 'translation.human');
  const inParent = useMarkLabel(label);

  if (iconOnly) {
    return (
      <View
        {...(inParent ? MARK_IN_PARENT : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label })}
        style={[
          glass
            ? {
                minWidth: COVER_MARK_HEIGHT,
                height: COVER_MARK_HEIGHT,
                paddingHorizontal: SPACE.xxs,
                borderRadius: COVER_MARK_HEIGHT / 2,
                backgroundColor: T.glass,
                alignItems: 'center',
                justifyContent: 'center',
              }
            : null,
          style,
        ]}
      >
        <Icon
          name={kind === 'machine' ? 'aiTranslation' : 'language'}
          size={16}
          color={glass ? T.text : T.text2}
        />
      </View>
    );
  }

  const large = size === 'lg';
  const height = TRANSLATION_BADGE_HEIGHT[size];
  // A machine translation is worth a second look: the warning tint.
  const background = kind === 'machine' ? withAlpha(T.warning, 0.14) : T.surface2;
  const color = kind === 'machine' ? T.warning : T.text2;
  return (
    <View
      {...(inParent ? MARK_IN_PARENT : null)}
      style={[
        {
          minHeight: height,
          borderRadius: height / 2,
          // A little less on the icon side, like a Tag with a leading glyph.
          paddingLeft: large ? SPACE.sm : SPACE.tight,
          paddingRight: large ? SPACE.md : SPACE.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: SPACE.xs,
          backgroundColor: background,
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      <Icon name={kind === 'machine' ? 'aiTranslation' : 'language'} size={16} color={color} />
      <Text
        style={{
          fontFamily: T.fontLabel,
          fontSize: large ? 12.5 : 11.5,
          lineHeight: large ? 17 : 16,
          color,
        }}
      >
        {label}
      </Text>
    </View>
  );
};
