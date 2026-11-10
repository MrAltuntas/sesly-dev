// Read by Metro (Expo's transformer extends it) and by Jest (jest-expo uses
// a project babel.config.js once one exists). Release bundles drop
// console.log / info / debug / trace (babel/strip-console.js); warn and error
// stay. Dev bundles and Jest transform exactly as with the default
// babel-preset-expo.
//
// Release is read from the Babel caller (Metro passes isDev: false for a
// non-dev bundle, the same flag babel-preset-expo reads), not from the env
// name: Expo's transformer resets BABEL_ENV after each file by writing the
// string "undefined", so an env.production block would apply to only some
// files of a release bundle. Jest passes no isDev and never gets the plugin.
// Clear the Metro cache (`npm start -- --clear`) after changing this file.
module.exports = function (api) {
  const isRelease = api.caller(caller => Boolean(caller && caller.isDev === false));
  return {
    presets: ['babel-preset-expo'],
    plugins: isRelease ? ['./babel/strip-console.js'] : [],
  };
};
