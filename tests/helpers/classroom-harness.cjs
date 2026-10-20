const { createClassroomService, projectEvents } = require('../../src/server/classroom.mjs');
const { createQuestionGenerator } = require('../../src/domain/questions.mjs');
const { seededRandom } = require('../../src/domain/modes.mjs');
function harness() {
  const events = [];
  let time = Date.parse('2026-10-19T03:00:00Z'), counter = 0, requests = 0;
  const config = { schoolDomain: 'school.example', schoolYear: '2026', teachers: ['teacher@school.example'], pinConfigured: true };
  const store = { read: () => structuredClone(events), append: event => events.push(structuredClone(event)) };
  const service = createClassroomService({ store, config, now: () => time,
    verifyTeacherPin: (email, pin) => pin === '246810',
    id: () => `id-${++counter}`, random: () => 0.25, today: () => '2026-10-19' });
  const api = (email, action, data = {}, requestId = `request-${++requests}`) => service.handle(email, { action, data, requestId });
  const teacher = (action, data = {}, requestId) => api('teacher@school.example', action, action === 'saveStudents' ? { teacherPin: '246810', ...data } : data, requestId);
  const student = (action, data = {}, requestId) => api('one@school.example', action, data, requestId);
  const dashboard = () => teacher('teacherDashboard', { from: '2026-10-01', to: '2026-10-31' });
  function roster(students = [{ email: 'one@school.example', name: '児童1', clazz: 1, number: 1, active: true }]) {
    return teacher('saveStudents', { students, expectedRevision: dashboard().rosterRevision });
  }
  function publish(mode = 0, dates = ['2026-10-19'], classes = [1]) {
    return teacher('publishAssignments', { dates, classes, mode, expectedRevision: dashboard().assignmentRevision });
  }
  function start(date = '2026-10-19') {
    const home = student('studentHome', { clazz: 1, number: 1 });
    return student('startSession', { assignmentId: home.assignments.find(a => a.date === date).id });
  }
  function correctAnswers(session, count = 10, firstAt = 0) {
    const gen = createQuestionGenerator(() => session.mode, seededRandom(session.seed));
    return Array.from({ length: count }, (_, index) => ({ seq: index, questionIndex: index, value: gen.problem().value, elapsedMs: firstAt + index * 650 }));
  }
  return { config, events, api, teacher, student, dashboard, roster, publish, start, correctAnswers,
    setTime: value => { time = value; }, advance: ms => { time += ms; }, now: () => time,
    state: () => projectEvents(store.read()) };
}
module.exports = { harness };
