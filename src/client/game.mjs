import { createQuestionGenerator } from "../domain/questions.mjs";
import { awardStreakBonuses } from "../domain/streaks.mjs";
import { shouldFinish, calculatePoints } from "../domain/scoring.mjs";
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id), modes = [{ name: "10までの たしひき", short: "たしひき", mult: 1 }, { name: "20までの くりあがり たしざん", short: "たし算", mult: 2 }, { name: "20までの くりさがり ひきざん", short: "ひき算", mult: 2 }, { name: "九九（1・2・3・5・9）", short: "九九①", mult: 2 }, { name: "九九（4・6・7・8・9・10）", short: "九九②", mult: 3 }];
  let student = "", shown = /* @__PURE__ */ new Date(), selectedDate = "", mode = 0, question, started = 0, total = 0, correct = 0, firstTotal = 0, firstCorrect = 0, active = false, tick = null, wrongCount = 0, answerLocked = false, feedbackTimeout = null, freePractice = false;
  const pad = (n) => String(n).padStart(2, "0"), dateString = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, today = () => dateString(/* @__PURE__ */ new Date()), studentKey = () => `math-homework-v2:${student}`, scheduleKey = "math-homework-v2:schedule", identityKey = "math-homework-v2:identity";
  const safeParse = (s, f) => {
    try {
      return JSON.parse(s) || f;
    } catch {
      return f;
    }
  }, getSchedule = () => safeParse(localStorage.getItem(scheduleKey), {}), setSchedule = (s) => localStorage.setItem(scheduleKey, JSON.stringify(s));
  function get() {
    const d = safeParse(localStorage.getItem(studentKey()), {});
    return { records: d.records || {}, claimed: d.claimed || {}, points: Number(d.points) || 0 };
  }
  function save(d) {
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
  const generator = createQuestionGenerator(() => mode);
  const problem = generator.problem;
  function resetAnswer() {
    $("answer").value = "";
    $("answerDisplay").textContent = "？";
    $("answerDisplay").classList.remove("good", "bad");
    $("answerMark").className = "answer-mark";
    $("answerMark").textContent = "";
    answerLocked = false;
  }
  function showQuestion() {
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
    $("confirmIdentity").textContent = `${c}くみ　${n}ばん`;
    $("confirmLogin").classList.remove("hidden");
    $("loginBtn").classList.add("hidden");
  }
  $("loginBtn").onclick = beginLogin;
  $("reselect").onclick = () => {
    $("confirmLogin").classList.add("hidden");
    $("loginBtn").classList.remove("hidden");
  };
  $("confirmStart").onclick = () => {
    const c = Number($("clazz").value), n = Number($("number").value);
    if (c < 1 || c > 4 || n < 1 || n > 35) return;
    student = `${c}くみ・${n}ばん`;
    localStorage.setItem(identityKey, student);
    home();
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
    generator.reset();
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
  $("exitConfirm").addEventListener("click", () => {
    $("exitDialog").classList.add("hidden");
    if (!active) return;
    active = false;
    clearInterval(tick);
    clearTimeout(feedbackTimeout);
    feedbackTimeout = null;
    answerLocked = false;
    home();
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
  $("start").onclick = () => {
    if (get().records[selectedDate]) return openDetail(selectedDate);
    if (getSchedule()[selectedDate] !== mode || selectedDate > today()) return home();
    freePractice = false;
    preparePlay();
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
    if (ok) correct++;
    else wrongCount++;
    if (t < 120) {
      firstTotal++;
      if (ok) firstCorrect++;
    }
    $("correct").textContent = correct;
    $("answered").textContent = total;
    markAnswer(ok);
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
})();
