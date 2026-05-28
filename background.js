// Yandex Music Downloader — Background Service Worker v3.0
// Cross-service download coordinator

importScripts(
  'lib/md5.js',
  'lib/core.js',
  'services/yandex.js',
  'services/bandcamp.js',
  'services/soundcloud.js',
);

// ═══════════════════════════════════════
// YANDEX AUDIO CAPTURE (webRequest)
// ═══════════════════════════════════════

const capturedAudio = {};

const AUDIO_PATTERNS = ['/get-mp3/', '/get-music-mp3/', '/rmusic/', '/music/'];
const AUDIO_TYPES = ['media', 'xmlhttprequest', 'other'];

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    const isAudio = AUDIO_PATTERNS.some(p => url.includes(p)) ||
      url.match(/\.(mp3|aac|m4a|opus|ogg)(\?|$)/i) ||
      (url.includes('storage.mds.yandex.net') && AUDIO_TYPES.includes(details.type));
    if (!isAudio) return;
    const tabId = details.tabId;
    if (tabId < 0) return;
    if (!capturedAudio[tabId]) capturedAudio[tabId] = [];
    capturedAudio[tabId].unshift({ url, timestamp: Date.now() });
    if (capturedAudio[tabId].length > 20) capturedAudio[tabId] = capturedAudio[tabId].slice(0, 20);
  },
  { urls: ['*://*.storage.mds.yandex.net/*', '*://storage.mds.yandex.net/*', '*://*.strm.yandex.net/*'], types: ['media', 'xmlhttprequest', 'other'] }
);

chrome.tabs.onRemoved.addListener((tabId) => { delete capturedAudio[tabId]; });

// ═══════════════════════════════════════
// DOWNLOAD HELPERS
// ═══════════════════════════════════════

function chromeDownload(url, filename, saveAs) {
  return new Promise((resolve) => {
    chrome.downloads.download({ url, filename, saveAs: !!saveAs }, (downloadId) => {
      if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
      else resolve({ success: true, downloadId });
    });
  });
}

function getSaveAs() {
  return new Promise(resolve => chrome.storage.local.get('saveAs', d => resolve(!!d.saveAs)));
}

// ═══════════════════════════════════════
// PASTE-LINK FLOW (cross-service)
// ═══════════════════════════════════════

function pushProgress(payload) {
  chrome.runtime.sendMessage({ action: 'pasteProgress', ...payload }).catch(() => {});
}

async function downloadByUrl(rawUrl) {
  const detected = globalThis.YMD.registry.detectByUrl(rawUrl);
  if (!detected) {
    pushProgress({ status: 'error', message: 'Сервис не распознан. Проверьте ссылку.' });
    return { success: false, error: 'Сервис не распознан' };
  }
  const { service, parsed } = detected;
  pushProgress({ status: 'starting', service: service.displayName, type: parsed.type });

  let tracks;
  try {
    tracks = await service.listTracks(parsed);
  } catch (err) {
    pushProgress({ status: 'error', message: 'Не удалось получить треки: ' + err.message });
    return { success: false, error: err.message };
  }

  if (!tracks?.length) {
    pushProgress({ status: 'error', message: 'Треки не найдены' });
    return { success: false, error: 'Треки не найдены' };
  }

  const saveAs = await getSaveAs();
  const folder = service.name; // subfolder per service for batch downloads
  let downloaded = 0;
  const isBatch = tracks.length > 1;

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const labelTitle = (t.artist && t.title) ? `${t.artist} - ${t.title}` : (t.title || `track ${i + 1}`);
    pushProgress({ status: 'progress', current: i + 1, total: tracks.length, title: labelTitle });
    try {
      const audioUrl = await service.getAudioUrl(t, {});
      if (!audioUrl) throw new Error('audio URL пустой');
      const filename = service.getFilename(t) || `track.mp3`;
      const fullName = isBatch ? `${folder}/${filename}` : filename;
      const res = await chromeDownload(audioUrl, fullName, saveAs && !isBatch);
      if (res.success) downloaded++;
      else console.warn('[YMD] download failed:', res.error);
    } catch (err) {
      console.warn('[YMD] track failed:', err);
    }
    if (i < tracks.length - 1) await globalThis.YMD.utils.sleep(400);
  }
  pushProgress({ status: 'done', downloaded, total: tracks.length });
  return { success: true, downloaded, total: tracks.length };
}

// ═══════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getCapturedAudio') {
    const tabId = message.tabId || sender.tab?.id;
    const urls = capturedAudio[tabId] || [];
    const fresh = urls.filter(u => Date.now() - u.timestamp < 5 * 60 * 1000);
    if (fresh.length > 0) sendResponse({ success: true, url: fresh[0].url, count: fresh.length });
    else sendResponse({ success: false, error: 'Нет перехваченных URL. Переключите трек.' });
    return true;
  }

  if (message.action === 'download') {
    const url = message.url;
    const filename = message.filename || 'track.mp3';
    chrome.storage.local.get('saveAs', (data) => {
      const saveAs = !!data.saveAs;
      chrome.downloads.download({ url, filename, saveAs }, (downloadId) => {
        if (chrome.runtime.lastError) {
          if (saveAs) {
            chrome.downloads.download({ url, saveAs: true }, (id2) => {
              if (chrome.runtime.lastError) sendResponse({ success: false, error: chrome.runtime.lastError.message });
              else sendResponse({ success: true, downloadId: id2 });
            });
          } else sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else sendResponse({ success: true, downloadId });
      });
    });
    return true;
  }

  if (message.action === 'getCurrentTrack') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (!tab?.url?.includes('music.yandex')) { sendResponse({ success: false, error: 'Откройте music.yandex' }); return; }
      chrome.tabs.sendMessage(tab.id, { action: 'getPlayerInfo' }, (resp) => {
        if (chrome.runtime.lastError) sendResponse({ success: false, error: 'Перезагрузите страницу (F5)' });
        else sendResponse(resp || { success: false });
      });
    });
    return true;
  }

  if (message.action === 'dlCurrentTrack') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (!tab?.url?.includes('music.yandex')) { sendResponse({ success: false, error: 'Откройте music.yandex' }); return; }
      chrome.tabs.sendMessage(tab.id, { action: 'dlCurrentTrack' }, (resp) => {
        if (chrome.runtime.lastError) sendResponse({ success: false, error: 'Перезагрузите страницу (F5)' });
        else sendResponse(resp || { success: false });
      });
    });
    return true;
  }

  if (message.action === 'grabYamToken') {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ token: null, error: 'no tab' }); return true; }
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const TOKEN_RE = /^[A-Za-z0-9_\-]{30,}$/;
        const KEY_RE = /token|oauth|access|bearer/i;
        const looksLikeToken = (v) => typeof v === 'string' && TOKEN_RE.test(v);
        function deepFind(obj, depth) {
          if (depth > 8 || !obj || typeof obj !== 'object') return null;
          for (const key in obj) {
            try {
              const val = obj[key];
              if (looksLikeToken(val) && KEY_RE.test(key)) return val;
              if (val && typeof val === 'object') {
                const r = deepFind(val, depth + 1);
                if (r) return r;
              }
            } catch {}
          }
          return null;
        }
        let token = null, source = '';
        try {
          const snaps = window.__STATE_SNAPSHOT__;
          if (Array.isArray(snaps)) {
            for (const s of snaps) {
              const v = deepFind(s, 0);
              if (v) { token = v; source = '__STATE_SNAPSHOT__'; break; }
            }
          } else if (snaps && typeof snaps === 'object') {
            token = deepFind(snaps, 0);
            if (token) source = '__STATE_SNAPSHOT__';
          }
        } catch {}
        if (!token) {
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (!k || !KEY_RE.test(k)) continue;
              const v = localStorage.getItem(k);
              if (looksLikeToken(v)) { token = v; source = 'localStorage:' + k; break; }
              try {
                const parsed = JSON.parse(v);
                const r = deepFind(parsed, 0);
                if (r) { token = r; source = 'localStorage:' + k + ' (json)'; break; }
              } catch {}
            }
          } catch {}
        }
        if (!token) {
          try {
            for (let i = 0; i < sessionStorage.length; i++) {
              const k = sessionStorage.key(i);
              if (!k || !KEY_RE.test(k)) continue;
              const v = sessionStorage.getItem(k);
              if (looksLikeToken(v)) { token = v; source = 'sessionStorage:' + k; break; }
            }
          } catch {}
        }
        return { token, source };
      },
    }, (results) => {
      const result = results?.[0]?.result || { token: null, source: '' };
      if (result.token) {
        chrome.storage.local.set({
          yamToken: result.token,
          yamTokenSource: result.source,
          yamTokenAt: Date.now(),
        });
      }
      sendResponse(result);
    });
    return true;
  }

  if (message.action === 'detectUrl') {
    const detected = globalThis.YMD.registry.detectByUrl(message.url);
    sendResponse(detected ? {
      success: true,
      service: detected.service.name,
      displayName: detected.service.displayName,
      type: detected.parsed.type,
    } : { success: false });
    return true;
  }

  if (message.action === 'pasteDownload') {
    downloadByUrl(message.url).then(r => sendResponse(r)).catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }
});
