// Yandex Music Downloader — Background Service Worker v3.0
// Cross-service download coordinator

importScripts(
  'lib/md5.js',
  'lib/core.js',
  'lib/id3.js',
  'lib/mp4cover.js',
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
      ((url.includes('storage.mds.yandex.net') || url.includes('storage.yandex.net')) && AUDIO_TYPES.includes(details.type));
    if (!isAudio) return;
    const tabId = details.tabId;
    if (tabId < 0) return;
    if (!capturedAudio[tabId]) capturedAudio[tabId] = [];
    capturedAudio[tabId].unshift({ url, timestamp: Date.now() });
    if (capturedAudio[tabId].length > 20) capturedAudio[tabId] = capturedAudio[tabId].slice(0, 20);
  },
  {
    urls: [
      '*://*.storage.mds.yandex.net/*',
      '*://storage.mds.yandex.net/*',
      '*://*.strm.yandex.net/*',
      '*://*.storage.yandex.net/*',
      '*://storage.yandex.net/*',
    ],
    types: ['media', 'xmlhttprequest', 'other'],
  }
);

chrome.tabs.onRemoved.addListener((tabId) => { delete capturedAudio[tabId]; });

// ═══════════════════════════════════════
// YANDEX MUSIC TOKEN — AUTO-CAPTURE FROM OAuth REDIRECT
// ═══════════════════════════════════════
// Когда юзер делает OAuth-флоу (через кнопку «Получить токен» в попапе),
// после авторизации браузер редиректит на URL вида
// <callback>#access_token=XXX&token_type=bearer&expires_in=...
// Часто эта страница быстро редиректит дальше и юзер не успевает скопировать.
// Этот listener ловит URL ЛЮБОЙ вкладки в момент когда там появляется
// access_token в hash/query, и сохраняет токен автоматически.

const TOKEN_RE = /[#&?]access_token=([A-Za-z0-9_.\-]+)/;

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || (tab && tab.url) || '';
  if (!url) return;
  const m = url.match(TOKEN_RE);
  if (!m) return;
  const token = m[1];
  if (!token || token.length < 20) return;

  chrome.storage.local.get(['yamToken'], (cur) => {
    if (cur && cur.yamToken === token) return; // already saved
    chrome.storage.local.set({
      yamToken: token,
      yamTokenSource: 'oauth-redirect',
      yamTokenAt: Date.now(),
    }, () => {
      // Бейдж на иконке расширения
      try {
        chrome.action.setBadgeText({ text: '✓' });
        chrome.action.setBadgeBackgroundColor({ color: '#4caf50' });
        setTimeout(() => { try { chrome.action.setBadgeText({ text: '' }); } catch {} }, 6000);
      } catch {}
      console.log('[YMD] auto-captured Yandex Music token from OAuth redirect');
    });
  });
});

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

// Универсальная скачка + опциональная расшифровка + ID3-тэги.
//
// MV3 service worker НЕ имеет URL.createObjectURL, поэтому сохраняем через
// data: URL с base64.
//
// opts:
//   url       — audio URL (зашифрованный если key, иначе прямой)
//   key       — опц., hex-ключ AES-CTR для расшифровки
//   codec     — 'mp3'/'flac'/...; для mp3 встраивается ID3v2 APIC
//   filename  — имя файла для chrome.downloads
//   coverUri  — опц., 'avatars.yandex.net/.../%%' — заберём cover отсюда
//   title/artist/album/year — для ID3 тэгов
//   saveAs    — bool
async function downloadAndTag(opts) {
  const r = await fetch(opts.url, { credentials: 'omit' });
  if (!r.ok) throw new Error(`fetch audio ${r.status}`);
  let bytes = new Uint8Array(await r.arrayBuffer());

  // Расшифровка AES-CTR (V2 path Я.Музыки)
  if (opts.key) {
    const keyBytes = new Uint8Array(opts.key.length / 2);
    for (let i = 0; i < keyBytes.length; i++) {
      keyBytes[i] = parseInt(opts.key.substr(i * 2, 2), 16);
    }
    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'AES-CTR' }, false, ['decrypt']
    );
    const counter = new Uint8Array(16);
    const decryptedBuf = await crypto.subtle.decrypt(
      { name: 'AES-CTR', counter, length: 32 }, cryptoKey, bytes
    );
    bytes = new Uint8Array(decryptedBuf);
  }

  // Определяем РЕАЛЬНЫЙ контейнер по магическим байтам — поле codec из API
  // ненадёжно (Яндекс зовёт flac-mp4 «flac», но это MP4-контейнер, не нативный
  // FLAC). Сохранять MP4 как .flac → FLAC-декодеры выдают LOST_SYNC / "Not a flac".
  const realContainer = detectContainer(bytes);  // 'flac' | 'm4a' | 'mp3' | 'unknown'
  const debug = { codec: opts.codec || '', container: realContainer, coverUri: opts.coverUri || '', coverBytes: 0, tagged: false };

  // Чиним расширение файла под реальный контейнер
  if (realContainer !== 'unknown') {
    const wantExt = realContainer;  // flac/m4a/mp3
    opts.filename = (opts.filename || 'track').replace(/\.[^.\/]+$/, '') + '.' + wantExt;
    debug.filename = opts.filename;
  }

  // Скачиваем обложку (для всех контейнеров)
  let coverBytes = null;
  if (opts.coverUri && (realContainer === 'mp3' || realContainer === 'm4a')) {
    try {
      const coverUrl = coverUriToHttps(opts.coverUri, '600x600');
      const cr = await fetch(coverUrl, { credentials: 'omit' });
      if (cr.ok) {
        coverBytes = new Uint8Array(await cr.arrayBuffer());
        debug.coverBytes = coverBytes.length;
        console.log('[YMD] cover fetched:', coverBytes.length, 'bytes');
      } else { debug.coverError = 'HTTP ' + cr.status; }
    } catch (e) { debug.coverError = e.message; console.warn('[YMD] cover fetch failed:', e.message); }
  }

  // MP3 → ID3v2 APIC
  if (realContainer === 'mp3' && (coverBytes || opts.title || opts.artist || opts.album)) {
    try {
      const tag = globalThis.YMD_ID3.buildID3v2({
        title: opts.title, artist: opts.artist, album: opts.album,
        year: opts.year, cover: coverBytes, coverMime: 'image/jpeg',
      });
      bytes = globalThis.YMD_ID3.prependID3v2ToMP3(bytes, tag);
      debug.tagged = true;
      console.log('[YMD] ID3 embedded');
    } catch (e) { debug.tagError = e.message; console.warn('[YMD] ID3 embed failed:', e.message); }
  }

  // M4A/MP4 (включая FLAC-в-MP4) → covr atom. Фолбэк: при ошибке оставляем
  // оригинальные байты (файл не бьётся, просто без обложки).
  if (realContainer === 'm4a' && (coverBytes || opts.title || opts.artist || opts.album)) {
    try {
      bytes = globalThis.YMD_MP4.addCoverToMp4(bytes, {
        title: opts.title, artist: opts.artist, album: opts.album, year: opts.year,
        cover: coverBytes, coverMime: 'image/jpeg',
      });
      debug.tagged = true;
      console.log('[YMD] MP4 covr embedded');
    } catch (e) { debug.tagError = e.message; console.warn('[YMD] MP4 covr failed (файл сохранён без обложки):', e.message); }
  }

  // base64 → data URL → chrome.downloads
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  const dataUrl = `data:application/octet-stream;base64,${base64}`;

  return new Promise(resolve => {
    chrome.downloads.download({ url: dataUrl, filename: opts.filename, saveAs: !!opts.saveAs }, (id) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message, debug });
      else resolve({ ok: true, downloadId: id, size: bytes.length, debug });
    });
  });
}

// Определение реального аудио-контейнера по магическим байтам.
function detectContainer(bytes) {
  if (!bytes || bytes.length < 12) return 'unknown';
  // fLaC — нативный FLAC
  if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) return 'flac';
  // ....ftyp — MP4/M4A контейнер (offset 4)
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'm4a';
  // ID3 tag — mp3
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'mp3';
  // MPEG audio frame sync (0xFFEx/0xFFFx) — mp3 без ID3
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3';
  return 'unknown';
}

function coverUriToHttps(uri, size = '600x600') {
  if (!uri) return null;
  if (!uri.startsWith('http')) uri = 'https://' + uri;
  return uri.replace('%%', size);
}

// Backward-compat alias — старый код где-то ещё может звать decryptAndDownload
async function decryptAndDownload(url, key, filename, saveAs) {
  return await downloadAndTag({ url, key, filename, saveAs });
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
      const result = await service.getAudioUrl(t, {});
      if (!result) throw new Error('audio URL пустой');
      const filename = service.getFilename(t) || `track.mp3`;
      const fullName = isBatch ? `${folder}/${filename}` : filename;

      // Унификация: всегда идём через downloadAndTag (он вшивает ID3/cover
      // если codec=mp3 и есть coverUri). Для Bandcamp/SoundCloud где codec
      // не указан — просто save через data URL без тегов.
      const audioUrl = typeof result === 'string' ? result : result.url;
      const encryptedKey = (typeof result === 'object') ? result.key : null;
      const codecVal = (typeof result === 'object' && result.codec) ? result.codec : (t._codec || '');
      let res;
      if (encryptedKey || (service.name === 'yandex' && t.coverUri)) {
        const dl = await downloadAndTag({
          url: audioUrl,
          key: encryptedKey,
          codec: codecVal,
          filename: fullName,
          coverUri: t.coverUri || '',
          title: t.title || '',
          artist: t.artist || '',
          album: t.album || '',
          year: t.year || '',
          saveAs: saveAs && !isBatch,
        });
        res = { success: dl.ok, error: dl.error };
      } else {
        res = await chromeDownload(audioUrl, fullName, saveAs && !isBatch);
      }
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

  if (message.action === 'downloadEncrypted' || message.action === 'downloadAndTag') {
    downloadAndTag({
      url: message.url,
      key: message.key,
      codec: message.codec,
      filename: message.filename,
      coverUri: message.coverUri,
      title: message.title,
      artist: message.artist,
      album: message.album,
      year: message.year,
      saveAs: !!message.saveAs,
    })
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message.action === 'corsProxyFetch') {
    // Кросс-доменный fetch из background (host_permissions обходят CORS).
    // Используется для storage.mds.yandex.net и подобных хостов которые не дают CORS.
    const url = message.url;
    const headers = message.headers || {};
    fetch(url, { headers })
      .then(async (r) => {
        const body = await r.text();
        if (!r.ok) sendResponse({ ok: false, error: `HTTP ${r.status}`, status: r.status, body });
        else sendResponse({ ok: true, status: r.status, body });
      })
      .catch(e => sendResponse({ ok: false, error: e.message || String(e) }));
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
