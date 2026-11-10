/**
 * The shims and dead code the release pass removed stay removed
 * (docs/release-pass/PLAN.json, W3-cleanup-core): a source scan of `src`
 * and App.tsx, comments stripped, so a later edit that brings one back fails
 * here with the file and the line.
 *
 *  - The backend playlist (store, service, model) gave way to the local
 *    queue (QueueStore): no file imports, requires or mocks it.
 *  - Deprecated APIs: `withThemedChrome`, `syncNavigationBar`,
 *    `lipSize.xl`, the subscription store's `isPro` / `isFree`, the audio
 *    store's `didJustFinish` / `acknowledgeFinish` / `loadFromNarration` /
 *    `isLoading`, `mapPlanUsage`, the legacy boolean plan (`toPlanId`).
 *    `didJustFinish` is also a field of expo-audio's own status event, so
 *    only a read of it on something other than a status counts.
 *  - The playlist copy is gone from the message and player namespaces.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PROJECT_ROOT, stripComments } from '../theme/designScan';
import trMessages from '../i18n/tr/messages.json';
import enMessages from '../i18n/en/messages.json';
import trPlayer from '../i18n/tr/player.json';
import enPlayer from '../i18n/en/player.json';

const SELF = path.resolve(__filename);

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(PROJECT_ROOT, dir));
  return out;
}

const isTest = (file: string) => /\.test\.tsx?$/.test(file);
const ALL = [...filesUnder('src'), path.join(PROJECT_ROOT, 'App.tsx')].filter(
  file => path.resolve(file) !== SELF,
);
const SOURCES = ALL.filter(file => !isTest(file));

/** Every line of `files` (comments stripped) that `pattern` matches, as "file:line text". */
function hitsOf(files: readonly string[], pattern: RegExp): string[] {
  return files.flatMap(file => {
    const lines = stripComments(fs.readFileSync(file, 'utf8')).split(/\r?\n/);
    return lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => pattern.test(line))
      .map(({ line, index }) => `${path.relative(PROJECT_ROOT, file)}:${index + 1} ${line.trim()}`);
  });
}

describe('the backend playlist is gone', () => {
  it.each(['src/stores/PlaylistStore.ts', 'src/services/PlaylistService.ts', 'src/models/Playlist.ts'])(
    '%s does not exist',
    file => {
      expect(fs.existsSync(path.join(PROJECT_ROOT, file))).toBe(false);
    },
  );

  it('no file imports, requires or mocks the playlist store, service or model', () => {
    const modulePath = /['"`][^'"`]*\/(stores\/PlaylistStore|services\/PlaylistService|models\/Playlist)['"`]/;
    expect(hitsOf(ALL, modulePath)).toEqual([]);
  });

  it('the scan sees the whole app, tests included', () => {
    const relative = ALL.map(file => path.relative(PROJECT_ROOT, file).replace(/\\/g, '/'));
    expect(relative).toContain('App.tsx');
    expect(relative).toContain('src/navigation/RootNavigator.tsx');
    expect(relative).toContain('src/stores/QueueStore.ts');
    expect(relative).toContain('src/hooks/useAuth.test.ts');
  });
});

/** Deprecated APIs, by the way they are read in a source file. */
const DEPRECATED: readonly [string, RegExp][] = [
  ['withThemedChrome', /\bwithThemedChrome\b/],
  ['syncNavigationBar', /\bsyncNavigationBar\b/],
  ['lipSize.xl', /\blipSize\.xl\b/],
  ['subscription isPro / isFree', /\.(isPro|isFree)\b/],
  ['isProTier', /\bisProTier\b/],
  ['the legacy boolean plan', /\btoPlanId\b|PlanId \| boolean/],
  ['the store didJustFinish', /\b(?!status\b|playerStatus\b|currentStatus\b)[A-Za-z_$][\w$]*\??\.didJustFinish\b|\bget didJustFinish\b/],
  ['acknowledgeFinish', /\backnowledgeFinish\b/],
  ['loadFromNarration', /\bloadFromNarration\b/],
  ['the audio store isLoading', /\b(audio|audioPlayer|audioStore|getAudioPlayerStore\(\))\??\.isLoading\b/],
  ['mapPlanUsage / BackendUsageSnapshot', /\b(mapPlanUsage|BackendUsageSnapshot)\b/],
  ['SyncedText', /models\/SyncedText|\bgetSentenceTimings\b/],
];

describe('deprecated APIs', () => {
  it.each(DEPRECATED)('no source reads %s', (_name, pattern) => {
    expect(hitsOf(SOURCES, pattern)).toEqual([]);
  });

  it('the audio store has no isLoading and no end flag of its own', () => {
    const store = stripComments(
      fs.readFileSync(path.join(PROJECT_ROOT, 'src/hooks/useAudioPlayer.ts'), 'utf8'),
    );
    expect(store).not.toMatch(/\bget isLoading\(\)/);
    expect(store).not.toMatch(/\bget didJustFinish\(\)/);
    // It names the narration a failure is about instead.
    expect(store).toMatch(/\bloadErrorNarrationId\b/);
  });

  it('the patterns find a use, and skip a comment and an expo-audio status', () => {
    const pattern = (name: string) => DEPRECATED.find(([n]) => n === name)![1];
    const finish = pattern('the store didJustFinish');
    expect(finish.test('if (audio.didJustFinish) next();')).toBe(true);
    expect(finish.test('return store?.didJustFinish;')).toBe(true);
    expect(finish.test('if (status.didJustFinish) this.onStoryEnd();')).toBe(false);
    expect(finish.test('}, [playerStatus?.didJustFinish, player]);')).toBe(false);
    expect(finish.test("player.emit({ playing: false, didJustFinish: true });")).toBe(false);
    expect(pattern('subscription isPro / isFree').test('if (subscriptionStore.isPro) {')).toBe(true);
    expect(pattern('lipSize.xl').test(stripComments('// T.lipSize.xl was the 5dp lip'))).toBe(false);
    expect(pattern('the audio store isLoading').test('const busy = audio.isLoading;')).toBe(true);
    // Another store's own loading flag is not the audio store's.
    expect(pattern('the audio store isLoading').test('if (store.isLoading) return;')).toBe(false);
  });
});

describe('the playlist copy is gone', () => {
  it.each([
    ['tr', trMessages, trPlayer],
    ['en', enMessages, enPlayer],
  ] as const)('%s: no playlist messages, no player:playlist keys', (_lang, messages, player) => {
    expect(messages).not.toHaveProperty('playlist');
    expect(player).not.toHaveProperty('playlist');
    // The queue that replaced it has its copy.
    expect(player).toHaveProperty('queue');
  });

  it.each([
    'story.detailFailed',
    'story.searchFailed',
    'common.permissionDenied',
    'common.recordingFailed',
    'common.playbackFailed',
    'common.invalidFormat',
    'common.minimumDuration',
    'common.maximumDuration',
    'narration.statusFailed',
    'narration.timeout',
  ])('the orphaned message %s is gone in both languages', key => {
    const [group, name] = key.split('.');
    const both = [trMessages, enMessages] as unknown as Record<string, Record<string, unknown>>[];
    for (const messages of both) {
      expect(messages[group]).toBeDefined();
      expect(messages[group]).not.toHaveProperty(name);
    }
  });
});
