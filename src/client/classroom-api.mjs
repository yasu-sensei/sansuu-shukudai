export const hasClassroomApi = () => typeof google !== 'undefined' && !!google.script?.run;
export const newRequestId = () => globalThis.crypto.randomUUID();
export function callClassroom(action, data = {}, requestId = newRequestId()) {
  return new Promise((resolve, reject) => {
    if (!hasClassroomApi()) { reject(new Error('学校用URLから開いてください。')); return; }
    google.script.run.withSuccessHandler(response => {
      if (response?.ok) resolve(response.data);
      else {
        const error = new Error(response?.error?.message || '保存結果を確認できません。');
        error.code = response?.error?.code;
        reject(error);
      }
    }).withFailureHandler(() => reject(new Error('通信できません。同じ操作を再試行してください。')))
      .classroomApi({ action, data, requestId });
  });
}

// A failed response retains the SAME immutable request until its result is recovered.
export function createSessionRecorder(sessionId, call = callClassroom, requestId = newRequestId) {
  const answers = [];
  let accepted = 0, pending = null, finalized = null, chain = Promise.resolve();
  return {
    add(answer) { answers.push({ ...answer, seq: answers.length }); },
    flush(options) {
      const snapshot = answers.slice();
      const run = async () => {
        if (finalized) return finalized;
        if (pending) {
          const result = await call('recordSession', pending.data, pending.id);
          accepted = result.accepted; pending = null;
          if (result.completion || result.status === 'interrupted') { finalized = result; return result; }
        }
        const data = { sessionId, answers: snapshot.slice(accepted), finish: false, cancel: false, ...options };
        pending = { id: requestId(), data };
        const result = await call('recordSession', data, pending.id);
        accepted = result.accepted; pending = null;
        if (result.completion || result.status === 'interrupted') finalized = result;
        return result;
      };
      chain = chain.catch(() => {}).then(run);
      return chain;
    },
  };
}
