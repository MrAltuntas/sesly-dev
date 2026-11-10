/**
 * @jest-environment node
 *
 * The e2e helpers: the static check of the Maestro flows (coverage test-19)
 * against the real flows and against small made-up ones, and the two
 * screenshot checks on generated PNGs.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkFlows } = require('./check-flows');
const launch = require('./check-launch-colours');
const sheets = require('./check-sheet-bars');
const { hexToRgb, lightness, makePng, readPng } = require('./png');
const { BASE_PALETTES, PALETTE_KEYS } = require('../../src/theme/palettes');

const FLOWS_DIR = path.join(__dirname, '..', 'maestro');

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sesly-e2e-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(relative, content) {
  const file = path.join(tmp, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

/** A made-up app: a few testIDs, one i18n string per language, and flows. */
function fixture(flows) {
  write(
    'src/Screen.tsx',
    [
      'export const Screen = ({ testID, paletteKey }) => (',
      '  <View testID="home-scroll">',
      '    <Button testID={busy ? "save-busy" : "save"} />',
      '    <View testID={`palette-option-${paletteKey}`} />',
      '    <Header testID="narrator-heading" />',
      '    <Text testID={testID ? `${testID}-link` : undefined} />',
      '  </View>',
      ');',
    ].join('\n'),
  );
  write('src/i18n/tr/common.json', JSON.stringify({ save: 'Kaydet', position: 'Sıra {{index}}/{{total}}' }));
  write('src/i18n/en/common.json', JSON.stringify({ save: 'Save', position: 'Queue {{index}} of {{total}}' }));
  for (const [name, content] of Object.entries(flows)) write(`maestro/${name}`, content);
  return checkFlows({
    flowsDir: path.join(tmp, 'maestro'),
    sourceRoots: [path.join(tmp, 'src')],
    i18nDir: path.join(tmp, 'src', 'i18n'),
  });
}

const flow = (body, header = 'appId: com.sesly\nname: Test') => `${header}\n---\n${body}\n`;

describe('the Maestro flows of the app', () => {
  it('parse, and every selector names a testID or a string the app has', () => {
    const result = checkFlows();
    expect(result.errors).toEqual([]);
    expect(result.selectors).toBeGreaterThan(150);
    expect(result.testIds).toBeGreaterThan(300);
  });

  it('cover the startup checks and every area the owner named', () => {
    const topLevel = fs.readdirSync(FLOWS_DIR).filter(name => name.endsWith('.yaml'));
    expect(topLevel.sort()).toEqual(
      [
        'cold_start.yaml',
        'mini_player.yaml',
        'offline_start.yaml',
        'palette_switch.yaml',
        'queue_library.yaml',
        'quota_free.yaml',
        'sheets_system_bars.yaml',
        'sleep_timer.yaml',
        'smoke.yaml',
      ].sort(),
    );
    const smoke = fs.readFileSync(path.join(FLOWS_DIR, 'smoke.yaml'), 'utf8');
    for (const step of ['sleep_timer', 'mini_player', 'queue_from_library', 'palette_switch', 'delete_account']) {
      expect(smoke).toContain(`steps/${step}.yaml`);
    }
  });

  it('pick every palette by its testID', () => {
    const steps = fs.readFileSync(path.join(FLOWS_DIR, 'steps', 'palette_switch.yaml'), 'utf8');
    for (const key of PALETTE_KEYS) {
      expect(steps).toContain(`id: "palette-option-${key}"`);
      expect(steps).toContain(`id: "palette-check-${key}"`);
    }
  });

  it('take a row play button, never "Hepsini çal" above the rows', () => {
    // Maestro's index counts top to bottom, so a selector that also matched
    // library-play-all (or its face) would start the whole list instead.
    const steps = fs
      .readdirSync(path.join(FLOWS_DIR, 'steps'))
      .map(name => fs.readFileSync(path.join(FLOWS_DIR, 'steps', name), 'utf8'))
      .join('\n');
    const selectors = [...steps.matchAll(/id: "(library-play-[^"]*)"/g)].map(match => match[1]);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      const regex = new RegExp(`^(?:${selector})$`);
      expect(regex.test('library-play-all')).toBe(false);
      expect(regex.test('library-play-all-face')).toBe(false);
      expect(regex.test('library-play-6f1c2a9e-1b2c-4d5e-8f90-a1b2c3d4e5f6')).toBe(true);
    }
  });

  it('never select by copy that the redesign removed', () => {
    const all = fs
      .readdirSync(path.join(FLOWS_DIR, 'steps'))
      .map(name => fs.readFileSync(path.join(FLOWS_DIR, 'steps', name), 'utf8'))
      .join('\n');
    for (const stale of ['Gecenin önerisi', 'Bu gece oku', 'ANLATAN SES', 'Oturumu kapat', 'Mail ile giriş yap', 'BİLDİRİMLER']) {
      expect(all).not.toContain(stale);
    }
  });
});

describe('checkFlows', () => {
  it('accepts static, template and derived ids, i18n texts and system texts', () => {
    const result = fixture({
      'main.yaml': flow(
        [
          '- tapOn:',
          '    id: "save"',
          '- tapOn:',
          '    id: "palette-option-erik"',
          '- tapOn:',
          '    id: "narrator-heading-link"',
          '- assertVisible:',
          '    id: "save|save-busy"',
          '    text: "Kaydet|Save"',
          '- assertVisible:',
          '    text: "Sıra [0-9]+/[0-9]+"',
          '- assertVisible: "Queue 2 of 3"',
          '- tapOn:',
          '    text: "Never|Not now"',
          '    optional: true',
          '- inputText: ${output.email}',
          '- runFlow: steps/one.yaml',
        ].join('\n'),
      ),
      'steps/one.yaml': flow('- back\n- hideKeyboard', 'appId: com.sesly'),
    });
    expect(result.errors).toEqual([]);
    expect(result.flows).toBe(2);
  });

  it('fails an id or a text the app does not have', () => {
    const result = fixture({
      'main.yaml': flow(
        [
          '- tapOn:',
          '    id: "login-screen"',
          '- extendedWaitUntil:',
          '    visible:',
          '      text: "Gecenin önerisi"',
          '    timeout: 1000',
          '- tapOn:',
          '    id: "save"',
          '    childOf:',
          '      id: "missing-parent"',
        ].join('\n'),
      ),
    });
    expect(result.errors).toEqual([
      'main.yaml: commands[0] tapOn: no testID in src matches id "login-screen"',
      'main.yaml: commands[1] extendedWaitUntil.visible: no tr or en string in src/i18n matches text "Gecenin önerisi"',
      'main.yaml: commands[2] tapOn > childOf: no testID in src matches id "missing-parent"',
    ]);
  });

  it('lets an absence check name what the app has or what is gone on purpose, and skips run-time values', () => {
    const result = fixture({
      'main.yaml': flow(
        [
          '- assertNotVisible:',
          '    id: "splash"',
          '- assertNotVisible: "Koyu tema|Sistem teması|Açık tema|Dark theme|System theme"',
          '- extendedWaitUntil:',
          '    notVisible:',
          '      id: "save-busy"',
          '    timeout: 1000',
          '- assertNotVisible:',
          '    text: "Kaydet|Save"',
          '- assertVisible:',
          '    id: "${output.someId}"',
          '- assertVisible:',
          '    text: "0:[0-5][0-9]"',
        ].join('\n'),
      ),
    });
    expect(result.errors).toEqual([]);
  });

  it('fails an absence check whose selector names nothing, which would pass forever', () => {
    const result = fixture({
      'main.yaml': flow(
        [
          '- assertNotVisible:',
          '    id: "save-bussy"',
          '- extendedWaitUntil:',
          '    notVisible:',
          '      text: "Kaydett"',
          '    timeout: 1000',
          '- runFlow:',
          '    when:',
          '      notVisible:',
          '        id: "old-banner"',
          '    commands:',
          '      - back',
        ].join('\n'),
      ),
    });
    expect(result.errors).toEqual([
      'main.yaml: commands[0] assertNotVisible: no testID in src matches id "save-bussy" (an absence check: list what is gone on purpose in GONE)',
      'main.yaml: commands[1] extendedWaitUntil.notVisible: no tr or en string in src/i18n matches text "Kaydett" (an absence check: list what is gone on purpose in GONE)',
      'main.yaml: commands[2] runFlow.when.notVisible: no testID in src matches id "old-banner" (an absence check: list what is gone on purpose in GONE)',
    ]);
  });

  it('checks the commands inside runFlow, repeat and the conditions', () => {
    const result = fixture({
      'main.yaml': flow(
        [
          '- runFlow:',
          '    when:',
          '      visible:',
          '        id: "gone-id"',
          '    commands:',
          '      - tapOnn: "x"',
          '- repeat:',
          '    times: 2',
          '    while:',
          '      notVisible:',
          '        id: "home-scroll"',
          '    commands:',
          '      - tapOn:',
          '          id: "home-scrolll"',
        ].join('\n'),
      ),
    });
    expect(result.errors).toEqual([
      'main.yaml: commands[0] runFlow.when.visible: no testID in src matches id "gone-id"',
      'main.yaml: commands[0] runFlow.commands[0]: unknown command "tapOnn"',
      'main.yaml: commands[1] repeat.commands[0] tapOn: no testID in src matches id "home-scrolll"',
    ]);
  });

  it('fails a broken file, a wrong header, a missing step, an unused step and a bad selector', () => {
    const result = fixture({
      'broken.yaml': 'appId: com.sesly\n---\n- tapOn: [unclosed\n',
      'headless.yaml': '- back\n',
      'other.yaml': flow('- runFlow: steps/missing.yaml', 'appId: com.other\nname: Other'),
      'keys.yaml': flow(['- tapOn:', '    idd: "save"', '- assertVisible:', '    id: "save(("', '- extendedWaitUntil:', '    visible: "Kaydet"'].join('\n')),
      'steps/unused.yaml': flow('- back', 'appId: com.sesly'),
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^broken\.yaml: does not parse/),
        'headless.yaml: needs a header document with appId',
        'other.yaml: appId is "com.other", expected com.sesly',
        'other.yaml: commands[0] runFlow: steps/missing.yaml does not exist',
        'keys.yaml: commands[0] tapOn: unknown selector key "idd"',
        'keys.yaml: commands[1] assertVisible: id "save((" is not a valid regex',
        'keys.yaml: commands[2] extendedWaitUntil: needs a timeout',
        'steps/unused.yaml: no flow runs this step',
      ]),
    );
  });

  it('wants a name on a top-level flow, not on a step', () => {
    const result = fixture({
      'main.yaml': flow('- runFlow: steps/one.yaml', 'appId: com.sesly'),
      'steps/one.yaml': flow('- back', 'appId: com.sesly'),
    });
    expect(result.errors).toEqual(['main.yaml: a top-level flow needs a name']);
  });
});

describe('check-launch-colours', () => {
  const W = 108;
  const H = 240;
  const NAVY = hexToRgb('#121A29');
  const CREAM = hexToRgb('#F6F0EA');

  it('reads lightness on the CIE L* scale', () => {
    expect(lightness([0, 0, 0])).toBeCloseTo(0, 5);
    expect(lightness([255, 255, 255])).toBeCloseTo(100, 1);
    expect(lightness(NAVY)).toBeLessThan(12);
    expect(lightness(CREAM)).toBeGreaterThan(90);
  });

  it('passes the dark launch and fails a cream frame', () => {
    const dark = launch.checkLaunchFrame(readPngFrom(makePng(W, H, () => NAVY)));
    expect(dark).toMatchObject({ ok: true, colour: '#121A29' });
    const cream = launch.checkLaunchFrame(readPngFrom(makePng(W, H, () => CREAM)));
    expect(cream.ok).toBe(false);
    expect(cream.lightness).toBeGreaterThan(30);
  });

  it('looks below the black cutout band, where a cream window would show', () => {
    const cutoutOverCream = makePng(W, H, (_x, y) => (y < H * 0.05 ? [0, 0, 0] : CREAM));
    expect(launch.checkLaunchFrame(readPngFrom(cutoutOverCream)).ok).toBe(false);
  });

  it('is not fooled by a few light pixels in the sampled block', () => {
    const icons = makePng(W, H, (x, y) => ((x + y) % 5 === 0 ? [255, 255, 255] : NAVY));
    expect(launch.checkLaunchFrame(readPngFrom(icons)).ok).toBe(true);
  });

  it('exits 1 when any screenshot is light, or none was taken, and 0 when all are dark', () => {
    const log = jest.fn();
    fs.writeFileSync(path.join(tmp, 'cold_start_0ms.png'), makePng(W, H, () => NAVY));
    fs.writeFileSync(path.join(tmp, 'cold_start_300ms.png'), makePng(W, H, () => NAVY));
    fs.writeFileSync(path.join(tmp, 'palette_erik.png'), makePng(W, H, () => CREAM));
    expect(launch.run([tmp], log)).toBe(0);
    expect(log).toHaveBeenCalledTimes(2);

    fs.writeFileSync(path.join(tmp, 'cold_start_first_screen.png'), makePng(W, H, () => CREAM));
    expect(launch.run([tmp], log)).toBe(1);
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^FAIL {2}cold_start_first_screen\.png {2}L\* 9\d\./));

    const empty = fs.mkdtempSync(path.join(tmp, 'empty-'));
    expect(launch.run([empty], log)).toBe(1);
    expect(launch.run([path.join(tmp, 'nothing.png')], log)).toBe(1);
    expect(launch.run([tmp, '--max-l', '100'], log)).toBe(0);
  });
});

describe('check-sheet-bars', () => {
  const W = 108;
  const H = 240;

  it('reads each palette surface from palettes.ts', () => {
    for (const key of PALETTE_KEYS) {
      expect(sheets.paletteToken(key, 'surface')).toBe(BASE_PALETTES[key].surface);
      expect(sheets.paletteToken(key, 'bar')).toBe(BASE_PALETTES[key].bar);
    }
    expect(() => sheets.paletteToken('pastel', 'surface')).toThrow('Unknown palette: pastel');
  });

  it('passes the sheet surface under a gesture handle and fails a white or grey bar', () => {
    const surface = hexToRgb(BASE_PALETTES['gece-mavisi'].surface);
    const withHandle = makePng(W, H, (x, y) => (y > H - 10 && y < H - 6 && x > 40 && x < 68 ? [230, 230, 230] : surface));
    expect(sheets.checkSheetBottom(readPngFrom(withHandle), surface)).toMatchObject({ ok: true, delta: 0 });

    const whiteBar = makePng(W, H, (_x, y) => (y >= H - 48 ? [255, 255, 255] : surface));
    expect(sheets.checkSheetBottom(readPngFrom(whiteBar), surface).ok).toBe(false);

    const greyScrim = makePng(W, H, (_x, y) => (y >= H - 48 ? [72, 76, 84] : surface));
    expect(sheets.checkSheetBottom(readPngFrom(greyScrim), surface).ok).toBe(false);

    const nearly = makePng(W, H, () => surface.map(c => c + 8));
    expect(sheets.checkSheetBottom(readPngFrom(nearly), surface)).toMatchObject({ ok: true, delta: 8 });
  });

  it('runs over the sheet_ screenshots of a folder, with the palette or an explicit colour', () => {
    const log = jest.fn();
    const surface = hexToRgb(BASE_PALETTES['gece-mavisi'].surface);
    fs.writeFileSync(path.join(tmp, 'sheet_speed.png'), makePng(W, H, () => surface));
    fs.writeFileSync(path.join(tmp, 'cold_start_0ms.png'), makePng(W, H, () => [255, 255, 255]));
    expect(sheets.run([tmp], log)).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(sheets.run([tmp, '--palette', 'erik'], log)).toBe(1);
    expect(sheets.run([tmp, `--expect=${BASE_PALETTES['gece-mavisi'].surface}`], log)).toBe(0);

    fs.writeFileSync(path.join(tmp, 'sheet_timer.png'), makePng(W, H, () => [255, 255, 255]));
    expect(sheets.run([tmp], log)).toBe(1);
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^FAIL {2}sheet_timer\.png {2}bottom 48 rows #FFFFFF/));
  });
});

function readPngFrom(buffer) {
  const file = path.join(tmp, `frame-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(file, buffer);
  return readPng(file);
}
