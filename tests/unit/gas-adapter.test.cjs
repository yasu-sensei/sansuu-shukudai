const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { buildSync } = require('esbuild');
const compiledCore = buildSync({ entryPoints: ['src/server/classroom.mjs'], bundle: true, write: false, format: 'iife', globalName: 'ClassroomCore', target: 'es2020' }).outputFiles[0].text;

function adapter() {
  const values = { SCHOOL_DOMAIN: 'school.example', SCHOOL_YEAR: '2026', TEACHER_EMAILS: 'teacher@school.example', CLASSROOM_SPREADSHEET_ID: 'private-book' };
  let actor = 'teacher@school.example', rows = [], exists = false, locked = false, available = true, opens = 0, uid = 0;
  const props = {
    getProperty: key => values[key] ?? null,
    setProperty: (key, value) => { values[key] = value; },
    setProperties: data => Object.assign(values, data),
    deleteProperty: key => { delete values[key]; },
  };
  const sheet = {
    getLastRow: () => rows.length,
    setFrozenRows() {},
    getRange(start, column, count, width) {
      return {
        getValues: () => Array.from({ length: count }, (_, i) => Array.from({ length: width }, (_, j) => rows[start - 1 + i]?.[column - 1 + j] ?? '')),
        setValues(data) { for (let i = 0; i < data.length; i++) rows[start - 1 + i] = data[i].slice(); },
      };
    },
  };
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => props },
    Session: { getActiveUser: () => ({ getEmail: () => actor }), getEffectiveUser() { throw Error('must never use owner identity'); } },
    SpreadsheetApp: { openById(id) {
      opens++; assert.equal(id, 'private-book');
      return { getSheetByName: () => exists ? sheet : null, insertSheet: () => { exists = true; return sheet; } };
    }, flush() {} },
    LockService: { getScriptLock: () => ({
      tryLock() { locked = available; return locked; },
      waitLock() { assert.ok(available); locked = true; },
      hasLock: () => locked, releaseLock() { locked = false; },
    }) },
    Utilities: {
      getUuid: () => `test-uuid-${++uid}`,
      formatDate: () => '2026-10-19',
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, text) => [...crypto.createHash('sha256').update(text).digest()],
    },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/test/exec' }) },
    HtmlService: { createHtmlOutput: content => ({ content }), createHtmlOutputFromFile: name => ({ name, setTitle() { return this; }, addMetaTag() { return this; } }) },
  });
  vm.runInContext(compiledCore, context);
  vm.runInContext(fs.readFileSync('src/gas/Code.gs', 'utf8'), context);
  let request = 0;
  return { values, rows: () => rows, context, setActor: email => { actor = email; },
    setBusy: busy => { available = !busy; }, opened: () => opens,
    api: (action, data = {}) => context.classroomApi({ action, data, requestId: `request-${++request}` }) };
}

test('GAS initializes a private event log without overwriting it and authenticates before accessing sheets', () => {
  const a = adapter(); a.context.initializeClassroom();
  assert.equal(a.rows().length, 1);
  a.context.initializeClassroom(); assert.equal(a.rows().length, 1);
  const before = a.opened();
  for (const email of ['', 'outsider@elsewhere.example']) {
    a.setActor(email); assert.equal(a.api('bootstrap').error.code, 'AUTH');
  }
  assert.equal(a.opened(), before);
  assert.throws(() => a.context.initializeClassroom());
});

test('GAS first-registration and subsequent login use the active user, with teacher APIs protected', () => {
  const a = adapter(); a.context.initializeClassroom();
  a.setActor('one@school.example');
  assert.equal(a.api('registerStudent', { clazz: 1, number: 1, confirmed: true, email: 'forged@school.example' }).ok, true);
  assert.equal(a.api('studentHome', { clazz: 1, number: 1 }).data.student.number, 1);
  assert.equal(a.api('teacherDashboard').error.code, 'FORBIDDEN');
  assert.equal(a.context.doGet({ parameter: { view: 'teacher' } }).content, '先生の学校アカウントで開いてください。');
  a.setActor('teacher@school.example');
  assert.equal(a.api('teacherDashboard').data.students[0].email, 'one@school.example');
  assert.match(a.api('bootstrap').data.teacherUrl, /\?view=teacher$/);
  assert.equal(a.context.doGet({ parameter: { view: 'teacher' } }).name, 'Teacher');
});

test('GAS stores salted PIN hashes only, requires teacher+PIN for changes, and throttles wrong guesses', () => {
  const a = adapter(); a.context.initializeClassroom();
  assert.equal(a.api('configureTeacherPin', { newPin: '135790', confirmPin: '135790' }).ok, true);
  assert.equal(a.values.TEACHER_PIN_HASH.length, 64);
  assert.notEqual(a.values.TEACHER_PIN_HASH, '135790');
  const data = { expectedRevision: '', students: [{ email: 'one@school.example', name: '', clazz: 1, number: 1, active: true }] };
  assert.equal(a.api('saveStudents', { ...data, teacherPin: '135790' }).ok, true);
  assert.equal(JSON.stringify(a.rows()).includes('135790'), false);
  assert.equal(a.api('configureTeacherPin', { newPin: '246810', confirmPin: '246810' }).error.code, 'PIN');
  a.setActor('one@school.example');
  assert.equal(a.api('configureTeacherPin', { newPin: '999999', confirmPin: '999999' }).error.code, 'FORBIDDEN');
  a.setActor('teacher@school.example');
  // One earlier incorrect current-PIN attempt plus four wrong guesses trigger a lock.
  for (let i = 0; i < 4; i++) assert.equal(a.api('saveStudents', { ...data, teacherPin: '000000' }).error.code, 'PIN');
  assert.equal(a.api('saveStudents', { ...data, teacherPin: '135790' }).error.code, 'PIN_LOCKED');
});

test('GAS fails closed on busy locks and corrupt event rows', () => {
  const a = adapter(); a.context.initializeClassroom(); a.setBusy(true);
  assert.equal(a.api('bootstrap').error.code, 'BUSY');
  a.setBusy(false); a.rows()[0][0] = 'wrong header';
  assert.equal(a.api('bootstrap').error.code, 'SERVER');
});
