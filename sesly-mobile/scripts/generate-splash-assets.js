#!/usr/bin/env node
/**
 * Generates the native launch splash images from the transparent bird mark.
 *
 *   node scripts/generate-splash-assets.js
 *
 * android/ and ios/ are committed and hand-edited (never `expo prebuild`), so the
 * expo-splash-screen plugin never writes these files; this script does, with the
 * same @expo/image-utils call the plugin uses. Run it again whenever
 * src/assets/images/logo.png changes and commit the outputs.
 *
 * The mark is 120dp everywhere (SPEC-startup 1.2):
 * - Android: drawable-<density>/splashscreen_logo.png is the whole 288dp splash icon
 *   box (288 / 432 / 576 / 864 / 1152 px, mdpi to xxxhdpi) with the 120dp mark centred
 *   and transparent around it, and windowSplashScreenAnimatedIcon names this bitmap
 *   directly. That is what the expo-splash-screen plugin writes (it composites the mark
 *   at imageWidth onto a 288dp canvas, @expo/prebuild-config withAndroidSplashImages);
 *   the earlier 120dp PNG inside an 84dp <inset> drawable showed no mark at all on the
 *   API 37 system splash (LA-1). The padding stays transparent: the splash window
 *   background is already the launch colour.
 * - iOS: SplashScreenLegacy.imageset at 120 pt (1x, 2x, 3x), the mark alone; the
 *   storyboard centres a 120 x 120 image view on SplashScreenBackground.
 * - assets/splash-mark.png at 1024 px: the source app.config.js names for the
 *   expo-splash-screen plugin (imageWidth 120), so a future prebuild agrees.
 *
 * Each Android file must stay under 72 KB. The cap guards against the old 1550 to
 * 6201 px set, which decoded to 38 to 154 MB at launch; the padded 1152 px xxxhdpi box
 * decodes to 5.3 MB. It was 60 KB for the bare 120dp marks: the transparent border makes
 * every mark row 2.4 times longer, so deflate's back references reach further and the
 * same mark pixels need about 63 KB at xxxhdpi (no filter or zlib strategy gets it under
 * 60 KB). src/theme/nativeConfig.test.ts checks dimensions, the centred mark, the
 * transparent padding and the sizes.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SOURCE = 'src/assets/images/logo.png';
const MARK_DP = 120;
/** The Android 12+ splash icon box without an icon background (the compat splash uses it too). */
const ICON_BOX_DP = 288;
const MAX_ANDROID_BYTES = 72 * 1024;

const ANDROID_RES = 'android/app/src/main/res';
const IOS_IMAGESET = 'ios/Sesly/Images.xcassets/SplashScreenLegacy.imageset';

/** Android density buckets and their scale over mdpi. */
const ANDROID_DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];

/** iOS scales, file names as listed in the imageset's Contents.json. */
const IOS_SCALES = [
  ['image.png', 1],
  ['image@2x.png', 2],
  ['image@3x.png', 3],
];

/**
 * Every file this script writes: project-relative path, pixel width of the square
 * file (`size`) and of the mark drawn centred in it (`mark`, equal to `size` when
 * the file is the mark alone).
 */
const TARGETS = [
  ...ANDROID_DENSITIES.map(([density, scale]) => ({
    file: `${ANDROID_RES}/drawable-${density}/splashscreen_logo.png`,
    size: ICON_BOX_DP * scale,
    mark: MARK_DP * scale,
    maxBytes: MAX_ANDROID_BYTES,
  })),
  ...IOS_SCALES.map(([name, scale]) => ({
    file: `${IOS_IMAGESET}/${name}`,
    size: MARK_DP * scale,
    mark: MARK_DP * scale,
  })),
  { file: 'assets/splash-mark.png', size: 1024, mark: 1024 },
];

// ---------------------------------------------------------------------------
// Lossless PNG re-encode. image-utils writes 8-bit RGBA with one fixed deflate
// setup (jimp: RLE strategy), which leaves the 480 px file at about 80 KB. The
// same pixels with the best of the five scanline filters and two zlib
// strategies come out about a third smaller. Node built-ins only.
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BYTES_PER_PIXEL = 4;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The value a PNG scanline filter predicts from the left, upper and upper-left bytes. */
function predict(filter, left, up, upLeft) {
  switch (filter) {
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4: {
      const p = left + up - upLeft;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - upLeft);
      if (pa <= pb && pa <= pc) return left;
      return pb <= pc ? up : upLeft;
    }
    default:
      return 0;
  }
}

/** RGBA pixels of an 8-bit, non-interlaced RGBA PNG, or null for any other kind. */
function decodeRgba(png) {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let width = 0;
  let height = 0;
  const idat = [];
  for (let at = 8; at + 8 <= png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [bitDepth, colorType, , , interlace] = body.subarray(8, 13);
      if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) return null;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }
  if (!width || !height || !idat.length) return null;
  const filtered = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * BYTES_PER_PIXEL;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= BYTES_PER_PIXEL ? pixels[row + x - BYTES_PER_PIXEL] : 0;
      const up = y > 0 ? pixels[row - stride + x] : 0;
      const upLeft = y > 0 && x >= BYTES_PER_PIXEL ? pixels[row - stride + x - BYTES_PER_PIXEL] : 0;
      const predictor = predict(filter, left, up, upLeft);
      pixels[row + x] = (filtered[src + x] + predictor) & 0xff;
    }
  }
  return { width, height, pixels };
}

/** Scanlines with one filter type (0 to 4) on every row. */
function filterRows({ width, height, pixels }, filter) {
  const stride = width * BYTES_PER_PIXEL;
  const out = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const dst = y * (stride + 1);
    out[dst] = filter;
    for (let x = 0; x < stride; x++) {
      const left = x >= BYTES_PER_PIXEL ? pixels[row + x - BYTES_PER_PIXEL] : 0;
      const up = y > 0 ? pixels[row - stride + x] : 0;
      const upLeft = y > 0 && x >= BYTES_PER_PIXEL ? pixels[row - stride + x - BYTES_PER_PIXEL] : 0;
      const predictor = predict(filter, left, up, upLeft);
      out[dst + 1 + x] = (pixels[row + x] - predictor) & 0xff;
    }
  }
  return out;
}

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** An 8-bit RGBA PNG of the pixels, every row with `filter`, deflated with `strategy`. */
function encodeRgba(image, { filter = 0, strategy = zlib.constants.Z_DEFAULT_STRATEGY } = {}) {
  const idat = zlib.deflateSync(filterRows(image, filter), { level: 9, memLevel: 9, strategy });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The smallest of the lossless encodings of the pixels, or `fallback` if that is smaller. */
function smallestEncoding(image, fallback = null) {
  let best = fallback;
  for (let filter = 0; filter <= 4; filter++) {
    for (const strategy of [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FILTERED]) {
      const candidate = encodeRgba(image, { filter, strategy });
      if (!best || candidate.length < best.length) best = candidate;
    }
  }
  return best;
}

/** The smallest lossless encoding of the same pixels (the input itself if that is smaller). */
function recompressPng(png) {
  const image = decodeRgba(png);
  if (!image) return png;
  return smallestEncoding(image, png);
}

/**
 * The image centred on a transparent square canvas `size` px wide, as the plugin's
 * compositeImagesAsync does with a transparent background. Throws when the image does
 * not fit or cannot sit exactly in the middle (an odd leftover would shift it by half a
 * pixel).
 */
function padToSquare(image, size) {
  const left = (size - image.width) / 2;
  const top = (size - image.height) / 2;
  if (left < 0 || top < 0 || !Number.isInteger(left) || !Number.isInteger(top)) {
    throw new Error(`a ${image.width} x ${image.height} image does not centre on ${size} px`);
  }
  const pixels = Buffer.alloc(size * size * BYTES_PER_PIXEL); // all zero: transparent
  const stride = image.width * BYTES_PER_PIXEL;
  for (let y = 0; y < image.height; y++) {
    image.pixels.copy(
      pixels,
      ((top + y) * size + left) * BYTES_PER_PIXEL,
      y * stride,
      (y + 1) * stride,
    );
  }
  return { width: size, height: size, pixels };
}

async function renderMark(size) {
  // No cacheType: nothing is written under .expo/. Sharp is used when it is
  // installed globally (sharp-cli), otherwise jimp; both keep the alpha channel.
  const { generateImageAsync } = require('@expo/image-utils');
  const { source } = await generateImageAsync(
    { projectRoot: PROJECT_ROOT },
    {
      src: path.join(PROJECT_ROOT, SOURCE),
      width: size,
      height: size,
      resizeMode: 'contain',
      backgroundColor: 'transparent',
    },
  );
  return recompressPng(source);
}

/** The PNG of one target: the mark at `target.mark` px, centred on `target.size` px. */
async function renderTarget(target) {
  const mark = await renderMark(target.mark);
  if (target.size === target.mark) return mark;
  const image = decodeRgba(mark);
  if (!image) throw new Error(`${target.file}: the rendered mark is not an 8-bit RGBA PNG`);
  return smallestEncoding(padToSquare(image, target.size));
}

async function main() {
  const failures = [];
  for (const target of TARGETS) {
    const buffer = await renderTarget(target);
    const out = path.join(PROJECT_ROOT, target.file);
    await fs.promises.mkdir(path.dirname(out), { recursive: true });
    await fs.promises.writeFile(out, buffer);
    const kb = (buffer.length / 1024).toFixed(1);
    console.log(`${target.file}  ${target.size} px (mark ${target.mark} px)  ${kb} KB`);
    if (target.maxBytes && buffer.length >= target.maxBytes) {
      failures.push(`${target.file} is ${kb} KB, the limit is ${target.maxBytes / 1024} KB`);
    }
  }
  if (failures.length) {
    throw new Error(failures.join('\n'));
  }
}

module.exports = {
  TARGETS,
  MARK_DP,
  ICON_BOX_DP,
  MAX_ANDROID_BYTES,
  decodeRgba,
  encodeRgba,
  recompressPng,
  padToSquare,
};

if (require.main === module) {
  main().catch(error => {
    console.error(error.message || error);
    process.exit(1);
  });
}
