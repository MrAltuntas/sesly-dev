/**
 * The UI text rules of CLAUDE.md as code: no emoji, no em dash, no unicode
 * ellipsis (three real dots are fine), no arrows, bullets, middle dots,
 * guillemets / chevrons, stars, check marks or other dingbats.
 *
 * Code point ranges, kept as numbers so this file contains none of them.
 */
const FORBIDDEN_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00ab, 0x00ab], // left guillemet
  [0x00b7, 0x00b7], // middle dot
  [0x00bb, 0x00bb], // right guillemet
  [0x2014, 0x2015], // em dash, horizontal bar
  [0x2022, 0x2023], // bullet, triangular bullet
  [0x2026, 0x2026], // unicode ellipsis
  [0x2039, 0x203a], // single chevrons
  [0x2043, 0x2043], // hyphen bullet
  [0x2190, 0x21ff], // arrows
  [0x25a0, 0x25ff], // geometric shapes (squares, triangles, circles)
  [0x2600, 0x27bf], // misc symbols, dingbats (stars, check marks, lightning)
  [0x2b00, 0x2bff], // misc symbols and arrows
  [0x1f000, 0x1faff], // emoji blocks
];

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

function isForbidden(ch: string): boolean {
  const cp = ch.codePointAt(0) as number;
  if (cp === 0xfe0f || cp === 0x200d) return true; // emoji variation selector, zero width joiner
  return FORBIDDEN_RANGES.some(([from, to]) => cp >= from && cp <= to) || PICTOGRAPHIC.test(ch);
}

/** Every forbidden character in `text`, once each, in order of appearance. */
export function findForbiddenUiGlyphs(text: string): string[] {
  const found: string[] = [];
  for (const ch of text) {
    if (isForbidden(ch) && !found.includes(ch)) found.push(ch);
  }
  return found;
}

/** Readable form of a forbidden character for an error message: "U+2014". */
export function describeGlyph(ch: string): string {
  return `U+${(ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')}`;
}
