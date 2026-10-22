/** Every API operation authenticates the real caller. Missing email never falls back to the owner. */
function classroomConfig_() {
  var p = PropertiesService.getScriptProperties();
  return {
    schoolDomain: (p.getProperty('SCHOOL_DOMAIN') || '').trim().toLowerCase(),
    schoolYear: (p.getProperty('SCHOOL_YEAR') || '').trim(),
    teachers: (p.getProperty('TEACHER_EMAILS') || '').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean),
    spreadsheetId: (p.getProperty('CLASSROOM_SPREADSHEET_ID') || '').trim(),
    pinConfigured: !!p.getProperty('TEACHER_PIN_HASH') && !!p.getProperty('TEACHER_PIN_SALT')
  };
}
function classroomActor_() {
  return (Session.getActiveUser().getEmail() || '').trim().toLowerCase();
}
function classroomStore_(config) {
  if (!config.spreadsheetId) throw new Error('保存先が未設定です。先生に連絡してください。');
  var sheet = SpreadsheetApp.openById(config.spreadsheetId).getSheetByName('ClassroomEvents');
  if (!sheet) throw new Error('保存先を初期化してください。');
  var headers = ['event_id', 'server_time', 'event_type', 'actor', 'request_id', 'event_json'];
  if (JSON.stringify(sheet.getRange(1, 1, 1, 6).getValues()[0]) !== JSON.stringify(headers)) throw new Error('保存先の見出しが一致しません。');
  return {
    read: function () {
      var count = sheet.getLastRow() - 1;
      if (!count) return [];
      return sheet.getRange(2, 1, count, 6).getValues().map(function (row) {
        var event = JSON.parse(row[5]);
        if (event.id !== row[0] || event.type !== row[2] || event.actor !== row[3] || event.requestId !== row[4]) throw new Error('保存記録の整合性を確認してください。');
        return event;
      });
    },
    append: function (event) {
      var json = JSON.stringify(event);
      if (json.length > 45000) throw new Error('一度に保存する内容が多すぎます。操作を小分けにしてください。');
      // One row is the authoritative commit; no multiple-sheet balance updates.
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, 6).setValues([[event.id, event.at, event.type, event.actor, event.requestId, json]]);
      SpreadsheetApp.flush();
    }
  };
}
function teacherPinDigest_(salt, pin) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8)
    .map(function (n) { return ('0' + ((n + 256) % 256).toString(16)).slice(-2); }).join('');
}
function verifyTeacherPin_(actor, pin) {
  var props = PropertiesService.getScriptProperties(), at = Date.now();
  var failureKey = 'PIN_FAILURES_' + teacherPinDigest_('actor', actor);
  var failures = JSON.parse(props.getProperty(failureKey) || '{"count":0,"until":0}');
  if (failures.count >= 5 && failures.until > at) throw new ClassroomCore.ClassroomError('PIN_LOCKED', '暗証番号の確認が続けて失敗しました。15分後に再試行してください。');
  var expected = props.getProperty('TEACHER_PIN_HASH'), salt = props.getProperty('TEACHER_PIN_SALT');
  var actual = typeof pin === 'string' && /^\d{6,12}$/.test(pin) && salt ? teacherPinDigest_(salt, pin) : '';
  var equal = !!expected && actual.length === expected.length, difference = 0;
  if (equal) for (var i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  if (!equal || difference) {
    var count = failures.until > at ? failures.count + 1 : 1;
    props.setProperty(failureKey, JSON.stringify({count:count, until:at + 900000}));
    return false;
  }
  props.deleteProperty(failureKey);
  return true;
}
function configureTeacherPin_(actor, data) {
  var config = classroomConfig_();
  if (config.teachers.indexOf(actor) < 0) throw new ClassroomCore.ClassroomError('FORBIDDEN', '先生だけが設定できます。');
  if (config.pinConfigured && !verifyTeacherPin_(actor, data.currentPin)) throw new ClassroomCore.ClassroomError('PIN', '現在の暗証番号を確認してください。');
  if (!data || typeof data.newPin !== 'string' || !/^\d{6,12}$/.test(data.newPin) || data.newPin !== data.confirmPin) throw new ClassroomCore.ClassroomError('INPUT', '新しい暗証番号は6〜12桁の数字で、確認欄と同じ内容にしてください。');
  var salt = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperties({TEACHER_PIN_SALT:salt, TEACHER_PIN_HASH:teacherPinDigest_(salt,data.newPin), TEACHER_PIN_UPDATED_BY:actor});
  return {saved:true};
}
function classroomApi(request) {
  var lock = LockService.getScriptLock();
  try {
    var config = classroomConfig_(), actor = classroomActor_();
    // Reject unidentifiable/outside callers before accessing the private spreadsheet.
    if (!actor || actor.split('@')[1] !== config.schoolDomain || !config.teachers.length || !/^\d{4}$/.test(config.schoolYear)) {
      return { ok: false, error: { code: 'AUTH', message: '学校のGoogleアカウントまたは学校設定を確認できません。先生に連絡してください。' } };
    }
    if (!lock.tryLock(10000)) return { ok: false, error: { code: 'BUSY', message: '保存が混み合っています。少し待って再試行してください。' } };
    if (request && request.action === 'configureTeacherPin') return {ok:true,data:configureTeacherPin_(actor,request.data)};
    var service = ClassroomCore.createClassroomService({
      store: classroomStore_(config), config: config, verifyTeacherPin: verifyTeacherPin_,
      now: function () { return Date.now(); },
      id: function () { return Utilities.getUuid(); },
      today: function () { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'); }
    });
    var result = service.handle(actor, request);
    if (request.action === 'bootstrap' && result.role === 'teacher') result.teacherUrl = ScriptApp.getService().getUrl() + '?view=teacher';
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: { code: error.code || 'SERVER', message: error.code ? error.message : '学校用の保存処理を確認してください。先生に連絡してください。' } };
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}
/** Run once in the editor after configuring Script Properties. Never overwrites existing records. */
function initializeClassroom() {
  var config = classroomConfig_(), actor = classroomActor_();
  if (!actor || actor.split('@')[1] !== config.schoolDomain || config.teachers.indexOf(actor) < 0 || !/^\d{4}$/.test(config.schoolYear)) throw new Error('設定済みの先生アカウントで実行してください。');
  if (!config.spreadsheetId) throw new Error('CLASSROOM_SPREADSHEET_IDを設定してください。');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var book = SpreadsheetApp.openById(config.spreadsheetId);
    var sheet = book.getSheetByName('ClassroomEvents');
    if (sheet && sheet.getLastRow() > 0) { classroomStore_(config); return '既存の記録を保持しました。'; }
    if (!sheet) sheet = book.insertSheet('ClassroomEvents');
    sheet.getRange(1, 1, 1, 6).setValues([['event_id', 'server_time', 'event_type', 'actor', 'request_id', 'event_json']]);
    sheet.setFrozenRows(1);
    return '学校用の保存先を初期化しました。';
  } finally { lock.releaseLock(); }
}
function doGet(e) {
  var teacher = e && e.parameter && e.parameter.view === 'teacher';
  if (teacher) {
    var config = classroomConfig_(), actor = classroomActor_();
    if (!actor || actor.split('@')[1] !== config.schoolDomain || config.teachers.indexOf(actor) < 0) return HtmlService.createHtmlOutput('先生の学校アカウントで開いてください。');
  }
  return HtmlService.createHtmlOutputFromFile(teacher ? 'Teacher' : 'Index')
    .setTitle(teacher ? 'さんすうしゅくだい｜先生の管理画面' : 'さんすうしゅくだい｜カレンダー・テンキー試作版')
    .addMetaTag('viewport', 'width=device-width,initial-scale=1');
}
