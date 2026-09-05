// Yandex Music Downloader — Background Service Worker v3.0
// Cross-service download coordinator

importScripts(
  'lib/md5.js',
  'lib/core.js',
  'lib/id3.js',
  'lib/mp4cover.js',
  'lib/flacremux.js',
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

// ═══ СТРАХОВКА ИМЕНИ ФАЙЛА (issue #47) ═══
// Некоторые Chromium-сборки (напр. Яндекс.Браузер) игнорируют filename при
// скачивании blob:/data: URL и сохраняют файл как «Загруженное» без расширения.
// Перехватываем определение имени и подставляем своё.
const expectedNames = [];

function pushExpectedName(name) {
  if (!name) return;
  expectedNames.push(name);
  if (expectedNames.length > 30) expectedNames.shift();
}

try {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    // Трогаем только свои загрузки
    if (item.byExtensionId && item.byExtensionId !== chrome.runtime.id) { suggest(); return; }
    const cur = item.filename || '';
    const hasExt = /\.[a-z0-9]{2,5}$/i.test(cur);
    if (!hasExt && expectedNames.length) {
      const name = expectedNames.shift();
      console.log('[YMD] filename fallback:', cur || '(пусто)', '->', name);
      suggest({ filename: name });
      return;
    }
    if (expectedNames.length) expectedNames.shift();
    suggest();
  });
} catch (e) {
  console.warn('[YMD] onDeterminingFilename недоступен:', e && e.message);
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
// fetch с таймаутом — иначе зависший хост держит кнопку в loading навсегда
async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 90000);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function downloadAndTag(opts) {
  const r = await fetchWithTimeout(opts.url, { credentials: 'omit' }, 120000);
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
  let realContainer = detectContainer(bytes);  // 'flac' | 'm4a' | 'mp3' | 'unknown'
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
      const cr = await fetchWithTimeout(coverUrl, { credentials: 'omit' }, 30000);
      if (cr.ok) {
        coverBytes = new Uint8Array(await cr.arrayBuffer());
        debug.coverBytes = coverBytes.length;
        console.log('[YMD] cover fetched:', coverBytes.length, 'bytes');
      } else { debug.coverError = 'HTTP ' + cr.status; }
    } catch (e) { debug.coverError = e.message; console.warn('[YMD] cover fetch failed:', e.message); }
  }

  // MP3 → ID3v2 APIC
  if (realContainer === 'mp3' && (coverBytes || opts.title || opts.artist || opts.album || opts.lyrics)) {
    try {
      const tag = globalThis.YMD_ID3.buildID3v2({
        title: opts.title, artist: opts.artist, album: opts.album, albumArtist: opts.albumArtist,
        year: opts.year, genre: opts.genre, trackNum: opts.trackNum, trackTotal: opts.trackTotal,
        discNum: opts.discNum, lyrics: opts.lyrics, cover: coverBytes, coverMime: 'image/jpeg',
      });
      bytes = globalThis.YMD_ID3.prependID3v2ToMP3(bytes, tag);
      debug.tagged = true;
      console.log('[YMD] ID3 embedded');
    } catch (e) { debug.tagError = e.message; console.warn('[YMD] ID3 embed failed:', e.message); }
  }

  // M4A контейнер. Если это FLAC-в-MP4 и юзер выбрал нативный .flac —
  // ремуксим в браузере (без ffmpeg) с тегами+обложкой. Иначе оставляем .m4a
  // и добавляем covr atom.
  if (realContainer === 'm4a') {
    const tagOpts = {
      title: opts.title, artist: opts.artist, album: opts.album, albumArtist: opts.albumArtist,
      year: opts.year, genre: opts.genre, trackNum: opts.trackNum, trackTotal: opts.trackTotal,
      discNum: opts.discNum, lyrics: opts.lyrics, cover: coverBytes, coverMime: 'image/jpeg',
    };
    let remuxed = false;
    if (opts.flacNative) {
      try {
        // remux бросит если внутри не FLAC (например AAC) — тогда фолбэк на m4a
        bytes = globalThis.YMD_FLACREMUX.remux(bytes, tagOpts);
        realContainer = 'flac';
        opts.filename = (opts.filename || 'track').replace(/\.[^.\/]+$/, '') + '.flac';
        debug.filename = opts.filename;
        debug.tagged = true;
        debug.remuxed = true;
        remuxed = true;
        console.log('[YMD] FLAC-в-MP4 → нативный .flac (JS remux) + теги/обложка');
      } catch (e) {
        debug.remuxError = e.message;
        console.warn('[YMD] flac remux skip (не FLAC или ошибка):', e.message);
      }
    }
    if (!remuxed && (coverBytes || opts.title || opts.artist || opts.album || opts.lyrics)) {
      try {
        bytes = globalThis.YMD_MP4.addCoverToMp4(bytes, tagOpts);
        debug.tagged = true;
        console.log('[YMD] MP4 covr embedded');
      } catch (e) { debug.tagError = e.message; console.warn('[YMD] MP4 covr failed (сохранён без обложки):', e.message); }
    }
  }

  // Имя файла: подстраховка на случай пустого/слишком длинного (Windows ~255).
  opts.filename = safeFilename(opts.filename, realContainer);
  debug.filename = opts.filename;
  const mime = mimeForContainer(realContainer);

  // ПУТЬ 1 (основной): data: URL. Здесь filename применяется надёжно во всех
  // Chromium-браузерах. Blob-URL из offscreen некоторые сборки (Я.Браузер)
  // сохраняют как «Загруженное» без расширения — см. issue #47.
  pushExpectedName(opts.filename);
  try {
    const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
    const id = await new Promise((resolve, reject) => {
      chrome.downloads.download({ url: dataUrl, filename: opts.filename, saveAs: !!opts.saveAs }, (downloadId) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(downloadId);
      });
    });
    debug.via = 'data-url';
    return { ok: true, downloadId: id, size: bytes.length, debug };
  } catch (e) {
    console.warn('[YMD] data URL failed, fallback to offscreen blob:', e.message);
    debug.dataUrlError = e.message;
  }

  // ПУТЬ 2 (фолбэк): blob через offscreen — на случай если файл слишком
  // большой для data: URL.
  const blobId = 'ymd-' + (++blobCounter);
  const url = await makeBlobUrlViaOffscreen(blobId, bytes, mime);
  const id = await new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename: opts.filename, saveAs: !!opts.saveAs }, (downloadId) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(downloadId);
    });
  });
  revokeBlobUrlLater(blobId, id);
  debug.via = 'offscreen-blob';
  return { ok: true, downloadId: id, size: bytes.length, debug };
}

// base64 из байтов чанками (String.fromCharCode.apply падает на больших массивах)
function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Правильный MIME помогает браузеру определить тип и не терять расширение
function mimeForContainer(container) {
  switch (container) {
    case 'mp3': return 'audio/mpeg';
    case 'flac': return 'audio/flac';
    case 'm4a': return 'audio/mp4';
    default: return 'application/octet-stream';
  }
}

// Гарантируем непустое, валидное и не слишком длинное имя с расширением
function safeFilename(name, container) {
  const ext = (container && container !== 'unknown') ? container : 'mp3';
  let n = String(name || '').trim();
  // запрещённые в Windows символы + control-символы
  n = n.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/\\/g, '_');
  // оставляем только последний сегмент пути (папка допустима для batch)
  const parts = n.split('/').filter(Boolean).map(p => p.trim()).filter(Boolean);
  if (!parts.length) return `track.${ext}`;
  let base = parts.pop();
  if (!base || base === '.' || base === '..') base = `track.${ext}`;
  // ограничиваем длину имени (Windows: путь ≤255)
  const dot = base.lastIndexOf('.');
  let stem = dot > 0 ? base.slice(0, dot) : base;
  let e = dot > 0 ? base.slice(dot + 1) : '';
  if (!e) e = ext;
  if (stem.length > 120) stem = stem.slice(0, 120).trim();
  if (!stem) stem = 'track';
  base = `${stem}.${e}`;
  return parts.length ? `${parts.join('/')}/${base}` : base;
}

// ─────────────────────── OFFSCREEN BLOB HELPER ───────────────────────
let blobCounter = 0;

async function ensureOffscreen() {
  // hasDocument есть не во всех версиях — пробуем, иначе ловим "already exists"
  try {
    if (chrome.offscreen.hasDocument) {
      const has = await chrome.offscreen.hasDocument();
      if (has) return;
    }
  } catch {}
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Создание blob: URL для сохранения больших аудио-файлов (FLAC).',
    });
  } catch (e) {
    // "Only a single offscreen document may be created" — значит уже есть, ок.
    if (!/single offscreen|already/i.test(e.message || '')) throw e;
  }
}

async function makeBlobUrlViaOffscreen(id, bytes, mime) {
  if (!chrome.offscreen) throw new Error('offscreen API недоступен');
  await ensureOffscreen();
  const resp = await chrome.runtime.sendMessage({
    target: 'offscreen', action: 'makeBlobUrl', id, bytes, mime,
  });
  if (!resp || !resp.ok) throw new Error(resp?.error || 'makeBlobUrl failed');
  return resp.url;
}

function revokeBlobUrlLater(id, downloadId) {
  let done = false;
  const cleanup = () => {
    if (done) return; done = true;
    chrome.downloads.onChanged.removeListener(onChanged);
    chrome.runtime.sendMessage({ target: 'offscreen', action: 'revokeBlobUrl', id }).catch(() => {});
  };
  const onChanged = (delta) => {
    if (delta.id === downloadId && delta.state &&
        (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
      cleanup();
    }
  };
  chrome.downloads.onChanged.addListener(onChanged);
  // Страховка: revoke + снять listener через 5 минут в любом случае
  setTimeout(cleanup, 5 * 60 * 1000);
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
  const flacNative = await new Promise(r => chrome.storage.local.get('yamFlacNative', d => r(d?.yamFlacNative !== false)));
  const wantLyrics = await new Promise(r => chrome.storage.local.get('yamLyrics', d => r(!!(d && d.yamLyrics))));
  const folder = service.name; // subfolder per service for batch downloads
  let downloaded = 0;
  const isBatch = tracks.length > 1;

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const labelTitle = (t.artist && t.title) ? `${t.artist} - ${t.title}` : (t.title || `track ${i + 1}`);
    pushProgress({ status: 'progress', current: i + 1, total: tracks.length, title: labelTitle });
    try {
      // Текст песни (если включено и сервис Я.Музыка)
      if (wantLyrics && service.name === 'yandex' && service.fetchLyrics && !t.lyrics) {
        try { t.lyrics = await service.fetchLyrics(t.trackId); } catch {}
      }
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
          albumArtist: t.albumArtist || '',
          year: t.year || '',
          genre: t.genre || '',
          trackNum: t.trackNum || 0,
          trackTotal: t.trackTotal || 0,
          discNum: t.discNum || 0,
          lyrics: t.lyrics || '',
          flacNative,
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
      albumArtist: message.albumArtist,
      year: message.year,
      genre: message.genre,
      trackNum: message.trackNum,
      trackTotal: message.trackTotal,
      discNum: message.discNum,
      lyrics: message.lyrics,
      flacNative: !!message.flacNative,
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
