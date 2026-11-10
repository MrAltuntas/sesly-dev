/**
 * @jest-environment node
 *
 * babel.config.js: release bundles strip console.log, every other build
 * (dev, Jest) is unchanged.
 */
const path = require('path');
const { execFileSync } = require('child_process');
const babel = require('@babel/core');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'babel.config.js');
const PLUGIN = path.join(__dirname, 'strip-console.js');
const METRO_CALLER = { name: 'metro', bundler: 'metro', platform: 'android' };
const RELEASE_CALLER = { ...METRO_CALLER, isDev: false };
const DEV_CALLER = { ...METRO_CALLER, isDev: true };
const SAMPLE = 'export function f(x, y) { console.log(x); console.warn(y); return 1; }';

/** Resolved plugin files for a config load of App.tsx. */
function pluginFiles(options) {
  const partial = babel.loadPartialConfig({ cwd: ROOT, filename: path.join(ROOT, 'App.tsx'), ...options });
  return { partial, files: partial.options.plugins.map(p => p.file && p.file.resolved) };
}

/** The config function's result for one Babel caller, through a stub api. */
function configFor(caller) {
  const api = { caller: jest.fn(read => read(caller)), cache: jest.fn() };
  return { api, config: require(CONFIG)(api) };
}

describe('babel.config.js', () => {
  it('uses babel-preset-expo and adds the local plugin only for a release caller', () => {
    const release = configFor(RELEASE_CALLER);
    expect(release.config).toEqual({
      presets: ['babel-preset-expo'],
      plugins: ['./babel/strip-console.js'],
    });
    // Caching is left to api.caller (keyed on the release flag).
    expect(release.api.cache).not.toHaveBeenCalled();
    expect(release.config.env).toBeUndefined();

    expect(configFor(DEV_CALLER).config.plugins).toEqual([]);
    // Jest (jest-expo's caller has no isDev) and a call without a caller.
    expect(configFor(METRO_CALLER).config.plugins).toEqual([]);
    expect(configFor(undefined).config.plugins).toEqual([]);
  });

  it('resolves the plugin for a release caller whatever the env name, never for dev', () => {
    // A release file transformed while BABEL_ENV reads "undefined" (see the
    // Expo transformer test below) still gets the plugin.
    for (const envName of ['production', 'development', 'undefined']) {
      expect(pluginFiles({ configFile: CONFIG, envName, caller: RELEASE_CALLER }).files).toContain(PLUGIN);
    }
    expect(pluginFiles({ configFile: CONFIG, envName: 'production', caller: DEV_CALLER }).files).not.toContain(PLUGIN);
    expect(pluginFiles({ configFile: CONFIG, envName: 'test', caller: METRO_CALLER }).files).not.toContain(PLUGIN);
  });

  it('strips console.log through the full preset in a release transform, not in dev', () => {
    const transform = caller =>
      babel.transformSync(SAMPLE, {
        cwd: ROOT,
        filename: path.join(ROOT, 'src/sample.ts'),
        configFile: CONFIG,
        babelrc: false,
        caller,
      }).code;
    const release = transform(RELEASE_CALLER);
    expect(release).not.toContain('console.log');
    expect(release).toContain('console.warn(y)');
    expect(transform(DEV_CALLER)).toContain('console.log(x)');
  });

  describe("through Expo's Metro transformer", () => {
    // Runs @expo/metro-config's babel-transformer (what Metro calls for every
    // file) over several files in one Node process, as a Metro worker does,
    // and reports per file whether console.log survived. That transformer
    // writes BABEL_ENV back as the string "undefined" after a file, so a
    // config keyed on the env name would strip only some of them.
    const SCRIPT = `
      const path = require('path');
      const root = process.argv[1];
      const expoDir = path.dirname(require.resolve('expo/package.json', { paths: [root] }));
      const transformer = require(require.resolve('@expo/metro-config/build/babel-transformer', { paths: [expoDir] }));
      const generate = require(require.resolve('@babel/generator', { paths: [root] })).default;
      const dev = process.argv[2] === 'dev';
      const kept = [];
      for (let i = 0; i < 6; i++) {
        const { ast } = transformer.transform({
          filename: path.join(root, 'src', 'sample' + i + (i % 2 ? '.tsx' : '.ts')),
          src: 'export function f' + i + '(x: number) { console.log(x); console.warn(x); return x; }',
          options: {
            dev, hot: false, minify: false, platform: 'android', projectRoot: root,
            publicPath: '/assets', type: 'module', inlineRequires: false,
            enableBabelRCLookup: true, enableBabelRuntime: true,
            unstable_transformProfile: 'hermes-stable',
            customTransformOptions: { routerRoot: 'app' },
          },
          plugins: [],
        });
        kept.push(generate(ast).code.includes('console.log'));
      }
      process.stdout.write(JSON.stringify(kept));
    `;

    function keptPerFile(mode, env) {
      const childEnv = { ...process.env, ...env };
      for (const key of Object.keys(env)) if (env[key] === undefined) delete childEnv[key];
      const out = execFileSync(process.execPath, ['-e', SCRIPT, ROOT, mode], {
        cwd: ROOT,
        env: childEnv,
        encoding: 'utf8',
      });
      return JSON.parse(out);
    }

    it('strips every file of a release bundle (env as expo export:embed sets it)', () => {
      expect(keptPerFile('release', { NODE_ENV: 'production', BABEL_ENV: 'production' })).toEqual(
        Array(6).fill(false),
      );
    });

    it('strips every file of a release bundle with no env set', () => {
      expect(keptPerFile('release', { NODE_ENV: undefined, BABEL_ENV: undefined })).toEqual(
        Array(6).fill(false),
      );
    });

    it('keeps console.log in every file of a dev bundle', () => {
      expect(keptPerFile('dev', { NODE_ENV: 'development', BABEL_ENV: undefined })).toEqual(
        Array(6).fill(true),
      );
    });
  });

  describe('under Jest', () => {
    const jestConfig = require('../jest.config.js');
    const [, jestOptions] = jestConfig.transform['\\.[jt]sx?$'];
    // What jest-expo passed before this file existed: its preset file as the
    // config file, plus the dynamic-import plugin from jest.config.js.
    const before = {
      ...jestOptions,
      configFile: require.resolve('expo/internal/babel-preset', { paths: [ROOT] }),
    };

    it('loads this file with the test env, so the plugin is not applied', () => {
      const { partial, files } = pluginFiles({ ...jestOptions, envName: 'test' });
      expect(partial.config).toBe(CONFIG);
      expect(jestOptions.caller.isDev).toBeUndefined();
      expect(files).not.toContain(PLUGIN);
      expect(files).toContain(path.join(ROOT, 'src/test-utils/babel-plugin-jest-dynamic-import.js'));
    });

    it.each(['App.tsx', 'src/services/AuthService.ts', 'src/components/design/Tactile.tsx'])(
      'transforms %s exactly as the jest-expo preset file did',
      file => {
        const filename = path.join(ROOT, file);
        const source = require('fs').readFileSync(filename, 'utf8');
        const transform = options =>
          babel.transformSync(source, { ...options, cwd: ROOT, filename, envName: 'test' }).code;
        expect(transform(jestOptions)).toBe(transform(before));
      },
    );
  });
});
