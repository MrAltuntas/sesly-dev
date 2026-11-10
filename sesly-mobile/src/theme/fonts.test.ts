/**
 * The bundled font files cover Turkish.
 *
 * Android draws a letter a custom font lacks in the system font (Roboto), in
 * the middle of a word. Fredoka, the mockup's display face, has no ğ, ş, İ,
 * Ğ or Ş, which is why "Keşfet" and "Değil" looked broken on the phone. This
 * test reads the cmap of every file App.tsx registers and fails if any
 * Turkish letter (or the circumflex vowels of loan words) is missing.
 *
 * It also pins how they are imported: by weight subpath, because the package
 * roots require every weight (16 Nunito files end up in the APK), and checks
 * that each file's PostScript name is the family name it is registered under.
 */

import * as fs from 'fs';
import * as path from 'path';
import { FONTS } from './theme';

const PKG = path.join(__dirname, '../../node_modules/@expo-google-fonts');

/** The files App.tsx registers under `FONTS`, by family name. */
const REGISTERED: Record<string, string> = {
  [FONTS.display]: 'baloo-2/600SemiBold/Baloo2_600SemiBold.ttf',
  [FONTS.body]: 'nunito/700Bold/Nunito_700Bold.ttf',
  [FONTS.label]: 'nunito/800ExtraBold/Nunito_800ExtraBold.ttf',
};

const TURKISH = 'çğıİöşüÇĞÖŞÜâîûÂÎÛ';

function tableOffset(buf: Buffer, tag: string): number {
  const count = buf.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16;
    if (buf.toString('ascii', rec, rec + 4) === tag) return buf.readUInt32BE(rec + 8);
  }
  throw new Error(`no ${tag} table`);
}

/** Code points with a glyph, from the cmap's format 4 and 12 subtables. */
function codePoints(buf: Buffer): Set<number> {
  const base = tableOffset(buf, 'cmap');
  const subtables = buf.readUInt16BE(base + 2);
  const out = new Set<number>();
  for (let i = 0; i < subtables; i++) {
    const start = base + buf.readUInt32BE(base + 8 + i * 8);
    const format = buf.readUInt16BE(start);
    if (format === 4) {
      const segX2 = buf.readUInt16BE(start + 6);
      const ends = start + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const rangeOffsets = deltas + segX2;
      for (let k = 0; k < segX2 / 2; k++) {
        const end = buf.readUInt16BE(ends + k * 2);
        const first = buf.readUInt16BE(starts + k * 2);
        const delta = buf.readInt16BE(deltas + k * 2);
        const ro = buf.readUInt16BE(rangeOffsets + k * 2);
        for (let c = first; c <= end && c !== 0xffff; c++) {
          let glyph: number;
          if (ro === 0) glyph = (c + delta) & 0xffff;
          else {
            glyph = buf.readUInt16BE(rangeOffsets + k * 2 + ro + (c - first) * 2);
            if (glyph) glyph = (glyph + delta) & 0xffff;
          }
          if (glyph) out.add(c);
        }
      }
    } else if (format === 12) {
      const groups = buf.readUInt32BE(start + 12);
      for (let k = 0; k < groups; k++) {
        const from = buf.readUInt32BE(start + 16 + k * 12);
        const to = buf.readUInt32BE(start + 20 + k * 12);
        for (let c = from; c <= to; c++) out.add(c);
      }
    }
  }
  return out;
}

describe('bundled fonts', () => {
  it.each(Object.entries(REGISTERED))('%s has every Turkish letter', (_family, file) => {
    const cps = codePoints(fs.readFileSync(path.join(PKG, file)));
    const missing = [...TURKISH].filter((ch) => !cps.has(ch.codePointAt(0)!));
    expect(missing).toEqual([]);
  });

  it('registers one file per family name, so Android never picks a weight itself', () => {
    expect(new Set(Object.values(FONTS)).size).toBe(Object.keys(FONTS).length);
    expect(Object.keys(REGISTERED).sort()).toEqual(Object.values(FONTS).slice().sort());
  });

  it('the App registers exactly these files, imported by weight subpath', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../App.tsx'), 'utf8');
    expect(app).toContain("import { Baloo2_600SemiBold } from '@expo-google-fonts/baloo-2/600SemiBold';");
    expect(app).toContain("import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold';");
    expect(app).toContain("import { Nunito_800ExtraBold } from '@expo-google-fonts/nunito/800ExtraBold';");
    expect(app).toContain('[FONTS.display]: Baloo2_600SemiBold');
    expect(app).toContain('[FONTS.body]: Nunito_700Bold');
    expect(app).toContain('[FONTS.label]: Nunito_800ExtraBold');
  });

  it('nothing imports a font package root (it would bundle every weight)', () => {
    const root = path.join(__dirname, '../..');
    const files = [path.join(root, 'App.tsx'), ...sourceFiles(path.join(root, 'src'))].filter(
      file => file !== __filename,
    );
    const bareRoot = /(?:from\s+|require\(\s*|import\(\s*)['"]@expo-google-fonts\/(?:baloo-2|nunito)['"]/;
    const offenders = files.filter(file => bareRoot.test(fs.readFileSync(file, 'utf8')));
    expect(offenders.map(file => path.relative(root, file))).toEqual([]);
    // The scan sees the real tree (App.tsx and the theme at least).
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(Object.entries(REGISTERED))('the file registered as %s has that PostScript name', (family, file) => {
    expect(postScriptName(fs.readFileSync(path.join(PKG, file)))).toBe(family);
  });
});

/** Every .ts / .tsx file under `dir`. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Name ID 6 (PostScript name) from the `name` table: the Windows record
 * (UTF-16BE) when there is one, else the Macintosh one (ASCII).
 */
function postScriptName(buf: Buffer): string | null {
  const base = tableOffset(buf, 'name');
  const count = buf.readUInt16BE(base + 2);
  const strings = base + buf.readUInt16BE(base + 4);
  let mac: string | null = null;
  for (let i = 0; i < count; i++) {
    const rec = base + 6 + i * 12;
    const platform = buf.readUInt16BE(rec);
    const nameId = buf.readUInt16BE(rec + 6);
    if (nameId !== 6) continue;
    const length = buf.readUInt16BE(rec + 8);
    const start = strings + buf.readUInt16BE(rec + 10);
    const raw = buf.subarray(start, start + length);
    if (platform === 3 || platform === 0) {
      let out = '';
      for (let k = 0; k + 1 < raw.length; k += 2) out += String.fromCharCode(raw.readUInt16BE(k));
      return out;
    }
    if (platform === 1) mac = raw.toString('latin1');
  }
  return mac;
}
