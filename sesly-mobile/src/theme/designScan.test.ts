/**
 * Design source scan (docs/release-pass/SPEC-design.md 5.4), node fs like
 * fonts.test.ts. The rules live in ./designScan so the sweep tests can run
 * them per folder.
 *
 * STRICT: every rule holds over every non-test .tsx file of src/components,
 * src/screens and src/navigation, with no allowlist (the sweeps brought all
 * three to zero). A true geometry value takes a `// geometry` comment on
 * its line; nothing else is exempt.
 */

import {
  DESIGN_RULES,
  DESIGN_SCAN_DIRS,
  DesignRule,
  DesignViolation,
  RADIUS_SCALE,
  SPACING_SCALE,
  formatDesignReport,
  scanDesign,
  scanSource,
  stripComments,
  summarizeDesignScan,
} from './designScan';
import { RADIUS, SPACE } from './theme';

/** Rules hit by a snippet, as [rule, line] pairs. */
function hits(source: string, file = 'src/components/Probe.tsx'): [DesignRule, number][] {
  return scanSource(source, file).map(v => [v.rule, v.line]);
}

describe('design scan rules', () => {
  it('the scales are the token scales', () => {
    expect([...SPACING_SCALE]).toEqual([0, ...new Set(Object.values(SPACE))].sort((a, b) => a - b));
    expect([...RADIUS_SCALE]).toEqual([0, ...Object.values(RADIUS)].sort((a, b) => a - b));
  });

  describe('spacing', () => {
    it('accepts scale values and tokens, flags off-scale literals by absolute value', () => {
      const source = [
        'const s = StyleSheet.create({',
        '  a: { padding: 12, marginTop: -4, gap: 8 },',
        '  b: { paddingHorizontal: 10 },',
        '  c: { marginBottom: -3 },',
        '  d: { top: 7, left: 0 },',
        '  e: { rowGap: T.space.md, columnGap: SPACE.lg },',
        '  f: { padding: 1.5 },',
        '  g: { bottom: 24, right: 32 },',
        '});',
      ].join('\n');
      expect(hits(source)).toEqual([
        ['spacing', 3],
        ['spacing', 4],
        ['spacing', 5],
        ['spacing', 7],
      ]);
    });

    it('reads both branches of a ternary and added terms, not geometry math', () => {
      expect(hits('<View style={{ paddingTop: compact ? 8 : 14 }} />')).toEqual([['spacing', 1]]);
      expect(hits('<View style={{ paddingTop: compact ? 8 : 12 }} />')).toEqual([]);
      expect(hits('<View style={{ paddingTop: insets.top + 10 }} />')).toEqual([['spacing', 1]]);
      expect(hits('<View style={{ paddingTop: insets.top + 12 }} />')).toEqual([]);
      expect(hits('<View style={{ paddingBottom: insets.bottom - 3 }} />')).toEqual([['spacing', 1]]);
      expect(hits('<View style={{ marginLeft: (width - 44) / 2 }} />')).toEqual([]);
      expect(hits('<View style={{ paddingBottom: Math.max(insets.bottom, 12) + 8 }} />')).toEqual([]);
      expect(hits('<View style={{ padding: value ?? 10 }} />')).toEqual([]);
    });

    it('scans spacing props of components', () => {
      expect(hits('<Stack gap={10} padding={16} />')).toEqual([['spacing', 1]]);
      expect(hits('<Stack gap={8} />')).toEqual([]);
    });

    it('a line marked // geometry is exempt', () => {
      expect(hits('const thumb = { left: 3 }; // geometry: switch thumb inset')).toEqual([]);
      expect(hits('const thumb = { left: 3 }; // the thumb inset')).toEqual([['spacing', 1]]);
    });

    it('hit slops are touch geometry, also over several lines', () => {
      const source = [
        '<Pressable hitSlop={{ top: 5, bottom: 5 }} />',
        '<Pressable',
        '  hitSlop={{',
        '    top: 7,',
        '    bottom: 7,',
        '  }}',
        '  style={{ marginTop: 10 }}',
        '/>',
        'const HIT_SLOP = { top: 9, bottom: 9 };',
      ].join('\n');
      expect(hits(source)).toEqual([['spacing', 7]]);
    });

    it('ignores keys that only end like a spacing key and type annotations', () => {
      expect(hits('const o = { insetTop: 7, scrollTop: 9 };')).toEqual([]);
      expect(hits('type Box = { top: number; padding: number };')).toEqual([]);
      expect(hits('const y = layout.top;')).toEqual([]);
    });
  });

  describe('radius', () => {
    it('accepts the radius set, expressions and tokens; flags other literals', () => {
      const source = [
        '  a: { borderRadius: 16 },',
        '  b: { borderRadius: 14 },',
        '  c: { borderRadius: size / 2 },',
        '  d: { borderTopLeftRadius: 9, borderTopRightRadius: 32 },',
        '  e: { borderRadius: T.r.lg },',
        '  f: { borderRadius: 999 },',
        '<Tactile radius={18} />',
        '<Tactile radius={T.r.md} />',
        '<Tactile radius={round ? 22 / 2 : 12} />',
        '  g: { borderRadius: 11 }, // geometry: 22dp pill',
      ].join('\n');
      expect(hits(source)).toEqual([
        ['radius', 2],
        ['radius', 4],
        ['radius', 7],
      ]);
    });
  });

  describe('lips, motion, styles, presses', () => {
    it('flags lip literals and the deleted 5dp lip', () => {
      expect(hits('<Tactile lip={3} />\n<Tactile lip={LIP.md} />\n<Tactile lip={T.lipSize.xl} />')).toEqual([
        ['lip-literal', 1],
        ['lip-xl', 3],
      ]);
    });

    it('flags numeric durations except 0, and allows them in motion.ts', () => {
      const source = [
        'Animated.timing(v, { toValue: 1, duration: 200, useNativeDriver: true });',
        'withTiming(1, { duration: DURATION.base });',
        'withTiming(1, { duration: reduced ? 0 : DURATION.base });',
        'withTiming(1, { duration: reduced ? 0 : 280 });',
        'withTiming(1, { duration: 0 });',
      ].join('\n');
      expect(hits(source)).toEqual([
        ['duration', 1],
        ['duration', 4],
      ]);
      expect(hits('export const X = { duration: 200 };', 'src/theme/motion.ts')).toEqual([]);
    });

    it('flags the JS driver, LayoutAnimation, uncached styles and pressed translates', () => {
      const source = [
        'Animated.timing(v, { toValue: 1, duration: DURATION.fast, useNativeDriver: false });',
        'LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);',
        'const styles = useMemo(() => makeStyles(T), [T]);',
        'const text = useMemo(() => makeTextStyles(T), [T]);',
        'const styles = stylesFor(T);',
        "style={({ pressed }) => [{ transform: [{ translateY: pressed ? 2 : 0 }] }]}",
      ].join('\n');
      expect(hits(source)).toEqual([
        ['native-driver-off', 1],
        ['layout-animation', 2],
        ['uncached-styles', 3],
        ['uncached-styles', 4],
        ['pressed-translate', 6],
      ]);
    });
  });

  describe('modals and keyboard', () => {
    it('allows <Modal only in ModalWindow.tsx', () => {
      expect(hits('return <Modal visible transparent />;')).toEqual([['modal', 1]]);
      expect(hits('return <ModalWindow visible />;')).toEqual([]);
      expect(hits('return <Modal visible transparent />;', 'src/components/design/ModalWindow.tsx')).toEqual([]);
    });

    it("flags KeyboardAvoidingView only when it comes from 'react-native', also in a long import", () => {
      const source = [
        'import React from "react";',
        'import {',
        '  View,',
        '  KeyboardAvoidingView,',
        '  Text,',
        "} from 'react-native';",
      ].join('\n');
      expect(hits(source)).toEqual([['keyboard-avoiding-view', 2]]);
      expect(hits("import { KeyboardAvoidingView } from 'react-native-keyboard-controller';")).toEqual([]);
      expect(hits("import { KeyboardAvoidingView as KAV, View } from 'react-native';")).toEqual([
        ['keyboard-avoiding-view', 1],
      ]);
    });
  });

  describe('comments', () => {
    it('a rule named in a comment is not a use', () => {
      const source = [
        '// padding: 10 was too much; LayoutAnimation is banned',
        '/* <Modal and lip={5}',
        '   duration: 300 */',
        "const url = 'https://example.com/padding: 10'; // trailing note: margin: 3",
        '/** borderRadius: 14 */',
      ].join('\n');
      expect(hits(source)).toEqual([]);
    });

    it('stripComments keeps the line structure and the strings', () => {
      const source = "a; // x\n/* b\nc */ d;\nconst s = '// not a comment';";
      const stripped = stripComments(source);
      expect(stripped.split('\n')).toHaveLength(4);
      expect(stripped).toContain("const s = '// not a comment';");
      expect(stripped).not.toContain('x');
      expect(stripped.split('\n')[2].trim()).toBe('d;');
    });
  });

  it('reports the file, the line and the trimmed source', () => {
    expect(scanSource('a;\n   <Tactile lip={4} />', 'src\\screens\\X.tsx')).toEqual([
      { rule: 'lip-literal', file: 'src/screens/X.tsx', line: 2, text: '<Tactile lip={4} />' },
    ]);
  });

  it('summarises per rule (every rule listed) and per file', () => {
    const violations = [
      ...scanSource('<Tactile lip={4} />\n<Modal />', 'src/a.tsx'),
      ...scanSource('<Tactile lip={2} />', 'src/b.tsx'),
    ];
    const { byRule, byFile } = summarizeDesignScan(violations);
    expect(Object.keys(byRule)).toEqual([...DESIGN_RULES]);
    expect(byRule['lip-literal']).toBe(2);
    expect(byRule.modal).toBe(1);
    expect(byRule.spacing).toBe(0);
    expect(byFile).toEqual({ 'src/a.tsx': 2, 'src/b.tsx': 1 });
    const report = formatDesignReport({ files: ['src/a.tsx', 'src/b.tsx', 'src/c.tsx'], violations });
    expect(report).toContain('3 violations in 2 of 3 files');
    expect(report).toContain('src/a.tsx: 2 (lip-literal 1, modal 1)');
  });
});

const describeViolation = (v: DesignViolation): string => `${v.file}:${v.line} [${v.rule}] ${v.text}`;

describe('design scan of the tree (strict)', () => {
  const result = scanDesign();

  it('reads every non-test .tsx file of components, screens and navigation', () => {
    const { files } = result;
    expect(files.length).toBeGreaterThan(50);
    for (const dir of DESIGN_SCAN_DIRS) expect(files.some(file => file.startsWith(`${dir}/`))).toBe(true);
    expect(files.every(file => file.endsWith('.tsx') && !/\.test\.tsx$/.test(file))).toBe(true);
    expect(files).toContain('src/components/design/Tactile.tsx');
    expect(files).toContain('src/screens/audio/AudioPlayerScreen.tsx');
    expect(files).toContain('src/navigation/RootNavigator.tsx');
  });

  it('scans a single folder for the sweeps', () => {
    const { files, violations } = scanDesign(['src/components/design']);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every(file => file.startsWith('src/components/design/'))).toBe(true);
    expect(violations.every(v => files.includes(v.file))).toBe(true);
    expect(() => scanDesign(['src/no-such-folder'])).toThrow(/no folder/);
  });

  it.each(DESIGN_RULES)('no %s violation anywhere', rule => {
    // The message names every file and line, so a failure says what to fix.
    expect(result.violations.filter(v => v.rule === rule).map(describeViolation)).toEqual([]);
  });

  it('the report says zero', () => {
    expect(formatDesignReport(result)).toContain(
      `design scan: 0 violations in 0 of ${result.files.length} files`,
    );
  });
});
