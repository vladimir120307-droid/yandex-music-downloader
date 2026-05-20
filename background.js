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
// ID3v2.3 TAG EMBEDDING
// ═══════════════════════════════════════

function buildID3(tags) {
  const enc = new TextEncoder();
  function makeFrame(id, text) {
    const body = enc.encode(text);
    const buf = new Uint8Array(4 + 4 + 2 + 1 + body.length);
    for (let i = 0; i < 4; i++) buf[i] = id.charCodeAt(i);
    const sz = 1 + body.length;
    buf[4] = (sz >> 24) & 0xff; buf[5] = (sz >> 16) & 0xff;
    buf[6] = (sz >> 8) & 0xff;  buf[7] = sz & 0xff;
    buf[10] = 3; // UTF-8 encoding
    buf.set(body, 11);
    return buf;
  }
  const frames = [];
  if (tags.title)       frames.push(makeFrame('TIT2', tags.title));
  if (tags.artist)      frames.push(makeFrame('TPE1', tags.artist));
  if (tags.album)       frames.push(makeFrame('TALB', tags.album));
  if (tags.trackNumber) frames.push(makeFrame('TRCK', String(tags.trackNumber)));
  if (!frames.length) return null;
  const sz = frames.reduce((s, f) => s + f.length, 0);
  const hdr = new Uint8Array([
    0x49, 0x44, 0x33, 0x03, 0x00, 0x00,  // "ID3" v2.3
    (sz >> 21) & 0x7f, (sz >> 14) & 0x7f, (sz >> 7) & 0x7f, sz & 0x7f, // synchsafe size
  ]);
  const out = new Uint8Array(hdr.length + sz);
  out.set(hdr);
  let off = hdr.length;
  for (const f of frames) { out.set(f, off); off += f.length; }
  return out;
}

// Fetches audio, prepends ID3 header, downloads via data URL.
// URL.createObjectURL is unavailable in MV3 service workers, so we use base64 data URL.
// Falls back to direct URL if fetch fails.
async function downloadWithTags(audioUrl, filename, tags, saveAs) {
  const id3 = (tags?.title || tags?.artist) ? buildID3(tags) : null;
  if (!id3) return chromeDownload(audioUrl, filename, saveAs);
  try {
    const resp = await fetch(audioUrl, {
      credentials: 'include',
      headers: { 'Referer': 'https://music.yandex.ru/' },
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const audio = await resp.arrayBuffer();
    const merged = new Uint8Array(id3.length + audio.byteLength);
    merged.set(id3);
    merged.set(new Uint8Array(audio), id3.length);
    // Encode to base64 in chunks to avoid max call stack errors on large files
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < merged.length; i += CHUNK) {
      binary += String.fromCharCode(...merged.subarray(i, i + CHUNK));
    }
    const dataUrl = 'data:audio/mpeg;base64,' + btoa(binary);
    return chromeDownload(dataUrl, filename, saveAs);
  } catch (e) {
    console.warn('[YMD] ID3 embed failed, fallback:', e.message);
    return chromeDownload(audioUrl, filename, saveAs);
  }
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
      const tags = { title: t.title, artist: t.artist, album: t.artist, trackNumber: t.trackNumber };
      const res = await downloadWithTags(audioUrl, fullName, tags, saveAs && !isBatch);
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
    const { url, filename = 'track.mp3', tags } = message;
    chrome.storage.local.get('saveAs', (data) => {
      const saveAs = !!data.saveAs;
      downloadWithTags(url, filename, tags, saveAs)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
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
