// Проверка новой версии на GitHub.
//
// Расширение ставится как распакованное, поэтому браузер сам его не обновляет,
// и люди месяцами сидят на версиях с давно исправленными багами. Раз в сутки
// спрашиваем у GitHub номер последнего релиза. Это обычный GET-запрос: токен,
// ссылки и история скачиваний никуда не передаются.
(function () {
  const API_URL = 'https://api.github.com/repos/vladimir120307-droid/yandex-music-downloader/releases/latest';
  const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
  const RETRY_AFTER_ERROR_MS = 60 * 60 * 1000;

  globalThis.YMD = globalThis.YMD || {};

  // Берём только первые три числа. Четвёртое — автоматическая пересборка
  // десктопа со свежим yt-dlp (v3.14.0.1): расширения она не касается.
  function parseVersion(v) {
    const parts = String(v || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  }

  function isNewer(latest, current) {
    const a = parseVersion(latest);
    const b = parseVersion(current);
    for (let i = 0; i < 3; i++) {
      if (a[i] !== b[i]) return a[i] > b[i];
    }
    return false;
  }

  function currentVersion() {
    return chrome.runtime.getManifest().version;
  }

  // Что показать пользователю: null, если обновляться не на что
  async function getAvailable() {
    const { ymdUpdate: u, ymdUpdateDismissed: dismissed } =
      await chrome.storage.local.get(['ymdUpdate', 'ymdUpdateDismissed']);
    if (!u || !u.version || !isNewer(u.version, currentVersion())) return null;
    return { ...u, dismissed: dismissed === u.version };
  }

  async function refreshBadge() {
    const u = await getAvailable();
    if (!u) return;
    chrome.action.setBadgeText({ text: u.dismissed ? '' : 'NEW' });
    chrome.action.setBadgeBackgroundColor({ color: '#ffdb4d' });
    chrome.action.setBadgeTextColor?.({ color: '#0d0d1a' });
  }

  async function dismiss() {
    const u = await getAvailable();
    if (u) await chrome.storage.local.set({ ymdUpdateDismissed: u.version });
    await refreshBadge();
  }

  async function check(force) {
    const { ymdUpdate: saved } = await chrome.storage.local.get('ymdUpdate');
    if (!force && saved && Date.now() - saved.checkedAt < CHECK_EVERY_MS) return refreshBadge();
    try {
      const r = await fetch(API_URL, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const release = await r.json();
      const zip = (release.assets || []).find(a => /\.zip$/i.test(a.name));
      await chrome.storage.local.set({
        ymdUpdate: {
          checkedAt: Date.now(),
          version: parseVersion(release.tag_name).join('.'),
          url: zip ? zip.browser_download_url : release.html_url,
        },
      });
    } catch (e) {
      // Нет сети или исчерпан лимит GitHub — повторим через час, а не через сутки
      console.warn('[YMD] update check failed:', e.message);
      await chrome.storage.local.set({
        ymdUpdate: { ...(saved || {}), checkedAt: Date.now() - CHECK_EVERY_MS + RETRY_AFTER_ERROR_MS },
      });
    }
    return refreshBadge();
  }

  globalThis.YMD.update = { isNewer, check, dismiss, getAvailable, refreshBadge, currentVersion };
})();
