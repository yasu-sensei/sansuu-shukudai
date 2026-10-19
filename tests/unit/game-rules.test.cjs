const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadLogic } = require('../helpers/legacy-logic.cjs');

test('index.html is byte-for-byte identical to the preserved original', () => {
  const root = path.join(__dirname, '../..');
  assert.deepEqual(fs.readFileSync(path.join(root, 'index.html')),
    fs.readFileSync(path.join(root, 'homework_math_calendar_keypad_practice_v10.html')));
});

for (let mode = 0; mode < 5; mode++) {
  test(`mode ${mode}: operand ranges, answer distribution and set uniqueness (100 seeded runs)`, () => {
    for (let seed = 1; seed <= 100; seed++) {
      const logic = loadLogic(mode, seed);
      const size = [11, 8, 8, 10, 12][mode];
      // Use problem(), so queue boundaries and the rolling history are exercised.
      const questions = Array.from({ length: size * 4 }, () => logic.problem());
      for (let offset = 0; offset < questions.length; offset += size) {
        const set = questions.slice(offset, offset + size);
        assert.equal(new Set(set.map(q => q.key)).size, size);
        for (const q of set) {
          const match = q.key.match(/^(\d+)([+−×])(\d+)$/);
          assert.ok(match, q.key);
          const [, rawA, op, rawB] = match;
          const a = Number(rawA), b = Number(rawB);
          assert.equal(q.value, op === '+' ? a + b : op === '−' ? a - b : a * b);
          assert.equal(q.label, `${a} ${op} ${b} = ?`);
          if (mode === 0) {
            assert.ok(a >= 0 && a <= 10 && b >= 0 && b <= 10);
            assert.ok(op === '+' || op === '−');
          } else if (mode === 1) {
            assert.equal(op, '+');
            assert.ok(a >= 1 && a <= 9 && b >= 1 && b <= 9 && a + b > 10);
          } else if (mode === 2) {
            assert.equal(op, '−');
            assert.ok(a >= 11 && a <= 18 && b >= 2 && b <= 9 && b > a % 10);
          } else {
            assert.equal(op, '×');
            assert.ok(b >= 1 && b <= 9);
          }
        }
        if (mode <= 2) {
          const start = [0, 11, 2][mode];
          assert.deepEqual(set.map(q => q.value).sort((a, b) => a - b),
            Array.from({ length: size }, (_, i) => i + start));
          if (offset) assert.notEqual(set[0].value, questions[offset - 1].value);
          if (mode === 0) assert.ok(Math.abs(set.filter(q => q.key.includes('+')).length * 2 - size) <= 1);
        } else {
          const counts = {};
          for (const q of set) {
            const table = q.key.split('×')[0];
            counts[table] = (counts[table] || 0) + 1;
          }
          const tables = mode === 3 ? [1, 2, 3, 5, 9] : [4, 6, 7, 8, 9, 10];
          assert.deepEqual(counts, Object.fromEntries(tables.map(n => [n, 2])));
        }
      }
      assert.equal(logic.recent().length, Math.min(35, questions.length));
    }
  });
}

test('expression selection prefers unused and nonrecent alternatives', () => {
  const logic = loadLogic();
  const options = [{ a: 1, b: 2, op: '+' }, { a: 2, b: 1, op: '+' }];
  logic.setRecent(['1+2']);
  assert.equal(logic.chooseExpression(options).key, '2+1');
  logic.setRecent([]);
  assert.equal(logic.chooseExpression(options, ['1+2']).key, '2+1');
});

test('bonus milestones: 3, 5, 10, 20, 30, but not 15 or ordinary counts', () => {
  const { bonusFor } = loadLogic();
  for (let n = 0; n <= 31; n++) {
    const expected = n === 3 ? 20 : n === 5 ? 30 : [10, 20, 30].includes(n) ? 50 : 0;
    assert.equal(bonusFor(n), expected, `streak ${n}`);
  }
});

function fixture(count) {
  // Gaps intentionally demonstrate assigned-homework streaks, not calendar days.
  const dates = Array.from({ length: count }, (_, i) => `2026-${String(Math.floor(i / 10) + 1).padStart(2, '0')}-${String(i % 10 * 2 + 1).padStart(2, '0')}`);
  return { dates, schedule: Object.fromEntries(dates.slice().reverse().map(d => [d, 0])) };
}

test('sorted assigned dates earn milestone bonuses once, including nonconsecutive dates', () => {
  const { dates, schedule } = fixture(30);
  const { claimBonuses } = loadLogic(0, 1, schedule);
  const data = { records: Object.fromEntries(dates.map(d => [d, {}])), claimed: {}, points: 7 };
  assert.equal(claimBonuses(data), 200);
  assert.equal(data.points, 207);
  assert.equal(Object.keys(data.claimed).length, 5);
  assert.equal(claimBonuses(data), 0);
  assert.equal(data.points, 207);
});

test('missing homework breaks a streak; completing it later awards newly reached bonuses', () => {
  const { dates, schedule } = fixture(5);
  const { claimBonuses } = loadLogic(0, 1, schedule);
  const data = { records: Object.fromEntries(dates.filter((_, i) => i !== 2).map(d => [d, {}])), claimed: {}, points: 0 };
  assert.equal(claimBonuses(data), 0);
  data.records[dates[2]] = {};
  assert.equal(claimBonuses(data), 50);
  assert.equal(claimBonuses(data), 0);
});
