/**
 * Release-only Babel plugin: removes console.log, console.info, console.debug
 * and console.trace, keeps console.warn and console.error (and every other
 * console method).
 *
 * Hermes release builds bundle with `--minify false`, so a minifier's
 * drop_console never runs; babel.config.js adds this plugin when Metro's
 * Babel caller says isDev: false (every file of a non-dev bundle, node_modules
 * included). Jest passes no isDev and never loads it.
 *
 * A call that is a whole statement is removed (an `if` body becomes `{}`);
 * a call whose value is used (`const z = console.info(1)`, an arrow body)
 * becomes `undefined`. Arguments are dropped with the call, as with any
 * console stripper. A local binding named `console` is left alone.
 */
const STRIPPED = new Set(['log', 'info', 'debug', 'trace']);

function methodName(t, member) {
  if (!member.computed && t.isIdentifier(member.property)) return member.property.name;
  if (member.computed && t.isStringLiteral(member.property)) return member.property.value;
  return null;
}

module.exports = function stripConsole({ types: t }) {
  function isStrippedCall(path) {
    const callee = path.node.callee;
    if (!t.isMemberExpression(callee) && !t.isOptionalMemberExpression(callee)) return false;
    if (!t.isIdentifier(callee.object, { name: 'console' })) return false;
    if (path.scope.getBinding('console')) return false;
    const name = methodName(t, callee);
    return name !== null && STRIPPED.has(name);
  }

  function strip(path) {
    if (!isStrippedCall(path)) return;
    if (path.parentPath.isExpressionStatement()) {
      path.parentPath.remove();
      return;
    }
    path.replaceWith(
      path.scope.getBinding('undefined')
        ? path.scope.buildUndefinedNode()
        : t.identifier('undefined'),
    );
  }

  return {
    name: 'sesly-strip-console',
    visitor: {
      CallExpression: strip,
      OptionalCallExpression: strip,
    },
  };
};
