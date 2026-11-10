/**
 * The contract between modules/sesly-media's Kotlin sources and its JS side
 * (index.ts, utils/mediaSession.ts, utils/sleepDeadline.ts). Every test mocks
 * the native module, so a renamed event, command or function would only
 * show on a device; this reads the sources as text instead (node fs, like
 * theme/fonts.test.ts).
 */

import fs from 'fs';
import path from 'path';
import { Platform } from 'react-native';

const MODULE_DIR = path.resolve(__dirname, '../../modules/sesly-media');
const KOTLIN_DIR = path.join(MODULE_DIR, 'android/src/main/java/expo/modules/seslymedia');
const KOTLIN_FILES = [
  'SeslyMediaSessionHolder.kt',
  'SeslySleepTimer.kt',
  'SeslyMediaPlayer.kt',
  'SeslyMediaModule.kt',
];

const read = (file: string) => fs.readFileSync(file, 'utf8');
const kotlin = Object.fromEntries(KOTLIN_FILES.map(name => [name, read(path.join(KOTLIN_DIR, name))]));
const indexTs = read(path.join(MODULE_DIR, 'index.ts'));

/** `const val NAME = "value"` string constants of a Kotlin source whose name starts with `prefix`. */
function stringConstants(source: string, prefix: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of source.matchAll(/const val (\w+)\s*=\s*"([^"]*)"/g)) {
    if (match[1].startsWith(prefix)) found.set(match[1], match[2]);
  }
  return found;
}

/** Body of `export interface <name> { ... }` in index.ts. */
function interfaceBody(name: string): string {
  const start = indexTs.indexOf(`export interface ${name} {`);
  if (start < 0) throw new Error(`index.ts has no interface ${name}`);
  let depth = 0;
  for (let i = indexTs.indexOf('{', start); i < indexTs.length; i++) {
    if (indexTs[i] === '{') depth += 1;
    if (indexTs[i] === '}') depth -= 1;
    if (depth === 0) return indexTs.slice(indexTs.indexOf('{', start) + 1, i);
  }
  throw new Error(`interface ${name} is not closed`);
}

const eventKeys = new Set(
  [...interfaceBody('SeslyMediaEvents').matchAll(/^\s*(\w+)\s*:/gm)].map(match => match[1]),
);
const commandUnion = new Set(
  [...(indexTs.match(/export type MediaSessionCommand =([^;]+);/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(
    match => match[1],
  ),
);
const moduleMethods = new Set(
  [...interfaceBody('SeslyMediaModule').matchAll(/^\s*(\w+)\s*[<(]/gm)].map(match => match[1]),
);
const kotlinFunctions = new Set(
  [...kotlin['SeslyMediaModule.kt'].matchAll(/\b(?:Async)?Function\("(\w+)"\)/g)].map(match => match[1]),
);

describe('modules/sesly-media: Kotlin and JS agree', () => {
  it('every EVENT_* the Kotlin code sends is an event the JS side listens for', () => {
    const events = KOTLIN_FILES.flatMap(name => [...stringConstants(kotlin[name], 'EVENT_').values()]);
    expect(events.sort()).toEqual(['onBecomingNoisy', 'onCommand', 'onSessionEnded', 'onSleepTimerFired']);
    for (const event of events) expect(eventKeys).toContain(event);
    expect([...eventKeys].sort()).toEqual([...events].sort());
  });

  it('the module declares every event it sends', () => {
    const declared = kotlin['SeslyMediaModule.kt'].match(/Events\(([^)]*)\)/)?.[1] ?? '';
    expect(declared).toContain('SeslyMediaSessionHolder.EVENT_COMMAND');
    expect(declared).toContain('SeslyMediaSessionHolder.EVENT_BECOMING_NOISY');
    expect(declared).toContain('SeslyMediaSessionHolder.EVENT_SESSION_ENDED');
    expect(declared).toContain('SeslySleepTimer.EVENT_FIRED');
  });

  it('every COMMAND_* the player routes to JS is a MediaSessionCommand, and back', () => {
    // SeslyMediaPlayer's commands are what `onCommand` carries. The session
    // holder's own COMMAND_SKIP_* are Media3 custom session actions (namespaced
    // ids that never reach JS), so they are not part of the union.
    const routed = [...stringConstants(kotlin['SeslyMediaPlayer.kt'], 'COMMAND_').values()];
    expect(routed.length).toBeGreaterThan(0);
    for (const command of routed) expect(commandUnion).toContain(command);
    expect([...commandUnion].sort()).toEqual([...routed].sort());
    for (const action of stringConstants(kotlin['SeslyMediaSessionHolder.kt'], 'COMMAND_').values()) {
      expect(action.startsWith('expo.modules.seslymedia.')).toBe(true);
    }
  });

  it('declares the sleep timer functions on both sides', () => {
    for (const name of ['armSleepTimer', 'disarmSleepTimer', 'isSleepTimerArmed']) {
      expect(kotlinFunctions).toContain(name);
      expect(moduleMethods).toContain(name);
    }
    expect(kotlin['SeslyMediaModule.kt']).toMatch(/AsyncFunction\("armSleepTimer"\)[\s\S]*?runOnQueue\(Queues\.MAIN\)/);
    expect(kotlin['SeslyMediaModule.kt']).toMatch(/AsyncFunction\("disarmSleepTimer"\)[\s\S]*?runOnQueue\(Queues\.MAIN\)/);
  });

  it('every Kotlin function is in the JS module type, and every JS method but addListener is native', () => {
    for (const name of kotlinFunctions) expect(moduleMethods).toContain(name);
    for (const name of moduleMethods) {
      if (name === 'addListener') continue;
      expect(kotlinFunctions).toContain(name);
    }
  });

  it('the fired event carries the fields the JS type names', () => {
    expect(kotlin['SeslySleepTimer.kt']).toMatch(/"paused" to /);
    expect(kotlin['SeslySleepTimer.kt']).toMatch(/"firedAtMs" to /);
    const body = interfaceBody('SleepTimerFiredEvent');
    expect(body).toMatch(/paused: boolean/);
    expect(body).toMatch(/firedAtMs: number/);
  });
});

describe('modules/sesly-media without the native module', () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('the wrapper is null, and so are the session and the sleep deadline, on Android too', () => {
    Platform.OS = 'android';
    jest.isolateModules(() => {
      jest.unmock('../../modules/sesly-media');
      const wrapper = require('../../modules/sesly-media');
      expect(wrapper.default).toBeNull();
      const { getAndroidMediaSession } = require('./mediaSession');
      expect(getAndroidMediaSession()).toBeNull();
      const { getNativeSleepDeadline } = require('./sleepDeadline');
      expect(getNativeSleepDeadline()).toBeNull();
    });
  });
});
