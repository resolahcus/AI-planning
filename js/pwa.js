let registration = null;
let installPrompt = null;
let ready = false;
let updateRequested = false;
let reloading = false;
let statusCallback = () => {};
let updateCallback = () => {};
let cleanupCurrent = null;

const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function getInstallState() {
  return {
    installable: Boolean(installPrompt) && !installed(),
    installed: installed(),
    supported: 'serviceWorker' in navigator && window.isSecureContext,
    offline: !navigator.onLine,
    ready,
    updateAvailable: Boolean(registration?.waiting),
  };
}

function notify(message) {
  const state = getInstallState();
  statusCallback({
    offline: state.offline,
    ready: state.ready,
    installable: state.installable,
    message: message || (state.offline
      ? (state.ready ? '目前離線，可繼續使用已儲存的題庫。' : '目前離線；首次使用請先連上網路。')
      : (state.ready ? '題庫已備妥，可離線練習。' : '正在準備離線題庫…')),
  });
}

function notifyUpdate() {
  if (registration?.waiting) updateCallback({ waiting: true, message: '新版本已備妥，可在結束作答後更新。' });
}

/** Register offline support without interrupting an active study session. */
export function initPwa({ onStatus = () => {}, onUpdate = () => {} } = {}) {
  cleanupCurrent?.();
  statusCallback = onStatus;
  updateCallback = onUpdate;
  let disposed = false;
  const listeners = [];
  const listen = (target, type, callback) => {
    target.addEventListener(type, callback);
    listeners.push(() => target.removeEventListener(type, callback));
  };
  listen(window, 'online', () => notify());
  listen(window, 'offline', () => notify());
  listen(window, 'beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    notify();
  });
  listen(window, 'appinstalled', () => {
    installPrompt = null;
    notify('已加入裝置，可從主畫面開啟。');
  });
  const cleanup = () => {
    disposed = true;
    listeners.splice(0).forEach((remove) => remove());
    if (cleanupCurrent === cleanup) cleanupCurrent = null;
  };
  cleanupCurrent = cleanup;

  if (!getInstallState().supported) {
    notify('離線功能需要 HTTPS 或 localhost；可先使用網頁練習。');
    return cleanup;
  }
  listen(navigator.serviceWorker, 'controllerchange', () => {
    if (updateRequested && !reloading) {
      reloading = true;
      window.location.reload();
    }
  });
  notify();
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname })
    .then((value) => {
      if (disposed) return;
      registration = value;
      notifyUpdate();
      listen(registration, 'updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        listen(worker, 'statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) notifyUpdate();
          if (worker.state === 'redundant' && !ready) notify('離線題庫尚未下載完成，請確認網路後重新開啟。');
        });
      });
      return navigator.serviceWorker.ready;
    })
    .then((activeRegistration) => {
      if (disposed || !activeRegistration) return;
      ready = true;
      notify();
    })
    .catch(() => {
      if (!disposed) notify('暫時無法啟用離線功能，仍可在線上練習。');
    });
  return cleanup;
}

export async function requestInstall() {
  if (!installPrompt || installed()) return false;
  const prompt = installPrompt;
  installPrompt = null;
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    notify(choice.outcome === 'accepted' ? '已接受安裝，請依瀏覽器提示完成。' : undefined);
    return choice.outcome === 'accepted';
  } catch {
    notify('請使用瀏覽器選單中的安裝或加入主畫面功能。');
    return false;
  }
}

/** The caller must save any active session before requesting an update. */
export function applyUpdate() {
  if (!registration?.waiting) return false;
  updateRequested = true;
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}
