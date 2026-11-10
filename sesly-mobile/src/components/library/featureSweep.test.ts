/**
 * The design rules (docs/release-pass/SPEC-design.md 5.4) hold in the
 * feature component folders: zero violations of the exported scanner, so a
 * later edit that brings back an off-scale gap, a literal lip or a
 * hand-rolled Modal fails here with the file and the line. The deprecated
 * store and design APIs are gone from these folders too (sources and tests).
 */

import * as fs from 'fs';
import * as path from 'path';
import { DESIGN_RULES, PROJECT_ROOT, formatDesignReport, scanDesign, stripComments } from '../../theme/designScan';

const SWEPT = [
  'src/components/audio',
  'src/components/auth',
  'src/components/detail',
  'src/components/library',
  'src/components/profile',
  'src/components/story',
  'src/components/voice',
  'src/components/voiceflow',
];

describe('feature sweep: the feature component folders', () => {
  const result = scanDesign(SWEPT);

  it('scans the eight folders and nothing else', () => {
    expect(result.files.length).toBeGreaterThan(30);
    expect(result.files).toContain('src/components/library/LibraryRowCard.tsx');
    expect(result.files).toContain('src/components/detail/SheetRow.tsx');
    expect(result.files).toContain('src/components/voiceflow/parts.tsx');
    expect(result.files.every(file => SWEPT.some(dir => file.startsWith(`${dir}/`)))).toBe(true);
  });

  it.each(DESIGN_RULES)('no %s violation', rule => {
    const hits = result.violations.filter(v => v.rule === rule);
    // The message names every file and line, so a failure says what to fix.
    expect(hits.map(v => `${v.file}:${v.line} ${v.text}`)).toEqual([]);
  });

  it('the report says zero', () => {
    expect(formatDesignReport(result)).toContain(`design scan: 0 violations in 0 of ${result.files.length} files`);
  });
});

/**
 * Deprecated APIs (SPEC-design 7, the W3 sweep list) by the way they are
 * read. `didJustFinish` is also a field of expo-audio's own status event,
 * so only the store's getter (`audio.didJustFinish`, `store.didJustFinish`)
 * counts.
 */
const DEPRECATED: readonly [string, RegExp][] = [
  ['withThemedChrome', /\bwithThemedChrome\b/],
  ['syncNavigationBar', /\bsyncNavigationBar\b/],
  ['TACTILE_PRESS_MS', /\bTACTILE_PRESS_MS\b/],
  ['lipSize.xl', /\blipSize\.xl\b/],
  ['subscription isPro / isFree', /\.(isPro|isFree)\b/],
  ['audio didJustFinish', /\b(audio|store|player|audioPlayer)\.didJustFinish\b/],
  ['audio acknowledgeFinish', /\.acknowledgeFinish\b/],
  ['audio loadFromNarration', /\.loadFromNarration\b/],
  ['audio / story isLoading', /\b(audio|audioPlayer|player|store|storyStore)\.isLoading\b/],
  ['useAddNarrator beforeDialog', /\bbeforeDialog\b/],
];

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(PROJECT_ROOT, dir));
  return out;
}

describe('feature sweep: deprecated APIs', () => {
  // This file names them on purpose.
  const self = path.resolve(__filename);
  const sources = SWEPT.flatMap(filesUnder).filter(file => path.resolve(file) !== self);

  it.each(DEPRECATED)('nothing reads %s', (_name, pattern) => {
    const hits = sources.flatMap(file => {
      const lines = stripComments(fs.readFileSync(file, 'utf8')).split(/\r?\n/);
      return lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => pattern.test(line))
        .map(({ line, index }) => `${path.relative(PROJECT_ROOT, file)}:${index + 1} ${line.trim()}`);
    });
    expect(hits).toEqual([]);
  });

  it('the patterns find a use, and skip one inside a comment', () => {
    const [, isLoading] = DEPRECATED.find(([name]) => name === 'audio / story isLoading')!;
    expect(isLoading.test('const busy = store.isLoading && x;')).toBe(true);
    expect(isLoading.test(stripComments('// store.isLoading was read here'))).toBe(false);
    const [, finish] = DEPRECATED.find(([name]) => name === 'audio didJustFinish')!;
    expect(finish.test('if (audio.didJustFinish) next();')).toBe(true);
    // expo-audio's own status event keeps its field.
    expect(finish.test("player.emit({ playing: false, didJustFinish: true });")).toBe(false);
  });
});
