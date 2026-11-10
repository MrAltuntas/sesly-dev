/**
 * LegalMarkdown: themed renderer for legal markdown fetched from the backend.
 *
 * Wraps `react-native-markdown-display` with styles built from the active
 * palette (`useT()`), in the playful system: Baloo 2 headings in `text`,
 * Nunito body in `text2`, links as underlined `text`, quotes, code and
 * tables on rounded `surface2` cards (the sheet itself is `surface`), no
 * hairlines and no monospace font. Bullets are small round dots drawn as
 * views, not a bullet glyph.
 *
 * Shared by the LegalSheet modal and any future full-screen legal viewer.
 */

import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import Markdown, { ASTNode, MarkdownIt, RenderRules, renderRules } from 'react-native-markdown-display';
import { Theme, themedStyles, useT } from '../../theme/theme';

interface LegalMarkdownProps {
  markdown: string;
}

const BODY_SIZE = 14.5;
const BODY_LINE = 22;
/** Thickness of a rule (`---`) and the edge of a bullet dot (dp). */
const RULE_HEIGHT = 2;
const BULLET_SIZE = 6;

// One StyleSheet and one rule set per palette, cached (`themedStyles`).
const makeMarkdownStyles = (T: Theme) =>
  StyleSheet.create({
    // ── Paragraphs & body text ───────────────────────────────────────
    body: {
      fontFamily: T.fontBody,
      fontSize: BODY_SIZE,
      lineHeight: BODY_LINE,
      color: T.text2,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: T.space.md,
      fontFamily: T.fontBody,
      fontSize: BODY_SIZE,
      lineHeight: BODY_LINE,
      color: T.text2,
    },
    // No font or colour here: a text node inherits them from its block
    // (paragraph, heading, link), otherwise headings would turn Nunito.
    text: {},

    // ── Headings (Baloo 2, line heights at least 1.3 times the size) ──
    heading1: {
      fontFamily: T.fontDisplay,
      fontSize: 24,
      lineHeight: 32,
      color: T.text,
      marginTop: T.space.xl,
      marginBottom: T.space.md,
    },
    heading2: {
      fontFamily: T.fontDisplay,
      fontSize: 20,
      lineHeight: 26,
      color: T.text,
      marginTop: T.space.xl,
      marginBottom: T.space.sm,
    },
    heading3: {
      fontFamily: T.fontDisplay,
      fontSize: 17,
      lineHeight: 23,
      color: T.text,
      marginTop: T.space.lg,
      marginBottom: T.space.sm,
    },
    heading4: {
      fontFamily: T.fontDisplay,
      fontSize: 15.5,
      lineHeight: 21,
      color: T.text,
      marginTop: T.space.md,
      marginBottom: T.space.xs,
    },
    heading5: {
      fontFamily: T.fontLabel,
      fontSize: 14.5,
      lineHeight: 20,
      color: T.text,
      marginTop: T.space.md,
      marginBottom: T.space.xs,
    },
    heading6: {
      fontFamily: T.fontLabel,
      fontSize: 13.5,
      lineHeight: 19,
      color: T.text2,
      marginTop: T.space.md,
      marginBottom: T.space.xs,
    },

    // ── Emphasis (no italics in the design: the body style) ──────────
    em: {
      fontFamily: T.fontBody,
      fontStyle: 'normal',
      color: T.text2,
    },
    strong: {
      fontFamily: T.fontLabel,
      fontWeight: 'normal',
      color: T.text,
    },

    // ── Links ────────────────────────────────────────────────────────
    link: {
      color: T.text,
      fontFamily: T.fontLabel,
      textDecorationLine: 'underline',
    },

    // ── Lists ────────────────────────────────────────────────────────
    bullet_list: {
      marginBottom: T.space.md,
    },
    ordered_list: {
      marginBottom: T.space.md,
    },
    list_item: {
      flexDirection: 'row',
      marginBottom: T.space.xs,
    },
    bullet_list_icon: {
      // The dot itself is drawn by the list_item rule below; this box
      // centres it on the first line.
      width: 18,
      height: BODY_LINE,
      alignItems: 'flex-start',
      justifyContent: 'center',
    },
    bullet_list_content: {
      flex: 1,
      fontFamily: T.fontBody,
      fontSize: BODY_SIZE,
      lineHeight: BODY_LINE,
      color: T.text2,
    },
    ordered_list_icon: {
      color: T.text3,
      fontFamily: T.fontLabel,
      fontSize: BODY_SIZE,
      marginLeft: 0,
      marginRight: T.space.sm,
      lineHeight: BODY_LINE,
    },
    ordered_list_content: {
      flex: 1,
      fontFamily: T.fontBody,
      fontSize: BODY_SIZE,
      lineHeight: BODY_LINE,
      color: T.text2,
    },

    // ── Quotes & rules ───────────────────────────────────────────────
    blockquote: {
      backgroundColor: T.surface2,
      borderLeftWidth: 0,
      paddingHorizontal: T.space.lg,
      paddingVertical: T.space.md,
      marginBottom: T.space.md,
      marginLeft: 0,
      borderRadius: T.r.md,
    },
    hr: {
      backgroundColor: T.line,
      height: RULE_HEIGHT,
      borderRadius: RULE_HEIGHT / 2,
      marginVertical: T.space.lg,
    },

    // ── Code (Nunito on a card, no monospace) ────────────────────────
    code_inline: {
      fontFamily: T.fontLabel,
      fontSize: 13.5,
      color: T.text,
      backgroundColor: T.surface2,
      borderRadius: T.r.xs,
      borderWidth: 0,
      paddingHorizontal: 4,
      paddingVertical: 2,
    },
    code_block: {
      fontFamily: T.fontLabel,
      fontSize: 13.5,
      lineHeight: 20,
      color: T.text,
      backgroundColor: T.surface2,
      borderRadius: T.r.md,
      borderWidth: 0,
      padding: T.space.md,
      marginBottom: T.space.md,
    },
    fence: {
      fontFamily: T.fontLabel,
      fontSize: 13.5,
      lineHeight: 20,
      color: T.text,
      backgroundColor: T.surface2,
      borderRadius: T.r.md,
      borderWidth: 0,
      padding: T.space.md,
      marginBottom: T.space.md,
    },

    // ── Tables (one rounded card, rows split by a 2dp track line) ────
    table: {
      backgroundColor: T.surface2,
      borderWidth: 0,
      borderRadius: T.r.md,
      overflow: 'hidden',
      marginBottom: T.space.md,
    },
    thead: {
      backgroundColor: T.line,
    },
    tr: {
      flexDirection: 'row',
      borderBottomWidth: T.hairline,
      borderColor: T.line,
    },
    th: {
      flex: 1,
      fontFamily: T.fontLabel,
      color: T.text,
      padding: T.space.sm,
    },
    td: {
      flex: 1,
      fontFamily: T.fontBody,
      color: T.text2,
      padding: T.space.sm,
    },
  });

/**
 * Render rules: the library's own, except that a bullet list item draws a
 * small round dot instead of a bullet character (no bullet glyphs in UI
 * text). Ordered lists keep the library's numbering.
 */
function makeRules(T: Theme): RenderRules {
  const base = renderRules.list_item;
  return {
    list_item: (node: ASTNode, children, parent: ASTNode[], styles, inheritedStyles) => {
      const inBulletList = parent.some(el => el.type === 'bullet_list');
      if (!inBulletList && base) return base(node, children, parent, styles, inheritedStyles);
      return (
        <View key={node.key} style={styles._VIEW_SAFE_list_item}>
          <View style={styles._VIEW_SAFE_bullet_list_icon} accessible={false}>
            <View
              testID="legal-bullet"
              style={{ width: BULLET_SIZE, height: BULLET_SIZE, borderRadius: BULLET_SIZE / 2, backgroundColor: T.text3 }}
            />
          </View>
          <View style={styles._VIEW_SAFE_bullet_list_content}>{children}</View>
        </View>
      );
    },
  };
}

// The library's default markdown-it has typographer ON, which rewrites plain
// quotes into curly ones (and "--" into dashes). UI text must not carry those
// glyphs, so render the backend markdown as authored. One parser for every
// render, built on the first one: screens import the legal sheet eagerly, and
// building markdown-it at import time put it on the launch path.
let legalParser: MarkdownIt | undefined;

export function getLegalParser(): MarkdownIt {
  legalParser ??= MarkdownIt({ typographer: false });
  return legalParser;
}

const markdownStylesFor = themedStyles(makeMarkdownStyles);
const rulesFor = themedStyles(makeRules);

const handleLinkPress = (url: string): boolean => {
  // Open external links in the OS browser / mail client.
  Linking.openURL(url).catch(err => {
    console.warn('[LegalMarkdown] Failed to open link:', url, err);
  });
  // Return false so the library doesn't attempt its own navigation.
  return false;
};

export const LegalMarkdown: React.FC<LegalMarkdownProps> = ({ markdown }) => {
  const T = useT();
  const markdownStyles = markdownStylesFor(T);
  const rules = rulesFor(T);
  return (
    <Markdown
      style={markdownStyles}
      rules={rules}
      onLinkPress={handleLinkPress}
      markdownit={getLegalParser()}
    >
      {markdown}
    </Markdown>
  );
};

export default LegalMarkdown;
