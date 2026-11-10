/**
 * Source scanner of the design rules (docs/release-pass/SPEC-design.md 5.4).
 * Node only (fs): used by `designScan.test.ts` and by the sweep tests that
 * bring one folder at a time to zero. Never imported by the app.
 *
 *   const { violations } = scanDesign(['src/components/design']);
 *   expect(violations).toEqual([]);
 *
 * Rules, over non-test `.tsx` files:
 * - spacing: `margin*`, `padding*`, `gap`, `rowGap`, `columnGap`, `top`,
 *   `left`, `right`, `bottom` literals (absolute value) on the scale
 *   `0 2 4 6 8 12 16 20 24 32`, or on a line marked `// geometry`;
 * - radius: `borderRadius` / `radius` literals in `0 6 12 16 20 24 28 32 999`,
 *   an expression (`size / 2`), or `// geometry`;
 * - no `lip={<digit>` and no `lipSize.xl`;
 * - no numeric `duration:` (other than 0) outside `src/theme/motion.ts`, no
 *   `useNativeDriver: false`, no `LayoutAnimation`, no
 *   `useMemo(() => make*(T)` (cached styles), no `translateY: pressed`;
 * - no `<Modal` outside `ModalWindow.tsx`, no `KeyboardAvoidingView` import
 *   from `react-native`.
 *
 * Comments are ignored (a rule named in a comment is not a use). Hit slops
 * and press retention offsets are touch geometry, not spacing.
 */

import * as fs from 'fs';
import * as path from 'path';

export type DesignRule =
  | 'spacing'
  | 'radius'
  | 'lip-literal'
  | 'lip-xl'
  | 'duration'
  | 'native-driver-off'
  | 'layout-animation'
  | 'uncached-styles'
  | 'pressed-translate'
  | 'modal'
  | 'keyboard-avoiding-view';

export const DESIGN_RULES: readonly DesignRule[] = [
  'spacing',
  'radius',
  'lip-literal',
  'lip-xl',
  'duration',
  'native-driver-off',
  'layout-animation',
  'uncached-styles',
  'pressed-translate',
  'modal',
  'keyboard-avoiding-view',
];

export const SPACING_SCALE: readonly number[] = [0, 2, 4, 6, 8, 12, 16, 20, 24, 32];
export const RADIUS_SCALE: readonly number[] = [0, 6, 12, 16, 20, 24, 28, 32, 999];

/** The folders the design rules cover, relative to the project root. */
export const DESIGN_SCAN_DIRS: readonly string[] = ['src/components', 'src/screens', 'src/navigation'];

/** Project root (this file is src/theme/designScan.ts). */
export const PROJECT_ROOT = path.resolve(__dirname, '../..');

export interface DesignViolation {
  rule: DesignRule;
  /** Path relative to the project root, with forward slashes. */
  file: string;
  /** 1-based line. */
  line: number;
  /** The source line, trimmed. */
  text: string;
}

export interface DesignScanResult {
  /** Every file scanned, relative to the project root. */
  files: string[];
  violations: DesignViolation[];
}

const NUMBER = /^-?\d+(?:\.\d+)?$/;
const GEOMETRY = /\/\/\s*geometry\b/;
const TOUCH_GEOMETRY = /hitSlop|HitSlop|SLOP|Slop\b|pressRetentionOffset/;

const SPACING_STYLE =
  /(?<![\w.$])(margin(?:Top|Bottom|Left|Right|Horizontal|Vertical|Start|End)?|padding(?:Top|Bottom|Left|Right|Horizontal|Vertical|Start|End)?|gap|rowGap|columnGap|top|left|right|bottom)\s*:(?!:)/g;
const SPACING_PROP =
  /(?<![\w.$])(margin(?:Top|Bottom|Left|Right|Horizontal|Vertical|Start|End)?|padding(?:Top|Bottom|Left|Right|Horizontal|Vertical|Start|End)?|gap|rowGap|columnGap)\s*=\s*\{/g;
const RADIUS_STYLE = /(?<![\w.$])(border(?:Top|Bottom)?(?:Left|Right|Start|End)?Radius|radius)\s*:(?!:)/g;
const RADIUS_PROP = /(?<![\w.$])(border(?:Top|Bottom)?(?:Left|Right|Start|End)?Radius|radius)\s*=\s*\{/g;
const DURATION_KEY = /(?<![\w.$])duration\s*:(?!:)/g;

const LINE_RULES: [DesignRule, RegExp][] = [
  ['lip-literal', /(?<![\w.$])lip\s*=\s*\{\s*-?\d/],
  ['lip-xl', /\blipSize\.xl\b/],
  ['native-driver-off', /\buseNativeDriver\s*:\s*false\b/],
  ['layout-animation', /\bLayoutAnimation\b/],
  ['uncached-styles', /\buseMemo\(\s*\(\)\s*=>\s*make\w*\(\s*T\s*\)/],
  ['pressed-translate', /\btranslateY\s*:\s*pressed\b/],
  ['modal', /<Modal\b/],
];

const RN_IMPORT = /import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]react-native['"]/g;

/**
 * Removes comments, keeping the line structure: block comments become
 * blanks and `//` comments are cut. Strings and template literals are kept,
 * or with `blankStrings` keep only their quotes (so a style written inside a
 * string is not a use).
 */
export function stripComments(source: string, blankStrings = false): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  const inner = (text: string) => (blankStrings ? text.replace(/[^\n]/g, ' ') : text);
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      if (ch === '\\' && i + 1 < source.length) {
        out += inner(ch + next);
        i += 2;
        continue;
      }
      const closes = ch === quote || (ch === '\n' && quote !== '`');
      out += closes ? ch : inner(ch);
      if (closes) quote = null;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    out += ch;
    i += 1;
  }
  return out;
}

/** The value expression after `key:` (or inside `key={...}`), up to its end on the line. */
function valueAfter(code: string, start: number, jsx: boolean): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return code.slice(start, i);
      depth -= 1;
    } else if ((ch === ',' || ch === ';') && depth === 0 && !jsx) return code.slice(start, i);
  }
  return code.slice(start);
}

/** Splits `cond ? a : b` at its top level into the two branches (recursively). */
function branches(expr: string): string[] {
  let depth = 0;
  let question = -1;
  let nested = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === '?' && (expr[i + 1] === '?' || expr[i + 1] === '.')) i += 1; // ?? and ?.
    else if (depth === 0 && ch === '?') {
      if (question === -1) question = i;
      else nested += 1;
    } else if (depth === 0 && ch === ':' && question !== -1) {
      if (nested > 0) nested -= 1;
      else return [...branches(expr.slice(question + 1, i)), ...branches(expr.slice(i + 1))];
    }
  }
  return [expr];
}

/** Numeric literals a spacing value states: a plain literal, or an added or subtracted term. */
function spacingLiterals(expr: string): number[] {
  const out: number[] = [];
  for (const branch of branches(expr)) {
    const value = branch.trim();
    if (NUMBER.test(value.replace(/\s+/g, ''))) {
      out.push(Math.abs(Number(value.replace(/\s+/g, ''))));
      continue;
    }
    if (/[*/%]/.test(value) || /[A-Za-z_$]\s*\(/.test(value)) continue; // geometry math or a call
    const terms = value.match(/(?:^|[+-])\s*\d+(?:\.\d+)?(?=\s*(?:[+-]|$))/g) ?? [];
    for (const term of terms) out.push(Math.abs(Number(term.replace(/[+\s]/g, ''))));
  }
  return out;
}

/** Plain numeric literals of a value, per ternary branch (an expression states none). */
function plainLiterals(expr: string): number[] {
  return branches(expr)
    .map(branch => branch.replace(/\s+/g, ''))
    .filter(value => NUMBER.test(value))
    .map(value => Math.abs(Number(value)));
}

function scanValues(
  code: string,
  pattern: RegExp,
  jsx: boolean,
  literals: (expr: string) => number[],
  scale: readonly number[],
): boolean {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code))) {
    const expr = valueAfter(code, match.index + match[0].length, jsx);
    if (literals(expr).some(value => !scale.includes(value))) return true;
  }
  return false;
}

/** Opened minus closed braces of a line. */
function braces(line: string): number {
  let depth = 0;
  for (const ch of line) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
  }
  return depth;
}

function normalise(file: string): string {
  return file.replace(/\\/g, '/');
}

/** Scans one file's source. `file` is used for the report and the per-file exemptions. */
export function scanSource(source: string, file: string): DesignViolation[] {
  const name = normalise(file);
  const isMotion = /(^|\/)src\/theme\/motion\.ts$/.test(name) || name === 'motion.ts';
  const isModalWindow = /(^|\/)ModalWindow\.tsx$/.test(name);
  const raw = source.split(/\r?\n/);
  // Rules read code without comments or string contents; imports need the module names.
  const code = stripComments(source, true).split(/\r?\n/);
  const out: DesignViolation[] = [];
  const add = (rule: DesignRule, index: number) =>
    out.push({ rule, file: name, line: index + 1, text: raw[index].trim() });

  // Depth of an open hit slop object (`hitSlop={{` over several lines).
  let slopDepth = 0;
  code.forEach((line, index) => {
    if (!line.trim()) return;
    const geometry = GEOMETRY.test(raw[index]);
    const slopAt = line.search(TOUCH_GEOMETRY);
    const touch = slopDepth > 0 || slopAt !== -1;
    const counted = slopDepth > 0 ? line : slopAt !== -1 ? line.slice(slopAt) : '';
    if (counted) slopDepth = Math.max(0, slopDepth + braces(counted));
    if (!geometry && !touch) {
      if (
        scanValues(line, SPACING_STYLE, false, spacingLiterals, SPACING_SCALE) ||
        scanValues(line, SPACING_PROP, true, spacingLiterals, SPACING_SCALE)
      ) {
        add('spacing', index);
      }
    }
    if (!geometry) {
      if (
        scanValues(line, RADIUS_STYLE, false, plainLiterals, RADIUS_SCALE) ||
        scanValues(line, RADIUS_PROP, true, plainLiterals, RADIUS_SCALE)
      ) {
        add('radius', index);
      }
    }
    // Duration 0 is how Reanimated applies a change at once (reduced motion).
    if (!isMotion && scanValues(line, DURATION_KEY, false, plainLiterals, [0])) add('duration', index);
    for (const [rule, pattern] of LINE_RULES) {
      if (rule === 'modal' && isModalWindow) continue;
      if (pattern.test(line)) add(rule, index);
    }
  });

  const joined = stripComments(source).replace(/\r\n/g, '\n');
  RN_IMPORT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RN_IMPORT.exec(joined))) {
    const names = match[1].split(',').map(part => part.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, ''));
    if (names.includes('KeyboardAvoidingView')) {
      add('keyboard-avoiding-view', joined.slice(0, match.index).split('\n').length - 1);
    }
  }

  return out.sort((a, b) => a.line - b.line || DESIGN_RULES.indexOf(a.rule) - DESIGN_RULES.indexOf(b.rule));
}

/** Non-test `.tsx` files under the given folders (relative to `root`), sorted. */
export function listDesignFiles(dirs: readonly string[] = DESIGN_SCAN_DIRS, root = PROJECT_ROOT): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full);
      } else if (/\.tsx$/.test(entry.name) && !/\.(test|spec)\.tsx$/.test(entry.name)) {
        files.push(normalise(path.relative(root, full)));
      }
    }
  };
  for (const dir of dirs) {
    const full = path.resolve(root, dir);
    if (!fs.existsSync(full)) throw new Error(`designScan: no folder ${dir}`);
    if (fs.statSync(full).isDirectory()) walk(full);
    else files.push(normalise(path.relative(root, full)));
  }
  return [...new Set(files)].sort();
}

/** Scans the given folders (default: components, screens, navigation). */
export function scanDesign(dirs: readonly string[] = DESIGN_SCAN_DIRS, root = PROJECT_ROOT): DesignScanResult {
  const files = listDesignFiles(dirs, root);
  const violations = files.flatMap(file => scanSource(fs.readFileSync(path.join(root, file), 'utf8'), file));
  return { files, violations };
}

/** Violations counted per rule (every rule present, zero included) and per file. */
export function summarizeDesignScan(violations: readonly DesignViolation[]): {
  byRule: Record<DesignRule, number>;
  byFile: Record<string, number>;
} {
  const byRule = Object.fromEntries(DESIGN_RULES.map(rule => [rule, 0])) as Record<DesignRule, number>;
  const byFile: Record<string, number> = {};
  for (const v of violations) {
    byRule[v.rule] += 1;
    byFile[v.file] = (byFile[v.file] ?? 0) + 1;
  }
  return { byRule, byFile };
}

/** A plain-text report: totals, counts per rule, then per file (most first). */
export function formatDesignReport(result: DesignScanResult): string {
  const { byRule, byFile } = summarizeDesignScan(result.violations);
  const lines = [
    `design scan: ${result.violations.length} violations in ${Object.keys(byFile).length} of ${result.files.length} files`,
    'per rule:',
    ...DESIGN_RULES.map(rule => `  ${rule}: ${byRule[rule]}`),
    'per file:',
    ...Object.entries(byFile)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([file, count]) => {
        const rules = summarizeDesignScan(result.violations.filter(v => v.file === file)).byRule;
        const detail = DESIGN_RULES.filter(rule => rules[rule] > 0)
          .map(rule => `${rule} ${rules[rule]}`)
          .join(', ');
        return `  ${file}: ${count} (${detail})`;
      }),
  ];
  return lines.join('\n');
}
