/**
 * @jest-environment node
 */
const { transformSync } = require('@babel/core');
const stripConsole = require('./strip-console');

/** Runs only the plugin (no preset, no config file) and returns the code. */
function strip(code) {
  return transformSync(code, {
    babelrc: false,
    configFile: false,
    plugins: [stripConsole],
    filename: 'sample.js',
  }).code;
}

describe('strip-console', () => {
  it('removes a log statement, keeps warn and turns a used info call into undefined', () => {
    const out = strip('console.log(x); console.warn(y); const z = console.info(1);');
    expect(out).not.toContain('console.log');
    expect(out).not.toContain('console.info');
    expect(out).toContain('console.warn(y);');
    expect(out).toContain('const z = undefined;');
  });

  it('removes log, info, debug and trace and keeps error and the other methods', () => {
    const out = strip(
      [
        'console.log("a");',
        'console.info("b");',
        'console.debug("c");',
        'console.trace("d");',
        'console.error("e");',
        'console.warn("f");',
        'console.table(rows);',
      ].join('\n'),
    );
    expect(out).toBe('console.error("e");\nconsole.warn("f");\nconsole.table(rows);');
  });

  it('handles computed and optional calls', () => {
    const out = strip('console["log"](a); console.debug?.(b); console["warn"](c);');
    expect(out).toBe('console["warn"](c);');
  });

  it('leaves an empty block when the call was the body of an if or a loop', () => {
    expect(strip('if (ok) console.log(x);')).toBe('if (ok) {}');
    expect(strip('while (next()) console.info(i);')).toBe('while (next()) {}');
    expect(strip('if (ok) run(); else console.log(x);')).toBe('if (ok) run();');
  });

  it('replaces a call used as a value, also inside an expression', () => {
    expect(strip('const f = () => console.log(x);')).toBe('const f = () => undefined;');
    expect(strip('use(console.trace(), 2);')).toBe('use(undefined, 2);');
    expect(strip('ok && console.log("done");')).toBe('ok && undefined;');
  });

  it('uses void 0 when undefined is shadowed', () => {
    expect(strip('function f(undefined) { return console.log(1); }')).toBe(
      'function f(undefined) {\n  return void 0;\n}',
    );
  });

  it('leaves a local binding named console alone', () => {
    const code = 'function f(console) {\n  console.log(x);\n}';
    expect(strip(code)).toBe(code);
  });

  it('does not touch references that are not calls', () => {
    const code = 'const log = console.log;\nlogger.log(x);\nconsole.log.bind(console);';
    expect(strip(code)).toBe(code);
  });
});
