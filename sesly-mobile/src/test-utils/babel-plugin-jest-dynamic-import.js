/**
 * Jest-only Babel plugin.
 *
 * Metro rewrites `await import('./x')` itself, so babel-preset-expo leaves
 * dynamic imports untouched. Under Jest (no --experimental-vm-modules) an
 * untransformed `import()` throws, which made AuthService.initialize and
 * AuthService.restoreSession untestable.
 *
 * @babel/plugin-transform-modules-commonjs already knows how to turn
 * `import()` into a lazy `require()`; it only does so when the (now merged)
 * dynamic-import plugin has flagged the file. This plugin sets that flag.
 * Wired in jest.config.js; never used by Metro.
 */
module.exports = function jestDynamicImport() {
  return {
    name: 'sesly-jest-dynamic-import',
    pre() {
      this.file.set('@babel/plugin-proposal-dynamic-import', '7.28.0');
    },
  };
};
