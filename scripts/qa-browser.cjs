const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
let pw;
try { pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
catch {
  console.error('Playwright is required for browser QA only. Install it locally, or set PLAYWRIGHT_MODULE to its module path. See README.md.');
  process.exit(1);
}
const root = path.resolve(__dirname, '..');
const url = (process.env.QA_URL || 'http://127.0.0.1:4173').replace(/\/+$/, '');
const artifacts = path.resolve(process.env.QA_ARTIFACTS || path.join(root, 'test-results'));
const key = 'ai-study-pwa-state-v1';
const checks = [];
const record = name => { checks.push(name); console.log('PASS ' + name); };
const getState = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
const launchOptions = executablePath => ({ headless: true, ...(executablePath ? { executablePath } : {}) });
async function screenshot(page, filename) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(artifacts, filename), fullPage: true, animations: 'disabled' });
}
async function waitForDarkOptions(page) {
  await page.waitForFunction(() => {
    if (document.documentElement.dataset.theme !== 'dark') return false;
    const option = document.querySelector('.option:not(.selected):not(.correct):not(.incorrect)');
    if (!option) return true;
    // Normalize the theme token to the same RGB format returned for the option.
    const probe = document.createElement('span');
    probe.style.color = 'var(--surface)';
    probe.style.position = 'fixed';
    probe.style.visibility = 'hidden';
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(option).backgroundColor === expected;
  });
}
async function overflow(page) { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'page horizontal overflow'); }
async function endSession(page) { await page.locator('[data-action="finish"]').last().click(); await page.locator('[data-action="confirm"]').click(); await page.locator('.result-hero').waitFor(); }
(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const browser = await pw.chromium.launch(launchOptions(process.env.CHROMIUM_EXECUTABLE));
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(url); await page.locator('.subjects').waitFor();
    await page.waitForFunction(() => document.querySelector('#connection').textContent.includes('可離線'));
    await overflow(page); await screenshot(page, 'desktop-home.png');
    record('Desktop home, 300-question stats, offline readiness');
    await page.goto(url + '/#practice'); await page.locator('[data-action="single"][data-id="115-1-1-001"]').click();
    await page.locator('[data-action="answer"][data-key="A"]').click();
    await page.keyboard.press('Enter'); await page.locator('.feedback.incorrect').waitFor();
    assert.equal((await getState(page)).records['115-1-1-001'].lastCorrect,false);
    record('Keyboard answer confirmation and wrong-answer recording');
    await page.locator('[data-action="favorite"]').click();
    await page.locator('.note-section summary').click();
    await page.locator('#question-note').fill('資料整合重點 <img src=x onerror=alert(1)>');
    await page.reload(); await page.locator('.feedback.incorrect').waitFor();
    assert.equal(await page.locator('#question-note').inputValue(),'資料整合重點 <img src=x onerror=alert(1)>');
    assert.equal(await page.locator('.quiz-card img').count(),0);
    assert.equal((await getState(page)).records['115-1-1-001'].attempts,1);
    record('Reload preserves session, notes, favorites; note HTML escaped; no double count');
    await endSession(page);
    await page.goto(url + '/#wrong'); await page.locator('[data-action="single"][data-id="115-1-1-001"]').click();
    await page.locator('[data-action="answer"][data-key="D"]').click(); await page.locator('[data-action="check"]').click();
    await endSession(page); await page.goto(url + '/#wrong'); await page.getByRole('heading',{name:'目前沒有待複習的錯題'}).waitFor();
    record('Correct retry removes wrong question and retains lifetime history');
    await page.goto(url + '/#home'); await page.locator('[data-action="setup"][data-mode="exam"]').click();
    await page.locator('[name="subject"]').selectOption('1'); await page.locator('[name="round"]').selectOption('1');
    await page.locator('[name="count"]').selectOption('10'); await page.locator('.setup-advanced summary').click(); await page.locator('[name="shuffle"]').selectOption('false');
    await page.locator('#setup-form [type="submit"]').click(); await page.locator('.quiz-question').waitFor();
    const bank = JSON.parse(await fs.readFile(path.join(root,'data/questions.json'),'utf8')).questions;
    await page.locator('[data-action="answer"][data-key="D"]').click();
    await page.locator('[data-action="answer"][data-key="A"]').click();
    assert.equal(await page.locator('.feedback').count(),0);
    await page.locator('[data-action="move"][data-delta="1"]').click();
    await page.locator(`[data-action="answer"][data-key="${bank[1].answer}"]`).click();
    const before = await getState(page);
    await page.reload(); await page.locator('.quiz-question').waitFor();
    assert.equal((await getState(page)).activeSession.deadline,before.activeSession.deadline);
    await endSession(page); const exam = (await getState(page)).history[0];
    assert.equal(exam.correct,1); assert.equal(exam.unanswered,8); assert.equal(exam.score,10);
    record('Timed exam supports edits, hides answers, preserves deadline and scores unanswered');
    await page.goto(url + '/#settings');
    const downloadEvent = page.waitForEvent('download'); await page.locator('[data-action="export"]').click();
    const download = await downloadEvent; const exported = JSON.parse(await fs.readFile(await download.path(),'utf8'));
    assert.equal(exported.app,'ai-study-pwa'); assert.equal(exported.state.history.length,3);
    record('Backup export preserves progress, favorites, notes and history');
    await page.locator('[data-action="reset"]').click(); await page.locator('[data-action="confirm"]').click();
    await page.locator('#backup-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
    await page.locator('[data-action="confirm"]').click();
    assert.equal((await getState(page)).history.length,3);
    record('Confirmed reset and backup import roundtrip');
    await page.locator('#theme-button').click(); await page.reload(); await page.locator('.settings-grid').waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(28, 28, 27)');
    record('Theme persistence and computed dark colors');
    await page.locator('#theme-button').click();
    for (const width of [360,390,768,1280,1440]) {
      await page.setViewportSize({width,height:900});
      for (const route of ['home','practice','wrong','favorites','stats','settings']) {
        await page.goto(url + '/#' + route); await page.waitForFunction(()=>document.querySelector('main').textContent.length>50); await overflow(page);
      }
    }
    record('All navigation pages fit 360, 390, 768, 1280, 1440px widths');
    await page.setViewportSize({width:390,height:844}); await page.goto(url + '/#home');
    await screenshot(page, 'mobile-home.png');
    await page.locator('[data-action="quick"]').click(); await page.locator('.quiz-question').waitFor(); await overflow(page);
    await screenshot(page, 'mobile-quiz.png');
    await page.locator('#theme-button').click();
    await waitForDarkOptions(page);
    await screenshot(page, 'mobile-dark.png');
    await context.setOffline(true); await page.reload(); await page.locator('.quiz-question').waitFor();
    await page.locator('[data-action="answer"]').first().click(); await page.locator('[data-action="check"]').click();
    await page.locator('.feedback').waitFor();
    assert.match(await page.locator('#connection').textContent(),/離線/);
    record('Offline reload and answer submission retain full question bank');
    await context.setOffline(false);
    await page.evaluate(k=>{const s=JSON.parse(localStorage.getItem(k));s.activeSession.mode='exam';s.activeSession.deadline=Date.now()-1000;s.activeSession.checked={};localStorage.setItem(k,JSON.stringify(s));},key);
    await page.reload(); await page.locator('.result-hero').waitFor(); assert.equal((await getState(page)).activeSession,null);
    record('Expired exam auto-submits on reload');
    assert.deepEqual(errors,[]); record('No uncaught browser errors');
    await fs.writeFile(path.join(artifacts,'browser-qa.json'),JSON.stringify({url,passed:checks.length,checks,errors},null,2));
  } catch(error) {
    await screenshot(page, 'qa-failure.png').catch(()=>{});
    await fs.writeFile(path.join(artifacts, 'browser-qa.json'), JSON.stringify({url,passed:checks.length,checks,errors,failure:error.message},null,2));
    throw error;
  }
  finally { await browser.close(); }
  const webkit = await pw.webkit.launch(launchOptions(process.env.WEBKIT_EXECUTABLE));
  try {
    const page = await webkit.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await page.goto(url); await page.locator('.subjects').waitFor(); await overflow(page);
    await page.locator('[data-action="quick"]').click(); await page.locator('.quiz-question').waitFor();
    await page.locator('[data-action="answer"]').first().click(); await page.locator('[data-action="check"]').click(); await page.locator('.feedback').waitFor(); await overflow(page);
    await screenshot(page, 'webkit-mobile.png'); record('WebKit mobile layout and answer flow');
  } finally { await webkit.close(); }
  await fs.writeFile(path.join(artifacts,'browser-qa.json'),JSON.stringify({url,passed:checks.length,checks,errors},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
