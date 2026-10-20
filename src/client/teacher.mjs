import { MODES } from '../domain/modes.mjs';
import { callClassroom, hasClassroomApi, newRequestId } from './classroom-api.mjs';
const $ = id => document.getElementById(id);
let snapshot = null, busy = false;
function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; }
function cell(value) { const td = document.createElement('td'); td.textContent = value ?? '—'; return td; }
function table(id, rows) {
  $(id).replaceChildren(...rows);
  if (!rows.length) { const tr = document.createElement('tr'); tr.append(cell('該当する記録はありません。')); $(id).append(tr); }
}
function row(values, attention = false) {
  const tr = document.createElement('tr');
  if (attention) tr.className = 'attention';
  tr.append(...values.map(cell)); return tr;
}
for (const [index, mode] of MODES.entries()) {
  const option = document.createElement('option'); option.value = index; option.textContent = mode.name;
  $('publishMode').append(option);
  const label = document.createElement('label'); label.textContent = mode.name;
  const input = document.createElement('input'); input.type = 'number'; input.min = 1; input.max = 500;
  input.id = `standard-${index}`; input.placeholder = '未設定'; label.append(input); $('standardInputs').append(label);
}
function render(data) {
  snapshot = data;
  $('pinSettingsInfo').textContent = data.pinConfigured ? '暗証番号は設定済みです。名簿修正の際に入力してください。' : '最初に先生用の暗証番号を設定してください。児童の初回登録には暗証番号は不要です。';
  $('currentPinLabel').hidden = !data.pinConfigured; $('currentPin').required = !!data.pinConfigured;
  $('updated').textContent = `${data.schoolYear}年度／日本時間 ${data.today}　現在の保存記録を表示しています。`;
  table('studentRows', data.students.filter(s => !$('classFilter').value || $('classFilter').value === '0' || s.clazz === Number($('classFilter').value)).map(s => {
    const tr = row([`${s.clazz}組 ${s.number}番`, s.name, s.email, s.active ? '有効' : '無効']);
    const td = document.createElement('td'), button = document.createElement('button'); button.textContent = '修正';
    button.type = 'button'; button.onclick = () => {
      $('studentId').value = s.id; $('studentEmail').value = s.email; $('studentName').value = s.name;
      $('studentClass').value = s.clazz; $('studentNumber').value = s.number; $('studentActive').value = String(s.active);
      $('studentEmail').focus();
    }; td.append(button); tr.append(td); return tr;
  }));
  table('progressRows', data.progress.map(p => row([`${p.clazz}組 ${p.number}番`, p.name, p.date, MODES[p.mode].short, p.status,
    p.summary ? `${p.summary.firstCorrect}／${p.summary.firstTotal}` : '—', p.summary?.elapsed,
    p.status === '完了' ? p.summary.earned + p.summary.bonus : '—'])));
  $('progressSummary').textContent=['未着手','取り組み中','中断','完了'].map(status=>`${status} ${data.progress.filter(p=>p.status===status).length}件`).join(' ／ ');
  renderSupport(data);
  for (let mode = 0; mode < MODES.length; mode++) $(`standard-${mode}`).value = data.standards[mode] ?? '';
}
function renderSupport(data) {
  table('supportRows', data.support.filter(p=>!$('supportOnly').checked||p.status==='ようすを確認').map(p => row([`${p.clazz}組 ${p.number}番`, p.name, MODES[p.mode].name, p.status,
    p.recent?.join(' / ') || '—', p.accuracy?.map(a => a === null ? '—' : `${a}%`).join(' / ') || '—'], p.status === 'ようすを確認')));
}
$('supportOnly').onchange=()=>{if(snapshot)renderSupport(snapshot);};
async function refresh() {
  render(await callClassroom('teacherDashboard', { clazz: Number($('classFilter').value), from: $('from').value, to: $('to').value }));
}
async function run(task) {
  if (busy) return;
  busy = true; document.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await task(); } catch (error) { message(error.message, true); }
  finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
}
// Keep a failed mutation for retry, so lost responses cannot repeat a publish or edit.
const pendingMutations = new Map();
async function mutate(action, data) {
  const key = JSON.stringify({ action, data });
  const requestId = pendingMutations.get(key) || newRequestId();
  pendingMutations.set(key, requestId);
  try {
    const result = await callClassroom(action, data, requestId);
    pendingMutations.delete(key); await refresh(); return result;
  } catch (error) {
    if (error.code) pendingMutations.delete(key);
    throw error;
  }
}
$('filterForm').onsubmit = event => { event.preventDefault(); run(async () => { await refresh(); message('最新の保存記録を表示しました。'); }); };
$('publishForm').onsubmit = event => {
  event.preventDefault(); run(async () => {
    if (!snapshot) throw new Error('先に学校への接続を確認してください。');
    const from = $('publishFrom').value, to = $('publishTo').value;
    if (!from || !to || from > to) throw new Error('配信期間を確認してください。');
    const start = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`);
    if ((end - start) / 86400000 > 30) throw new Error('一度の配信期間は31日以内にしてください。');
    const dates = [];
    for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
      if (!$('weekdays').checked || ![0, 6].includes(d.getUTCDay())) dates.push(d.toISOString().slice(0, 10));
    }
    const classes = [...document.querySelectorAll('[name=classes]:checked')].map(c => Number(c.value));
    if (!classes.length || !dates.length) throw new Error('配信先の学級と対象日を選んでください。');
    const result = await mutate('publishAssignments', { classes, dates, mode: Number($('publishMode').value), expectedRevision: snapshot.assignmentRevision });
    message(`${result.published}件の宿題を配信しました。`);
  });
};
$('studentForm').onsubmit = event => {
  event.preventDefault(); run(async () => {
    if (!snapshot) throw new Error('先に学校への接続を確認してください。');
    await mutate('saveStudents', { expectedRevision: snapshot.rosterRevision, teacherPin: $('teacherPin').value, students: [{ id: $('studentId').value || undefined,
      email: $('studentEmail').value, name: $('studentName').value, clazz: Number($('studentClass').value), number: Number($('studentNumber').value), active: $('studentActive').value === 'true' }] });
    $('studentForm').reset(); $('studentId').value = ''; message('名簿を保存しました。');
  });
};
$('clearStudent').onclick = () => { $('studentForm').reset(); $('studentId').value = ''; };
$('bulkForm').onsubmit = event => {
  event.preventDefault(); run(async () => {
    if (!snapshot) throw new Error('先に学校への接続を確認してください。');
    const lines = $('bulkStudents').value.trim().split(/\r?\n/).filter(line => line.trim());
    if (lines[0]?.split('\t')[0] === 'メール') lines.shift();
    const students = lines.map((line, index) => {
      const fields = line.split('\t');
      if (fields.length < 3 || fields.length > 4) throw new Error(`${index + 1}行目を「メール・組・番号・名前」のタブ区切りで確認してください。`);
      const [email, clazz, number, name = ''] = fields;
      return { email, clazz: Number(clazz), number: Number(number), name, active: true };
    });
    const result = await mutate('saveStudents', { expectedRevision: snapshot.rosterRevision, teacherPin: $('teacherPin').value, students });
    $('bulkStudents').value = ''; $('teacherPin').value=''; message(`${result.saved}人の名簿を保存しました。`);
  });
};
$('pinForm').onsubmit = event => {
  event.preventDefault(); run(async()=>{
    if(!snapshot)throw new Error('先に学校への接続を確認してください。');
    if($('newPin').value!==$('confirmPin').value)throw new Error('新しい暗証番号が一致しません。');
    await callClassroom('configureTeacherPin',{currentPin:$('currentPin').value,newPin:$('newPin').value,confirmPin:$('confirmPin').value});
    $('pinForm').reset(); await refresh(); message('先生用の暗証番号を設定しました。');
  });
};
$('standardsForm').onsubmit = event => {
  event.preventDefault(); run(async () => {
    if (!snapshot) throw new Error('先に学校への接続を確認してください。');
    const standards = {};
    for (let mode = 0; mode < MODES.length; mode++) if ($(`standard-${mode}`).value !== '') standards[mode] = Number($(`standard-${mode}`).value);
    await mutate('saveStandards', { standards, expectedRevision: snapshot.standardRevision }); message('モード別の目安を保存しました。');
  });
};
if (!hasClassroomApi()) message('学校用GASのURLから開いてください。この画面は端末内デモでは操作できません。', true);
else run(async () => {
  const info = await callClassroom('bootstrap');
  if (info.role !== 'teacher') throw new Error('先生の学校アカウントで開いてください。');
  for (const id of ['from', 'to', 'publishFrom', 'publishTo']) $(id).value = info.today;
  await refresh(); message('学校アカウントを確認しました。');
});
