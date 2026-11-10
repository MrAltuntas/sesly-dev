/**
 * @jest-environment node
 */
/**
 * The hand-edited native launch and system-bar configuration.
 *
 * android/ and ios/ are committed and edited by hand (never `expo prebuild`), so
 * nothing regenerates these files from app.config.js. A prebuild, a template
 * copy or a stray edit would silently bring back the cream window, the light
 * theme or the 6201 px splash bitmaps; this test reads the files with fs and
 * fails first. It is the merged contract of SPEC-startup 1.7 and SPEC-design 5.6:
 * - one launch picture: the default palette bg with the 120dp transparent mark,
 *   centred, on Android (system and compat splash) and iOS;
 * - dark-only natively: night mode pinned before React Native loads, a dark
 *   AppCompat parent, no values-night override, Dark on iOS;
 * - a transparent navigation bar without the contrast scrim.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_PALETTE, palettes } from './palettes';

type RgbaImage = { width: number; height: number; pixels: Buffer };

const splashAssets = require('../../scripts/generate-splash-assets') as {
  TARGETS: { file: string; size: number; mark: number; maxBytes?: number }[];
  MARK_DP: number;
  ICON_BOX_DP: number;
  MAX_ANDROID_BYTES: number;
  decodeRgba: (png: Buffer) => { width: number; height: number; pixels: Buffer } | null;
  encodeRgba: (
    image: { width: number; height: number; pixels: Buffer },
    options?: { filter?: number; strategy?: number },
  ) => Buffer;
  recompressPng: (png: Buffer) => Buffer;
  padToSquare: (image: RgbaImage, size: number) => RgbaImage;
};

const ROOT = path.join(__dirname, '../..');
const RES = path.join(ROOT, 'android/app/src/main/res');
const JAVA = path.join(ROOT, 'android/app/src/main/java/com/sesly');
const IOS = path.join(ROOT, 'ios/Sesly');

const BG = palettes[DEFAULT_PALETTE].bg.toUpperCase();
const MARK_DP = 120;
/** The splash icon box without an icon background; the system keeps its central 192dp circle. */
const ICON_BOX_DP = 288;
const SAFE_CIRCLE_DP = 192;
const DENSITIES: [string, number][] = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];
/** 60 KB for the bare marks; the 1152 px padded xxxhdpi box needs about 63 KB (see the script). */
const MAX_SPLASH_BYTES = 72 * 1024;

const read = (file: string): string => fs.readFileSync(file, 'utf8');

/**
 * Kotlin source without its comments, so a call that a prebuild or a stray edit
 * commented out (the plugin turns `setTheme(...)` into `// setTheme(...)`) does
 * not count as present. These files have no `//` inside string literals.
 */
const stripKotlinComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const kotlinCode = (file: string): string => stripKotlinComments(read(file));

/** `<color name="x">#...</color>` entries of a values file. */
function colors(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of xml.matchAll(/<color\s+name="([^"]+)"\s*>\s*([^<\s]+)\s*<\/color>/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

type StyleItem = { value: string; attrs: string };

/** Parent and items of one `<style>` in styles.xml. */
function style(xml: string, name: string): { parent: string; items: Record<string, StyleItem> } {
  const escaped = name.replace(/\./g, '\\.');
  const block = xml.match(
    new RegExp(`<style\\s+name="${escaped}"\\s+parent="([^"]*)"\\s*>([\\s\\S]*?)</style>`),
  );
  if (!block) throw new Error(`style ${name} not found`);
  const items: Record<string, StyleItem> = {};
  for (const m of block[2].matchAll(/<item\s+name="([^"]+)"([^>]*)>([^<]*)<\/item>/g)) {
    items[m[1]] = { attrs: m[2], value: m[3].trim() };
  }
  return { parent: block[1], items };
}

/** An sRGB colour from 0..1 component strings, as #RRGGBB. */
function hexFromComponents(red: string, green: string, blue: string): string {
  return (
    '#' +
    [red, green, blue]
      .map(c => Math.round(parseFloat(c) * 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

function pngHeader(file: string): { width: number; height: number; colorType: number; bytes: number } {
  const buf = fs.readFileSync(file);
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf[25],
    bytes: buf.length,
  };
}

/** Alpha of the pixel at (x, y) of a decoded RGBA image. */
function alphaAt(image: { width: number; pixels: Buffer }, x: number, y: number): number {
  return image.pixels[(y * image.width + x) * 4 + 3];
}

/** Inclusive pixel bounds of everything not fully transparent, or null for an empty image. */
function visibleBounds(image: RgbaImage): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (alphaAt(image, x, y) === 0) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** The RGBA bytes of the square of `size` px at (`left`, `top`) of a decoded image. */
function cropSquare(image: RgbaImage, left: number, top: number, size: number): Buffer {
  const rows: Buffer[] = [];
  for (let y = top; y < top + size; y++) {
    const start = (y * image.width + left) * 4;
    rows.push(image.pixels.subarray(start, start + size * 4));
  }
  return Buffer.concat(rows);
}

describe('Android launch and window colours', () => {
  const values = colors(read(path.join(RES, 'values/colors.xml')));

  it('paints the splash and every window in the default palette bg', () => {
    expect(values.splashscreen_background.toUpperCase()).toBe(BG);
    expect(values.window_background.toUpperCase()).toBe(BG);
  });

  it('has no night override and no layer-list splash drawable', () => {
    expect(fs.existsSync(path.join(RES, 'values-night/colors.xml'))).toBe(false);
    expect(fs.existsSync(path.join(RES, 'drawable/ic_launcher_background.xml'))).toBe(false);
    // With night mode pinned, any -night qualified folder (the plugin writes
    // drawable-night-* for a dark splash config) would silently win over values/.
    const nightDirs = fs.readdirSync(RES).filter(dir => /(^|-)night(-|$)/.test(dir));
    expect(nightDirs).toEqual([]);
  });

  it('keeps the launcher icon colour the adaptive icon reads', () => {
    // Same resource name as the deleted layer-list, but a colour: it is branding,
    // not the splash, and must survive.
    const icon = colors(read(path.join(RES, 'values/ic_launcher_background.xml')));
    expect(icon.ic_launcher_background).toMatch(/^#[0-9A-F]{6}$/i);
    expect(read(path.join(RES, 'mipmap-anydpi-v26/ic_launcher.xml'))).toContain(
      '@color/ic_launcher_background',
    );
  });
});

describe('Android themes (styles.xml)', () => {
  const xml = read(path.join(RES, 'values/styles.xml'));

  it('gives AppTheme a dark AppCompat parent with no DayNight lookup', () => {
    const { parent } = style(xml, 'AppTheme');
    expect(parent).toMatch(/^Theme\.AppCompat\./);
    expect(parent).not.toMatch(/Light/);
    expect(parent).not.toMatch(/DayNight/);
  });

  it('declares the native control colours and light-icon system bars on AppTheme', () => {
    const { items } = style(xml, 'AppTheme');
    // Native fallbacks only (every input sets its own per-palette colours): the
    // default palette's text3 for idle controls and its action colour for active ones.
    const T = palettes[DEFAULT_PALETTE];
    expect(items.colorControlNormal?.value.toUpperCase()).toBe(T.text3.toUpperCase());
    expect(items.colorControlActivated?.value.toUpperCase()).toBe(T.action.toUpperCase());
    expect(items.colorAccent?.value.toUpperCase()).toBe(T.action.toUpperCase());
    expect(items['android:enforceNavigationBarContrast']?.value).toBe('false');
    expect(items['android:windowLightStatusBar']?.value).toBe('false');
    expect(items['android:windowLightNavigationBar']?.value).toBe('false');
    expect(items['android:windowLightNavigationBar']?.attrs).toContain('tools:targetApi="27"');
    expect(items['android:windowBackground']?.value).toBe('@color/window_background');
  });

  it('shapes Theme.App.SplashScreen like the expo-splash-screen plugin', () => {
    const { parent, items } = style(xml, 'Theme.App.SplashScreen');
    expect(parent).toBe('Theme.SplashScreen');
    expect(items.windowSplashScreenBackground?.value).toBe('@color/splashscreen_background');
    // The padded bitmap itself, as the plugin writes it: no <inset> wrapper (LA-1).
    expect(items.windowSplashScreenAnimatedIcon?.value).toBe('@drawable/splashscreen_logo');
    expect(items.postSplashScreenTheme?.value).toBe('@style/AppTheme');
    expect(items['android:windowSplashScreenBehavior']?.attrs).toContain('tools:targetApi="33"');
    // No circle behind the mark, and no legacy layer-list window background.
    expect(items.windowSplashScreenIconBackgroundColor).toBeUndefined();
    expect(items['android:windowBackground']).toBeUndefined();
  });

  it('keeps the launch window bars dark whatever the phone theme is', () => {
    // Theme.SplashScreen is DayNight: on a light phone (Android 13+) it asks for dark
    // navigation icons and every Android 12+ variant enforces the contrast scrim. The
    // system draws the launch window's bars from this theme, before AppTheme exists.
    const { items } = style(xml, 'Theme.App.SplashScreen');
    expect(items['android:windowLightStatusBar']?.value).toBe('false');
    expect(items['android:windowLightNavigationBar']?.value).toBe('false');
    expect(items['android:windowLightNavigationBar']?.attrs).toContain('tools:targetApi="27"');
    expect(items['android:enforceNavigationBarContrast']?.value).toBe('false');
    expect(items['android:enforceNavigationBarContrast']?.attrs).toContain('tools:targetApi="29"');
  });

  it('starts MainActivity on the splash theme without recreating it on uiMode changes', () => {
    const manifest = read(path.join(ROOT, 'android/app/src/main/AndroidManifest.xml'));
    const activity = manifest.match(/<activity\s+android:name="\.MainActivity"[^>]*>/)?.[0] ?? '';
    expect(activity).toContain('android:theme="@style/Theme.App.SplashScreen"');
    const configChanges = activity.match(/android:configChanges="([^"]*)"/)?.[1].split('|') ?? [];
    expect(configChanges).toContain('uiMode');
  });
});

describe('Android splash mark', () => {
  it('is only the density bitmaps, with no wrapper drawable around them', () => {
    // The 84dp <inset> around a 120dp PNG drew nothing on the API 37 system splash.
    expect(fs.existsSync(path.join(RES, 'drawable/splashscreen_icon.xml'))).toBe(false);
    const drawableDirs = fs.readdirSync(RES).filter(dir => /^drawable(-|$)/.test(dir));
    const logos = drawableDirs.flatMap(dir =>
      fs
        .readdirSync(path.join(RES, dir))
        .filter(name => /^splashscreen_(logo|icon)\./.test(name))
        .map(name => `${dir}/${name}`),
    );
    expect(logos.sort()).toEqual(
      DENSITIES.map(([density]) => `drawable-${density}/splashscreen_logo.png`).sort(),
    );
  });

  it.each(DENSITIES)(
    'drawable-%s is the 288dp icon box with the 120dp mark centred and transparent around it',
    (density, scale) => {
      const file = path.join(RES, `drawable-${density}/splashscreen_logo.png`);
      const header = pngHeader(file);
      expect(header.width).toBe(ICON_BOX_DP * scale);
      expect(header.height).toBe(ICON_BOX_DP * scale);
      expect(header.bytes).toBeLessThan(MAX_SPLASH_BYTES);
      expect(header.colorType).toBe(6);
      const image = splashAssets.decodeRgba(fs.readFileSync(file));
      expect(image).not.toBeNull();

      // The mark: drawn at 120dp (its longer side), centred on the box within 1dp.
      const bounds = visibleBounds(image!);
      expect(bounds).not.toBeNull();
      const { x0, y0, x1, y1 } = bounds!;
      const longerSide = Math.max(x1 - x0 + 1, y1 - y0 + 1);
      expect(longerSide).toBeGreaterThanOrEqual((MARK_DP - 2) * scale);
      expect(longerSide).toBeLessThanOrEqual(MARK_DP * scale);
      const centre = (image!.width - 1) / 2;
      expect(Math.abs((x0 + x1) / 2 - centre)).toBeLessThanOrEqual(scale);
      expect(Math.abs((y0 + y1) / 2 - centre)).toBeLessThanOrEqual(scale);

      // The padding: nothing visible outside the central 120dp square, so the box
      // adds no frame, tint or second edge to the launch colour.
      const inner = ((ICON_BOX_DP - MARK_DP) / 2) * scale;
      const innerEnd = inner + MARK_DP * scale;
      expect(x0).toBeGreaterThanOrEqual(inner);
      expect(y0).toBeGreaterThanOrEqual(inner);
      expect(x1).toBeLessThan(innerEnd);
      expect(y1).toBeLessThan(innerEnd);
      const last = image!.width - 1;
      for (const [x, y] of [
        [0, 0],
        [last, 0],
        [0, last],
        [last, last],
      ]) {
        expect(alphaAt(image!, x, y)).toBe(0);
      }

      // Inside the system's 192dp circle, so neither splash clips a wing.
      let farthest = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (alphaAt(image!, x, y) === 0) continue;
          const half = image!.width / 2;
          farthest = Math.max(farthest, Math.hypot(x + 0.5 - half, y + 0.5 - half));
        }
      }
      expect(farthest).toBeLessThanOrEqual((SAFE_CIRCLE_DP / 2) * scale);

      // The bird alone in its square, not the old navy square.
      let transparent = 0;
      let opaque = 0;
      const square = cropSquare(image!, inner, inner, MARK_DP * scale);
      for (let i = 3; i < square.length; i += 4) {
        if (square[i] === 0) transparent++;
        else if (square[i] === 255) opaque++;
      }
      const total = (MARK_DP * scale) ** 2;
      expect(transparent / total).toBeGreaterThan(0.2);
      expect(opaque / total).toBeGreaterThan(0.3);
    },
  );

  it.each([
    ['mdpi', 'image.png'],
    ['xhdpi', 'image@2x.png'],
    ['xxhdpi', 'image@3x.png'],
  ])('drawable-%s holds the same mark pixels as the iOS %s', (density, iosName) => {
    const android = splashAssets.decodeRgba(
      fs.readFileSync(path.join(RES, `drawable-${density}/splashscreen_logo.png`)),
    )!;
    const ios = splashAssets.decodeRgba(
      fs.readFileSync(path.join(IOS, 'Images.xcassets/SplashScreenLegacy.imageset', iosName)),
    )!;
    const inner = (android.width - ios.width) / 2;
    expect(cropSquare(android, inner, inner, ios.width).equals(ios.pixels)).toBe(true);
  });
});

describe('Android activity and application code', () => {
  const activity = kotlinCode(path.join(JAVA, 'MainActivity.kt'));
  const application = kotlinCode(path.join(JAVA, 'MainApplication.kt'));

  it('reads code, not comments', () => {
    const code = stripKotlinComments('a()\n    // b()\n/** c()\n * d() */ e() // f()\ng()');
    for (const kept of ['a()', 'e()', 'g()']) expect(code).toContain(kept);
    for (const gone of ['b()', 'c()', 'd()', 'f()']) expect(code).not.toContain(gone);
  });

  it('registers expo-splash-screen before super.onCreate and never sets a theme by hand', () => {
    const register = activity.indexOf('SplashScreenManager.registerOnActivity(this)');
    const superCreate = activity.indexOf('super.onCreate(null)');
    expect(register).toBeGreaterThan(-1);
    expect(superCreate).toBeGreaterThan(register);
    expect(activity).toContain('import expo.modules.splashscreen.SplashScreenManager');
    expect(activity).not.toContain('setTheme(');
  });

  it('turns off the navigation bar scrim after React Native enabled edge-to-edge', () => {
    const superCreate = activity.indexOf('super.onCreate(null)');
    const contrast = activity.indexOf('isNavigationBarContrastEnforced = false');
    const lightBars = activity.indexOf('isAppearanceLightNavigationBars = false');
    expect(contrast).toBeGreaterThan(superCreate);
    expect(lightBars).toBeGreaterThan(superCreate);
    // Window.isNavigationBarContrastEnforced is API 29: unguarded it would crash
    // Android 7 to 9 (minSdk 24).
    expect(activity).toMatch(
      /if \(Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.Q\) \{\s*window\.isNavigationBarContrastEnforced = false/,
    );
    expect(activity.split('isNavigationBarContrastEnforced').length).toBe(2);
    expect(activity).toContain('Color.TRANSPARENT');
    expect(activity).toContain('R.color.window_background');
  });

  it('pins night mode first in onCreate, before React Native loads', () => {
    const superCreate = application.indexOf('super.onCreate()');
    const pin = application.indexOf('setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES)');
    const load = application.indexOf('loadReactNative(');
    expect(superCreate).toBeGreaterThan(-1);
    expect(pin).toBeGreaterThan(superCreate);
    expect(load).toBeGreaterThan(pin);
    expect(application).toContain('import androidx.appcompat.app.AppCompatDelegate');
  });

  it('keeps the hand-written FCM channel', () => {
    expect(application).toContain('createNotificationChannels()');
    expect(application).toContain('"sesly-default"');
  });
});

describe('iOS launch screen', () => {
  it('colours the splash background colorset in the default palette bg', () => {
    const json = JSON.parse(
      read(path.join(IOS, 'Images.xcassets/SplashScreenBackground.colorset/Contents.json')),
    ) as { colors: { color: { components: Record<string, string> } }[] };
    expect(json.colors).toHaveLength(1);
    const { red, green, blue } = json.colors[0].color.components;
    expect(hexFromComponents(red, green, blue)).toBe(BG);
  });

  const storyboard = read(path.join(IOS, 'SplashScreen.storyboard'));

  it('repeats the same colour in the storyboard fallback', () => {
    const color = storyboard.match(
      /<namedColor name="SplashScreenBackground">\s*<color ([^>]*)\/>/,
    )?.[1];
    expect(color).toBeDefined();
    const attr = (name: string) => color!.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1] ?? '';
    expect(hexFromComponents(attr('red'), attr('green'), attr('blue'))).toBe(BG);
  });

  it('centres a 120 x 120 image view instead of pinning it to the edges', () => {
    const imageView = storyboard.match(/<imageView id="EXPO-SplashScreen"[\s\S]*?<\/imageView>/)?.[0];
    expect(imageView).toBeDefined();
    expect(imageView).toMatch(/<constraint firstAttribute="width" constant="120"/);
    expect(imageView).toMatch(/<constraint firstAttribute="height" constant="120"/);
    const pins = [
      ...storyboard.matchAll(/<constraint firstItem="EXPO-SplashScreen" firstAttribute="(\w+)"/g),
    ].map(m => m[1]);
    expect(pins.sort()).toEqual(['centerX', 'centerY']);
  });

  it('is pinned to the dark interface style', () => {
    const plist = read(path.join(IOS, 'Info.plist'));
    expect(plist).toMatch(/<key>UIUserInterfaceStyle<\/key>\s*<string>Dark<\/string>/);
  });

  it('ships the mark at 120, 240 and 360 px as three different files', () => {
    const dir = path.join(IOS, 'Images.xcassets/SplashScreenLegacy.imageset');
    const json = JSON.parse(read(path.join(dir, 'Contents.json'))) as {
      images: { filename: string; scale: string }[];
    };
    const byScale = Object.fromEntries(json.images.map(i => [i.scale, i.filename]));
    expect(new Set(Object.values(byScale)).size).toBe(3);
    expect(pngHeader(path.join(dir, byScale['1x'])).width).toBe(120);
    expect(pngHeader(path.join(dir, byScale['2x'])).width).toBe(240);
    expect(pngHeader(path.join(dir, byScale['3x'])).width).toBe(360);
  });
});

type ExpoConfig = {
  userInterfaceStyle?: string;
  splash?: unknown;
  ios?: { splash?: unknown };
  android?: { splash?: unknown; adaptiveIcon?: unknown };
  plugins: (string | [string, Record<string, unknown>])[];
};

/** app.config.js as Expo reads it (its dotenv load logs a line, kept out of the output). */
function loadAppConfig(): ExpoConfig {
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    return (require('../../app.config.js') as { expo: ExpoConfig }).expo;
  } finally {
    log.mockRestore();
  }
}

describe('app.config.js mirror', () => {
  const expo = loadAppConfig();

  it('declares the dark interface style and no top-level splash', () => {
    expect(expo.userInterfaceStyle).toBe('dark');
    expect(expo).not.toHaveProperty('splash');
    expect(expo.ios).not.toHaveProperty('splash');
    expect(expo.android).not.toHaveProperty('splash');
    expect(expo.android?.adaptiveIcon).toBeDefined();
  });

  it('configures expo-splash-screen with the default bg and the 1024 px mark at 120', () => {
    const entry = expo.plugins.find(
      (p): p is [string, Record<string, unknown>] => Array.isArray(p) && p[0] === 'expo-splash-screen',
    );
    expect(entry).toBeDefined();
    const options = entry![1];
    expect(String(options.backgroundColor).toUpperCase()).toBe(BG);
    expect(options.imageWidth).toBe(MARK_DP);
    const image = path.join(ROOT, String(options.image));
    expect(pngHeader(image).width).toBe(1024);
  });
});

describe('scripts/generate-splash-assets.js', () => {
  const mdpi = fs.readFileSync(path.join(RES, 'drawable-mdpi/splashscreen_logo.png'));

  it('writes every committed splash file at the size this test expects', () => {
    expect(splashAssets.MARK_DP).toBe(MARK_DP);
    expect(splashAssets.ICON_BOX_DP).toBe(ICON_BOX_DP);
    expect(splashAssets.MAX_ANDROID_BYTES).toBe(MAX_SPLASH_BYTES);
    const byFile = Object.fromEntries(splashAssets.TARGETS.map(t => [t.file, t]));
    for (const [density, scale] of DENSITIES) {
      const target = byFile[`android/app/src/main/res/drawable-${density}/splashscreen_logo.png`];
      expect(target.size).toBe(ICON_BOX_DP * scale);
      expect(target.mark).toBe(MARK_DP * scale);
      expect(target.maxBytes).toBe(MAX_SPLASH_BYTES);
    }
    const iosScales: [string, number][] = [
      ['image.png', 1],
      ['image@2x.png', 2],
      ['image@3x.png', 3],
    ];
    for (const [name, scale] of iosScales) {
      const target = byFile[`ios/Sesly/Images.xcassets/SplashScreenLegacy.imageset/${name}`];
      expect(target.size).toBe(MARK_DP * scale);
      expect(target.mark).toBe(MARK_DP * scale);
    }
    expect(byFile['assets/splash-mark.png'].size).toBe(1024);
    for (const target of splashAssets.TARGETS) {
      const header = pngHeader(path.join(ROOT, target.file));
      expect(header.width).toBe(target.size);
      expect(header.height).toBe(target.size);
      if (target.maxBytes) expect(header.bytes).toBeLessThan(target.maxBytes);
    }
  });

  it('centres an image on a transparent square, pixel for pixel', () => {
    // A 2 x 2 image with four different opaque pixels.
    const pixels = Buffer.from([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]);
    const padded = splashAssets.padToSquare({ width: 2, height: 2, pixels }, 6);
    expect(padded.width).toBe(6);
    expect(padded.height).toBe(6);
    expect(padded.pixels.length).toBe(6 * 6 * 4);
    expect(cropSquare(padded, 2, 2, 2).equals(pixels)).toBe(true);
    expect(visibleBounds(padded)).toEqual({ x0: 2, y0: 2, x1: 3, y1: 3 });
    // Everything around it is fully transparent and colourless.
    const middle = cropSquare(padded, 2, 2, 2);
    const sum = (buf: Buffer) => buf.reduce((total, byte) => total + byte, 0);
    expect(sum(padded.pixels)).toBe(sum(middle));
    // The padded pixels survive the PNG encoder.
    const again = splashAssets.decodeRgba(splashAssets.encodeRgba(padded));
    expect(again?.pixels.equals(padded.pixels)).toBe(true);
  });

  it('refuses a square the image cannot sit exactly in the middle of', () => {
    const image = { width: 2, height: 2, pixels: Buffer.alloc(16) };
    expect(() => splashAssets.padToSquare(image, 1)).toThrow(/does not centre/);
    expect(() => splashAssets.padToSquare(image, 5)).toThrow(/does not centre/);
    expect(splashAssets.padToSquare(image, 2).pixels.equals(image.pixels)).toBe(true);
  });

  it('round-trips the pixels through every PNG scanline filter', () => {
    const image = splashAssets.decodeRgba(mdpi)!;
    expect(image.width).toBe(ICON_BOX_DP);
    for (let filter = 0; filter <= 4; filter++) {
      const again = splashAssets.decodeRgba(splashAssets.encodeRgba(image, { filter }));
      expect(again?.width).toBe(image.width);
      expect(again?.height).toBe(image.height);
      expect(again?.pixels.equals(image.pixels)).toBe(true);
    }
  });

  it('recompresses losslessly and never grows the file', () => {
    const image = splashAssets.decodeRgba(mdpi)!;
    // A deliberately poor encoding (no filter, Huffman only) gets smaller, same pixels.
    const poor = splashAssets.encodeRgba(image, { filter: 0, strategy: 2 });
    const better = splashAssets.recompressPng(poor);
    expect(better.length).toBeLessThan(poor.length);
    expect(splashAssets.decodeRgba(better)?.pixels.equals(image.pixels)).toBe(true);
    // The committed file is already the smallest candidate.
    expect(splashAssets.recompressPng(mdpi).length).toBeLessThanOrEqual(mdpi.length);
  });

  it('leaves anything that is not an 8-bit RGBA PNG untouched', () => {
    const notPng = Buffer.from('not a png at all');
    expect(splashAssets.decodeRgba(notPng)).toBeNull();
    expect(splashAssets.recompressPng(notPng)).toBe(notPng);

    // Same file with the IHDR colour type switched to RGB (2).
    const rgb = Buffer.from(mdpi);
    rgb[25] = 2;
    expect(splashAssets.decodeRgba(rgb)).toBeNull();
    expect(splashAssets.recompressPng(rgb)).toBe(rgb);

    // A signature with no chunks after it.
    const empty = mdpi.subarray(0, 8);
    expect(splashAssets.decodeRgba(empty)).toBeNull();
  });
});
