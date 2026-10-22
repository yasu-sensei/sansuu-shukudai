const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { shouldFinish, calculatePoints } = require('../../src/domain/scoring.mjs');
const root = path.join(__dirname, '../..');
const read = name => readFileSync(path.join(root, name), 'utf8');

test('archived original HTML has not changed since phase 1', () => {
  assert.equal(createHash('sha256').update(read('homework_math_calendar_keypad_practice_v10.html')).digest('hex'),
    '91a3423fbd146db9447bc74d03c3d3f4e8d5a4c204984448f973163cebdfa710');
});

test('GAS package builds repeatably and embeds its own styles and executable script', () => {
  const build = () => execFileSync(process.execPath, ['scripts/build-gas.mjs'], { cwd: root });
  build();
  const first = read('build/gas/Index.html');
  build();
  assert.equal(read('build/gas/Index.html'), first);
  assert.ok(first.includes(`<style>${read('src/client/styles.css')}</style>`));
  assert.doesNotMatch(first, /<script[^>]*\bsrc=|<link[^>]*rel="stylesheet"|type="module"/);
  const scripts = [...first.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0][1]));
  assert.deepEqual(JSON.parse(read('build/gas/appsscript.json')), {
    timeZone: 'Asia/Tokyo', exceptionLogging: 'STACKDRIVER', runtimeVersion: 'V8',
    oauthScopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/userinfo.email'],
  });
  assert.equal(read('build/gas/Code.gs'), read('src/gas/Code.gs'));
});

test('GAS doGet loads Index and sets the original title and viewport', () => {
  const calls = [];
  const output = {
    setTitle(title) { calls.push(['title', title]); return this; },
    addMetaTag(name, value) { calls.push(['meta', name, value]); return this; },
  };
  const context = vm.createContext({ HtmlService: {
    createHtmlOutputFromFile(name) { calls.push(['file', name]); return output; },
  } });
  vm.runInContext(read('src/gas/Code.gs'), context);
  assert.equal(context.doGet(), output);
  assert.deepEqual(calls, [
    ['file', 'Index'],
    ['title', 'さんすうしゅくだい｜カレンダー・テンキー試作版'],
    ['meta', 'viewport', 'width=device-width,initial-scale=1'],
  ]);
});

test('completion predicate preserves time, correct-count, practice and feedback boundaries', () => {
  assert.equal(shouldFinish(119.999, 10, false, false), false);
  assert.equal(shouldFinish(120, 9, false, false), false);
  assert.equal(shouldFinish(120, 10, false, false), true);
  assert.equal(shouldFinish(121, 10, false, true), false);
  assert.equal(shouldFinish(120, 0, true, false), true);
  assert.equal(shouldFinish(119.999, 10, true, false), false);
  assert.equal(shouldFinish(120, 10, true, true), false);
});

test('point calculation uses first-two-minute correct count and the existing multiplier', () => {
  assert.equal(calculatePoints(0, 1), 10);
  assert.equal(calculatePoints(9, 1), 19);
  assert.equal(calculatePoints(12, 2), 34);
  assert.equal(calculatePoints(10, 3), 40);
});
