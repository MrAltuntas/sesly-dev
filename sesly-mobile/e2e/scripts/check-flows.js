#!/usr/bin/env node
/**
 * Static check of the Maestro flows in e2e/maestro (coverage test-19): the
 * old flows broke silently because their selectors named copy that no longer
 * existed. This reads every flow and fails on
 *   - YAML that does not parse, a missing `appId: com.sesly` header, a
 *     command or selector key Maestro does not know, a runFlow file that is
 *     not there, a step file no flow uses;
 *   - an `id:` selector that matches no testID in src (static ids, ids built
 *     from a template such as `palette-option-${paletteKey}`, and ids a
 *     component derives from its testID, such as `${testID}-link`);
 *   - a `text:` selector that matches no string of src/i18n (tr or en,
 *     `{{name}}` read as any value) and is not a known system text (a text
 *     without letters, such as a clock "0:[0-5][0-9]", is a value and passes).
 * Selectors that must be absent (assertNotVisible, notVisible) are held to
 * the same rule, since a stale one passes forever on a device; what is gone
 * on purpose is listed in GONE with the reason. Values with `${...}` are
 * filled in by Maestro at run time and are skipped.
 *
 *   node e2e/scripts/check-flows.js             the static check
 *   node e2e/scripts/check-flows.js --maestro   plus `maestro check-syntax` on every
 *                                               flow, when Maestro is installed
 *
 * Exit code 1 on any error. Runs in jest as e2e/scripts/scripts.test.js.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const YAML = require('yaml');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULTS = {
  flowsDir: path.join(ROOT, 'e2e', 'maestro'),
  sourceRoots: [path.join(ROOT, 'src'), path.join(ROOT, 'App.tsx')],
  i18nDir: path.join(ROOT, 'src', 'i18n'),
  appId: 'com.sesly',
};

const HEADER_KEYS = new Set(['appId', 'name', 'tags', 'env', 'onFlowStart', 'onFlowComplete', 'jsEngine', 'properties']);

/** Commands written without an argument. */
const BARE_COMMANDS = new Set([
  'back', 'clearKeychain', 'clearState', 'hideKeyboard', 'inputRandomEmail', 'inputRandomNumber',
  'inputRandomPersonName', 'inputRandomText', 'killApp', 'launchApp', 'pasteText', 'scroll',
  'stopApp', 'stopRecording', 'toggleAirplaneMode', 'waitForAnimationToEnd',
]);

/** Every command with an argument, and which of its keys hold selectors. */
const COMMANDS = {
  addMedia: {}, assertTrue: {}, clearState: {}, eraseText: {}, evalScript: {}, inputText: {},
  killApp: {}, launchApp: {}, openLink: {}, pressKey: {}, runScript: {}, setAirplaneMode: {},
  setClipboard: {}, setLocation: {}, setOrientation: {}, setPermissions: {}, startRecording: {},
  stopApp: {}, takeScreenshot: {}, travel: {}, waitForAnimationToEnd: {}, scroll: {},
  assertWithAI: {}, assertNoDefectsWithAI: {}, extractTextWithAI: {},
  tapOn: { self: 'present' }, doubleTapOn: { self: 'present' }, longPressOn: { self: 'present' },
  assertVisible: { self: 'present' }, copyTextFrom: { self: 'present' },
  assertNotVisible: { self: 'absent' },
  scrollUntilVisible: { element: 'present' },
  swipe: { from: 'present' },
  extendedWaitUntil: { visible: 'present', notVisible: 'absent' },
  runFlow: {}, repeat: {}, retry: {},
};

/** Keys of a selector (and of the tap options written next to it). */
const SELECTOR_KEYS = new Set([
  'id', 'text', 'index', 'enabled', 'checked', 'focused', 'selected', 'traits', 'css',
  'width', 'height', 'tolerance', 'point', 'childOf', 'below', 'above', 'leftOf', 'rightOf',
  'containsChild', 'containsDescendants', 'optional', 'label', 'retryTapIfNoChange',
  'waitUntilVisible', 'repeat', 'delay', 'waitToSettleTimeoutMs',
]);
const RELATION_KEYS = ['childOf', 'below', 'above', 'leftOf', 'rightOf', 'containsChild'];
const CONDITION_KEYS = new Set(['visible', 'notVisible', 'true', 'platform']);

/** Texts that are not the app's: Android system sheets and the Expo dev client. */
const SYSTEM_TEXTS = new Map([
  ['Never|Not now', 'Android password manager sheet'],
  ['Allow|While using the app', 'Android permission dialog'],
  ['DEVELOPMENT SERVERS', 'Expo dev client launcher'],
  ['http://.*:8081', 'Expo dev client launcher (the Metro entry)'],
  ['Runtime version.*', 'Expo dev menu intro'],
  ['Close', 'Expo dev menu intro'],
]);
/** Ids that are absent on purpose. */
const FLOW_ONLY_IDS = new Map([['maestro-wait-never', 'steps/wait.yaml: a pause, nothing is ever found']]);
/**
 * Selectors of absence checks that name what the app no longer has, as a
 * guard against it coming back (the exact `id:` or `text:` value).
 */
const GONE = new Map([
  ['splash', 'the JS splash screen: the native launch screen hands over to the first screen (SPEC-startup 1)'],
  ['Koyu tema|Sistem teması|Açık tema|Dark theme|System theme', 'the theme setting: the app is dark only'],
]);
/** A template that begins with one of these variables extends a known id. */
const BASE_VARIABLES = new Set(['testID', 'testIDPrefix', 'prefix', 'inputProps.testID']);

// ─── testIDs in the source ───────────────────────────────────

function listFiles(target, accept) {
  if (!fs.existsSync(target)) return [];
  if (fs.statSync(target).isFile()) return accept(target) ? [target] : [];
  return fs.readdirSync(target).flatMap(name => {
    if (name === 'node_modules' || name.startsWith('.')) return [];
    return listFiles(path.join(target, name), accept);
  });
}

const isSourceFile = file =>
  /\.(ts|tsx)$/.test(file) &&
  !/\.test\.(ts|tsx)$/.test(file) &&
  !/\.d\.ts$/.test(file) &&
  !file.split(path.sep).includes('test-utils');

/** The JavaScript expression that starts at `start`: a string, a template or a braced expression. */
function readExpression(text, start) {
  const open = text[start];
  if (open === '"' || open === "'") {
    const end = text.indexOf(open, start + 1);
    return end < 0 ? '' : text.slice(start, end + 1);
  }
  if (open === '`') return text.slice(start, skipTemplate(text, start) + 1);
  if (open !== '{') return '';
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"' || c === "'") i = text.indexOf(c, i + 1);
    else if (c === '`') i = skipTemplate(text, i);
    else if (c === '{') depth += 1;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
    if (i < 0) break;
  }
  return '';
}

/** Index of the backtick that closes the template opened at `start`. */
function skipTemplate(text, start) {
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === '\\') i += 1;
    else if (text[i] === '`') return i;
    else if (text[i] === '$' && text[i + 1] === '{') i = readExpression(text, i + 1).length + i;
  }
  return text.length - 1;
}

/** String literals and templates in an expression, templates as parts. */
function literalsIn(expression) {
  const found = [];
  for (let i = 0; i < expression.length; i += 1) {
    const c = expression[i];
    if (c === '"' || c === "'") {
      const end = expression.indexOf(c, i + 1);
      if (end < 0) break;
      found.push({ kind: 'string', value: expression.slice(i + 1, end) });
      i = end;
    } else if (c === '`') {
      const end = skipTemplate(expression, i);
      found.push({ kind: 'template', parts: templateParts(expression.slice(i + 1, end)) });
      i = end;
    }
  }
  return found;
}

/** `a-${b}-c` as [{ text: 'a-' }, { variable: 'b' }, { text: '-c' }]. */
function templateParts(body) {
  const parts = [];
  let text = '';
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '$' && body[i + 1] === '{') {
      if (text) parts.push({ text });
      text = '';
      const expression = readExpression(body, i + 1);
      parts.push({ variable: expression.slice(1, -1).trim() });
      i += expression.length;
    } else {
      text += body[i];
    }
  }
  if (text) parts.push({ text });
  return parts;
}

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every testID the source can produce:
 *   staticIds  plain ids, and testIDPrefix values ("home" for home-avatar)
 *   patterns   { regex, sample } for templates with a fixed start
 *   suffixes   { regex, sample } for `${testID}-face` style templates, tried
 *              after each static id
 */
function collectTestIds(sourceRoots) {
  const staticIds = new Set();
  const bases = new Set();
  const patterns = [];
  const suffixes = [];
  const files = sourceRoots.flatMap(root => listFiles(root, isSourceFile));
  const addTemplate = parts => {
    const fixed = parts.filter(part => part.text).map(part => part.text).join('');
    const regex = parts.map(part => (part.text ? escapeRegex(part.text) : '.+')).join('');
    const sample = parts.map(part => (part.text ? part.text : 'x1')).join('');
    const first = parts[0];
    if (first && first.variable && BASE_VARIABLES.has(first.variable)) {
      const rest = parts.slice(1);
      if (rest.length === 0) return;
      suffixes.push({
        regex: new RegExp(`^${rest.map(part => (part.text ? escapeRegex(part.text) : '.+')).join('')}$`),
        sample: rest.map(part => (part.text ? part.text : 'x1')).join(''),
      });
      return;
    }
    // A template must say something of its own, or it would match anything.
    if ((fixed.match(/[a-z]/gi) || []).length < 3) return;
    patterns.push({ regex: new RegExp(`^${regex}$`), sample });
  };
  const addExpression = (expression, isPrefix) => {
    for (const literal of literalsIn(expression)) {
      if (literal.kind === 'string') {
        if (!/^[\w-]+$/.test(literal.value)) continue;
        (isPrefix ? bases : staticIds).add(literal.value);
      } else {
        addTemplate(literal.parts);
      }
    }
  };
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const pattern = /\btestID(Prefix)?\b\s*(=|:|\?\?)\s*/g;
    let match;
    while ((match = pattern.exec(text))) {
      const start = match.index + match[0].length;
      if (match[2] === '=' && text[start] === '=') continue; // a comparison
      const expression = readExpression(text, start);
      if (!expression) continue;
      addExpression(expression, match[1] === 'Prefix');
      // `testID={id}`: the constant it names, in the same file.
      const named = /^\{\s*([A-Za-z_$][\w$]*)\s*\}$/.exec(expression);
      if (named && !BASE_VARIABLES.has(named[1])) {
        const declarations = new RegExp(`(?:const|let)\\s+${named[1]}\\s*=\\s*([^;\\n]+)`, 'g');
        let declaration;
        while ((declaration = declarations.exec(text))) addExpression(`{${declaration[1]}}`, false);
      }
    }
  }
  for (const base of bases) staticIds.add(base);
  return { staticIds, patterns, suffixes, files: files.length };
}

function idExists(id, known) {
  if (known.staticIds.has(id) || FLOW_ONLY_IDS.has(id)) return true;
  const selector = new RegExp(`^(?:${id})$`, 's');
  for (const value of known.staticIds) if (selector.test(value)) return true;
  for (const entry of known.patterns) if (entry.regex.test(id) || selector.test(entry.sample)) return true;
  for (const base of known.staticIds) {
    for (const entry of known.suffixes) {
      if (id.startsWith(base) && entry.regex.test(id.slice(base.length))) return true;
      if (selector.test(base + entry.sample)) return true;
    }
  }
  return false;
}

// ─── texts in i18n ───────────────────────────────────────────

function collectTexts(i18nDir) {
  const texts = [];
  const visit = value => {
    if (typeof value === 'string') texts.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  for (const language of ['tr', 'en']) {
    for (const file of listFiles(path.join(i18nDir, language), f => f.endsWith('.json'))) {
      visit(JSON.parse(fs.readFileSync(file, 'utf8')));
    }
  }
  return texts.map(template => ({
    template,
    sample: template.replace(/\{\{\s*[\w.]+\s*\}\}/g, '1'),
    regex: new RegExp(
      `^${template.split(/\{\{\s*[\w.]+\s*\}\}/).map(escapeRegex).join('.+')}$`,
      's',
    ),
  }));
}

function textExists(text, texts) {
  if (SYSTEM_TEXTS.has(text)) return true;
  // No letter at all: a value the app formats (a clock, a count), not copy.
  if (!/\p{L}/u.test(text.replace(/\[[^\]]*\]|\\./g, ''))) return true;
  const selector = new RegExp(`^(?:${text})$`, 's');
  return texts.some(entry => entry.template === text || selector.test(entry.sample) || entry.regex.test(text));
}

// ─── flows ───────────────────────────────────────────────────

function parseFlow(file) {
  const documents = YAML.parseAllDocuments(fs.readFileSync(file, 'utf8'));
  const errors = documents.flatMap(document => document.errors.map(error => error.message));
  if (errors.length > 0) return { errors };
  const values = documents.map(document => document.toJS());
  if (values.length === 1) return { header: null, commands: values[0], errors };
  if (values.length === 2) return { header: values[0], commands: values[1], errors };
  return { errors: [`${values.length} YAML documents (a header and the commands at most)`] };
}

function checkFlows(options = {}) {
  const { flowsDir, sourceRoots, i18nDir, appId } = { ...DEFAULTS, ...options };
  const known = collectTestIds(sourceRoots);
  const texts = collectTexts(i18nDir);
  const files = listFiles(flowsDir, file => /\.ya?ml$/.test(file) && path.basename(file) !== 'config.yaml');
  const errors = [];
  const referenced = new Set();
  let selectors = 0;

  for (const file of files) {
    const name = path.relative(flowsDir, file).split(path.sep).join('/');
    const fail = message => errors.push(`${name}: ${message}`);
    const topLevel = path.dirname(file) === flowsDir;
    const parsed = parseFlow(file);
    if (parsed.errors.length > 0) {
      parsed.errors.forEach(message => fail(`does not parse: ${message}`));
      continue;
    }
    const { header, commands } = parsed;
    if (!header || typeof header !== 'object' || Array.isArray(header)) {
      fail('needs a header document with appId');
    } else {
      if (header.appId !== appId) fail(`appId is ${JSON.stringify(header.appId)}, expected ${appId}`);
      Object.keys(header)
        .filter(key => !HEADER_KEYS.has(key))
        .forEach(key => fail(`unknown header key "${key}"`));
      if (topLevel && !header.name) fail('a top-level flow needs a name');
    }
    if (!Array.isArray(commands) || commands.length === 0) {
      fail('the commands document must be a non-empty list');
      continue;
    }

    const checkSelector = (selector, mode, where) => {
      if (typeof selector === 'string') selector = { text: selector };
      if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
        fail(`${where}: a selector must be a text or a map`);
        return;
      }
      selectors += 1;
      Object.keys(selector)
        .filter(key => !SELECTOR_KEYS.has(key))
        .forEach(key => fail(`${where}: unknown selector key "${key}"`));
      for (const key of ['id', 'text']) {
        const value = selector[key];
        if (value === undefined) continue;
        if (typeof value !== 'string') {
          fail(`${where}: ${key} must be a string`);
          continue;
        }
        if (value.includes('${')) continue;
        try {
          new RegExp(value);
        } catch (error) {
          fail(`${where}: ${key} "${value}" is not a valid regex`);
          continue;
        }
        if (mode === 'absent' && GONE.has(value)) continue;
        const hint = mode === 'absent' ? ' (an absence check: list what is gone on purpose in GONE)' : '';
        if (key === 'id' && !idExists(value, known)) fail(`${where}: no testID in src matches id "${value}"${hint}`);
        if (key === 'text' && !textExists(value, texts)) {
          fail(`${where}: no tr or en string in src/i18n matches text "${value}"${hint}`);
        }
      }
      RELATION_KEYS.forEach(key => {
        if (selector[key] !== undefined) checkSelector(selector[key], mode, `${where} > ${key}`);
      });
      if (selector.containsDescendants !== undefined) {
        [].concat(selector.containsDescendants).forEach(child => checkSelector(child, mode, `${where} > containsDescendants`));
      }
    };

    const checkCondition = (condition, where) => {
      if (!condition || typeof condition !== 'object') {
        fail(`${where}: a condition must be a map`);
        return;
      }
      Object.keys(condition)
        .filter(key => !CONDITION_KEYS.has(key))
        .forEach(key => fail(`${where}: unknown condition key "${key}"`));
      if (condition.visible !== undefined) checkSelector(condition.visible, 'present', `${where}.visible`);
      if (condition.notVisible !== undefined) checkSelector(condition.notVisible, 'absent', `${where}.notVisible`);
    };

    const checkFile = (target, where) => {
      const resolved = path.resolve(path.dirname(file), target);
      if (!fs.existsSync(resolved)) fail(`${where}: ${target} does not exist`);
      else if (!resolved.startsWith(flowsDir)) fail(`${where}: ${target} is outside e2e/maestro`);
      else referenced.add(resolved);
    };

    const checkCommands = (list, where) => {
      if (!Array.isArray(list)) {
        fail(`${where}: commands must be a list`);
        return;
      }
      list.forEach((item, index) => {
        const at = `${where}[${index}]`;
        if (typeof item === 'string') {
          if (!BARE_COMMANDS.has(item)) fail(`${at}: unknown command "${item}"`);
          return;
        }
        if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 1) {
          fail(`${at}: a command is a name or a map with one name`);
          return;
        }
        const [command, arg] = Object.entries(item)[0];
        const spec = COMMANDS[command];
        if (!spec) {
          fail(`${at}: unknown command "${command}"`);
          return;
        }
        const label = `${at} ${command}`;
        if (spec.self) checkSelector(arg, spec.self, label);
        for (const [key, mode] of Object.entries(spec)) {
          if (key === 'self' || arg === null || typeof arg !== 'object') continue;
          if (arg[key] !== undefined) checkSelector(arg[key], mode, `${label}.${key}`);
        }
        if (command === 'extendedWaitUntil') {
          if (!arg || (arg.visible === undefined && arg.notVisible === undefined)) {
            fail(`${label}: needs visible or notVisible`);
          }
          if (!arg || arg.timeout === undefined) fail(`${label}: needs a timeout`);
        }
        if (command === 'scrollUntilVisible' && (!arg || arg.element === undefined)) {
          fail(`${label}: needs an element`);
        }
        if (command === 'runFlow' || command === 'retry') {
          if (typeof arg === 'string') {
            checkFile(arg, label);
            return;
          }
          if (!arg || typeof arg !== 'object') {
            fail(`${label}: needs a file or commands`);
            return;
          }
          if (arg.when !== undefined) checkCondition(arg.when, `${label}.when`);
          if (arg.file !== undefined) checkFile(arg.file, label);
          if (arg.commands !== undefined) checkCommands(arg.commands, `${label}.commands`);
          if (arg.file === undefined && arg.commands === undefined) fail(`${label}: needs a file or commands`);
        }
        if (command === 'repeat') {
          if (!arg || typeof arg !== 'object' || arg.commands === undefined) {
            fail(`${label}: needs commands`);
            return;
          }
          if (arg.times === undefined && arg.while === undefined) fail(`${label}: needs times or while`);
          if (arg.while !== undefined) checkCondition(arg.while, `${label}.while`);
          checkCommands(arg.commands, `${label}.commands`);
        }
      });
    };

    checkCommands(commands, 'commands');
    ['onFlowStart', 'onFlowComplete'].forEach(hook => {
      if (header && header[hook] !== undefined) checkCommands(header[hook], hook);
    });
  }

  for (const file of files) {
    if (path.dirname(file) === flowsDir || referenced.has(file)) continue;
    errors.push(`${path.relative(flowsDir, file).split(path.sep).join('/')}: no flow runs this step`);
  }

  return { errors, flows: files.length, selectors, testIds: known.staticIds.size, sourceFiles: known.files };
}

// ─── maestro check-syntax ────────────────────────────────────

function findMaestro() {
  if (process.env.MAESTRO_BIN) return process.env.MAESTRO_BIN;
  const bin = path.join(os.homedir(), '.maestro', 'maestro', 'bin', process.platform === 'win32' ? 'maestro.bat' : 'maestro');
  return fs.existsSync(bin) ? bin : null;
}

/** `maestro check-syntax` on every flow; null when Maestro is not installed. */
function maestroCheckSyntax(flowsDir = DEFAULTS.flowsDir) {
  const bin = findMaestro();
  if (!bin) return null;
  const files = listFiles(flowsDir, file => /\.ya?ml$/.test(file) && path.basename(file) !== 'config.yaml');
  return files.map(file => {
    const env = { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', JAVA_TOOL_OPTIONS: '-Dfile.encoding=UTF-8' };
    // maestro.bat needs a shell on Windows: one quoted command line then.
    const result =
      process.platform === 'win32'
        ? spawnSync(`"${bin}" --no-ansi check-syntax "${file}"`, { encoding: 'utf8', shell: true, env })
        : spawnSync(bin, ['--no-ansi', 'check-syntax', file], { encoding: 'utf8', env });
    return {
      file: path.relative(flowsDir, file).split(path.sep).join('/'),
      ok: result.status === 0,
      output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
    };
  });
}

function run(argv, log = console.log) {
  const result = checkFlows();
  result.errors.forEach(error => log(`FAIL  ${error}`));
  log(
    `${result.errors.length === 0 ? 'PASS' : 'FAIL'}  ${result.flows} flows, ${result.selectors} selectors, ` +
      `${result.testIds} testIDs from ${result.sourceFiles} source files`,
  );
  let failed = result.errors.length > 0;
  if (argv.includes('--maestro')) {
    const syntax = maestroCheckSyntax();
    if (syntax === null) {
      log('SKIP  maestro check-syntax: Maestro is not installed (or set MAESTRO_BIN)');
    } else {
      syntax.forEach(entry => {
        if (!entry.ok) failed = true;
        log(`${entry.ok ? 'PASS' : 'FAIL'}  maestro check-syntax ${entry.file}${entry.ok ? '' : `\n${entry.output}`}`);
      });
    }
  }
  return failed ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}

module.exports = { checkFlows, collectTestIds, collectTexts, idExists, maestroCheckSyntax, run, textExists };
