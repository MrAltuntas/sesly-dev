/**
 * Self-test of the strict mode in setup.ts (coverage test-9): an update
 * outside act(), a list child without a key and a missing i18n key fail the
 * test, an allowlisted file keeps passing, every other console.error stays a
 * log, and the language is back to Turkish before each test.
 *
 * Each case drains what strict mode recorded (`takeStrictFailures`), which is
 * what the shared afterEach would otherwise turn into a failure
 * (`failOnStrictLeftovers`, tested on its own below).
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import {
  STRICT_ALLOWLIST,
  failOnStrictLeftovers,
  isStrictAllowed,
  takeStrictFailures,
} from './setup';

const THIS_FILE = 'src/test-utils/setup.test.tsx';
const ACT_WARNING = 'An update to Probe inside a test was not wrapped in act(...).';

let setProbeValue: (value: number) => void = () => undefined;

const Probe: React.FC = () => {
  const [value, setValue] = useState(0);
  setProbeValue = setValue;
  return <Text testID="probe">{String(value)}</Text>;
};

const MissingLabel: React.FC = () => {
  const { t } = useTranslation('home');
  return <Text testID="label">{t('strictSelfTest.noSuchKey')}</Text>;
};

const UnkeyedList: React.FC = () => (
  <View>
    {['a', 'b'].map(letter => (
      <Text>{letter}</Text>
    ))}
  </View>
);

describe('the shared check', () => {
  it('fails with every recorded warning and starts empty again', () => {
    expect(() => console.error(ACT_WARNING)).toThrow();
    i18n.t('home:strictSelfTest.recorded');

    let thrown: Error | undefined;
    try {
      failOnStrictLeftovers('strict warnings in this test');
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toContain('[strict test setup] strict warnings in this test:');
    expect(thrown?.message).toContain(`act: ${ACT_WARNING}`);
    expect(thrown?.message).toContain('i18nKey: home:strictSelfTest.recorded (tr)');

    expect(() => failOnStrictLeftovers('again')).not.toThrow();
  });
});

describe('act() warnings', () => {
  it('throws where the warning is logged and records it', () => {
    expect(() => console.error(ACT_WARNING)).toThrow(/not wrapped in act/);
    const failures = takeStrictFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^act: An update to Probe/);
  });

  it('catches a component that updates outside act', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('0');

    expect(() => setProbeValue(1)).toThrow(/not wrapped in act/);
    expect(takeStrictFailures()).toEqual([expect.stringMatching(/^act: .*Probe/s)]);
  });

  it('lets the same update through inside act', async () => {
    render(<Probe />);
    await act(async () => setProbeValue(2));

    expect(screen.getByTestId('probe')).toHaveTextContent('2');
    expect(takeStrictFailures()).toEqual([]);
  });
});

describe('list key warnings', () => {
  it('records a list rendered without keys although React swallows the throw', () => {
    // The throw happens inside React's dev key check, which does not
    // propagate it; the record is what fails the test in the shared afterEach.
    render(<UnkeyedList />);
    expect(takeStrictFailures()).toEqual([expect.stringMatching(/^listKey: Each child in a list/)]);
  });

  it('passes the same list with keys', () => {
    render(
      <View>
        {['a', 'b'].map(letter => (
          <Text key={letter}>{letter}</Text>
        ))}
      </View>,
    );
    expect(screen.getByText('b')).toBeTruthy();
    expect(takeStrictFailures()).toEqual([]);
  });
});

describe('missing i18n keys', () => {
  it('records a key that resolves to itself', () => {
    expect(i18n.t('home:strictSelfTest.missing')).toBe('strictSelfTest.missing');
    expect(takeStrictFailures()).toEqual(['i18nKey: home:strictSelfTest.missing (tr)']);
  });

  it('records a missing key rendered by a component, in the active language', async () => {
    await act(() => i18n.changeLanguage('en'));
    render(<MissingLabel />);

    expect(screen.getByTestId('label')).toHaveTextContent('strictSelfTest.noSuchKey');
    const failures = takeStrictFailures();
    expect(failures.length).toBeGreaterThan(0);
    expect(new Set(failures)).toEqual(new Set(['i18nKey: home:strictSelfTest.noSuchKey (en)']));
  });

  it('accepts a deliberate default value and a key that exists', () => {
    expect(i18n.t('home:strictSelfTest.missing', { defaultValue: 'Yedek' })).toBe('Yedek');
    expect(i18n.t('common:retry')).not.toBe('retry');
    expect(takeStrictFailures()).toEqual([]);
  });
});

describe('the language reset', () => {
  it('switches to English inside act', async () => {
    await act(() => i18n.changeLanguage('en'));
    expect(i18n.language).toBe('en');
  });

  it('is back to Turkish in the next test', () => {
    expect(i18n.language).toBe('tr');
  });
});

// SESLY_STRICT_ALL=1 switches the allowlist off on purpose.
(process.env.SESLY_STRICT_ALL === '1' ? describe.skip : describe)('the allowlist', () => {
  const withEntry = (allow: Array<'act' | 'listKey' | 'i18nKey'>, run: () => void) => {
    const entry = { file: THIS_FILE, allow };
    STRICT_ALLOWLIST.push(entry);
    try {
      run();
    } finally {
      STRICT_ALLOWLIST.splice(STRICT_ALLOWLIST.indexOf(entry), 1);
    }
  };

  it('resolves the running file relative to the project root', () => {
    withEntry(['act'], () => {
      expect(isStrictAllowed('act')).toBe(true);
      expect(isStrictAllowed('act', 'src/screens/home/HomeScreen.test.tsx')).toBe(false);
    });
    expect(isStrictAllowed('act')).toBe(false);
  });

  it('hides only the listed kind for a listed file', () => {
    withEntry(['act'], () => {
      expect(() => console.error(ACT_WARNING)).not.toThrow();
      expect(takeStrictFailures()).toEqual([]);

      expect(() => console.error('Each child in a list should have a unique "key" prop.')).toThrow();
      expect(takeStrictFailures()).toEqual([expect.stringMatching(/^listKey:/)]);
    });
  });

  it('hides missing i18n keys for a file listed with i18nKey', () => {
    withEntry(['i18nKey'], () => {
      i18n.t('home:strictSelfTest.allowed');
      expect(takeStrictFailures()).toEqual([]);
    });
  });
});

describe('other console errors', () => {
  it('stay plain logs', () => {
    expect(() => console.error('[setup self-test] a store error path logs on purpose')).not.toThrow();
    expect(takeStrictFailures()).toEqual([]);
  });

  it('do not match again when React or MobX logs a strict error', () => {
    const logged = new Error('[strict test setup] An update to X inside a test was not wrapped in act(...)');
    expect(() => console.error('[mobx] uncaught in reaction', logged)).not.toThrow();
    expect(takeStrictFailures()).toEqual([]);
  });
});
