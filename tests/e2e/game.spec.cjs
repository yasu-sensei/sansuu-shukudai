const { test, expect } = require('@playwright/test');
const DAY = '2026-10-19';
const STUDENT = 'math-homework-v2:1くみ・1ばん';

async function boot(page, { mode = 0, practice = false, data = null, schedule = { [DAY]: mode } } = {}) {
  await page.clock.install({ time: new Date('2026-10-19T03:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-19T03:00:01Z'));
  await page.addInitScript(({ schedule, data, key }) => {
    localStorage.setItem('math-homework-v2:schedule', JSON.stringify(schedule));
    if (data) localStorage.setItem(key, JSON.stringify(data));
  }, { schedule, data, key: STUDENT });
  await page.goto('/');
  await page.selectOption('#clazz', '1');
  await page.selectOption('#number', '1');
  await page.click('#loginBtn');
  await page.click('#confirmStart');
  await expect(page.locator('#home')).toBeVisible();
  if (practice) {
    await page.locator('#practiceModes button').nth(mode).click();
    await page.click('#practiceStart');
  } else {
    await page.locator('#calendar button.assigned').last().click();
    await page.click('#start');
  }
  await expect(page.locator('#play')).toBeVisible();
  return page.evaluate(() => performance.now());
}
async function at(page, start, milliseconds) {
  const elapsed = await page.evaluate(() => performance.now());
  const remaining = start + milliseconds - elapsed;
  if (remaining < 0) throw new Error(`Clock already passed requested boundary by ${-remaining}ms`);
  await page.clock.runFor(remaining);
}
async function answer(page, { wrong = false, wait = true } = {}) {
  const text = await page.textContent('#question');
  const [, rawA, op, rawB] = text.match(/(\d+)\s*([+−×])\s*(\d+)/);
  const a = Number(rawA), b = Number(rawB);
  const value = op === '+' ? a + b : op === '−' ? a - b : a * b;
  for (const digit of String(wrong ? 999 : value)) await page.click(`[data-key="${digit}"]`);
  await page.click('#submitAnswer');
  if (wait) await page.clock.runFor(wrong ? 900 : 650);
}
async function solve(page, count) {
  for (let i = 0; i < count; i++) await answer(page);
}
async function saved(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), STUDENT);
}

test('ten correct answers before 120 seconds do not complete; exactly 120 seconds completes once', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const start = await boot(page);
  await solve(page, 10);
  await at(page, start, 119999);
  await expect(page.locator('#play')).toBeVisible();
  expect(await saved(page)).toBeNull();
  await at(page, start, 120000);
  await expect(page.locator('#result')).toBeVisible();
  const data = await saved(page);
  expect(data.records[DAY]).toMatchObject({ firstCorrect: 10, firstTotal: 10, correct: 10, total: 10, elapsed: 120, earned: 20 });
  expect(data.points).toBe(20);
  await page.click('#back');
  await expect(page.locator('#calendar .done .stamp')).toHaveCount(1);
  await page.locator('#calendar button.assigned').last().click();
  await expect(page.locator('#start')).toBeHidden();
  await page.reload();
  await expect(page.locator('#home')).toBeVisible();
  expect(await saved(page)).toEqual(data);
  expect(errors).toEqual([]);
});

test('120 seconds with nine correct answers continues; tenth answer after the boundary is not rewarded', async ({ page }) => {
  const start = await boot(page);
  await solve(page, 9);
  await at(page, start, 120000);
  await expect(page.locator('#play')).toBeVisible();
  expect(await saved(page)).toBeNull();
  await answer(page);
  await expect(page.locator('#result')).toBeVisible();
  expect((await saved(page)).records[DAY]).toMatchObject({ firstCorrect: 9, firstTotal: 9, correct: 10, total: 10, earned: 19 });
});

test('120 seconds without answers does not complete or award points', async ({ page }) => {
  const start = await boot(page);
  await at(page, start, 120000);
  await expect(page.locator('#play')).toBeVisible();
  expect(await saved(page)).toBeNull();
});

for (const [mode, multiplier] of [1, 2, 2, 2, 3].entries()) {
  test(`mode ${mode}: points use pre-120s correct answers × ${multiplier} + 10, including 119999ms`, async ({ page }) => {
    const start = await boot(page, { mode });
    await solve(page, 9);
    await at(page, start, 119999);
    await answer(page, { wait: false });
    await expect(page.locator('#answerMark')).toHaveText('◯');
    await page.clock.runFor(1);
    await expect(page.locator('#play')).toBeVisible(); // feedback is still locked
    await page.clock.runFor(649);
    await expect(page.locator('#result')).toBeVisible();
    const data = await saved(page);
    expect(data.records[DAY]).toMatchObject({ mode, firstCorrect: 10, firstTotal: 10, earned: 10 * multiplier + 10 });
    expect(data.points).toBe(10 * multiplier + 10);
  });
}

test('an answer submitted exactly at 120000ms is excluded from first-two-minute totals', async ({ page }) => {
  const start = await boot(page);
  await solve(page, 9);
  await at(page, start, 120000);
  await answer(page);
  expect((await saved(page)).records[DAY]).toMatchObject({ firstCorrect: 9, firstTotal: 9, correct: 10, total: 10, earned: 19 });
});

test('first wrong answer retries the same question; second wrong answer advances without a correct answer', async ({ page }) => {
  await boot(page);
  const first = await page.textContent('#question');
  await answer(page, { wrong: true, wait: false });
  await expect(page.locator('#answerMark')).toHaveText('✕');
  await page.clock.runFor(900);
  await expect(page.locator('#question')).toHaveText(first);
  await expect(page.locator('#answerDisplay')).toHaveText('？');
  await expect(page.locator('#answered')).toHaveText('1');
  await answer(page, { wrong: true });
  await expect(page.locator('#question')).not.toHaveText(first);
  await expect(page.locator('#answered')).toHaveText('2');
  await expect(page.locator('#correct')).toHaveText('0');
});

test('a correct retry advances and rewards one correct answer, while counting both submissions', async ({ page }) => {
  const start = await boot(page);
  const first = await page.textContent('#question');
  await answer(page, { wrong: true });
  await expect(page.locator('#question')).toHaveText(first);
  await answer(page);
  await expect(page.locator('#question')).not.toHaveText(first);
  await solve(page, 9);
  await at(page, start, 120000);
  expect((await saved(page)).records[DAY]).toMatchObject({ firstCorrect: 10, firstTotal: 11, correct: 10, total: 11, earned: 20 });
});

test('empty submission is ignored and rapid duplicate submission during feedback is ignored', async ({ page }) => {
  await boot(page);
  await page.click('#submitAnswer');
  await expect(page.locator('#answered')).toHaveText('0');
  await answer(page, { wait: false });
  await page.click('#submitAnswer');
  await expect(page.locator('#answered')).toHaveText('1');
  await expect(page.locator('#correct')).toHaveText('1');
});

for (const count of [0, 10]) {
  test(`free practice with ${count} correct answers finishes without changing any saved record or points`, async ({ page }) => {
    const data = { points: 123, records: { '2026-10-01': { earned: 20 } }, claimed: { '2026-10-01:3': 20 } };
    const start = await boot(page, { practice: true, data });
    await solve(page, count);
    await at(page, start, 119999);
    await expect(page.locator('#play')).toBeVisible();
    await at(page, start, 120000);
    await expect(page.locator('#practiceResult')).toBeVisible();
    expect(await saved(page)).toEqual(data);
  });
}

test('cancelling the exit dialog continues; confirmed exit awards no completion or points', async ({ page }) => {
  await boot(page);
  await solve(page, 10);
  await page.click('#playExit');
  await page.click('#exitCancel');
  await expect(page.locator('#play')).toBeVisible();
  await page.click('#playExit');
  await page.click('#exitConfirm');
  await expect(page.locator('#home')).toBeVisible();
  expect(await saved(page)).toBeNull();
});

test('homework completion adds a streak bonus once and saves the bonus claim separately', async ({ page }) => {
  const schedule = { '2026-10-15': 0, '2026-10-16': 0, [DAY]: 0 };
  const data = { points: 40, records: { '2026-10-15': { earned: 20 }, '2026-10-16': { earned: 20 } }, claimed: {} };
  const start = await boot(page, { schedule, data });
  await solve(page, 10);
  await at(page, start, 120000);
  await expect(page.locator('#earned')).toHaveText('+40 ポイント！');
  const result = await saved(page);
  expect(result.points).toBe(80);
  expect(result.records[DAY].earned).toBe(20);
  expect(result.claimed).toEqual({ [`${DAY}:3`]: 20 });
  await page.clock.runFor(1000);
  expect(await saved(page)).toEqual(result);
});
