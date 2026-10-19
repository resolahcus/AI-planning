/** Pure study-session logic and bounded, versioned local persistence. */

/** @typedef {'A'|'B'|'C'|'D'} AnswerKey */
/** @typedef {{id:string, subject:1|2, round:1|2|3, number:number, stem:string, options:{key:AnswerKey,text:string}[], answer:AnswerKey, sourceId:string, sourcePages:number[], explanation:null|string}} Question */
/** @typedef {{attempts:number,correct:number,lastAnswer:AnswerKey,lastCorrect:boolean,lastAt:number}} RecordEntry */
/** @typedef {{id:string,mode:'practice'|'exam',questionIds:string[],currentIndex:number,answers:Record<string,AnswerKey>,checked:Record<string,boolean>,startedAt:number,deadline:number|null,finishedAt:number|null}} Session */
/** @typedef {{id:string,mode:'practice'|'exam',startedAt:number,finishedAt:number,total:number,answered:number,correct:number,wrong:number,unanswered:number,score:number,questionIds:string[],answers:Record<string,AnswerKey>}} SessionResult */
/** @typedef {{version:1,records:Record<string,RecordEntry>,favorites:string[],notes:Record<string,string>,activeSession:Session|null,history:SessionResult[]}} State */
/** @typedef {{getItem:(key:string)=>string|null,setItem:(key:string,value:string)=>void}} StorageAdapter */

export const STORAGE_KEY = 'ai-study-pwa-state-v1';
// Covers all 300 supported questions at the 8,000-character note limit, including CJK.
export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
const MAX_QUESTIONS = 10_000;
const MAX_SESSION_QUESTIONS = 1_000;
const MAX_NOTE_LENGTH = 8_000;
const MAX_ATTEMPTS = 1_000_000;
const MAX_HISTORY = 100;
// Date/Intl reject larger values even when they are valid JavaScript integers.
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const ANSWERS = new Set(['A', 'B', 'C', 'D']);
const RESERVED_KEYS = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);

/** @returns {State} */
export function createEmptyState() {
  return { version: 1, records: {}, favorites: [], notes: {}, activeSession: null, history: [] };
}

/** @param {unknown} value @returns {value is Record<string,any>} */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is AnswerKey} */
function isAnswer(value) {
  return typeof value === 'string' && ANSWERS.has(value);
}

/** @param {unknown} value @returns {value is string} */
function isId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && !RESERVED_KEYS.has(value) && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** @param {unknown} value @param {number} fallback @param {number} max @returns {number} */
function integer(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : fallback;
}

/** @param {unknown} value @param {number} [fallback] @returns {number} */
function timestamp(value, fallback = 0) {
  return integer(value, fallback, MAX_TIMESTAMP);
}

/** @param {Iterable<string>|undefined} ids @returns {Set<string>|undefined} */
function allowedIds(ids) {
  return ids === undefined ? undefined : new Set(ids);
}

/** @param {unknown} id @param {Set<string>|undefined} allowed @returns {id is string} */
function acceptedId(id, allowed) {
  return isId(id) && (allowed === undefined || allowed.has(id));
}

/** @param {unknown} input @param {Set<string>|undefined} allowed @param {number} limit @returns {string[]} */
function cleanIds(input, allowed, limit = MAX_QUESTIONS) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.slice(0, MAX_QUESTIONS).filter(id => acceptedId(id, allowed)))].slice(0, limit);
}

/** @param {unknown} value @param {string[]} ids @returns {Record<string,AnswerKey>} */
function cleanAnswers(value, ids) {
  const result = {};
  if (!isObject(value)) return result;
  for (const id of ids) if (Object.hasOwn(value, id) && isAnswer(value[id])) result[id] = value[id];
  return result;
}

/** @param {unknown} value @param {Set<string>|undefined} allowed @returns {Session|null} */
function cleanSession(value, allowed) {
  if (!isObject(value) || !isId(value.id) || !['practice', 'exam'].includes(value.mode)) return null;
  const ids = cleanIds(value.questionIds, allowed, MAX_SESSION_QUESTIONS);
  if (!ids.length) return null;
  const answers = cleanAnswers(value.answers, ids);
  const checked = {};
  for (const id of ids) if (value.mode === 'practice' && Object.hasOwn(answers, id) && isObject(value.checked) && value.checked[id] === true) checked[id] = true;
  const startedAt = timestamp(value.startedAt);
  const deadline = value.mode === 'exam' ? timestamp(value.deadline, timestamp(startedAt + 60 * 60_000)) : null;
  return {
    id: value.id,
    mode: value.mode,
    questionIds: ids,
    currentIndex: Math.min(integer(value.currentIndex), ids.length - 1),
    answers,
    checked,
    startedAt,
    deadline,
    finishedAt: typeof value.finishedAt === 'number' ? Math.max(startedAt, timestamp(value.finishedAt)) : null,
  };
}

/** @param {unknown} value @param {Set<string>|undefined} allowed @returns {SessionResult|null} */
function cleanResult(value, allowed) {
  if (!isObject(value) || !isId(value.id) || !['practice', 'exam'].includes(value.mode)) return null;
  const questionIds = cleanIds(value.questionIds, allowed, MAX_SESSION_QUESTIONS);
  // A historical score cannot be reconstructed safely after its question set changes.
  if (!Array.isArray(value.questionIds) || questionIds.length !== value.questionIds.length || !questionIds.length) return null;
  const total = questionIds.length;
  const answers = cleanAnswers(value.answers, questionIds);
  const answered = Object.keys(answers).length;
  const correct = integer(value.correct, 0, answered);
  const startedAt = timestamp(value.startedAt);
  return {
    id: value.id, mode: value.mode, startedAt,
    finishedAt: Math.max(startedAt, timestamp(value.finishedAt)),
    total, answered, correct, wrong: total - correct,
    unanswered: total - answered, score: Math.round(correct / total * 100), questionIds, answers,
  };
}

/**
 * Validate the version and sanitize every nested value. Imported strings remain plain text.
 * Unknown IDs are discarded when a current question-ID list is supplied.
 * @param {unknown} raw
 * @param {Iterable<string>} [validQuestionIds]
 * @returns {State}
 * @throws {Error} If the root is not a supported study backup.
 */
export function validateBackup(raw, validQuestionIds) {
  const root = isObject(raw) && raw.app === 'ai-study-pwa' ? raw.state : raw;
  if (!isObject(root) || root.version !== 1 || !isObject(root.records) || !Array.isArray(root.favorites) || !isObject(root.notes) || !Array.isArray(root.history)) {
    throw new Error('備份格式不正確，請選擇本網站匯出的 JSON 備份。');
  }
  const allowed = allowedIds(validQuestionIds);
  const state = createEmptyState();
  for (const [id, entry] of Object.entries(root.records).slice(0, MAX_QUESTIONS)) {
    if (!acceptedId(id, allowed) || !isObject(entry) || !isAnswer(entry.lastAnswer) || typeof entry.lastCorrect !== 'boolean') continue;
    const attempts = integer(entry.attempts, 0, MAX_ATTEMPTS);
    if (!attempts) continue;
    state.records[id] = {
      attempts,
      correct: integer(entry.correct, 0, attempts),
      lastAnswer: entry.lastAnswer,
      lastCorrect: entry.lastCorrect,
      lastAt: timestamp(entry.lastAt),
    };
  }
  state.favorites = cleanIds(root.favorites, allowed);
  for (const [id, note] of Object.entries(root.notes).slice(0, MAX_QUESTIONS)) {
    if (acceptedId(id, allowed) && typeof note === 'string' && note.trim()) state.notes[id] = note.slice(0, MAX_NOTE_LENGTH);
  }
  state.activeSession = cleanSession(root.activeSession, allowed);
  if (state.activeSession && state.activeSession.finishedAt !== null) state.activeSession = null;
  const seen = new Set();
  for (const entry of root.history.slice(0, MAX_HISTORY)) {
    const result = cleanResult(entry, allowed);
    if (result && !seen.has(result.id)) {
      state.history.push(result);
      seen.add(result.id);
    }
  }
  // A completed exam must never become an active, scoreable session again.
  if (state.activeSession && seen.has(state.activeSession.id)) state.activeSession = null;
  return state;
}

/** @param {string} json @param {Iterable<string>} [validQuestionIds] @returns {State} */
export function importBackup(json, validQuestionIds) {
  if (typeof json !== 'string' || json.length > MAX_BACKUP_BYTES || new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) {
    throw new Error(`備份檔案過大或格式不正確，檔案上限為 ${MAX_BACKUP_BYTES / (1024 * 1024)} MB。`);
  }
  let raw;
  try { raw = JSON.parse(json); } catch { throw new Error('無法讀取備份，請確認檔案為有效的 JSON。'); }
  return validateBackup(raw, validQuestionIds);
}

/** @param {State} state @returns {string} */
export function exportBackup(state) {
  return JSON.stringify({ app: 'ai-study-pwa', exportedAt: new Date().toISOString(), state: validateBackup(state) });
}

/**
 * Recover from disabled storage, malformed JSON, and incompatible saved versions.
 * @param {StorageAdapter} [storage]
 * @param {Iterable<string>} [validQuestionIds]
 * @returns {State}
 */
export function loadState(storage, validQuestionIds) {
  try {
    const source = storage ?? globalThis.localStorage;
    const raw = source?.getItem(STORAGE_KEY);
    return raw ? importBackup(raw, validQuestionIds) : createEmptyState();
  } catch { return createEmptyState(); }
}

/** @param {StorageAdapter|undefined} storage @param {State} state @returns {boolean} */
export function saveState(storage, state) {
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target) return false;
    const json = JSON.stringify(validateBackup(state));
    if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) return false;
    target.setItem(STORAGE_KEY, json);
    return true;
  } catch { return false; }
}

/**
 * Subject and round filters apply to every pool, including wrong and favorite questions.
 * @param {Question[]} questions
 * @param {{subject?:'all'|'1'|'2',round?:'all'|'1'|'2'|'3',pool?:'all'|'wrong'|'favorites'|'unseen',search?:string}} filters
 * @param {State} state
 * @returns {Question[]}
 */
export function filterQuestions(questions, filters = {}, state = createEmptyState()) {
  const { subject = 'all', round = 'all', pool = 'all', search = '' } = filters;
  const favorites = new Set(state.favorites);
  const needle = String(search).trim().toLocaleLowerCase();
  return questions.filter(question => {
    if (subject !== 'all' && String(question.subject) !== String(subject)) return false;
    if (round !== 'all' && String(question.round) !== String(round)) return false;
    if (pool === 'wrong' && state.records[question.id]?.lastCorrect !== false) return false;
    if (pool === 'favorites' && !favorites.has(question.id)) return false;
    if (pool === 'unseen' && state.records[question.id]) return false;
    if (!needle) return true;
    return [question.stem, ...question.options.map(option => option.text), state.notes[question.id] ?? ''].join('\n').toLocaleLowerCase().includes(needle);
  });
}

/**
 * Create a resumable session without mutating the question array.
 * @param {Question[]} questions
 * @param {{mode?:'practice'|'exam',count?:number|'all',shuffle?:boolean,durationMinutes?:number}} [options]
 * @param {number} [now]
 * @returns {Session}
 */
export function startSession(questions, options = {}, now = Date.now()) {
  const { mode = 'practice', count = 'all', shuffle = false, durationMinutes = 60 } = options;
  if (!['practice', 'exam'].includes(mode)) throw new Error('不支援的練習模式。');
  const ids = cleanIds(questions.map(question => question.id), undefined, MAX_SESSION_QUESTIONS);
  if (!ids.length) throw new Error('目前沒有符合條件的題目。');
  if (shuffle) {
    for (let index = ids.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [ids[index], ids[other]] = [ids[other], ids[index]];
    }
  }
  const desiredCount = count === 'all' ? ids.length : Math.max(1, integer(count, ids.length, ids.length));
  const startedAt = timestamp(now);
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `session-${startedAt}-${Math.random().toString(36).slice(2)}`,
    mode,
    questionIds: ids.slice(0, desiredCount),
    currentIndex: 0,
    answers: {},
    checked: {},
    startedAt,
    deadline: mode === 'exam' ? timestamp(startedAt + Math.max(1, integer(durationMinutes, 60, 240)) * 60_000) : null,
    finishedAt: null,
  };
}

/**
 * Count one deliberately submitted answer. The caller records a practice question only
 * on its first check in a session; changing a selection alone must not call this function.
 * @param {State} state @param {Question} question @param {AnswerKey} answer @param {number} [now]
 * @returns {State}
 */
export function recordAnswer(state, question, answer, now = Date.now()) {
  if (!isId(question.id) || !isAnswer(question.answer) || !isAnswer(answer) || !question.options.some(option => option.key === answer)) {
    throw new Error('題目或答案格式不正確。');
  }
  const prior = state.records[question.id];
  const isCorrect = answer === question.answer;
  state.records[question.id] = {
    attempts: Math.min(MAX_ATTEMPTS, (prior?.attempts ?? 0) + 1),
    correct: Math.min(MAX_ATTEMPTS, (prior?.correct ?? 0) + (isCorrect ? 1 : 0)),
    lastAnswer: answer,
    lastCorrect: isCorrect,
    lastAt: timestamp(now),
  };
  return state;
}

/**
 * Finish and score once per session ID. Unanswered questions lower this session's score
 * and appear in `wrong`; they do not create attempt records or alter cumulative accuracy.
 * Practice answers were recorded when checked, so completion never records them again.
 * @param {State} state @param {Session} session @param {Question[]} questions @param {number} [now]
 * @returns {SessionResult}
 */
export function finishSession(state, session, questions, now = Date.now()) {
  const previous = state.history.find(entry => entry.id === session.id);
  if (previous) return previous;
  const questionMap = new Map(questions.map(question => [question.id, question]));
  const questionIds = [...new Set(session.questionIds)];
  if (!questionIds.length || questionIds.some(id => !questionMap.has(id))) throw new Error('部分題目已不存在，無法正確計算本次成績。');
  const answers = {};
  let correct = 0;
  for (const id of questionIds) {
    const question = questionMap.get(id);
    const answer = session.answers[id];
    // A selected practice option is an answer only after the user checks it.
    if (!isAnswer(answer) || (session.mode === 'practice' && session.checked[id] !== true)) continue;
    answers[id] = answer;
    if (answer === question.answer) correct++;
    if (session.mode === 'exam' && session.finishedAt === null) recordAnswer(state, question, answer, now);
  }
  const finishedAt = session.finishedAt ?? Math.max(session.startedAt, timestamp(now));
  session.finishedAt = finishedAt;
  const total = questionIds.length;
  const answered = Object.keys(answers).length;
  const result = {
    id: session.id, mode: session.mode, startedAt: session.startedAt, finishedAt,
    total, answered, correct, wrong: total - correct, unanswered: total - answered,
    score: Math.round(correct / total * 100), questionIds, answers,
  };
  state.history = [result, ...state.history].slice(0, MAX_HISTORY);
  if (state.activeSession?.id === session.id) state.activeSession = null;
  return result;
}

/**
 * Cumulative attempts and accuracy count submitted answers, not unanswered exam items.
 * Every metric is scoped to the supplied questions.
 * @param {Question[]} questions @param {State} state
 * @returns {{total:number,seen:number,unseen:number,attempts:number,correct:number,accuracy:number,wrong:number,favorites:number,notes:number,mastered:number,sessions:number}}
 */
export function getStats(questions, state) {
  const ids = new Set(questions.map(question => question.id));
  let seen = 0, attempts = 0, correct = 0, wrong = 0, mastered = 0, notes = 0;
  for (const id of ids) {
    const entry = state.records[id];
    if (entry) {
      seen++;
      attempts += entry.attempts;
      correct += entry.correct;
      if (entry.lastCorrect) mastered++; else wrong++;
    }
    if (state.notes[id]?.trim()) notes++;
  }
  return {
    total: ids.size, seen, unseen: ids.size - seen, attempts, correct,
    accuracy: attempts ? Math.round(correct / attempts * 100) : 0,
    wrong, favorites: [...new Set(state.favorites)].filter(id => ids.has(id)).length,
    notes, mastered,
    sessions: state.history.filter(result => result.questionIds.some(id => ids.has(id))).length,
  };
}
