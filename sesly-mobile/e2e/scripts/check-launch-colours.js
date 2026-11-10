#!/usr/bin/env node
/**
 * Cold start colours (SPEC-startup 1, e2e/maestro/cold_start.yaml): the
 * launch is dark from the first frame. Every screenshot's centre-top must be
 * darker than L* 30; any cream frame (the old #F6F0EA window, L* about 95)
 * fails.
 *
 *   node e2e/scripts/check-launch-colours.js [files or folders] [--max-l 30] [--y 0.08]
 *
 * Folders contribute their cold_start*.png files; the default folder is
 * e2e/artifacts. The sample is the median of a small block at the
 * horizontal centre, `--y` of the height down: below the status bar and the
 * emulator's cutout band, inside the native launch screen or the first
 * screen's top bar. Exit code 1 on a light frame or when no screenshot is
 * found.
 */
'use strict';

const path = require('path');
const { collectPngs, lightness, medianColour, parseArgs, readPng, rgbToHex } = require('./png');

const DEFAULT_MAX_L = 30;
const DEFAULT_Y = 0.08;
/** Half the side of the sampled block (px). */
const HALF_BLOCK = 7;

function checkLaunchFrame(png, { maxL = DEFAULT_MAX_L, y = DEFAULT_Y } = {}) {
  const cx = png.width / 2;
  const cy = Math.round(png.height * y);
  const colour = medianColour(png, {
    x0: cx - HALF_BLOCK,
    x1: cx + HALF_BLOCK + 1,
    y0: cy - HALF_BLOCK,
    y1: cy + HALF_BLOCK + 1,
  });
  const l = lightness(colour);
  return { ok: l < maxL, lightness: l, colour: rgbToHex(colour), at: { x: Math.round(cx), y: cy } };
}

function run(argv, log = console.log) {
  const { options, paths } = parseArgs(argv);
  const maxL = options['max-l'] !== undefined ? Number(options['max-l']) : DEFAULT_MAX_L;
  const y = options.y !== undefined ? Number(options.y) : DEFAULT_Y;
  const targets = paths.length > 0 ? paths : [path.join(process.cwd(), 'e2e', 'artifacts')];
  const { files, missing } = collectPngs(targets, 'cold_start');
  missing.forEach(target => log(`MISSING ${target}`));
  if (files.length === 0) {
    log('No cold_start screenshot found. Run e2e/maestro/cold_start.yaml first.');
    return 1;
  }
  let failures = missing.length;
  for (const file of files) {
    const result = checkLaunchFrame(readPng(file), { maxL, y });
    if (!result.ok) failures += 1;
    log(
      `${result.ok ? 'PASS' : 'FAIL'}  ${path.basename(file)}  L* ${result.lightness.toFixed(1)} ` +
        `(${result.colour} at ${result.at.x},${result.at.y}; limit ${maxL})`,
    );
  }
  return failures === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}

module.exports = { checkLaunchFrame, run };
