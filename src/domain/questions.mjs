function createQuestionGenerator(getMode, random = Math.random) {
  function rand(a, b) {
    return Math.floor(random() * (b - a + 1)) + a;
  }
  let problemQueue = [], recentExpressions = [], lastAnswer = null;
  function shuffle(items) {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = rand(0, i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function candidatesForAnswer(target) {
    const mode = getMode();
    const out = [];
    if (mode === 0) {
      for (let a = 0; a <= 10; a++) for (let b = 0; b <= 10; b++) {
        if (a + b === target) out.push({ a, b, op: "+" });
        if (a - b === target) out.push({ a, b, op: "−" });
      }
    } else if (mode === 1) {
      for (let a = 1; a <= 9; a++) for (let b = 1; b <= 9; b++) if (a + b === target && a + b > 10) out.push({ a, b, op: "+" });
    } else if (mode === 2) {
      for (let a = 11; a <= 18; a++) for (let b = 2; b <= 9; b++) if (a - b === target && b > a % 10) out.push({ a, b, op: "−" });
    }
    return out;
  }
  function chooseExpression(options, usedInSet = [], preferredOp = null) {
    const scored = options.map((x2) => {
      const key = `${x2.a}${x2.op}${x2.b}`;
      let score = random() * 3;
      if (recentExpressions.includes(key)) score -= 30;
      if (usedInSet.includes(key)) score -= 100;
      if (preferredOp && x2.op === preferredOp) score += 7;
      return { ...x2, key, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const x = scored[0];
    return { label: `${x.a} ${x.op} ${x.b} = ?`, value: x.op === "+" ? x.a + x.b : x.op === "−" ? x.a - x.b : x.a * x.b, key: x.key };
  }
  function buildSet() {
    const mode = getMode();
    const used = [];
    let result = [];
    if (mode <= 2) {
      const targets = mode === 0 ? Array.from({ length: 11 }, (_, i) => i) : mode === 1 ? Array.from({ length: 8 }, (_, i) => i + 11) : Array.from({ length: 8 }, (_, i) => i + 2);
      const order = shuffle(targets);
      if (order.length > 1 && order[0] === lastAnswer) [order[0], order[1]] = [order[1], order[0]];
      let plus = 0, minus = 0;
      for (const target of order) {
        let preferred = null;
        if (mode === 0) {
          preferred = plus > minus ? "−" : minus > plus ? "+" : random() < 0.5 ? "+" : "−";
        }
        const q = chooseExpression(candidatesForAnswer(target), used, preferred);
        result.push(q);
        used.push(q.key);
        if (q.key.includes("+")) plus++;
        else minus++;
      }
    } else {
      const tables = mode === 3 ? [1, 2, 3, 5, 9] : [4, 6, 7, 8, 9, 10];
      for (const a of tables) {
        const options = [];
        for (let b = 1; b <= 9; b++) options.push({ a, b, op: "×" });
        for (let j = 0; j < 2; j++) {
          const q = chooseExpression(options, used);
          used.push(q.key);
          result.push(q);
        }
      }
      result = shuffle(result);
      for (let i = 1; i < result.length; i++) {
        if (result[i].key.split("×")[0] === result[i - 1].key.split("×")[0]) {
          const k = result.findIndex((q, j) => j > i && q.key.split("×")[0] !== result[i - 1].key.split("×")[0] && (i + 1 >= result.length || q.key.split("×")[0] !== result[i + 1].key.split("×")[0]));
          if (k > i) [result[i], result[k]] = [result[k], result[i]];
        }
      }
    }
    return result;
  }
  function problem() {
    if (!problemQueue.length) problemQueue = buildSet();
    const q = problemQueue.shift();
    lastAnswer = q.value;
    recentExpressions.push(q.key);
    if (recentExpressions.length > 35) recentExpressions.shift();
    return q;
  }
  function reset() {
    problemQueue = [];
    recentExpressions = [];
    lastAnswer = null;
  }
  return { problem, reset };
}
export {
  createQuestionGenerator
};
