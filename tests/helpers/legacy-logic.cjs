// Baseline oracle only: production tests import the new domain modules directly.
// Extraction deliberately fails if the markers change. Replace this adapter with
// this baseline when the original archived HTML is deliberately retired.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = readFileSync(path.join(__dirname, '../../homework_math_calendar_keypad_practice_v10.html'), 'utf8');
function between(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Legacy extraction marker missing: ${start}`);
  return html.slice(from, to);
}
function loadLogic(mode = 0, seed = 1, schedule = {}) {
  let state = seed >>> 0;
  const math = Object.create(Math);
  math.random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32);
  const context = vm.createContext({ Math: math, mode, schedule });
  vm.runInContext(`
    const modes = ${between('modes=[', ';let student=') .slice('modes='.length)};
    let problemQueue = [], recentExpressions = [], lastAnswer = null;
    const getSchedule = () => schedule;
    ${between('const assigned=()', 'function render()')}
    ${between('function rand(a,b)', 'let problemQueue=')}
    ${between('function shuffle(items)', 'function resetAnswer()')}
    globalThis.api = { buildSet, problem, chooseExpression, bonusFor, claimBonuses,
      setRecent: keys => { recentExpressions = keys; },
      recent: () => recentExpressions };
  `, context);
  return context.api;
}
module.exports = { loadLogic };
