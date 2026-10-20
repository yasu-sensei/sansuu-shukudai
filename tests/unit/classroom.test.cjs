const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../helpers/classroom-harness.cjs');
const { assessSupport, scoreAnswers, projectEvents } = require('../../src/server/classroom.mjs');
const { createSessionRecorder } = require('../../src/client/classroom-api.mjs');
const rejectsCode = (fn, code) => assert.throws(fn, error => error.code === code);

function ready(mode = 0, dates, classes) { const h = harness(); h.roster(); h.publish(mode, dates, classes); return h; }
const record = (h, session, answers, options = {}, id) => h.student('recordSession', { sessionId: session.id, answers, elapsedMs: 120000, finish: true, cancel: false, ...options }, id);

test('school identity is required; teacher rights never come from request fields', () => {
  const h = harness();
  for (const email of ['', 'one@outside.example', 'teacher@school.example.evil']) rejectsCode(() => h.api(email, 'bootstrap'), 'AUTH');
  rejectsCode(() => h.api('one@school.example', 'teacherDashboard', { email: 'teacher@school.example', role: 'teacher' }), 'FORBIDDEN');
  rejectsCode(() => h.student('studentHome', { clazz: 1, number: 1 }), 'ENROLLMENT');
  h.config.teachers = [];
  rejectsCode(() => h.teacher('bootstrap'), 'CONFIG');
});

test('only roster account and selected class/number matching each other can open homework', () => {
  const h = ready();
  rejectsCode(() => h.student('studentHome', { clazz: 2, number: 1 }), 'IDENTITY');
  rejectsCode(() => h.api('other@school.example', 'studentHome', { clazz: 1, number: 1 }), 'ENROLLMENT');
  const own = h.student('studentHome', { clazz: 1, number: 1 });
  assert.equal(own.student.name, '児童1');
  assert.equal(own.assignments.length, 1);
  assert.equal(own.data.points, 0);
  h.roster([{ ...h.dashboard().students[0], active: false }]);
  rejectsCode(() => h.student('studentHome', { clazz: 1, number: 1 }), 'ENROLLMENT');
});

test('bulk roster validation is atomic, rejects duplicate slots/accounts and stale updates', () => {
  const h = harness();
  const row = { email: 'one@school.example', clazz: 1, number: 1, name: '', active: true };
  rejectsCode(() => h.roster([row, { ...row, email: 'two@school.example' }]), 'DUPLICATE');
  assert.equal(h.events.length, 0);
  rejectsCode(() => h.roster([{ ...row, email: 'one@outside.example' }]), 'INPUT');
  h.roster([row]);
  rejectsCode(() => h.teacher('saveStudents', { students: [row], expectedRevision: '' }), 'CONFLICT');
  const id = h.dashboard().students[0].id;
  h.roster([{ ...row, id, clazz: 2, number: 3 }]);
  assert.equal(h.dashboard().students[0].id, id);
  assert.equal(h.dashboard().students[0].clazz, 2);
});

test('multi-class date publication is idempotent, class-scoped and future homework cannot start', () => {
  const h = ready(2, ['2026-10-19', '2026-10-20'], [1, 2, 3, 4]);
  assert.equal(h.dashboard().assignments.length, 8);
  const home = h.student('studentHome', { clazz: 1, number: 1 });
  assert.equal(home.assignments.length, 2);
  rejectsCode(() => h.student('startSession', { assignmentId: h.dashboard().assignments.find(a => a.clazz === 2).id }), 'ASSIGNMENT');
  rejectsCode(() => h.student('startSession', { assignmentId: home.assignments.find(a => a.date === '2026-10-20').id }), 'ASSIGNMENT');
  h.publish(2, ['2026-10-19', '2026-10-20'], [1, 2, 3, 4]);
  assert.equal(h.dashboard().assignments.length, 8);
  rejectsCode(() => h.publish(0, ['2026-02-30']), 'INPUT');
});

test('all five modes are regraded server-side, with correct points and duplicate-completion protection', () => {
  for (let mode = 0; mode < 5; mode++) {
    const h = ready(mode), session = h.start(), answers = h.correctAnswers(session);
    h.advance(120000);
    const result = record(h, session, answers, {}, 'finish-request');
    assert.equal(result.completion.earned, 10 * [1, 2, 2, 2, 3][mode] + 10);
    assert.equal(result.home.data.points, result.completion.earned);
    assert.equal(result.home.data.records['2026-10-19'].correct, 10);
    const count = h.events.length;
    assert.deepEqual(record(h, session, answers, {}, 'finish-request'), result);
    assert.equal(h.events.length, count);
    rejectsCode(() => record(h, session, answers), 'SESSION');
    rejectsCode(() => h.start(), 'COMPLETED');
    assert.equal(h.events.filter(e => e.payload.completion).length, 1);
    assert.equal(h.dashboard().progress[0].status, '完了');
  }
});

test('server enforces both 120 seconds and 10 correct answers, and excludes 120000ms from first-period scores', () => {
  const h = ready(), session = h.start();
  rejectsCode(() => record(h, session, h.correctAnswers(session)), 'INPUT');
  h.advance(120000);
  rejectsCode(() => record(h, session, h.correctAnswers(session, 9)), 'INCOMPLETE');
  const answers = h.correctAnswers(session);
  answers[9].elapsedMs = 120000;
  h.advance(650);
  const result = record(h, session, answers, { elapsedMs: 120650 });
  assert.equal(result.completion.firstCorrect, 9);
  assert.equal(result.completion.firstTotal, 9);
  assert.equal(result.completion.earned, 19);
});

test('fabricated aggregates, question indices, future timestamps and answer speeds cannot grant points', () => {
  const h = ready(), session = h.start(); h.advance(120000);
  const answers = h.correctAnswers(session);
  for (const changed of [
    answers.map((a, i) => ({ ...a, seq: i + 1 })),
    answers.map(a => ({ ...a, elapsedMs: 1 })),
    answers.map(a => ({ ...a, questionIndex: 999 })),
    answers.map(a => ({ ...a, elapsedMs: 999999 })),
    answers.map(a => ({ ...a, points: 999 })),
  ]) rejectsCode(() => record(h, session, changed), changed[0].points ? 'INPUT' : 'ANSWER');
  const result = record(h, session, answers, { points: 999999, correct: 9999, mode: 4, studentId: 'another' });
  assert.equal(result.home.data.points, 20);
});

test('server retry rules keep the first wrong question and advance after the second; wrong answers count as attempts', () => {
  const h = ready(), session = h.start(); h.advance(120000);
  const correct = h.correctAnswers(session, 10);
  const retry = [{ seq: 0, questionIndex: 0, value: 999, elapsedMs: 0 }, { seq: 1, questionIndex: 0, value: correct[0].value, elapsedMs: 900 }];
  const summary = scoreAnswers({ ...h.state().sessions[session.id] }, retry, h.now());
  assert.equal(summary.total, 2); assert.equal(summary.correct, 1);
  const twice = [{ seq: 0, questionIndex: 0, value: 999, elapsedMs: 0 }, { seq: 1, questionIndex: 0, value: 999, elapsedMs: 900 },
    { seq: 2, questionIndex: 1, value: correct[1].value, elapsedMs: 1800 }];
  assert.equal(scoreAnswers(h.state().sessions[session.id], twice, h.now()).correct, 1);
  rejectsCode(() => record(h, session, [{ ...twice[0] }, { ...twice[1], questionIndex: 1 }]), 'ANSWER');
});

test('progress distinguishes unstarted, active, disconnected, cancelled and completed; intermediate work grants no points', () => {
  const h = ready();
  assert.equal(h.dashboard().progress[0].status, '未着手');
  let session = h.start();
  assert.equal(h.dashboard().progress[0].status, '取り組み中');
  h.advance(300000);
  assert.equal(h.dashboard().progress[0].status, '中断');
  record(h, session, [], { elapsedMs: 300000, finish: false });
  assert.equal(h.dashboard().progress[0].status, '取り組み中');
  record(h, session, [], { elapsedMs: 300000, finish: false, cancel: true });
  assert.equal(h.dashboard().progress[0].status, '中断');
  assert.equal(h.student('studentHome', { clazz: 1, number: 1 }).data.points, 0);
  session = h.start(); h.advance(120000);
  record(h, session, h.correctAnswers(session));
  assert.equal(h.dashboard().progress[0].status, '完了');
});

test('a new session supersedes earlier active sessions and another child cannot submit to it', () => {
  const h = ready(); h.roster([
    ...h.dashboard().students,
    { email: 'two@school.example', clazz: 1, number: 2, name: '', active: true },
  ]);
  const first = h.start(), second = h.start();
  rejectsCode(() => h.api('two@school.example', 'recordSession', { sessionId: second.id }), 'FORBIDDEN');
  rejectsCode(() => record(h, first, [], { finish: false, elapsedMs: 0 }), 'SESSION');
  assert.equal(h.state().sessions[first.id].status, 'interrupted');
});

test('started homework modes cannot be rewritten, and a batch with a locked date changes nothing', () => {
  const h = ready(); h.start();
  const count = h.events.length;
  rejectsCode(() => h.publish(1, ['2026-10-18', '2026-10-19']), 'STARTED');
  assert.equal(h.events.length, count);
  assert.equal(h.dashboard().assignments.length, 1);
});

test('late completions retain original streak milestone awards without duplicate claims', () => {
  const h = ready(0, ['2026-10-15', '2026-10-16', '2026-10-19']);
  for (const date of ['2026-10-15', '2026-10-19', '2026-10-16']) {
    const session = h.start(date); h.advance(120000);
    record(h, session, h.correctAnswers(session));
  }
  const home = h.student('studentHome', { clazz: 1, number: 1 });
  assert.equal(home.data.points, 80);
  assert.deepEqual(home.data.claimed, { '2026-10-19:3': 20 });
});

test('support labels separate unset, insufficient, below standard and within-standard; equality passes', () => {
  const data = [5, 9, 10].map((firstCorrect, i) => ({ firstCorrect, firstTotal: 12, completedAt: i }));
  assert.equal(assessSupport([], undefined).status, '未設定');
  assert.equal(assessSupport(data.slice(0, 2), 10).status, '記録不足');
  assert.equal(assessSupport(data, 10).status, 'ようすを確認');
  assert.equal(assessSupport(data.concat({ firstCorrect: 10, firstTotal: 10, completedAt: 4 }), 10).status, '目安内');
});

test('teacher thresholds are optional per mode; support uses only completed records and is private to teachers', () => {
  const h = ready();
  h.teacher('saveStandards', { expectedRevision: '', standards: { 0: 11 } });
  for (const date of ['2026-10-15', '2026-10-16', '2026-10-19']) {
    h.publish(0, [date]); const session = h.start(date); h.advance(120000);
    record(h, session, h.correctAnswers(session));
  }
  const support = h.dashboard().support;
  assert.equal(support.find(s => s.mode === 0).status, 'ようすを確認');
  assert.equal(support.find(s => s.mode === 1).status, '未設定');
  assert.equal(support.find(s => s.mode === 0).samples, 3);
  const home = h.student('studentHome', { clazz: 1, number: 1 });
  assert.equal(home.support, undefined); assert.equal(home.standards, undefined);
  rejectsCode(() => h.student('saveStandards', { standards: { 0: 1 } }), 'FORBIDDEN');
});

test('request IDs reject changed payloads, and corrupt/unsupported event logs fail closed', () => {
  const h = ready();
  const assignmentId = h.student('studentHome', { clazz: 1, number: 1 }).assignments[0].id;
  const session = h.student('startSession', { assignmentId }, 'same-request');
  assert.deepEqual(h.student('startSession', { assignmentId }, 'same-request'), session);
  rejectsCode(() => h.student('startSession', { assignmentId: 'other' }, 'same-request'), 'CONFLICT');
  rejectsCode(() => projectEvents([{ id: 'x', actor: 'x', payload: {}, type: 'unknown' }]), 'STORE');
});

test('lost completion response is retried with the same immutable payload and only one award', async () => {
  const h = ready(), session = h.start(); h.advance(120000);
  let dropped = false, count = 0;
  const calls = [];
  const recorder = createSessionRecorder(session.id, async (action, data, id) => {
    calls.push({ action, data: structuredClone(data), id });
    const result = h.student(action, data, id);
    if (!dropped) { dropped = true; throw new Error('connection lost after commit'); }
    return result;
  }, () => `recorder-${++count}`);
  for (const answer of h.correctAnswers(session)) recorder.add(answer);
  await assert.rejects(recorder.flush({ finish: true, elapsedMs: 120000 }), /connection lost/);
  const result = await recorder.flush({ finish: true, elapsedMs: 121000 });
  assert.equal(result.home.data.points, 20);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(h.events.filter(e => e.payload.completion).length, 1);
  await recorder.flush({ elapsedMs: 125000 });
  assert.equal(calls.length, 2);
});

test('queued flushes keep answer snapshots consistent and lost cancel responses recover', async () => {
  let release, calls = 0;
  const recorder = createSessionRecorder('session', async (action, data) => {
    calls++;
    if (calls === 1) await new Promise(resolve => { release = resolve; });
    assert.ok(data.answers.every(a => a.elapsedMs <= data.elapsedMs));
    return { accepted: data.answers.at(-1)?.seq + 1 || 0, status: data.cancel ? 'interrupted' : 'active' };
  }, () => `snapshot-${calls + 10000}`);
  recorder.add({ elapsedMs: 1 }); const first = recorder.flush({ elapsedMs: 1 });
  await new Promise(resolve => setImmediate(resolve));
  recorder.add({ elapsedMs: 1000 }); const second = recorder.flush({ elapsedMs: 1000 });
  release(); await first; await second;
  const h = ready(), session = h.start();
  let lost = true;
  const cancelRecorder = createSessionRecorder(session.id, async (action, data, id) => {
    const result = h.student(action, data, id);
    if (lost) { lost = false; throw Error('lost cancel'); } return result;
  }, () => 'cancel-request');
  await assert.rejects(cancelRecorder.flush({ cancel: true, elapsedMs: 0 }));
  assert.equal((await cancelRecorder.flush({ cancel: true, elapsedMs: 1 })).status, 'interrupted');
});

test('first registration captures the real school account only after explicit confirmation, with no preregistered roster', () => {
  const h = harness(); h.publish();
  assert.equal(h.student('bootstrap').registered, false);
  assert.equal(h.student('bootstrap').email, 'one@school.example');
  rejectsCode(() => h.student('registerStudent', { clazz: 1, number: 1 }), 'CONFIRM');
  const result = h.student('registerStudent', { clazz: 1, number: 1, confirmed: true, email: 'forged@school.example' }, 'registration-request');
  assert.deepEqual(result, { registered: true });
  assert.equal(h.dashboard().students[0].email, 'one@school.example');
  assert.equal(h.student('studentHome', { clazz: 1, number: 1 }).assignments.length, 1);
  const count = h.events.length;
  h.student('registerStudent', { clazz: 1, number: 1, confirmed: true, email: 'forged@school.example' }, 'registration-request');
  assert.equal(h.events.length, count);
  rejectsCode(() => h.student('registerStudent', { clazz: 2, number: 2, confirmed: true }), 'REGISTERED');
  rejectsCode(() => h.api('two@school.example', 'registerStudent', { clazz: 1, number: 1, confirmed: true }), 'DUPLICATE');
  rejectsCode(() => h.teacher('registerStudent', { clazz: 1, number: 3, confirmed: true }), 'FORBIDDEN');
});

test('roster changes require BOTH teacher identity and PIN; the PIN is never stored in events', () => {
  const h = harness();
  const data = { expectedRevision: '', students: [{ email: 'one@school.example', clazz: 1, number: 1, name: '', active: true }] };
  rejectsCode(() => h.api('teacher@school.example', 'saveStudents', data), 'PIN');
  rejectsCode(() => h.teacher('saveStudents', { ...data, teacherPin: '000000' }), 'PIN');
  rejectsCode(() => h.api('one@school.example', 'saveStudents', { ...data, teacherPin: '246810' }), 'FORBIDDEN');
  h.teacher('saveStudents', { ...data, teacherPin: '246810' });
  assert.equal(JSON.stringify(h.events).includes('246810'), false);
  assert.equal(JSON.stringify(h.events).includes('teacherPin'), false);
});

test('teacher identity corrections interrupt old sessions so work cannot be saved against stale enrollment', () => {
  const h = ready(), session = h.start();
  h.roster([{ ...h.dashboard().students[0], clazz: 2, number: 3 }]);
  assert.equal(h.state().sessions[session.id].status, 'interrupted');
  rejectsCode(() => record(h, session, [], { elapsedMs: 0, finish: false }), 'SESSION');
  rejectsCode(() => h.student('studentHome', { clazz: 1, number: 1 }), 'IDENTITY');
  assert.equal(h.student('studentHome', { clazz: 2, number: 3 }).data.points, 0);
});
