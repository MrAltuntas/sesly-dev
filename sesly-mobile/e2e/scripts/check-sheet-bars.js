#!/usr/bin/env node
/**
 * The navigation bar under a sheet (R3, coverage test-3,
 * e2e/maestro/sheets_system_bars.yaml): the bar is transparent with no
 * contrast scrim, so the bottom rows of a screenshot with a sheet open show
 * the sheet's own surface. The median colour of the bottom `--rows` rows
 * must lie within `--tolerance` of the palette's `surface` on every channel;
 * a white bar or a grey scrim fails.
 *
 *   node e2e/scripts/check-sheet-bars.js [files or folders] [--palette gece-mavisi]
 *       [--expect #RRGGBB] [--rows 48] [--tolerance 12]
 *
 * Folders contribute their sheet_*.png files; the default folder is
 * e2e/artifacts. The expected colour is read from src/theme/palettes.ts, so
 * it follows the palette values; `--expect` overrides it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { collectPngs, hexToRgb, medianColour, parseArgs, readPng, rgbToHex } = require('./png');

const ROOT = path.resolve(__dirname, '..', '..');
const PALETTES_FILE = path.join(ROOT, 'src', 'theme', 'palettes.ts');
const DEFAULT_PALETTE = 'gece-mavisi';
const DEFAULT_ROWS = 48;
const DEFAULT_TOLERANCE = 12;

/**
 * One token of a palette, read from the source of palettes.ts: the
 * BASE_PALETTES registry (`'gece-mavisi': geceMavisi,` or the shorthand
 * `orman,`) names the constant, whose `token: '#RRGGBB'` is returned.
 */
function paletteToken(key, token, source = fs.readFileSync(PALETTES_FILE, 'utf8')) {
  const registry = /export const BASE_PALETTES[^=]*=\s*\{([\s\S]*?)\};/.exec(source);
  if (!registry) throw new Error('No palette registry in palettes.ts');
  let constant = null;
  for (const entry of registry[1].split(',')) {
    const text = entry.trim();
    if (!text) continue;
    const pair = /^'?([\w-]+)'?\s*:\s*(\w+)$/.exec(text);
    if (pair && pair[1] === key) constant = pair[2];
    else if (!pair && text === key) constant = text;
  }
  if (!constant) throw new Error(`Unknown palette: ${key}`);
  const body = new RegExp(`const ${constant}\\s*:\\s*BasePalette\\s*=\\s*\\{([\\s\\S]*?)\\};`).exec(source);
  if (!body) throw new Error(`No values for palette ${key}`);
  const value = new RegExp(`(?:^|[\\s,{])${token}:\\s*'(#[0-9A-Fa-f]{6})'`).exec(body[1]);
  if (!value) throw new Error(`Palette ${key} has no ${token}`);
  return value[1];
}

function checkSheetBottom(png, expected, { rows = DEFAULT_ROWS, tolerance = DEFAULT_TOLERANCE } = {}) {
  const colour = medianColour(png, {
    x0: png.width * 0.1,
    x1: png.width * 0.9,
    y0: png.height - rows,
    y1: png.height,
  });
  const delta = Math.max(...colour.map((c, i) => Math.abs(c - expected[i])));
  return { ok: delta <= tolerance, colour: rgbToHex(colour), delta };
}

function run(argv, log = console.log) {
  const { options, paths } = parseArgs(argv);
  const palette = options.palette || DEFAULT_PALETTE;
  const expectedHex = options.expect || paletteToken(palette, 'surface');
  const expected = hexToRgb(expectedHex);
  const rows = options.rows !== undefined ? Number(options.rows) : DEFAULT_ROWS;
  const tolerance = options.tolerance !== undefined ? Number(options.tolerance) : DEFAULT_TOLERANCE;
  const targets = paths.length > 0 ? paths : [path.join(process.cwd(), 'e2e', 'artifacts')];
  const { files, missing } = collectPngs(targets, 'sheet_');
  missing.forEach(target => log(`MISSING ${target}`));
  if (files.length === 0) {
    log('No sheet_ screenshot found. Run e2e/maestro/sheets_system_bars.yaml first.');
    return 1;
  }
  let failures = missing.length;
  for (const file of files) {
    const result = checkSheetBottom(readPng(file), expected, { rows, tolerance });
    if (!result.ok) failures += 1;
    log(
      `${result.ok ? 'PASS' : 'FAIL'}  ${path.basename(file)}  bottom ${rows} rows ${result.colour}, ` +
        `expected ${expectedHex.toUpperCase()} (${palette} surface), off by ${result.delta} (limit ${tolerance})`,
    );
  }
  return failures === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}

module.exports = { checkSheetBottom, paletteToken, run };
