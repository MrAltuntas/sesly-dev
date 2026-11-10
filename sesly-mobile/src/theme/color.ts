/**
 * Colour arithmetic for the palette registry: the CSS `color-mix()` the
 * playful mockup derives its tints with, an alpha helper, the WCAG 2.x
 * contrast ratio the palette tests check, and the two perceptual measures
 * of the contrast contract (CIELAB L* for the surface ladder and the lips,
 * OKLab distance for colours that must not read as each other).
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** "#RRGGBB" (or "#RGB") to channels 0 to 255. */
export function hexToRgb(hex: string): Rgb {
  let value = hex.trim().replace('#', '');
  if (value.length === 3) value = value.split('').map(ch => ch + ch).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) throw new Error(`Not a hex colour: ${hex}`);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function channelHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0').toUpperCase();
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${channelHex(r)}${channelHex(g)}${channelHex(b)}`;
}

/**
 * `color-mix(in srgb, a <weight>, b)`: `weight` (0 to 1) of `a`, the rest of
 * `b`, per channel.
 */
export function mix(a: string, weight: number, b: string): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const w = Math.max(0, Math.min(1, weight));
  return rgbToHex({
    r: x.r * w + y.r * (1 - w),
    g: x.g * w + y.g * (1 - w),
    b: x.b * w + y.b * (1 - w),
  });
}

/**
 * `color-mix(in srgb, hex <alpha>, transparent)`: the colour at that
 * opacity, as React Native takes it.
 */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 1000) / 1000;
  return `rgba(${r},${g},${b},${a})`;
}

/** Parse "#RRGGBB" or "rgba(r,g,b,a)". */
export function parseColor(color: string): Rgb & { a: number } {
  const value = color.trim();
  if (value.startsWith('#')) return { ...hexToRgb(value), a: 1 };
  const match = value.match(/^rgba?\(([^)]+)\)$/);
  if (!match) throw new Error(`Unsupported colour: ${color}`);
  const [r, g, b, a = '1'] = match[1].split(',').map(part => part.trim());
  return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
}

/** A translucent colour painted over an opaque background, as hex. */
export function flatten(color: string, background: string): string {
  const top = parseColor(color);
  const base = hexToRgb(background);
  return rgbToHex({
    r: top.r * top.a + base.r * (1 - top.a),
    g: top.g * top.a + base.g * (1 - top.a),
    b: top.b * top.a + base.b * (1 - top.a),
  });
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance of an opaque colour. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * WCAG 2.x contrast ratio of a foreground on a background. A translucent
 * foreground or background is flattened onto `base` first (the page).
 */
export function contrastRatio(foreground: string, background: string, base = '#000000'): number {
  const bg = background.startsWith('#') ? background : flatten(background, base);
  const fg = foreground.startsWith('#') ? foreground : flatten(foreground, bg);
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * CIELAB L* (0 to 100) of an opaque colour: perceptual lightness, not
 * compressed in the darks the way the WCAG ratio is. The neutral ladder keeps
 * at least 6 L* between steps.
 */
export function lightness(hex: string): number {
  const y = luminance(hex);
  const f = y > 216 / 24389 ? Math.cbrt(y) : ((24389 / 27) * y + 16) / 116;
  return 116 * f - 16;
}

function toOklab(hex: string): [number, number, number] {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab distance of two opaque colours, x 100 (about 2 is just noticeable). */
export function oklabDistance(a: string, b: string): number {
  const [x, y] = [toOklab(a), toOklab(b)];
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
