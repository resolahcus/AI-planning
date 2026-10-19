import { STORAGE_KEY, MAX_BACKUP_BYTES, createEmptyState, loadState, saveState, filterQuestions, startSession, recordAnswer, finishSession, getStats, importBackup, exportBackup } from './engine.js';
import { initPwa, requestInstall, getInstallState, applyUpdate } from './pwa.js';

/** @typedef {import('./engine.js').Question} Question */
/** @typedef {import('./engine.js').SessionResult} SessionResult */
/** @typedef {{id:string,year:number,round:number,subject:number,title:string,file:string,pages:number,questionCount:number}} Source */
const SUBJECTS = { 1: '人工智慧基礎概論', 2: '生成式 AI 應用與規劃' };
const ROUNDS = { 1: '第一次', 2: '第二次', 3: '第三次' };
const ROUTES = [
  ['home', '學習總覽', 'home'], ['practice', '題庫練習', 'book'], ['wrong', '錯題複習', 'repeat'],
  ['favorites', '我的收藏', 'bookmark'], ['stats', '學習紀錄', 'chart'], ['settings', '設定與備份', 'settings'],
];
const PATHS = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  book: '<path d="M12 5v15M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2Z"/>',
  repeat: '<path d="M20 7h-5V2M4 17h5v5M20 7a8 8 0 0 0-14-2M4 17a8 8 0 0 0 14 2M20 11v2M4 11v2"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>', chart: '<path d="M4 3v18h17M8 16v-5m5 5V6m5 10V9"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>', back: '<path d="M20 12H5m6-6-6 6 6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>', cross: '<path d="m6 6 12 12M6 18 18 6"/>',
  moon: '<path d="M20 15A8 8 0 0 1 9 4a8.5 8.5 0 1 0 11 11Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  brain: '<path d="M12 5c-2-4-7-2-7 2-4 1-3 7 0 7-2 5 4 8 7 4 3 4 9 1 7-4 3 0 4-6 0-7 0-4-5-6-7-2Zm0 0v13M5 7l3 2m11-2-3 2M5 14l3-2m11 2-3-2"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  document: '<path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8m-8 4h6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
};
/** All untrusted content is text-escaped before insertion. */
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] || PATHS.book}</svg>`;
const $ = (selector) => document.querySelector(selector);
const main = $('#main');
const modal = $('#modal');
const dateLabel = (timestamp) => new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(timestamp);
/** @type {Question[]} */ let questions = [];
/** @type {Source[]} */ let sources = [];
/** @type {Map<string, Question>} */ let questionMap = new Map();
let state = createEmptyState();
let route = 'home';
let filters = { subject: 'all', round: 'all', search: '' };
let listPage = 1;
let resultId = null;
let reviewFilter = 'all';
let timer = null;
let toastTimer = null;
let pendingConfirm = null;
let theme = 'light';
let storageFailed = false;

function persist() {
  const ok = saveState(undefined, state);
  if (!ok && !storageFailed) toast('無法儲存到這個瀏覽器，請匯出備份，避免關閉後遺失進度。', 9000);
  storageFailed = !ok;
  return ok;
}
function toast(message, duration = 3500) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, duration);
}
function applyTheme(value) {
  theme = value === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const title = theme === 'dark' ? '切換淺色模式' : '切換深色模式';
  $('#theme-button').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  $('#theme-button').setAttribute('aria-label', title);
  $('#theme-button').title = title;
  const tokens = getComputedStyle(document.documentElement);
  document.querySelector('meta[name="theme-color"]').content = tokens.getPropertyValue('--bg').trim();
  try { localStorage.setItem('ai-study-theme', theme); } catch { /* Storage may be restricted. */ }
}
try { applyTheme(localStorage.getItem('ai-study-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); } catch { applyTheme('light'); }

function renderNavigation() {
  const active = ['quiz', 'result'].includes(route) ? 'practice' : route === 'favorites' ? 'wrong' : route;
  const navigation = ROUTES.filter(([id]) => !['favorites', 'settings'].includes(id));
  const labels = { home: '首頁', practice: '練習', wrong: '複習', stats: '紀錄' };
  $('#navigation').innerHTML = navigation.map(([id]) => `<a class="nav-item ${active === id ? 'active' : ''}" href="#${id}" ${active === id ? 'aria-current="page"' : ''}>${labels[id]}</a>`).join('');
  $('#mobile-navigation').innerHTML = navigation.map(([id, , glyph]) => `<a href="#${id}" class="${active === id ? 'active' : ''}" ${active === id ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${labels[id]}</span></a>`).join('');
  document.querySelector('[data-nav="settings"]')?.setAttribute('aria-current', route === 'settings' ? 'page' : 'false');
  $('#page-label').textContent = ROUTES.find(([id]) => id === active)?.[1] || '學習總覽';
  document.title = `${route === 'quiz' ? '專注作答' : route === 'result' ? '練習結果' : $('#page-label').textContent} · AI 學習所`;
}
function goto(next, focus = true) {
  if (location.hash.slice(1) !== next) location.hash = next;
  else render(focus);
}
function render(focus = false) {
  if (!questions.length) return;
  route = location.hash.slice(1) || 'home';
  if (!ROUTES.some(([id]) => id === route) && !['quiz', 'result'].includes(route)) route = 'home';
  if (route === 'quiz' && !state.activeSession) route = 'home';
  if (route === 'result' && !state.history.length) route = 'home';
  document.body.dataset.view = route;
  renderNavigation();
  if (route === 'home') renderHome();
  else if (['practice', 'wrong', 'favorites'].includes(route)) renderLibrary();
  else if (route === 'quiz') renderQuiz();
  else if (route === 'result') renderResult();
  else if (route === 'stats') renderStats();
  else renderSettings();
  if (focus) { main.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); }
  updateTimer();
}
function statsStrip() {
  const s = getStats(questions, state);
  return `<div class="stats-strip" aria-label="學習摘要">${[
    ['book', '已練習題目', s.seen, '/ 300 題', '兩科公告試題，循序累積'],
    ['target', '累計正確率', s.attempts ? s.accuracy : '—', s.attempts ? '%' : '', s.attempts ? `累計 ${s.attempts} 次有效作答` : '從你的第一題開始'],
    ['repeat', '待複習錯題', s.wrong, '題', '再次答對，就能移出錯題'],
    ['bookmark', '收藏題目', s.favorites, '題', '留下值得再看一次的題目'],
  ].map(([glyph, label, value, unit, foot]) => `<div class="stat"><div class="stat-label">${icon(glyph)}${label}</div><div class="stat-value">${value}<small>${unit}</small></div><div class="stat-foot">${foot}</div></div>`).join('')}</div>`;
}
function activeBanner() {
  const s = state.activeSession;
  if (!s) return '';
  const answered = s.mode === 'practice' ? Object.keys(s.checked).length : Object.keys(s.answers).length;
  return `<div class="session-banner">${icon('clock')}<div class="grow"><strong>上次的${s.mode === 'exam' ? '模擬測驗' : '練習'}還在這裡</strong><small>已完成 ${answered} / ${s.questionIds.length} 題${s.mode === 'exam' ? '・計時持續進行' : '・接著上次的進度'}</small></div><button class="button primary" data-action="resume">繼續作答 ${icon('arrow')}</button></div>`;
}
function renderHome() {
  const stats = getStats(questions, state);
  const session = state.activeSession;
  const completed = session ? Object.keys(session.mode === 'practice' ? session.checked : session.answers).length : 0;
  main.innerHTML = `
    <section class="home-intro"><h1>開始練習</h1><p>115 年初級 AI 應用規劃師 · 兩科共 300 題</p></section>
    <section class="practice-start" aria-label="快速開始">
      <div class="practice-start-copy"><strong>${session ? '繼續上次進度' : '先練 10 題'}</strong><p>${session ? `${session.mode === 'exam' ? '模擬測驗' : '逐題練習'} · 已完成 ${completed} / ${session.questionIds.length} 題${session.mode === 'exam' ? ' · 計時中' : ''}` : '兩科隨機出題，答完立即核對。'}</p></div>
      <div class="practice-start-actions"><button class="button primary" data-action="${session ? 'resume' : 'quick'}">${session ? '繼續作答' : '開始練習'} ${icon('arrow')}</button><button class="button" data-action="setup" data-mode="exam">模擬測驗</button></div>
    </section>
    <section aria-label="依科目練習"><div class="section-heading"><h2>選擇科目</h2><a href="#practice" class="text-button">全部題目 ${icon('arrow')}</a></div><div class="subjects">${[1, 2].map((subject) => {
    const items = questions.filter(q => q.subject === subject); const seen = getStats(items, state).seen;
    return `<button class="subject-row" data-action="setup" data-subject="${subject}" data-round="all" aria-label="練習${SUBJECTS[subject]}"><span class="subject-index">0${subject}</span><span class="subject-copy"><strong>${SUBJECTS[subject]}</strong><span>三個場次 · 已練習 ${seen} / ${items.length} 題</span></span><span class="subject-trailing">${icon('arrow')}</span></button>`;
  }).join('')}</div></section>
    <div class="home-summary"><span>已練習 ${stats.seen} / 300 題${stats.attempts ? ` · 正確率 ${stats.accuracy}%` : ''}</span><a href="#stats" class="text-button">查看紀錄</a></div>`;
}
function libraryQuestions() {
  return filterQuestions(questions, { ...filters, pool: route === 'practice' ? 'all' : route }, state);
}
function renderLibrary() {
  const names = { practice: ['題庫練習', '選擇科目、場次，或搜尋題目。'], wrong: ['複習', '答對後，題目會自動移出錯題。'], favorites: ['複習', '收藏的題目集中在這裡。'] };
  const reviewTabs = route === 'practice' ? '' : `<nav class="review-tabs" aria-label="複習範圍"><a href="#wrong" ${route === 'wrong' ? 'aria-current="page"' : ''}>錯題</a><a href="#favorites" ${route === 'favorites' ? 'aria-current="page"' : ''}>收藏</a></nav>`;
  main.innerHTML = `<div class="page-title split"><div><h1>${names[route][0]}</h1><p>${names[route][1]}</p></div><button class="button primary" data-action="setup" data-pool="${route === 'practice' ? 'all' : route}">開始練習 ${icon('arrow')}</button></div>${activeBanner()}${reviewTabs}<div class="filter-bar"><label class="field search-field"><span>搜尋</span><span class="search-wrap">${icon('search')}<input id="search" type="search" maxlength="150" placeholder="題幹或選項關鍵字" value="${esc(filters.search)}"></span></label><label class="field"><span>科目</span><select id="filter-subject">${subjectOptions(filters.subject)}</select></label><label class="field"><span>場次</span><select id="filter-round">${roundOptions(filters.round)}</select></label></div><div class="list-info"><span id="list-count"></span></div><div id="question-results"></div>`;
  renderQuestionList();
}
function renderQuestionList() {
  const items = libraryQuestions(); const perPage = 15; const pages = Math.max(1, Math.ceil(items.length / perPage)); listPage = Math.min(listPage, pages);
  $('#list-count').textContent = `找到 ${items.length} 道題目`;
  if (!items.length) {
    $('#question-results').innerHTML = `<div class="empty"><span class="empty-icon">${icon(route === 'wrong' ? 'check' : route === 'favorites' ? 'bookmark' : 'search')}</span><h2>${route === 'wrong' ? '目前沒有待複習的錯題' : route === 'favorites' ? '把想再看的題目留在這裡' : '沒有符合條件的題目'}</h2><p>${route === 'wrong' ? '繼續練習，系統會自動整理最後一次答錯的題目。也可以調整上方篩選條件。' : route === 'favorites' ? '作答時點選收藏圖示，就能隨時回來複習。若已有收藏，請調整篩選條件。' : '試著換個關鍵字，或選擇全部科目與場次。'}</p><button class="button" data-action="${route === 'practice' ? 'clear-filters' : 'quick'}">${route === 'practice' ? '清除篩選' : '開始 10 題練習'} ${icon('arrow')}</button></div>`; return;
  }
  $('#question-results').innerHTML = `<div class="question-list">${items.slice((listPage - 1) * perPage, listPage * perPage).map(q => `<article class="question-item"><span class="item-number">${String(q.number).padStart(2, '0')}</span><div class="item-body"><div class="item-meta">115 年${ROUNDS[q.round]} · 第${q.subject === 1 ? '一' : '二'}科${state.records[q.id] ? ` · ${state.records[q.id].lastCorrect ? '上次答對' : '上次答錯'}` : ' · 尚未練習'}</div><h3>${esc(q.stem)}</h3></div><button class="icon-button favorite ${state.favorites.includes(q.id) ? 'active' : ''}" data-action="favorite" data-id="${q.id}" aria-label="${state.favorites.includes(q.id) ? '取消' : '加入'}收藏第 ${q.number} 題" aria-pressed="${state.favorites.includes(q.id)}">${icon('bookmark')}</button><button class="icon-button" data-action="single" data-id="${q.id}" aria-label="練習第 ${q.number} 題">${icon('arrow')}</button></article>`).join('')}</div><div class="pagination"><button class="button" data-action="page" data-delta="-1" ${listPage <= 1 ? 'disabled' : ''}>上一頁</button><span>${listPage} / ${pages}</span><button class="button" data-action="page" data-delta="1" ${listPage >= pages ? 'disabled' : ''}>下一頁</button></div>`;
}
const subjectOptions = (selected) => [['all', '全部科目'], ['1', '第一科：AI 基礎'], ['2', '第二科：生成式 AI']].map(([v, text]) => `<option value="${v}" ${String(selected) === v ? 'selected' : ''}>${text}</option>`).join('');
const roundOptions = (selected) => [['all', '全部場次'], ['1', '115 年第一次'], ['2', '115 年第二次'], ['3', '115 年第三次']].map(([v, text]) => `<option value="${v}" ${String(selected) === v ? 'selected' : ''}>${text}</option>`).join('');
function openModal(title, body) {
  $('#modal-content').innerHTML = `<div class="dialog-header"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-action="close-modal" aria-label="關閉視窗">${icon('cross')}</button></div><div class="dialog-body">${body}</div>`;
  if (!modal.open) modal.showModal();
}
function confirmAction(title, message, action, button = '確認') {
  pendingConfirm = action;
  openModal(title, `<p>${esc(message)}</p><div class="dialog-actions"><button class="button" data-action="close-modal">取消</button><button class="button primary" data-action="confirm">${button}</button></div>`);
}
function showSetup(data = {}) {
  const subject = data.subject || filters.subject;
  const round = data.round || filters.round;
  openModal('練習設定', `<form id="setup-form">
    <div class="dialog-grid">
      <label class="field"><span>科目</span><select name="subject">${subjectOptions(subject)}</select></label>
      <label class="field"><span>場次</span><select name="round">${roundOptions(round)}</select></label>
      <label class="field"><span>題數</span><select name="count">${['10', '20', '50', 'all'].map(v => `<option value="${v}" ${v === (data.count || '20') ? 'selected' : ''}>${v === 'all' ? '全部題目' : `${v} 題`}</option>`).join('')}</select></label>
      <label class="field"><span>模式</span><select name="mode"><option value="practice">練習・即時對答案</option><option value="exam" ${data.mode === 'exam' ? 'selected' : ''}>測驗・交卷後對答案</option></select></label>
      <label class="field full" id="duration-field" ${data.mode !== 'exam' ? 'hidden' : ''}><span>自訂計時（非官方應試時長）</span><select name="duration"><option value="30">30 分鐘</option><option value="60" selected>60 分鐘</option><option value="90">90 分鐘</option></select></label>
    </div>
    <details class="setup-advanced" ${data.pool && data.pool !== 'all' ? 'open' : ''}><summary>更多選項</summary><div class="dialog-grid">
      <label class="field"><span>題目範圍</span><select name="pool">${[['all', '全部題目'], ['unseen', '尚未練習'], ['wrong', '待複習錯題'], ['favorites', '我的收藏']].map(([v, t]) => `<option value="${v}" ${v === (data.pool || 'all') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field"><span>順序</span><select name="shuffle"><option value="true">隨機出題</option><option value="false" ${data.round && data.round !== 'all' ? 'selected' : ''}>原題順序</option></select></label>
    </div></details>
    <div class="notice" id="setup-count"></div><div class="dialog-actions"><button class="button" type="button" data-action="close-modal">取消</button><button class="button primary" type="submit">開始 ${icon('arrow')}</button></div>
  </form>`);
  updateSetupCount();
}
function updateSetupCount() {
  const form = $('#setup-form'); if (!form) return;
  const values = Object.fromEntries(new FormData(form));
  const available = filterQuestions(questions, values, state).length;
  const count = values.count === 'all' ? available : Math.min(Number(values.count), available);
  $('#setup-count').textContent = available ? `符合範圍共 ${available} 題，本回合將練習 ${count} 題。${state.activeSession ? '開始新的練習將取代目前尚未完成的回合。' : '作答紀錄會自動保存在目前裝置。'}` : '目前沒有符合範圍的題目，請調整科目、場次或題目範圍。';
  $('#duration-field').hidden = values.mode !== 'exam';
  form.querySelector('[type="submit"]').disabled = !available;
}
function begin(items, options) {
  const run = () => {
    state.activeSession = startSession(items, options);
    if (!state.activeSession) { toast('目前沒有可以練習的題目。'); return; }
    persist(); modal.close(); goto('quiz');
  };
  if (state.activeSession) confirmAction('開始新的練習？', '目前回合將被取代。已確認的練習紀錄、收藏與筆記會保留；未交卷的模擬測驗不會計分。', run, '開始新回合');
  else run();
}
function currentQuestion() { return questionMap.get(state.activeSession?.questionIds[state.activeSession.currentIndex]); }
function sourceLink(q) {
  const source = sources.find(s => s.id === q.sourceId);
  if (!source || !/^sources\/[a-z0-9-]+\.pdf$/.test(source.file)) return '';
  return `<a href="./${esc(source.file)}#page=${q.sourcePages[0]}" target="_blank" rel="noopener noreferrer">原公告 PDF，第 ${q.sourcePages.join('、')} 頁 ↗</a>`;
}
function renderQuiz() {
  const s = state.activeSession;
  const q = currentQuestion();
  if (!s || !q) { goto('home'); return; }
  const checked = s.mode === 'practice' && s.checked[q.id];
  const answer = s.answers[q.id];
  const correct = answer === q.answer;
  const completed = s.mode === 'practice' ? Object.keys(s.checked).length : Object.keys(s.answers).length;
  main.innerHTML = `
    <div class="quiz-top"><button class="text-button" data-action="leave">${icon('back')} 返回</button><span class="timer" id="timer">${s.mode === 'exam' ? '' : `${s.currentIndex + 1} / ${s.questionIds.length} 題`}</span></div>
    <div class="quiz-layout">
      <section class="quiz-card">
        <div class="quiz-meta"><span>115 年${ROUNDS[q.round]} · 第${q.subject === 1 ? '一' : '二'}科 · 原題 ${q.number}</span><div class="question-tools"><button class="icon-button ${state.favorites.includes(q.id) ? 'active' : ''}" data-action="favorite" data-id="${q.id}" aria-pressed="${state.favorites.includes(q.id)}" aria-label="${state.favorites.includes(q.id) ? '取消收藏' : '收藏這一題'}" title="${state.favorites.includes(q.id) ? '取消收藏' : '收藏這一題'}">${icon('bookmark')}</button></div></div>
        <h1 class="quiz-question" id="question-heading">${esc(q.stem)}</h1>
        <div class="options" role="group" aria-labelledby="question-heading">${q.options.map(option => `<button class="option ${answer === option.key ? 'selected' : ''} ${checked && option.key === q.answer ? 'correct' : checked && answer === option.key ? 'incorrect' : ''}" data-action="answer" data-key="${option.key}" aria-pressed="${answer === option.key}" ${checked ? 'disabled' : ''}><span class="option-key">${option.key}</span><span class="option-text">${esc(option.text)}</span>${checked && (option.key === q.answer || option.key === answer) ? `<span class="option-indicator">${icon(option.key === q.answer ? 'check' : 'cross')}</span>` : ''}</button>`).join('')}</div>
        <div aria-live="polite" id="answer-feedback">${checked ? `<div class="feedback ${correct ? '' : 'incorrect'}"><strong>${icon(correct ? 'check' : 'repeat')}${correct ? '答對了' : `公告答案：${q.answer}`}</strong><p>依原公告答案，來源未附解析。</p>${sourceLink(q)}</div>` : ''}</div>
        <div class="quiz-actions"><button class="button ghost" data-action="move" data-delta="-1" ${s.currentIndex === 0 ? 'disabled' : ''}>${icon('back')} 上一題</button><div class="right">${s.mode === 'practice' && !checked ? `<button class="button primary" data-action="check" ${!answer ? 'disabled' : ''}>確認答案</button>` : ''}${s.currentIndex < s.questionIds.length - 1 ? `<button class="button ${checked || s.mode === 'exam' ? 'primary' : 'ghost'}" data-action="move" data-delta="1">${!checked && s.mode === 'practice' ? '跳過' : '下一題'} ${icon('arrow')}</button>` : `<button class="button ${checked || s.mode === 'exam' ? 'primary' : 'ghost'}" data-action="finish">${s.mode === 'exam' ? '交卷' : '完成'} ${icon('check')}</button>`}</div></div>
        <details class="note-section" ${state.notes[q.id] ? 'open' : ''}><summary>筆記${state.notes[q.id] ? ' · 已儲存' : ''}</summary><label class="sr-only" for="question-note">本題學習筆記</label><textarea id="question-note" maxlength="8000" placeholder="寫下這一題的重點…" data-id="${q.id}">${esc(state.notes[q.id] || '')}</textarea><small>自動儲存在目前裝置，最多 8,000 字。</small></details>
      </section>
      <div class="quiz-footer"><details class="quiz-navigator"><summary>題號與進度 <span>${completed} / ${s.questionIds.length} 已答</span></summary><div class="number-grid">${s.questionIds.map((id, i) => `<button class="number-cell ${s.currentIndex === i ? 'current' : ''} ${s.mode === 'practice' && s.checked[id] ? s.answers[id] === questionMap.get(id).answer ? 'correct' : 'incorrect' : s.answers[id] ? 'answered' : ''}" data-action="jump" data-index="${i}" aria-label="跳至第 ${i + 1} 題${s.checked[id] ? '，已確認' : s.answers[id] ? '，已選答案' : '，未作答'}" ${s.currentIndex === i ? 'aria-current="step"' : ''}>${i + 1}</button>`).join('')}</div></details><button class="text-button" data-action="finish">${s.mode === 'exam' ? '交卷' : '結束練習'}</button></div>
    </div>`;
}
function checkAnswer() {
  const s = state.activeSession; const q = currentQuestion();
  if (!s || !q || s.mode !== 'practice' || s.checked[q.id] || !s.answers[q.id]) return;
  recordAnswer(state, q, s.answers[q.id]); s.checked[q.id] = true; persist(); renderQuiz(); renderNavigation();
  $('#answer-feedback').focus?.({ preventScroll: true });
}
function moveQuestion(index) {
  const s = state.activeSession; if (!s) return;
  s.currentIndex = Math.max(0, Math.min(s.questionIds.length - 1, index)); persist(); renderQuiz(); updateTimer();
  $('.quiz-question').setAttribute('tabindex', '-1'); $('.quiz-question').focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}
function completeSession(automatic = false) {
  const s = state.activeSession; if (!s) return;
  const answered = s.mode === 'practice' ? Object.keys(s.checked).length : Object.keys(s.answers).length;
  const run = () => {
    const result = finishSession(state, s, questions); resultId = result.id; reviewFilter = 'all'; persist(); modal.close(); goto('result');
    if (automatic) toast('測驗時間已到，已自動交卷並保存結果。', 6000);
  };
  if (automatic) run();
  else confirmAction(s.mode === 'exam' ? '準備交卷？' : '結束這回合練習？', `已完成 ${answered} / ${s.questionIds.length} 題。${answered < s.questionIds.length ? `還有 ${s.questionIds.length - answered} 題未${s.mode === 'practice' ? '確認答案' : '作答'}，本次結果將列為未答。` : '完成後可以查看逐題結果與公告答案。'}`, run, s.mode === 'exam' ? '確認交卷' : '查看結果');
}
function updateTimer() {
  const s = state.activeSession; if (!s || s.mode !== 'exam') return;
  const seconds = Math.max(0, Math.ceil((s.deadline - Date.now()) / 1000));
  if ($('#timer')) $('#timer').textContent = `剩餘 ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  if (!seconds) completeSession(true);
}
function renderResult() {
  const result = state.history.find(h => h.id === resultId) || state.history[0];
  if (!result) { goto('home'); return; }
  resultId = result.id;
  const items = result.questionIds.map(id => questionMap.get(id)).filter(Boolean);
  const filtered = items.filter(q => reviewFilter === 'all' || result.answers[q.id] !== q.answer);
  main.innerHTML = `<div class="panel result-hero"><div class="eyebrow">${result.mode === 'exam' ? '測驗結果' : '練習結果'}</div><div class="score">${result.score}<small>分</small></div><h1>本回合完成</h1><p>${result.mode === 'exam' ? '模擬測驗' : '逐題練習'} · ${dateLabel(result.finishedAt)} · 自訂練習成績</p><div class="result-numbers"><div><strong>${result.correct}</strong><span>答對</span></div><div><strong>${result.answered - result.correct}</strong><span>答錯</span></div><div><strong>${result.unanswered}</strong><span>未作答</span></div></div><p>答對題數 ÷ 本回合題數 × 100；未答題不給分。</p><div class="result-actions"><button class="button primary" data-action="retry-result">複習本回合錯題與未答題 ${icon('repeat')}</button><a class="button" href="#home">回學習總覽</a></div></div><div class="section-heading"><h2>逐題回顧<span class="sub">${filtered.length} 題</span></h2><button class="text-button" data-action="review-filter">${reviewFilter === 'all' ? '只看錯題與未答題' : '查看全部題目'}</button></div>${filtered.length ? filtered.map((q) => `<details class="panel result-question"><summary><span class="tag">${result.answers[q.id] === q.answer ? '答對' : result.answers[q.id] ? '答錯' : '未答'}</span>${esc(q.stem)}</summary><div class="result-options">${q.options.map(o => `<div class="result-option ${o.key === q.answer ? 'correct' : o.key === result.answers[q.id] ? 'incorrect' : ''}">${o.key}. ${esc(o.text)} ${o.key === q.answer ? ' ✓ 公告答案' : o.key === result.answers[q.id] ? ' ← 你的選擇' : ''}</div>`).join('')}</div><p>115 年${ROUNDS[q.round]} · 第${q.subject === 1 ? '一' : '二'}科 · 第 ${q.number} 題。來源未提供解析。</p><div class="review-actions">${sourceLink(q)}<button class="text-button" data-action="favorite" data-id="${q.id}">${icon('bookmark')}${state.favorites.includes(q.id) ? '取消收藏' : '收藏題目'}</button></div></details>`).join('') : '<div class="empty"><h2>這回合全部答對了</h2><p>可以試試其他科目，繼續累積。</p></div>'}`;
}
function renderStats() {
  main.innerHTML = `<div class="page-title"><h1>學習紀錄</h1><p>練習結果與科目進度，保存在目前裝置。</p></div>${statsStrip()}<div class="stats-subjects">${[1, 2].map(subject => {
    const s = getStats(questions.filter(q => q.subject === subject), state);
    return `<div class="panel"><span class="eyebrow">第${subject === 1 ? '一' : '二'}科</span><h3>${SUBJECTS[subject]}</h3><p>已練習 ${s.seen} / ${s.total} 題 · 最近答對 ${s.mastered} 題</p><div class="progress-track"><progress value="${s.seen}" max="${s.total}" aria-label="科目 ${subject} 進度"></progress></div><p>累計正確率 ${s.attempts ? `${s.accuracy}%` : '—'} · 待複習 ${s.wrong} 題</p></div>`;
  }).join('')}</div><div class="section-heading"><h2>最近的練習紀錄<span class="sub">保留最近 100 回合</span></h2></div>${state.history.length ? `<div class="history-list">${state.history.map(h => `<button class="history-row" data-action="history" data-id="${esc(h.id)}">${icon(h.mode === 'exam' ? 'clock' : 'book')}<div class="grow"><strong>${h.mode === 'exam' ? '模擬測驗' : '逐題練習'} · ${h.total} 題</strong><small>${dateLabel(h.finishedAt)} · 答對 ${h.correct} 題</small></div><span class="history-score">${h.score}<small> 分</small></span>${icon('arrow')}</button>`).join('')}</div>` : `<div class="empty"><span class="empty-icon">${icon('chart')}</span><h2>你的第一筆紀錄，從現在開始</h2><p>完成練習或交卷後，這裡會留下每回合的結果。</p><button class="button primary" data-action="quick">開始 10 題練習 ${icon('arrow')}</button></div>`}`;
}
function renderSettings() {
  main.innerHTML = `<div class="page-title"><h1>設定</h1><p>安裝、外觀與資料備份。</p></div><div class="settings-grid"><section class="panel"><h2>隨時打開，繼續練習</h2><p>將 AI 學習所加入手機主畫面。題庫快取完成後，即使沒有網路，也可以作答、收藏和寫筆記。原始 PDF 需連網查閱。</p><div class="setting-buttons"><button class="button primary" data-action="install">安裝與操作說明 ${icon('download')}</button><a class="button" href="#favorites">我的收藏 ${icon('bookmark')}</a></div></section><section class="panel"><h2>舒服的閱讀方式</h2><p>切換淺色或深色模式，偏好會保存在目前瀏覽器。</p><button class="button" data-action="theme">${icon(theme === 'dark' ? 'sun' : 'moon')}${theme === 'dark' ? '改用淺色模式' : '改用深色模式'}</button></section><section class="panel"><h2>備份你的學習進度</h2><p>本網站不要求登入，作答、筆記、收藏不會上傳伺服器，也不會自動跨裝置同步。清除瀏覽器資料可能遺失紀錄。換裝置前，先匯出一份備份。</p><div class="setting-buttons"><button class="button" data-action="export">${icon('download')} 匯出備份</button><button class="button" data-action="import">${icon('upload')} 匯入備份</button></div><input type="file" id="backup-file" accept=".json,application/json" hidden></section><section class="panel"><h2>題庫與資料管理</h2><p>包含你提供的 115 年三個場次、兩科共 300 題公告試題。答案依原 PDF，未附官方解析。本網站為個人練習工具，非考試主辦單位網站。</p><div class="setting-buttons"><button class="button" data-action="sources">${icon('document')} 查看原始來源</button><button class="button danger" data-action="reset">清除本機學習紀錄</button></div></section></div>`;
}
function showSources() {
  openModal('題庫來源與使用說明', `<p>本題庫依提供的六份公告試題 PDF 整理，共 300 題。答案直接採用原 PDF 標示，來源未提供解析；此版本未另外查核公告後的勘誤。每題的對答案畫面可回到原始頁面核對。</p><div class="source-list">${sources.map(s => `<a class="source-link" href="./${esc(s.file)}" target="_blank" rel="noopener noreferrer"><div><strong>115 年${ROUNDS[s.round]} · 第${s.subject === 1 ? '一' : '二'}科</strong><small>${SUBJECTS[s.subject]} · ${s.questionCount} 題</small></div>${icon('external')}</a>`).join('')}</div><div class="notice">題庫版本：115-2026-v1。原始試題與相關權利屬原權利人；本網站不代表主辦單位。原 PDF 需連網開啟；本機資料僅供個人備考紀錄。</div>`);
}
async function showInstall() {
  if (getInstallState().installable) { if (await requestInstall()) toast('已送出安裝請求，請依瀏覽器提示完成。'); return; }
  const install = getInstallState();
  openModal(install.installed ? '已在獨立視窗中開啟' : '把 AI 學習所放進手機', `<p>${install.ready ? '題庫已備妥，可以離線練習。' : '先保持連網，等頁面顯示「可離線練習」後再離線。'}安裝操作會依手機與瀏覽器版本略有不同。</p><div class="install-section"><h3>iPhone / iPad · Safari</h3><ol class="install-steps"><li>用 Safari 開啟本網站的 HTTPS 網址。</li><li>點選「分享」，再選「加入主畫面」。</li><li>確認名稱並加入，之後從主畫面開啟。</li></ol><h3>Android · Chrome</h3><ol class="install-steps"><li>用 Chrome 開啟本網站。</li><li>選單中點選「安裝應用程式」或「新增至主畫面」。</li><li>依提示完成安裝。</li></ol></div><div class="notice">安裝及離線功能需要 HTTPS（或本機 localhost）。手機不能使用電腦的 localhost 網址；部署到 Vercel 後，請在手機開啟正式網址。紀錄不會自動跨裝置同步，換裝置請先匯出備份。</div>`);
}
function exportState() {
  const blob = new Blob([exportBackup(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = `AI學習所-進度備份-${new Intl.DateTimeFormat('sv-SE').format(new Date())}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500); toast('備份已匯出，請妥善保存。');
}
async function readBackup(file) {
  if (!file) return;
  if (file.size > MAX_BACKUP_BYTES) { toast(`備份上限為 ${MAX_BACKUP_BYTES / 1024 / 1024} MB，請選擇本網站匯出的檔案。`); return; }
  try {
    const imported = importBackup(await file.text(), questionMap.keys());
    const stats = getStats(questions, imported);
    confirmAction('以備份取代目前進度？', `備份包含 ${stats.seen} 題練習紀錄、${stats.favorites} 題收藏及 ${stats.notes} 則筆記。匯入會取代目前裝置的紀錄，建議先匯出現有備份。`, () => { state = imported; const saved = persist(); render(); if (saved) toast('備份已匯入。'); else toast('備份已暫時載入，但無法儲存到瀏覽器。請保留原備份，關閉後可能遺失進度。', 9000); }, '匯入並取代');
  } catch (error) { toast(error.message || '無法讀取這份備份。', 6000); }
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const data = button.dataset; const s = state.activeSession;
  switch (data.action) {
    case 'theme': applyTheme(theme === 'dark' ? 'light' : 'dark'); if (route === 'settings') renderSettings(); break;
    case 'quick': begin(questions, { mode: 'practice', count: 10, shuffle: true }); break;
    case 'setup': showSetup(data); break;
    case 'resume': goto('quiz'); break;
    case 'leave': persist(); goto('home'); break;
    case 'single': begin([questionMap.get(data.id)], { mode: 'practice', count: 'all', shuffle: false }); break;
    case 'answer': if (s && !s.checked[currentQuestion().id]) { s.answers[currentQuestion().id] = data.key; persist(); renderQuiz(); updateTimer(); document.querySelector(`[data-action="answer"][data-key="${data.key}"]`)?.focus({ preventScroll: true }); } break;
    case 'check': checkAnswer(); break;
    case 'move': if (s) moveQuestion(s.currentIndex + Number(data.delta)); break;
    case 'jump': moveQuestion(Number(data.index)); break;
    case 'finish': completeSession(); break;
    case 'favorite': {
      if (!questionMap.has(data.id)) break;
      const existing = state.favorites.includes(data.id);
      state.favorites = existing ? state.favorites.filter(id => id !== data.id) : [...state.favorites, data.id]; persist();
      if (route === 'quiz') renderQuiz();
      else if (['practice', 'wrong', 'favorites'].includes(route)) renderQuestionList();
      else if (route === 'result') { button.innerHTML = `${icon('bookmark')}${existing ? '收藏題目' : '取消收藏'}`; }
      renderNavigation(); toast(existing ? '已取消收藏' : '已加入我的收藏'); break;
    }
    case 'page': listPage += Number(data.delta); renderQuestionList(); window.scrollTo({ top: 0 }); break;
    case 'clear-filters': filters = { subject: 'all', round: 'all', search: '' }; listPage = 1; renderLibrary(); break;
    case 'history': resultId = data.id; reviewFilter = 'all'; goto('result'); break;
    case 'review-filter': reviewFilter = reviewFilter === 'all' ? 'wrong' : 'all'; renderResult(); break;
    case 'retry-result': {
      const result = state.history.find(h => h.id === resultId);
      const items = result?.questionIds.map(id => questionMap.get(id)).filter(q => q && result.answers[q.id] !== q.answer) || [];
      if (items.length) begin(items, { mode: 'practice', count: 'all', shuffle: false }); else toast('這回合全部答對了，可以開始其他題目的練習。'); break;
    }
    case 'sources': showSources(); break;
    case 'install': await showInstall(); break;
    case 'update': if (persist()) applyUpdate(); break;
    case 'export': exportState(); break;
    case 'import': $('#backup-file').click(); break;
    case 'reset': confirmAction('清除這個裝置的學習紀錄？', '將清除所有作答、錯題、收藏、筆記與進行中的回合。此操作無法復原，建議先匯出備份。題庫本身會保留。', () => { state = createEmptyState(); const saved = persist(); render(); if (saved) toast('本機學習紀錄已清除。'); else toast('目前畫面已重設，但無法寫入瀏覽器，原紀錄可能仍在。', 9000); }, '確認清除'); break;
    case 'close-modal': modal.close(); pendingConfirm = null; break;
    case 'confirm': { const callback = pendingConfirm; pendingConfirm = null; modal.close(); callback?.(); break; }
  }
});
document.addEventListener('submit', event => {
  if (event.target.id !== 'setup-form') return;
  event.preventDefault(); const values = Object.fromEntries(new FormData(event.target));
  const items = filterQuestions(questions, values, state);
  if (!items.length) return;
  begin(items, { mode: values.mode, count: values.count === 'all' ? 'all' : Number(values.count), shuffle: values.shuffle === 'true', durationMinutes: Number(values.duration) });
});
document.addEventListener('input', event => {
  const target = event.target;
  if (target.id === 'search') { filters.search = target.value; listPage = 1; renderQuestionList(); }
  if (target.id === 'question-note') {
    if (target.value.trim()) state.notes[target.dataset.id] = target.value.slice(0, 8000); else delete state.notes[target.dataset.id];
    persist();
  }
});
document.addEventListener('change', event => {
  const target = event.target;
  if (target.closest('#setup-form')) updateSetupCount();
  if (target.id === 'filter-subject' || target.id === 'filter-round') { filters[target.id === 'filter-subject' ? 'subject' : 'round'] = target.value; listPage = 1; renderQuestionList(); }
  if (target.id === 'backup-file') { readBackup(target.files[0]); target.value = ''; }
});
document.addEventListener('keydown', event => {
  if (route !== 'quiz' || modal.open || event.altKey || event.ctrlKey || event.metaKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
  if (event.target.tagName === 'BUTTON' && event.target.dataset.action !== 'answer') return;
  if (/^[1-4]$/.test(event.key)) { event.preventDefault(); document.querySelector(`[data-action="answer"][data-key="${'ABCD'[Number(event.key) - 1]}"]`)?.click(); }
  else if (event.key === 'Enter') { event.preventDefault(); if (state.activeSession?.mode === 'practice' && !state.activeSession.checked[currentQuestion().id]) checkAnswer(); else if (state.activeSession.currentIndex < state.activeSession.questionIds.length - 1) moveQuestion(state.activeSession.currentIndex + 1); }
  else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); moveQuestion(state.activeSession.currentIndex + (event.key === 'ArrowLeft' ? -1 : 1)); }
});
window.addEventListener('hashchange', () => { listPage = 1; render(true); });
window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY && questions.length) { state = loadState(undefined, questionMap.keys()); modal.close(); pendingConfirm = null; render(); toast('已同步這個瀏覽器其他分頁的最新進度。'); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateTimer(); });

async function initialize() {
  try {
    const responses = await Promise.all([fetch(new URL('../data/questions.json', import.meta.url)), fetch(new URL('../data/sources.json', import.meta.url))]);
    if (responses.some(r => !r.ok)) throw new Error('題庫下載未完成');
    const [bank, provenance] = await Promise.all(responses.map(r => r.json()));
    if (!Array.isArray(bank.questions) || !bank.questions.length || !Array.isArray(provenance.sources)) throw new Error('題庫格式不正確');
    questions = bank.questions; sources = provenance.sources; questionMap = new Map(questions.map(q => [q.id, q]));
    state = loadState(undefined, questionMap.keys());
    render();
    initPwa({ onStatus: ({ offline, ready, message }) => {
      const connection = $('#connection'); connection.classList.toggle('offline', offline);
      connection.innerHTML = `<i></i>${offline ? '離線模式' : ready ? '可離線練習' : '離線準備中'}`; connection.title = message;
    }, onUpdate: () => { $('#update-banner').hidden = false; } });
    timer = setInterval(updateTimer, 1000);
  } catch (error) {
    main.innerHTML = `<div class="empty"><span class="empty-icon">${icon('repeat')}</span><h1>題庫暫時無法載入</h1><p>首次使用需要網路，請確認連線後重新整理。若是本機專案，請使用 npm run dev 開啟，不能直接雙擊 HTML。</p><a href="./" class="button primary">重新載入</a></div>`;
    $('#connection').textContent = '題庫載入失敗';
    console.error('Question bank initialization failed:', error.message);
  }
}
initialize();
