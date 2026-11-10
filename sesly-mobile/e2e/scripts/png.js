/**
 * Small PNG helpers for the screenshot checks of the Maestro flows
 * (check-launch-colours.js, check-sheet-bars.js). pngjs comes with Expo
 * (expo-asset > @expo/image-utils), so nothing is installed for it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

/** Decoded PNG: { width, height, data } with RGBA bytes. */
function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

/** An RGBA PNG buffer filled by `colourAt(x, y)` ([r, g, b]); tests build screenshots with it. */
function makePng(width, height, colourAt) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = colourAt(x, y);
      const i = (width * y + x) << 2;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** CIE L* (0 black to 100 white) of an sRGB colour, D65. */
function lightness([r, g, b]) {
  const linear = c => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const y = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  const e = (6 / 29) ** 3;
  const f = y > e ? Math.cbrt(y) : y / (3 * (6 / 29) ** 2) + 4 / 29;
  return 116 * f - 16;
}

/**
 * Per-channel median of the pixels in [x0, x1) x [y0, y1), clamped to the
 * image. A median ignores small light things on a dark field (status bar
 * icons, the gesture handle, the 3-button icons).
 */
function medianColour(png, { x0, y0, x1, y1 }) {
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const right = Math.min(png.width, Math.ceil(x1));
  const bottom = Math.min(png.height, Math.ceil(y1));
  if (right <= left || bottom <= top) throw new Error('Empty sample region');
  const channels = [[], [], []];
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const i = (png.width * y + x) << 2;
      channels[0].push(png.data[i]);
      channels[1].push(png.data[i + 1]);
      channels[2].push(png.data[i + 2]);
    }
  }
  return channels.map(values => {
    values.sort((a, b) => a - b);
    return values[values.length >> 1];
  });
}

/**
 * The PNG files named by the arguments: a file as it is, a folder as its
 * `<prefix>*.png` files (sorted). Missing paths are reported, not skipped.
 */
function collectPngs(paths, prefix) {
  const files = [];
  const missing = [];
  for (const target of paths) {
    if (!fs.existsSync(target)) {
      missing.push(target);
    } else if (fs.statSync(target).isDirectory()) {
      fs.readdirSync(target)
        .filter(name => name.startsWith(prefix) && name.toLowerCase().endsWith('.png'))
        .sort()
        .forEach(name => files.push(path.join(target, name)));
    } else {
      files.push(target);
    }
  }
  return { files, missing };
}

/** `--name value` and `--name=value` options, the rest as paths. */
function parseArgs(argv) {
  const options = {};
  const paths = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      paths.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq > 0) options[arg.slice(2, eq)] = arg.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) options[arg.slice(2)] = argv[(i += 1)];
    else options[arg.slice(2)] = 'true';
  }
  return { options, paths };
}

module.exports = {
  collectPngs,
  hexToRgb,
  lightness,
  makePng,
  medianColour,
  parseArgs,
  readPng,
  rgbToHex,
};
