import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build, BUILD_FILES, BUILD_DIRECTORIES } from '../scripts/build.mjs';
import { createStaticServer } from '../scripts/serve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function filesUnder(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await filesUnder(root, path));
    else result.push(path);
  }
  return result.sort();
}

async function workerHarness() {
  const listeners = new Map();
  const entries = new Map();
  const state = { added: [], installRequests: [], fetched: [], skipped: 0, claimed: 0, response: null };
  const cache = {
    async addAll(requests) { state.installRequests = requests; state.added = requests.map((request) => request.url); },
    async match(url) { return entries.get(typeof url === 'string' ? url : url.url); },
    async put(url, value) { entries.set(url, value); },
    async keys() { return [...entries.keys()].map((url) => ({ url })); },
    async delete(request) { return entries.delete(request.url); },
  };
  const self = {
    registration: { scope: 'https://example.test/study/' },
    addEventListener(type, callback) { listeners.set(type, callback); },
    async skipWaiting() { state.skipped += 1; },
    clients: { async claim() { state.claimed += 1; } },
  };
  vm.runInNewContext(await readFile(join(ROOT, 'sw.js'), 'utf8'), {
    self, URL, Request,
    caches: { async open() { return cache; }, async keys() { return ['ai-study-115-v3']; } },
    async fetch(request) {
      state.fetched.push(request.url);
      return state.response || { ok: true, type: 'basic', redirected: false, clone() { return this; } };
    },
  });
  return { listeners, entries, state };
}

test('manifest is subpath-safe and supplies valid install icons', async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'AI 學習所');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  for (const size of [192, 512]) {
    for (const purpose of ['any', 'maskable']) {
      const icon = manifest.icons.find((entry) => entry.sizes === `${size}x${size}` && entry.purpose === purpose);
      assert.ok(icon, `Missing ${size} ${purpose} icon`);
      const bytes = await readFile(join(ROOT, icon.src));
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      assert.equal(bytes.readUInt32BE(16), size);
      assert.equal(bytes.readUInt32BE(20), size);
    }
  }
  const apple = await readFile(join(ROOT, 'icons/apple-touch-icon.png'));
  assert.equal(apple.readUInt32BE(16), 180);
});

test('offline installation includes the complete shell and both data files but no PDFs', async () => {
  const { listeners, state } = await workerHarness();
  let completion;
  listeners.get('install')({ waitUntil(value) { completion = value; } });
  await completion;
  assert.ok(state.added.includes('https://example.test/study/data/questions.json'));
  assert.ok(state.added.includes('https://example.test/study/data/sources.json'));
  assert.ok(state.added.every((url) => url.startsWith('https://example.test/study/')));
  assert.ok(state.added.every((url) => !url.endsWith('.pdf')));
  assert.ok(state.installRequests.every((request) => request.redirect === 'error'), 'Install must reject login redirects rather than cache them as app resources');
  for (const url of state.added) {
    const path = url.slice('https://example.test/study/'.length) || 'index.html';
    await readFile(join(ROOT, path));
  }
  assert.equal(state.skipped, 0, 'Installation must not force an update during a study session');
});

test('worker restricts caching to GET, same-origin, explicit app files', async () => {
  const { listeners, state, entries } = await workerHarness();
  const dispatch = async (url, options = {}) => {
    let response;
    listeners.get('fetch')({ request: { url, method: 'GET', mode: 'cors', ...options }, respondWith(value) { response = value; } });
    return response ? await response : undefined;
  };
  for (const url of ['https://example.test/api/session', 'https://example.test/study/login', 'https://example.test/study/sources/115-r1-s1.pdf', 'https://other.test/study/js/app.js', 'https://example.test/study/js/app.js?token=private']) {
    assert.equal(await dispatch(url), undefined);
  }
  assert.equal(await dispatch('https://example.test/study/js/app.js', { method: 'POST' }), undefined);
  assert.equal(state.fetched.length, 0);
  const cached = { offline: true };
  entries.set('https://example.test/study/data/questions.json', cached);
  assert.equal(await dispatch('https://example.test/study/data/questions.json'), cached);
  entries.set('https://example.test/study/', cached);
  assert.equal(await dispatch('https://example.test/study/?source=homescreen', { mode: 'navigate' }), cached);
  assert.equal(state.fetched.length, 0, 'Cached questions and navigation must load without network access');
  await dispatch('https://example.test/study/js/app.js');
  assert.equal(state.fetched.length, 1);
  assert.ok(entries.has('https://example.test/study/js/app.js'));
  state.response = { ok: true, type: 'basic', redirected: true, clone() { return this; } };
  await dispatch('https://example.test/study/styles.css');
  assert.equal(entries.has('https://example.test/study/styles.css'), false, 'Redirected login responses must never enter the app cache');
});

test('waiting worker activates only after an explicit update message', async () => {
  const { listeners, state } = await workerHarness();
  listeners.get('message')({ data: { type: 'UNRELATED' }, waitUntil() { assert.fail('Unexpected update'); } });
  assert.equal(state.skipped, 0);
  let completion;
  listeners.get('message')({ data: { type: 'SKIP_WAITING' }, waitUntil(value) { completion = value; } });
  await completion;
  assert.equal(state.skipped, 1);
});

test('production build contains exactly deployable files with byte-identical data', async () => {
  const output = await build();
  const expected = [...BUILD_FILES];
  for (const directory of BUILD_DIRECTORIES) expected.push(...(await filesUnder(ROOT, directory)));
  assert.deepEqual(await filesUnder(output), expected.sort());
  for (const path of expected) {
    assert.deepEqual(await readFile(join(output, path)), await readFile(join(ROOT, path)), `Changed bytes in ${path}`);
  }
  const config = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(config.buildCommand, 'node scripts/build.mjs');
  assert.equal(config.outputDirectory, 'dist');
});

test('preview server enforces safe paths, correct MIME and service worker freshness', async (t) => {
  const server = await createStaticServer({ port: 0 });
  t.after(() => new Promise((done) => server.close(done)));
  const port = server.address().port;
  const get = (path, method = 'GET') => new Promise((resolveRequest, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method }, (response) => {
      response.resume();
      response.on('end', () => resolveRequest(response));
    });
    req.on('error', reject);
    req.end();
  });
  for (const path of ['/%2e%2e/package.json', '/..%5cpackage.json', '/%00index.html', '/.git/config']) {
    assert.equal((await get(path)).statusCode, 400, path);
  }
  assert.equal((await get('/index.html', 'POST')).statusCode, 405);
  assert.equal((await get('/does-not-exist')).statusCode, 404);
  const home = await get('/');
  assert.equal(home.statusCode, 200);
  assert.match(home.headers['content-type'], /text\/html/);
  assert.match(home.headers['content-security-policy'], /script-src 'self';/);
  assert.equal((await get('/sw.js')).headers['cache-control'], 'no-store');
  assert.match((await get('/manifest.webmanifest')).headers['content-type'], /application\/manifest\+json/);
  assert.match((await get('/data/questions.json')).headers['content-type'], /application\/json/);
  assert.equal((await get('/sources/115-r1-s1.pdf', 'HEAD')).statusCode, 200);
});
