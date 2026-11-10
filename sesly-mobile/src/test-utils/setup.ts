import '@testing-library/jest-native/extend-expect';
import path from 'path';
import { format } from 'util';
import { act } from 'react';

// Import all global mocks
import './mocks/native-modules';
import './mocks/navigation';
import { AccessibilityInfo } from 'react-native';

// UI strings go through i18next. Tests run in Turkish, the product's first
// language, whatever locale the machine reports; a test that needs English
// switches with `await act(() => i18n.changeLanguage('en'))` and is reset
// before the next test.
import i18n from '../i18n';

void i18n.changeLanguage('tr');

// Mock timers globally
jest.useFakeTimers();

// Silence known noise from React Native / libraries during testing
const IGNORED_LOGS = [
  'Animated: `useNativeDriver` was not specified',
  'Animated.event now requires',
  'Sending `onAnimatedValueUpdate` with no listeners registered',
  'componentWillReceiveProps has been renamed',
  'componentWillMount has been renamed',
];

/**
 * Strict mode (coverage test-9). Three warnings are bugs, never noise, so
 * they fail the test: a state update outside act() (the test asserts on a
 * tree that is still settling), a list child without a key, and a missing
 * i18n key (the screen would show the raw key; a `defaultValue` is a
 * deliberate fallback and passes). The two console warnings also throw where
 * they happen, so the stack points at the update; every one is recorded and
 * fails the test in afterEach in case the throw was swallowed (a store's
 * catch, a MobX reaction). Any other console.error stays a plain log: error
 * paths in stores and services log on purpose and tests trigger them.
 */
export type StrictKind = 'act' | 'listKey' | 'i18nKey';

const STRICT_CONSOLE: ReadonlyArray<{ kind: StrictKind; pattern: RegExp }> = [
  // React 19: "An update to X inside a test was not wrapped in act(...)."
  { kind: 'act', pattern: /not wrapped in act\(/ },
  // React 19: 'Each child in a list should have a unique "key" prop.'
  { kind: 'listKey', pattern: /unique "key" prop/ },
];

/**
 * Test files that still raise a strict warning, by kind, until the file's
 * owner fixes it (paths from the project root). An entry hides that kind
 * again for that file, as before strict mode; delete the entry once the file
 * runs clean (`SESLY_STRICT_ALL=1 npx jest <file>` ignores this list and
 * shows what is left). Empty since the end of the release pass: the 13
 * files listed when strict mode landed were fixed. The usual causes were a
 * test's own `i18n.changeLanguage` on a mounted tree (wrap it in act, or
 * drop the switch back to 'tr', which the shared beforeEach does), a store
 * change in a nested afterEach while the tree is still mounted, a late
 * answer after a sync assertion (end the test with `await act(async () =>
 * undefined)`), and a reduced-motion mock that outlived its test (reset
 * below).
 */
export const STRICT_ALLOWLIST: Array<{ file: string; allow: StrictKind[] }> = [];

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const IGNORE_ALLOWLIST = process.env.SESLY_STRICT_ALL === '1';

function currentTestFile(): string {
  const { testPath } = expect.getState();
  return testPath ? path.relative(PROJECT_ROOT, testPath).split(path.sep).join('/') : '';
}

export function isStrictAllowed(kind: StrictKind, file: string = currentTestFile()): boolean {
  if (IGNORE_ALLOWLIST) return false;
  return STRICT_ALLOWLIST.some(entry => entry.file === file && entry.allow.includes(kind));
}

const strictFailures: string[] = [];

/** Removes and returns what strict mode recorded so far (the setup self-test). */
export function takeStrictFailures(): string[] {
  return strictFailures.splice(0);
}

/** Marks this file's errors, so React or MobX logging one does not match again. */
const STRICT_TAG = '[strict test setup]';

export function failOnStrictLeftovers(when: string): void {
  const failures = takeStrictFailures();
  if (failures.length === 0) return;
  throw new Error(`${STRICT_TAG} ${when}:\n${failures.join('\n')}`);
}

const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

console.warn = (...args: any[]) => {
  const message = args.join(' ');
  if (IGNORED_LOGS.some(log => message.includes(log))) {
    return;
  }
  originalConsoleWarn(...args);
};

console.error = (...args: any[]) => {
  const message = args.join(' ');
  const strict = message.includes(STRICT_TAG)
    ? undefined
    : STRICT_CONSOLE.find(entry => entry.pattern.test(message));
  if (strict) {
    if (isStrictAllowed(strict.kind)) return;
    // React passes a format string ("An update to %s ..."): the first line,
    // filled in, names the component.
    const warning = format(...args).split('\n')[0];
    strictFailures.push(`${strict.kind}: ${warning}`);
    throw new Error(`${STRICT_TAG} ${warning}`);
  }
  if (IGNORED_LOGS.some(log => message.includes(log))) {
    return;
  }
  originalConsoleError(...args);
};

// A missing key resolves to the key itself; record it instead of throwing
// from t(), which would turn a wrong label into a render crash.
i18n.options.saveMissing = true;
i18n.options.missingKeyHandler = (_languages, namespace, key, _fallback, _update, options) => {
  const hasDefault = Object.keys(options ?? {}).some(
    option => option.startsWith('defaultValue') && options[option] !== undefined,
  );
  if (hasDefault || isStrictAllowed('i18nKey')) return;
  strictFailures.push(`i18nKey: ${namespace}:${key} (${i18n.language})`);
};

/**
 * React Native's AccessibilityInfo mocks are plain jest.fn()s: jest.spyOn
 * returns the mock itself, so a test's `mockResolvedValue(true)` outlived it
 * (restoreAllMocks only restores real spies) and every later test of the
 * file ran under reduced motion, its late answer landing outside act. Back
 * to React Native's defaults before every test.
 */
function resetAccessibilityMocks(): void {
  const a11y = AccessibilityInfo as unknown as Record<string, unknown>;
  const reset = (name: string, impl: () => unknown) => {
    const fn = a11y[name];
    if (jest.isMockFunction(fn)) fn.mockImplementation(impl);
  };
  reset('isReduceMotionEnabled', () => Promise.resolve(false));
  reset('isScreenReaderEnabled', () => Promise.resolve(false));
  reset('addEventListener', () => ({ remove: jest.fn() }));
}

beforeEach(async () => {
  // Raised during the previous test's cleanup (RNTL unmounts after the
  // afterEach below has run).
  failOnStrictLeftovers('raised after the previous test ended');
  resetAccessibilityMocks();
  // Before the test, not after it: RNTL's cleanup runs after this file's
  // afterEach, so a reset there re-rendered the still mounted tree. Inside
  // act all the same in a component test (RNTL sets the act environment).
  if (i18n.language === 'tr') return;
  if ((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT) {
    await act(async () => {
      await i18n.changeLanguage('tr');
    });
  } else {
    await i18n.changeLanguage('tr');
  }
});

// Cleanup after each test
afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  failOnStrictLeftovers('strict warnings in this test');
});

afterAll(() => {
  failOnStrictLeftovers('raised after the last test of the file ended');
});
