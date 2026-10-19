import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STORAGE_KEY, MAX_BACKUP_BYTES, createEmptyState, loadState, saveState,
  validateBackup, importBackup, exportBackup, filterQuestions, startSession,
  recordAnswer, finishSession, getStats,
} from '../js/engine.js';

const options = ['A', 'B', 'C', 'D'].map(key => ({ key, text: `選項 ${key}` }));
const questions = [
  { id: 's1-r1-q1', subject: 1, round: 1, number: 1, stem: '機器學習是什麼？', options, answer: 'B', sourceId: 'one', sourcePages: [1], explanation: null },
  { id: 's1-r2-q1', subject: 1, round: 2, number: 1, stem: '監督式學習', options, answer: 'A', sourceId: 'two', sourcePages: [1], explanation: null },
  { id: 's2-r1-q1', subject: 2, round: 1, number: 1, stem: 'Prompt 提示詞', options, answer: 'C', sourceId: 'three', sourcePages: [1], explanation: null },
];
const ids = questions.map(question => question.id);
const [first, second, third] = questions;
function memoryStorage(initial = null) {
  let raw = initial;
  return {
    getItem(key) { assert.equal(key, STORAGE_KEY); return raw; },
    setItem(key, value) { assert.equal(key, STORAGE_KEY); raw = value; },
  };
}

test('missing, corrupted, wrong-version and inaccessible storage recover safely', () => {
  for (const raw of [null, '{broken', 'null', '[]', '{}', JSON.stringify({ ...createEmptyState(), version: 900 })]) {
    assert.deepEqual(loadState(memoryStorage(raw), ids), createEmptyState());
  }
  assert.deepEqual(loadState({ getItem() { throw new Error('disabled'); } }), createEmptyState());
  assert.equal(saveState({ setItem() { throw new Error('quota'); } }, createEmptyState()), false);
});

test('backup parsing rejects unsupported roots and enforces size limits', () => {
  assert.throws(() => importBackup('not JSON'), /JSON/);
  assert.throws(() => importBackup(JSON.stringify({ records: {} })), /格式/);
  assert.throws(() => importBackup(' '.repeat(MAX_BACKUP_BYTES + 1)), /16 MB/);
  assert.throws(() => importBackup('漢'.repeat(Math.floor(MAX_BACKUP_BYTES / 3) + 1)), /16 MB/);
});

test('imports sanitize nested values, exclude unknown IDs and prevent prototype poisoning', () => {
  const hostile = JSON.parse(JSON.stringify(createEmptyState()));
  hostile.records = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"attempts":20},"s1-r1-q1":{"attempts":2.9,"correct":900,"lastAnswer":"B","lastCorrect":true,"lastAt":-90},"s1-r2-q1":{"attempts":3,"lastAnswer":"E","lastCorrect":false},"removed":{"attempts":1,"correct":0,"lastAnswer":"C","lastCorrect":false}}');
  hostile.favorites = [first.id, first.id, '__proto__', 'removed', null];
  hostile.notes = { [first.id]: 'x'.repeat(9000), [second.id]: '   ', removed: 'old', [third.id]: { text: 'bad' } };
  hostile.history = [null, { id: 'bad', mode: 'exam', questionIds: ['removed'] }];
  const result = validateBackup(hostile, ids);
  assert.deepEqual(result.records, { [first.id]: { attempts: 2, correct: 2, lastAnswer: 'B', lastCorrect: true, lastAt: 0 } });
  assert.deepEqual(result.favorites, [first.id]);
  assert.equal(result.notes[first.id].length, 8000);
  assert.equal(Object.keys(result.notes).length, 1);
  assert.deepEqual(result.history, []);
  assert.equal({}.polluted, undefined);
});

test('recording answers accumulates real attempts; a later correct answer removes wrong status', () => {
  const state = createEmptyState();
  recordAnswer(state, first, 'A', 100);
  assert.deepEqual(filterQuestions(questions, { pool: 'wrong' }, state).map(q => q.id), [first.id]);
  recordAnswer(state, first, 'B', 200);
  assert.deepEqual(state.records[first.id], { attempts: 2, correct: 1, lastAnswer: 'B', lastCorrect: true, lastAt: 200 });
  assert.deepEqual(filterQuestions(questions, { pool: 'wrong' }, state), []);
  assert.throws(() => recordAnswer(state, first, 'E'), /格式/);
  assert.equal(getStats(questions, state).accuracy, 50);
  assert.equal(getStats(questions, state).seen, 1);
});

test('all learning pools respect both subject and round, including duplicated question numbers', () => {
  const state = createEmptyState();
  recordAnswer(state, first, 'A');
  recordAnswer(state, third, 'A');
  state.favorites = [first.id, third.id];
  state.notes[second.id] = 'validation holdout';
  const select = filter => filterQuestions(questions, filter, state).map(q => q.id);
  assert.deepEqual(select({ subject: '1', round: '1', pool: 'wrong' }), [first.id]);
  assert.deepEqual(select({ subject: '2', pool: 'favorites' }), [third.id]);
  assert.deepEqual(select({ subject: '1', pool: 'unseen' }), [second.id]);
  assert.deepEqual(select({ search: 'PROMPT' }), [third.id]);
  assert.deepEqual(select({ search: 'holdout' }), [second.id]);
  assert.deepEqual(select({ search: '選項 D', round: '2' }), [second.id]);
});

test('creating sessions preserves source arrays and establishes a bounded exam deadline', () => {
  const originalOrder = questions.map(q => q.id);
  const session = startSession(questions, { mode: 'exam', count: 2, shuffle: true, durationMinutes: 60 }, 10_000);
  assert.deepEqual(questions.map(q => q.id), originalOrder);
  assert.equal(new Set(session.questionIds).size, 2);
  assert.equal(session.deadline, 3_610_000);
  assert.equal(session.currentIndex, 0);
  assert.equal(startSession(questions, { mode: 'practice', count: 'all' }, 10).deadline, null);
  assert.equal(startSession(questions, { count: 999 }).questionIds.length, 3);
  assert.throws(() => startSession([]), /沒有/);
});

test('a partial practice session resumes with navigation, answers, checked flags and notes intact', () => {
  const storage = memoryStorage();
  const state = createEmptyState();
  state.activeSession = startSession(questions, { mode: 'practice' }, 1000);
  state.activeSession.currentIndex = 1;
  state.activeSession.answers[first.id] = 'B';
  state.activeSession.checked[first.id] = true;
  state.activeSession.answers[second.id] = 'D';
  state.notes[first.id] = '把概念與例子配對。';
  recordAnswer(state, first, 'B', 1100);
  assert.equal(saveState(storage, state), true);
  assert.deepEqual(loadState(storage, ids), state);
  assert.deepEqual(importBackup(exportBackup(state), ids), state);
});

test('exam completion scores unanswered items as incorrect without inflating attempt records', () => {
  const state = createEmptyState();
  const session = startSession(questions, { mode: 'exam' }, 1000);
  state.activeSession = session;
  session.answers[first.id] = 'B';
  session.answers[second.id] = 'D';
  const result = finishSession(state, session, questions, 5000);
  assert.deepEqual({ total: result.total, answered: result.answered, correct: result.correct, wrong: result.wrong, unanswered: result.unanswered, score: result.score }, { total: 3, answered: 2, correct: 1, wrong: 2, unanswered: 1, score: 33 });
  assert.equal(state.activeSession, null);
  assert.equal(session.finishedAt, 5000);
  assert.equal(state.records[third.id], undefined);
  assert.deepEqual(getStats(questions, state), { total: 3, seen: 2, unseen: 1, attempts: 2, correct: 1, accuracy: 50, wrong: 1, favorites: 0, notes: 0, mastered: 1, sessions: 1 });
  const before = JSON.stringify(state);
  assert.deepEqual(finishSession(state, session, questions, 9999), result);
  assert.equal(JSON.stringify(state), before);
  const reloaded = importBackup(exportBackup(state), ids);
  assert.deepEqual(finishSession(reloaded, { ...session, finishedAt: null }, questions, 10_000), result);
  assert.equal(getStats(questions, reloaded).attempts, 2);
});

test('finishing practice never double counts checked answers or counts unchecked selections', () => {
  const state = createEmptyState();
  const session = startSession(questions, { mode: 'practice' }, 1000);
  session.answers[first.id] = 'B';
  session.checked[first.id] = true;
  session.answers[second.id] = 'A';
  recordAnswer(state, first, 'B', 2000);
  const result = finishSession(state, session, questions, 3000);
  assert.equal(result.answered, 1);
  assert.equal(result.correct, 1);
  assert.equal(getStats(questions, state).attempts, 1);
  assert.equal(state.records[second.id], undefined);
});

test('finished or already settled sessions cannot be restored as active', () => {
  const state = createEmptyState();
  const session = startSession(questions, { mode: 'exam' }, 1000);
  session.answers[first.id] = 'B';
  finishSession(state, session, questions, 2000);
  state.activeSession = { ...session, finishedAt: null };
  assert.equal(validateBackup(state, ids).activeSession, null);
  state.history = [];
  state.activeSession.finishedAt = 2000;
  assert.equal(validateBackup(state, ids).activeSession, null);
});

test('history retains the latest 100 sessions and scoped stats ignore other subjects', () => {
  const state = createEmptyState();
  for (let index = 0; index < 105; index++) {
    const session = startSession([first], { mode: 'exam' }, index * 1000);
    session.answers[first.id] = 'B';
    finishSession(state, session, questions, index * 1000 + 100);
  }
  recordAnswer(state, third, 'A', 999999);
  state.favorites = [first.id, third.id];
  assert.equal(state.history.length, 100);
  assert.equal(state.history[0].startedAt, 104000);
  assert.equal(getStats([third], state).attempts, 1);
  assert.equal(getStats([third], state).favorites, 1);
  assert.equal(getStats([third], state).sessions, 0);
});

test('a missing question prevents partial exam settlement and preserves records', () => {
  const state = createEmptyState();
  const session = startSession(questions, { mode: 'exam' }, 1000);
  session.answers[first.id] = 'B';
  const before = JSON.stringify(state);
  assert.throws(() => finishSession(state, session, [first], 2000), /不存在/);
  assert.equal(JSON.stringify(state), before);
  assert.equal(session.finishedAt, null);
});

test('imported timestamps remain formatable by Date and Intl, and exam options stay editable', () => {
  const state = createEmptyState();
  const completed = startSession(questions, { mode: 'exam' }, 1000);
  finishSession(state, completed, questions, 2000);
  state.history[0].startedAt = Number.MAX_VALUE;
  state.history[0].finishedAt = Number.MAX_SAFE_INTEGER;
  state.activeSession = startSession(questions, { mode: 'exam' }, Number.MAX_VALUE);
  state.activeSession.answers[first.id] = 'A';
  state.activeSession.checked[first.id] = true;
  const imported = importBackup(JSON.stringify(state), ids);
  const formatter = new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric' });
  assert.doesNotThrow(() => formatter.format(imported.history[0].finishedAt));
  assert.doesNotThrow(() => formatter.format(imported.activeSession.deadline));
  assert.deepEqual(imported.activeSession.checked, {});
  assert.equal(imported.activeSession.answers[first.id], 'A');
});

test('all 300 full-length CJK notes can be saved and exported for a lossless backup round trip', () => {
  const state = createEmptyState();
  const validIds = Array.from({ length: 300 }, (_, index) => `q${index}`);
  for (const id of validIds) state.notes[id] = '學'.repeat(8000);
  const storage = memoryStorage();
  assert.equal(saveState(storage, state), true);
  assert.deepEqual(loadState(storage, validIds), state);
  const backup = exportBackup(state);
  assert.ok(Buffer.byteLength(backup) > 5 * 1024 * 1024);
  assert.ok(Buffer.byteLength(backup) <= MAX_BACKUP_BYTES);
  assert.equal(backup.includes('\n'), false);
  assert.deepEqual(importBackup(backup, validIds), state);
});
