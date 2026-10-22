import { MODES, seededRandom } from '../domain/modes.mjs';
import { hasClassroomApi, callClassroom, createSessionRecorder, newRequestId } from './classroom-api.mjs';
import { createQuestionGenerator } from "../domain/questions.mjs";
import { awardStreakBonuses } from "../domain/streaks.mjs";
import { shouldFinish, calculatePoints } from "../domain/scoring.mjs";
(() => {
  "use strict";
  const $ = id => document.getElementById(id), modes = MODES;
  const cloudMode = hasClassroomApi();
  let remoteHome = null, remoteSession = null, recorder = null, serverDay = '', syncTick = null;
  let questionIndex = -1, pendingSchoolAction = null;
  const startRequests = new Map();
  let schoolIdentity = null, registrationRequest = null, confirmedSelection = null;
  $('confirmIdentity').style.whiteSpace=cloudMode?'pre-line':'';
  $('confirmIdentity').style.overflowWrap='anywhere';
  const registrationCheck = document.createElement('input'); registrationCheck.type='checkbox'; registrationCheck.id='confirmSchoolRegistration';
  const registrationLabel = document.createElement('label'); registrationLabel.hidden=true;
  registrationLabel.append(registrationCheck,document.createTextNode('クラスと ばんごうを かくにんしました。とうろくごは せんせいだけが なおせます。'));
  $('confirmLogin').insertBefore(registrationLabel,$('confirmStart').closest('p'));
  registrationCheck.onchange=()=>{if(cloudMode&&!schoolIdentity?.registered)$('confirmStart').disabled=!registrationCheck.checked;};
  const notice = document.createElement('div'); notice.className = 'panel'; notice.hidden = !cloudMode;
  const noticeText = document.createElement('p'); noticeText.setAttribute('role','status'); noticeText.setAttribute('aria-live','polite');
  noticeText.id = 'schoolStatus';
  const retrySave = document.createElement('button'); retrySave.textContent = 'もういちど ほぞんする'; retrySave.hidden = true; retrySave.id = 'retrySchoolSave';
  const refreshSchool = document.createElement('button'); refreshSchool.textContent = 'しゅくだいを こうしん'; refreshSchool.hidden = true;
  const teacherLink = document.createElement('a'); teacherLink.textContent = '先生の管理画面へ'; teacherLink.hidden = true; teacherLink.target = '_top';
  notice.append(noticeText,retrySave,refreshSchool,teacherLink); $('login').before(notice);
  function schoolStatus(text, retry = null) {
    noticeText.textContent = text;
    if (retry) pendingSchoolAction = retry;
    retrySave.hidden = !retry;
  }
  retrySave.onclick = async () => {
    if (!pendingSchoolAction) return;
    retrySave.disabled = true;
    try { await pendingSchoolAction(); } finally { retrySave.disabled = false; }
  };
  refreshSchool.onclick = async () => {
    if (!remoteHome || active || pendingSchoolAction) return;
    refreshSchool.disabled = true;
    try {
      remoteHome = await callClassroom('studentHome', {clazz: remoteHome.student.clazz, number: remoteHome.student.number});
      serverDay=remoteHome.today; home(); schoolStatus('しゅくだいを こうしんしました。');
    } catch (error) { schoolStatus(error.message); }
    finally { refreshSchool.disabled = false; }
  };

  let student = "", shown = /* @__PURE__ */ new Date(), selectedDate = "", mode = 0, question, started = 0, total = 0, correct = 0, firstTotal = 0, firstCorrect = 0, active = false, tick = null, wrongCount = 0, answerLocked = false, feedbackTimeout = null, freePractice = false;
  const pad = (n) => String(n).padStart(2, "0"), dateString = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, today = () => serverDay || dateString(/* @__PURE__ */ new Date()), studentKey = () => `math-homework-v2:${student}`, scheduleKey = "math-homework-v2:schedule", identityKey = "math-homework-v2:identity";
  const safeParse = (s, f) => {
    try {
      return JSON.parse(s) || f;
    } catch {
      return f;
    }
  }, getSchedule = () => cloudMode ? (remoteHome?.schedule || {}) : safeParse(localStorage.getItem(scheduleKey), {}), setSchedule = (s) => localStorage.setItem(scheduleKey, JSON.stringify(s));
  function get() {
    if (cloudMode) return remoteHome?.data || {records:{},claimed:{},points:0};
    const d = safeParse(localStorage.getItem(studentKey()), {});
    return { records: d.records || {}, claimed: d.claimed || {}, points: Number(d.points) || 0 };
  }
  function save(d) {
    if (cloudMode) throw new Error('学校の記録はサーバーで確定します。');
    localStorage.setItem(studentKey(), JSON.stringify(d));
  }
  function screen(id) {
    ["login", "home", "practiceDetail", "detail", "play", "practiceResult", "result"].forEach((x) => $(x).classList.toggle("hidden", x !== id));
  }
  const assigned = () => Object.keys(getSchedule()).filter((k) => Number.isInteger(getSchedule()[k]) && getSchedule()[k] >= 0 && getSchedule()[k] < modes.length).sort();
  function claimBonuses(d) {
    return awardStreakBonuses(d, assigned());
  }
  function render() {
    const d = get();
    $("who").textContent = student;
    $("points").textContent = `⭐ ${d.points}pt`;
    $("monthLabel").textContent = `${shown.getFullYear()}ねん ${shown.getMonth() + 1}がつ`;
    const cal = $("calendar");
    cal.replaceChildren();
    ["日", "月", "火", "水", "木", "金", "土"].forEach((day, i) => {
      const x = document.createElement("div");
      x.className = "weekday";
      x.style.color = i === 0 ? "#d94d75" : i === 6 ? "#427cba" : "";
      x.textContent = day;
      cal.append(x);
    });
    const year = shown.getFullYear(), month = shown.getMonth(), offset = new Date(year, month, 1).getDay(), days = new Date(year, month + 1, 0).getDate(), schedule = getSchedule();
    for (let i = 0; i < offset; i++) {
      const x = document.createElement("div");
      x.className = "day empty";
      cal.append(x);
    }
    for (let n = 1; n <= days; n++) {
      const date = dateString(new Date(year, month, n)), has = date <= today() && Object.prototype.hasOwnProperty.call(schedule, date), done = !!d.records[date], b = document.createElement(has ? "button" : "div");
      b.className = "day" + (has ? " assigned" : "") + (done ? " done" : "") + (date === today() ? " today" : "");
      const num = document.createElement("span");
      num.className = "date";
      num.textContent = n;
      b.append(num);
      if (has) {
        const m = document.createElement("span");
        m.className = "mode-name";
        m.textContent = modes[schedule[date]].short;
        b.append(m);
        if (done) {
          const stamp = document.createElement("span");
          stamp.className = "stamp";
          stamp.textContent = "💮";
          stamp.setAttribute("aria-label", "クリア");
          b.append(stamp);
        } else {
          const s = document.createElement("span");
          s.className = "status";
          s.textContent = "まだ";
          b.append(s);
        }
        b.onclick = () => openDetail(date);
      }
      cal.append(b);
    }
  }
  function home() {
    render();
    screen("home");
  }
  function openDetail(date) {
    selectedDate = date;
    const s = getSchedule();
    if (!(date in s) || date > today()) return;
    mode = s[date];
    $("detailTitle").textContent = `${date.replaceAll("-", "/")} の しゅくだい`;
    $("detailMode").textContent = modes[mode].name;
    const rec = get().records[date];
    $("start").classList.toggle("hidden", !!rec);
    $("detailStatus").replaceChildren();
    const p = document.createElement("p");
    p.textContent = rec ? `💮 クリアずみ！　はじめの2ふん：${rec.firstCorrect}もんせいかい／${rec.firstTotal}もんかいとう　もらったポイント：${rec.earned}pt` : "まだ クリアしていないよ。ここから ちょうせんできるよ！";
    $("detailStatus").append(p);
    screen("detail");
  }
  let generator = createQuestionGenerator(() => mode);
  const problem = () => generator.problem();
  function resetAnswer() {
    $("answer").value = "";
    $("answerDisplay").textContent = "？";
    $("answerDisplay").classList.remove("good", "bad");
    $("answerMark").className = "answer-mark";
    $("answerMark").textContent = "";
    answerLocked = false;
  }
  function showQuestion() {
    questionIndex++;
    question = problem();
    wrongCount = 0;
    $("question").textContent = question.label;
    resetAnswer();
  }
  function markAnswer(ok) {
    $("answerMark").textContent = ok ? "◯" : "✕";
    $("answerMark").className = "answer-mark " + (ok ? "good" : "bad");
    $("answerDisplay").classList.add(ok ? "good" : "bad");
  }
  function elapsed() {
    return (performance.now() - started) / 1e3;
  }
  function update() {
    const sec = Math.floor(elapsed());
    $("timer").textContent = `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
    if (shouldFinish(elapsed(), correct, freePractice, answerLocked)) finish();
  }
  function finish() {
    if (!active) return;
    active = false;
    clearInterval(tick);
    clearTimeout(feedbackTimeout);
    if (freePractice) {
      $("practiceSummary").textContent = `${modes[mode].name}　｜　2ふんかんで ${correct}もん せいかい！　｜　かいとう ${total}かい　｜　せいかいりつ ${total ? Math.round(correct / total * 100) : 0}%`;
      screen("practiceResult");
      return;
    }
    if (cloudMode) {
      clearInterval(syncTick);
      persistSchoolEnd(false, elapsed() * 1000);
      return;
    }
    const d = get();
    if (d.records[selectedDate]) {
      home();
      return;
    }
    const earned = calculatePoints(firstCorrect, modes[mode].mult);
    d.records[selectedDate] = { mode, firstCorrect, firstTotal, correct, total, elapsed: Math.round(elapsed()), earned, completedAt: (/* @__PURE__ */ new Date()).toISOString() };
    d.points += earned;
    const streakBonus = claimBonuses(d);
    save(d);
    $("earned").textContent = `+${earned + streakBonus} ポイント！`;
    $("summary").textContent = `しゅくだい：${selectedDate}　｜　はじめの2ふん：${firstCorrect}もんせいかい／${firstTotal}もんかいとう　｜　ぜんぶで：${correct}もんせいかい／${total}もんかいとう　｜　宿題ポイント：${earned}pt（完了＋10ptを含む）　｜　連続ボーナス：${streakBonus}pt　｜　合計：${d.points}pt`;
    screen("result");
  }
  for (let n = 1; n <= 35; n++) {
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = `${n}ばん`;
    $("number").append(opt);
  }
  function beginLogin() {
    const c = Number($("clazz").value), n = Number($("number").value);
    if (!Number.isInteger(c) || c < 1 || c > 4 || !Number.isInteger(n) || n < 1 || n > 35) {
      alert("クラスと ばんごうを えらんでね");
      return;
    }
    if(cloudMode)confirmedSelection={clazz:c,number:n};
    $("confirmIdentity").textContent = `${c}くみ　${n}ばん`;
    if(cloudMode && schoolIdentity && !schoolIdentity.registered) {
      $('confirmIdentity').textContent = `${c}くみ　${n}ばん\n${schoolIdentity.email}\n${schoolIdentity.role==='teacher'?'先生のテスト登録です。児童が使わない番号か確認してください。':'はじめての とうろくです。まちがいが ないか かくにんしてね。'}`;
      registrationLabel.hidden=false; registrationCheck.checked=false; $('confirmStart').disabled=true;
      $('confirmStart').textContent='このないようで とうろくする';
    }
    $("confirmLogin").classList.remove("hidden");
    $("loginBtn").classList.add("hidden");
  }
  $("loginBtn").onclick = beginLogin;
  $("reselect").onclick = () => {
    $("confirmLogin").classList.add("hidden");
    $("loginBtn").classList.remove("hidden");
  };
  $('confirmStart').onclick = async () => {
    const c = cloudMode?confirmedSelection?.clazz:Number($('clazz').value), n = cloudMode?confirmedSelection?.number:Number($('number').value);
    if(!Number.isInteger(c)||!Number.isInteger(n)||c<1||c>4||n<1||n>35)return;
    if (cloudMode) {
      $('confirmStart').disabled = true;
      try {
        if(!schoolIdentity.registered) {
          if(!registrationCheck.checked)throw new Error('クラスと ばんごうを かくにんしてね。');
          const data={clazz:c,number:n,confirmed:true,...(schoolIdentity.role==='teacher'?{teacherTest:true}:{})};
          const key=JSON.stringify(data);
          if(!registrationRequest||registrationRequest.key!==key)registrationRequest={key,id:newRequestId()};
          await callClassroom('registerStudent',data,registrationRequest.id);
          schoolIdentity.registered=true; registrationLabel.hidden=true; registrationRequest=null;
          $('confirmStart').textContent='あっている！';
        }
        remoteHome = await callClassroom('studentHome', {clazz:c,number:n});
        serverDay=remoteHome.today; student = `${c}くみ・${n}ばん`; shown = new Date(remoteHome.today+'T12:00:00');
        refreshSchool.hidden = false; home(); schoolStatus('がっこうの しゅくだいを ひょうじしました。');
      } catch(error) { schoolStatus(error.message); }
      finally { $('confirmStart').disabled = false; }
      return;
    }
    student = `${c}くみ・${n}ばん`;
    localStorage.setItem(identityKey, student); home();
  };
  $("switchUser").onclick = () => {
    const pin = prompt("せんせいの あんしょうばんごうを いれてください");
    if (pin === null) return;
    if (pin !== "0822") {
      alert("あんしょうばんごうが ちがいます");
      return;
    }
    if (!confirm("クラスと ばんごうを えらびなおしますか？（いままでの学習記録は消えません）")) return;
    localStorage.removeItem(identityKey);
    student = "";
    $("clazz").value = "";
    $("number").value = "";
    $("confirmLogin").classList.add("hidden");
    $("loginBtn").classList.remove("hidden");
    screen("login");
  };
  $("prev").onclick = () => {
    shown = new Date(shown.getFullYear(), shown.getMonth() - 1, 1);
    render();
  };
  $("next").onclick = () => {
    shown = new Date(shown.getFullYear(), shown.getMonth() + 1, 1);
    render();
  };
  $("teacherToggle").onclick = () => {
    if (!$("teacher").classList.contains("hidden")) {
      $("teacher").classList.add("hidden");
      return;
    }
    const pin = prompt("せんせいの あんしょうばんごう");
    if (pin === null) return;
    if (pin !== "0822") return alert("あんしょうばんごうが ちがいます");
    $("teacher").classList.remove("hidden");
  };
  $("setMode").replaceChildren();
  modes.forEach((m, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = m.name;
    $("setMode").append(o);
  });
  $("setDate").value = today();
  $("setSave").onclick = () => {
    const date = $("setDate").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return alert("日付を選んでください");
    const s = getSchedule();
    s[date] = Number($("setMode").value);
    setSchedule(s);
    const d = get();
    claimBonuses(d);
    save(d);
    shown = /* @__PURE__ */ new Date(date + "T12:00:00");
    render();
    alert("しゅくだいを設定しました");
  };
  $("setRemove").onclick = () => {
    const date = $("setDate").value, s = getSchedule();
    if (!date) return;
    if (get().records[date]) return alert("すでに完了記録があるため、この試作版では削除できません");
    delete s[date];
    setSchedule(s);
    render();
  };
  function preparePlay() {
    if(cloudMode) generator = cloudMode && !freePractice
      ? createQuestionGenerator(()=>mode, seededRandom(remoteSession.seed)) : createQuestionGenerator(()=>mode);
    generator.reset(); questionIndex = -1;
    total = 0;
    correct = 0;
    firstTotal = 0;
    firstCorrect = 0;
    active = true;
    $("correct").textContent = "0";
    $("answered").textContent = "0";
    clearTimeout(feedbackTimeout);
    answerLocked = false;
    wrongCount = 0;
    $("playExitLabel").textContent = freePractice ? "れんしゅうを やめる" : "しゅくだいを ちゅうだん";
    $("playDate").textContent = freePractice ? "✏️ じゆうれんしゅう" : `${selectedDate} の しゅくだい`;
    $("play").querySelector(".muted").textContent = freePractice ? "2ふんで おしまい！ ポイントは つかないよ。" : "2ふんを すぎても 10もん せいかいするまで つづくよ。";
    started = performance.now();
    screen("play");
    showQuestion();
    clearInterval(tick);
    tick = setInterval(update, 150);
    clearInterval(syncTick);
    if(cloudMode && !freePractice) syncTick = setInterval(() => flushSchoolProgress(),15000);
  }
  modes.forEach((m, i) => {
    const b = document.createElement("button");
    b.textContent = m.name;
    b.onclick = () => {
      freePractice = true;
      mode = i;
      $("practiceModeName").textContent = m.name;
      screen("practiceDetail");
    };
    $("practiceModes").append(b);
  });
  $("practiceTopBack").onclick = home;
  $("detailTopBack").onclick = home;
  $("practiceResultBack").onclick = home;
  $("resultTopBack").onclick = home;
  function exitPlay() {
    if (!active) return;
    $("exitQuestion").textContent = freePractice ? "れんしゅうを やめて カレンダーに もどる？" : "しゅくだいを ちゅうだんする？ はなまるや ポイントは つかないよ。";
    $("exitDialog").classList.remove("hidden");
  }
  $("playExit").addEventListener("click", exitPlay);
  $("exitCancel").addEventListener("click", () => {
    $("exitDialog").classList.add("hidden");
  });
  $('exitConfirm').addEventListener('click', () => {
    $('exitDialog').classList.add('hidden');
    if(!active)return;
    active=false; clearInterval(tick); clearInterval(syncTick); clearTimeout(feedbackTimeout);
    feedbackTimeout=null; answerLocked=false;
    if(cloudMode && !freePractice) persistSchoolEnd(true,elapsed()*1000);
    else home();
  });
  $("practiceStart").onclick = () => {
    freePractice = true;
    preparePlay();
  };
  $("practiceAgain").onclick = () => {
    freePractice = true;
    preparePlay();
  };
  $("practiceHome").onclick = home;
  $("detailBack").onclick = home;
  $('start').onclick = async () => {
    if(get().records[selectedDate])return openDetail(selectedDate);
    if(getSchedule()[selectedDate]!==mode||selectedDate>today())return home();
    if(cloudMode) {
      if(pendingSchoolAction)return schoolStatus('さきに きろくを ほぞんしてね。',pendingSchoolAction);
      const assignment=remoteHome.assignments.find(a=>a.date===selectedDate);
      if(!assignment)return;
      $('start').disabled=true;
      try {
        const requestId=startRequests.get(assignment.id)||newRequestId();
        startRequests.set(assignment.id,requestId);
        remoteSession=await callClassroom('startSession',{assignmentId:assignment.id},requestId);
        startRequests.delete(assignment.id);
        recorder=createSessionRecorder(remoteSession.id);
        freePractice=false; preparePlay(); schoolStatus('しゅくだいを はじめました。');
      }catch(error){schoolStatus(error.message);}
      finally{$('start').disabled=false;}
      return;
    }
    freePractice=false; preparePlay();
  };
  $("keypad").onclick = (e) => {
    const btn = e.target.closest("button[data-key]");
    if (!btn || !active || answerLocked) return;
    const key = btn.dataset.key;
    let value = $("answer").value;
    if (key === "clear") value = "";
    else if (key === "back") value = value.slice(0, -1);
    else if (value.length < 3) value += key;
    $("answer").value = value;
    $("answerDisplay").textContent = value || "？";
  };
  function submitAnswer() {
    if (!active || answerLocked) return;
    const raw = $("answer").value;
    if (raw === "") return;
    answerLocked = true;
    const t = elapsed();
    total++;
    const ok = Number(raw) === question.value;
    if(cloudMode && !freePractice) recorder.add({questionIndex,value:Number(raw),elapsedMs:t*1000});
    if (ok) correct++;
    else wrongCount++;
    if (t < 120) {
      firstTotal++;
      if (ok) firstCorrect++;
    }
    $("correct").textContent = correct;
    $("answered").textContent = total;
    markAnswer(ok);
    if(cloudMode&&!freePractice&&total%5===0)flushSchoolProgress();
    feedbackTimeout = setTimeout(() => {
      if (!active) return;
      if (ok || wrongCount >= 2) {
        showQuestion();
      } else {
        resetAnswer();
      }
      update();
    }, ok ? 650 : 900);
  }
  $("submitAnswer").addEventListener("click", submitAnswer);
  $("answerForm").addEventListener("submit", (e) => {
    e.preventDefault();
    submitAnswer();
  });
  $("back").onclick = home;
  async function flushSchoolProgress() {
    if(!active||freePractice||!recorder)return;
    try { await recorder.flush({elapsedMs:elapsed()*1000}); }
    catch(error) { if(active&&!pendingSchoolAction)schoolStatus('きろくが まだ ほぞんできていません。つうしんを かくにんしてね。'); }
  }
  async function persistSchoolEnd(cancel,elapsedMs) {
    const action=async()=>persistSchoolEnd(cancel,elapsedMs);
    pendingSchoolAction=action;
    schoolStatus('きろくを ほぞんしています。');
    try {
      const response=await recorder.flush({elapsedMs,finish:!cancel,cancel});
      pendingSchoolAction=null;
      if(cancel){home();schoolStatus('ちゅうだんした きろくを ほぞんしました。');return;}
      remoteHome=response.home; serverDay=remoteHome.today;
      const rec=response.completion;
      $('earned').textContent=`+${rec.earned+rec.bonus} ポイント！`;
      $('summary').textContent=`はじめの2ふん：${rec.firstCorrect}もんせいかい／${rec.firstTotal}もんかいとう　｜　ぜんぶで：${rec.correct}もんせいかい／${rec.total}もんかいとう　｜　合計：${remoteHome.data.points}pt`;
      screen('result');schoolStatus('がんばった きろくを ほぞんしました！');
    }catch(error){
      if(['SESSION','COMPLETED'].includes(error.code)) {
        const recover=async()=>{
          try {
            remoteHome=await callClassroom('studentHome',{clazz:remoteHome.student.clazz,number:remoteHome.student.number});
            pendingSchoolAction=null; recorder=null; serverDay=remoteHome.today; home(); schoolStatus('がっこうに ほぞんされた きろくを かくにんしました。');
          }catch(failure){
            if(['IDENTITY','ENROLLMENT'].includes(failure.code)) {
              pendingSchoolAction=null; recorder=null; remoteHome=null; student=''; refreshSchool.hidden=true;
              $('confirmLogin').classList.add('hidden'); $('loginBtn').classList.remove('hidden');screen('login');schoolStatus(failure.message);
            }else schoolStatus(failure.message,recover);
          }
        };
        retrySave.textContent='カレンダーの きろくを かくにん'; schoolStatus(error.message,recover);
      }else{retrySave.textContent='もういちど ほぞんする';schoolStatus(error.message+'　このがめんで もういちど ほぞんしてね。',action);}
    }
  }
  if(cloudMode) {
    $('teacherToggle').hidden=true; $('teacher').classList.add('hidden');
    $('switchUser').textContent='えらびなおす';
    $('switchUser').onclick=()=>{
      remoteHome=null; student=''; refreshSchool.hidden=true;
      $('confirmLogin').classList.add('hidden');$('loginBtn').classList.remove('hidden');screen('login');
    };
    $('login').querySelector('.muted').textContent='はじめての ときは クラスと ばんごうを かくにんして とうろくします。とうろくごに なおせるのは せんせいだけです。';
    $('loginBtn').disabled=true;
    schoolStatus('がっこうの アカウントを かくにんしています。');
    callClassroom('bootstrap').then(info=>{
      serverDay=info.today; schoolIdentity=info;
      if(info.role==='teacher') {
        $('loginBtn').disabled=false;
        schoolStatus('先生のアカウントです。下のクラス・番号から児童としてテストできます。実際の児童が使わない番号を選んでください。');
        if(info.teacherUrl){teacherLink.href=info.teacherUrl;teacherLink.hidden=false;}
      } else {
        $('loginBtn').disabled=false;
        schoolStatus(info.registered?'クラスと ばんごうを えらんでね。':'はじめての とうろくです。クラスと ばんごうを えらんで、かくにんしてね。');
      }
    }).catch(error=>schoolStatus(error.message));
  }else{
  const savedIdentity = localStorage.getItem(identityKey);
  if (savedIdentity && /^[1-4]くみ・(?:[1-9]|[12][0-9]|3[0-5])ばん$/.test(savedIdentity)) {
    student = savedIdentity;
    home();
  }
  if (localStorage.getItem(scheduleKey) === null) {
    const s = {}, now = /* @__PURE__ */ new Date();
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      if (d.getDay() !== 0 && d.getDay() !== 6) s[dateString(d)] = i % 5;
    }
    setSchedule(s);
  }
  }
})();
