const { test, expect } = require('@playwright/test');
const { harness } = require('../helpers/classroom-harness.cjs');

async function bridge(page, h, email, { dropFinish = false } = {}) {
  let dropped = false;
  await page.clock.install({ time: new Date(h.now()) });
  await page.clock.pauseAt(new Date(h.now()+1000));
  await page.exposeFunction('testSchoolCall', async (request, at) => {
    h.setTime(at);
    let response;
    try { response = { ok: true, data: h.api(email, request.action, request.data, request.requestId) }; }
    catch (error) { return { ok: false, error: { code: error.code || 'SERVER', message: error.message } }; }
    if (dropFinish && !dropped && request.action === 'recordSession' && request.data.finish) {
      dropped = true; throw Error('response lost after server commit');
    }
    return response;
  });
  await page.addInitScript(() => {
    function runner() {
      let success, failure;
      return {
        withSuccessHandler(fn) { success = fn; return this; },
        withFailureHandler(fn) { failure = fn; return this; },
        classroomApi(request) { window.testSchoolCall(request, Date.now()).then(success, failure); },
      };
    }
    window.google = { script: { get run() { return runner(); } } };
    // Must not affect authenticated school data.
    localStorage.setItem('math-homework-v2:1くみ・1ばん', JSON.stringify({ points: 999999, records: {}, claimed: {} }));
  });
}
async function login(page, clazz = '1', number = '1') {
  await page.goto(test.info().project.metadata.gamePath);
  await expect(page.locator('#loginBtn')).toBeEnabled();
  await page.selectOption('#clazz', clazz); await page.selectOption('#number', number);
  await page.click('#loginBtn');
  if(await page.locator('#confirmSchoolRegistration').isVisible())await page.check('#confirmSchoolRegistration');
  await page.click('#confirmStart');
}
async function solve(page, count) {
  for (let i = 0; i < count; i++) {
    const [, a, op, b] = (await page.textContent('#question')).match(/(\d+)\s*([+−×])\s*(\d+)/);
    const value = op === '+' ? +a + +b : op === '−' ? +a - +b : +a * +b;
    for (const digit of String(value)) await page.click(`[data-key="${digit}"]`);
    await page.click('#submitAnswer'); await page.clock.runFor(650);
  }
}
function teacherPath() { return test.info().project.name === 'gas-bundle' ? '/build/gas/Teacher.html' : '/src/client/teacher.html'; }

test('school account must match selected class/number; local demo points are ignored', async ({ page }) => {
  const h = harness(); h.roster(); h.publish();
  await bridge(page, h, 'one@school.example');
  await login(page, '2');
  await expect(page.locator('#schoolStatus')).toContainText('登録と違います');
  await expect(page.locator('#home')).toBeHidden();
  await page.click('#reselect'); await page.selectOption('#clazz', '1');
  await page.click('#loginBtn');
  if(await page.locator('#confirmSchoolRegistration').isVisible())await page.check('#confirmSchoolRegistration');
  await page.click('#confirmStart');
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#points')).toHaveText('⭐ 0pt');
  await expect(page.locator('#teacherToggle')).toBeHidden();
});

test('homework is issued and regraded by the server; lost completion reply retries without double points', async ({ page }) => {
  const h = harness(); h.roster(); h.publish();
  await bridge(page, h, 'one@school.example', { dropFinish: true });
  await login(page); await expect(page.locator('#home')).toBeVisible();
  await page.locator('#calendar button.assigned').click(); await page.click('#start');
  await expect(page.locator('#play')).toBeVisible();
  const start = await page.evaluate(() => performance.now());
  await solve(page, 10);
  const elapsed = await page.evaluate(() => performance.now());
  await page.clock.runFor(start + 120000 - elapsed);
  await expect(page.locator('#retrySchoolSave')).toBeVisible();
  await expect(page.locator('#result')).toBeHidden();
  expect(h.events.filter(e => e.payload.completion)).toHaveLength(1);
  await page.click('#retrySchoolSave');
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#earned')).toHaveText('+20 ポイント！');
  expect(h.events.filter(e => e.payload.completion)).toHaveLength(1);
  expect(h.dashboard().progress[0].status).toBe('完了');
  await page.click('#back'); await expect(page.locator('#points')).toHaveText('⭐ 20pt');
});

test('school free practice never creates a homework session or awards points', async ({ page }) => {
  const h = harness(); h.roster(); h.publish();
  await bridge(page, h, 'one@school.example'); await login(page);
  await expect(page.locator('#home')).toBeVisible();
  await page.locator('#practiceModes button').first().click(); await page.click('#practiceStart');
  await solve(page, 2); await page.clock.runFor(120000);
  await expect(page.locator('#practiceResult')).toBeVisible();
  expect(h.events.filter(e => e.type.startsWith('session.'))).toHaveLength(0);
  expect(h.student('studentHome', { clazz: 1, number: 1 }).data.points).toBe(0);
});

test('teacher can register/edit students, publish to multiple classes and configure support thresholds', async ({ page }) => {
  const h = harness(); h.roster();
  await bridge(page, h, 'teacher@school.example'); await page.goto(teacherPath());
  await expect(page.locator('#message')).toContainText('学校アカウントを確認しました');
  await page.fill('#studentEmail', 'two@school.example'); await page.fill('#studentName', '児童2');
  await page.selectOption('#studentClass', '2'); await page.fill('#studentNumber', '7');
  await page.fill('#teacherPin','000000'); await page.locator('#studentForm button').first().click();
  await expect(page.locator('#message')).toContainText('暗証番号');
  expect(h.dashboard().students).toHaveLength(1);
  await page.fill('#teacherPin','246810'); await page.locator('#studentForm button').first().click();
  await expect(page.locator('#message')).toHaveText('名簿を保存しました。');
  await expect(page.locator('#studentRows')).toContainText('two@school.example');
  await page.locator('#studentRows tr').filter({ hasText: 'two@school.example' }).getByRole('button', { name: '修正' }).click();
  await page.fill('#studentNumber', '8'); await page.fill('#teacherPin','246810'); await page.locator('#studentForm button').first().click();
  await expect(page.locator('#studentRows')).toContainText('2組 8番');
  await page.check('[name=classes][value="1"]'); await page.check('[name=classes][value="2"]');
  await page.fill('#publishTo', '2026-10-21'); await page.locator('#publishForm button').click();
  await expect(page.locator('#message')).toHaveText('6件の宿題を配信しました。');
  await page.fill('#to', '2026-10-21'); await page.locator('#filterForm button').click();
  await expect(page.locator('#progressRows tr')).toHaveCount(6);
  await expect(page.locator('#progressRows')).toContainText('未着手');
  await page.fill('#standard-0', '10'); await page.locator('#standardsForm button').click();
  await expect(page.locator('#message')).toHaveText('モード別の目安を保存しました。');
  await expect(page.locator('#supportRows')).toContainText('記録不足');
  await expect(page.locator('#supportRows')).toContainText('未設定');
  await page.check('#supportOnly');
  await expect(page.locator('#supportRows')).toContainText('該当する記録はありません');
  expect(h.dashboard().students).toHaveLength(2);
});

test('teacher bulk roster reports duplicates without partial registration; student cannot access dashboard', async ({ page }) => {
  const h = harness(); h.roster();
  await bridge(page, h, 'teacher@school.example'); await page.goto(teacherPath());
  await expect(page.locator('#message')).toContainText('学校アカウントを確認しました');
  await page.locator('summary').click();
  await page.fill('#bulkStudents', 'two@school.example\t1\t1\t児童2\nthree@school.example\t2\t3\t児童3');
  await page.fill('#teacherPin','246810'); await page.locator('#bulkForm button').click();
  await expect(page.locator('#message')).toContainText('重複');
  expect(h.dashboard().students).toHaveLength(1);
  const pupilPage = await page.context().newPage();
  await bridge(pupilPage, h, 'one@school.example'); await pupilPage.goto(teacherPath());
  await expect(pupilPage.locator('#message')).toContainText('先生の学校アカウント');
  await expect(pupilPage.locator('#studentRows tr')).toHaveCount(0);
});

test('first enrollment confirms the account and number, creates the roster, and cannot reassign itself', async ({ page }) => {
  const h = harness(); h.publish();
  await bridge(page, h, 'one@school.example');
  await page.goto(test.info().project.metadata.gamePath);
  await expect(page.locator('#schoolStatus')).toContainText('はじめての とうろく');
  await page.selectOption('#clazz', '1'); await page.selectOption('#number', '1'); await page.click('#loginBtn');
  await expect(page.locator('#confirmIdentity')).toContainText('one@school.example');
  await expect(page.locator('#confirmStart')).toBeDisabled();
  expect(h.dashboard().students).toHaveLength(0);
  await page.check('#confirmSchoolRegistration');
  await page.selectOption('#clazz','3');
  await page.click('#confirmStart');
  await expect(page.locator('#home')).toBeVisible();
  expect(h.dashboard().students).toHaveLength(1);
  expect(h.dashboard().students[0].clazz).toBe(1);
  await page.click('#switchUser');
  await page.selectOption('#clazz', '2'); await page.click('#loginBtn'); await page.click('#confirmStart');
  await expect(page.locator('#schoolStatus')).toContainText('登録と違います');
  expect(h.dashboard().students[0].clazz).toBe(1);
});

test('teacher can isolate support-needed rows without treating incomplete records as low scores', async ({ page }) => {
  const h = harness();
  h.roster([{ email: 'one@school.example', clazz: 1, number: 1, name: '児童1', active: true },
    { email: 'two@school.example', clazz: 1, number: 2, name: '児童2', active: true }]);
  h.teacher('saveStandards', { expectedRevision: '', standards: { 0: 11 } });
  for (const date of ['2026-10-15', '2026-10-16', '2026-10-19']) {
    h.publish(0,[date]); const session = h.start(date); h.advance(120000);
    h.student('recordSession',{sessionId:session.id,answers:h.correctAnswers(session),elapsedMs:120000,finish:true,cancel:false});
  }
  await bridge(page,h,'teacher@school.example'); await page.goto(teacherPath());
  await expect(page.locator('#message')).toContainText('学校アカウントを確認しました');
  await expect(page.locator('#supportRows')).toContainText('ようすを確認');
  await expect(page.locator('#supportRows')).toContainText('記録不足');
  await page.check('#supportOnly');
  await expect(page.locator('#supportRows tr')).toHaveCount(1);
  await expect(page.locator('#supportRows')).toContainText('児童1');
  await expect(page.locator('#supportRows')).toContainText('10 / 10 / 10');
});

test('teacher correction during homework ends the old enrollment session and lets the pupil select the corrected number', async ({ page }) => {
  const h = harness(); h.roster(); h.publish();
  await bridge(page,h,'one@school.example'); await login(page);
  await expect(page.locator('#home')).toBeVisible();
  await page.locator('#calendar button.assigned').click(); await page.click('#start');
  await expect(page.locator('#play')).toBeVisible();
  await solve(page,1);
  h.roster([{...h.dashboard().students[0],number:2}]);
  await page.click('#playExit'); await page.click('#exitConfirm');
  await expect(page.locator('#retrySchoolSave')).toHaveText('カレンダーの きろくを かくにん');
  await page.click('#retrySchoolSave');
  await expect(page.locator('#login')).toBeVisible();
  await page.selectOption('#number','2'); await page.click('#loginBtn'); await page.click('#confirmStart');
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#who')).toHaveText('1くみ・2ばん');
  await expect(page.locator('#points')).toHaveText('⭐ 0pt');
});


test('teacher account can confirm test enrollment and complete homework without losing management access', async ({ page }) => {
  const h = harness(); h.publish(0, ['2026-10-19'], [3]);
  await bridge(page, h, 'teacher@school.example');
  await page.goto(test.info().project.metadata.gamePath);
  await expect(page.locator('#loginBtn')).toBeEnabled();
  await expect(page.locator('#schoolStatus')).toContainText('児童としてテスト');
  await page.selectOption('#clazz', '3'); await page.selectOption('#number', '35');
  await page.click('#loginBtn');
  await expect(page.locator('#confirmIdentity')).toContainText('先生のテスト登録');
  await expect(page.locator('#confirmStart')).toBeDisabled();
  await page.check('#confirmSchoolRegistration'); await page.click('#confirmStart');
  await expect(page.locator('#home')).toBeVisible();
  await page.locator('.day.assigned').click(); await page.click('#start');
  await solve(page, 10); await page.clock.runFor(120000);
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#summary')).toContainText('20pt');
  assertTeacher();
  function assertTeacher() {
    expect(h.teacher('bootstrap').role).toBe('teacher');
    expect(h.dashboard().progress[0].status).toBe('完了');
  }
});
