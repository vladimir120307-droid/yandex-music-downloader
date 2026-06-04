// Yandex Music Downloader — Content Script v3.0
// In-page UI for music.yandex.* (FAB, track buttons, page-level batch button)

(function () {
  'use strict';

  const DOWNLOAD_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
  const PROCESSED = 'data-ymd-done';
  const ORIGIN = window.location.origin;

  const yandex = globalThis.YMD?.registry?.get('yandex');
  if (!yandex) { console.error('[YMD] Yandex adapter not loaded'); return; }

  const sanitize = globalThis.YMD.utils.sanitize;
  const sleep = globalThis.YMD.utils.sleep;

  // ═══════════════════════════════════════
  // DOM SCRAPING
  // ═══════════════════════════════════════

  function getCurrentPlayerInfo() {
    let trackId = null, albumId = null, title = '', artist = '';
    const linkSelectors = [
      '[class*="PlayerBarDesktop"] a[href*="/track/"]',
      '[class*="PlayerBar"] a[href*="/track/"]',
      '.player-controls a[href*="/track/"]',
    ];
    for (const sel of linkSelectors) {
      for (const link of document.querySelectorAll(sel)) {
        const href = link.getAttribute('href') || '';
        const m1 = href.match(/\/album\/(\d+)\/track\/(\d+)/);
        if (m1) { albumId = m1[1]; trackId = m1[2]; break; }
        const m2 = href.match(/\/track\/(\d+)/);
        if (m2) { trackId = m2[1]; break; }
      }
      if (trackId) break;
    }
    for (const sel of ['[class*="PlayerBarDesktop"]', '[class*="PlayerBar"]', '.player-controls']) {
      const c = document.querySelector(sel);
      if (!c) continue;
      const t = c.querySelector('[class*="Meta_title"], a[class*="title"]');
      const a = c.querySelector('[class*="Meta_artist"], [class*="artist"]');
      if (t) title = t.textContent.trim();
      if (a) artist = a.textContent.trim();
      if (title) break;
    }
    return { trackId, albumId, title, artist };
  }

  function extractTrackInfo(el) {
    const link = el.querySelector('a[href*="/track/"]');
    if (!link) return null;
    const href = link.getAttribute('href') || '';
    let m = href.match(/\/album\/(\d+)\/track\/(\d+)/);
    if (m) return { trackId: m[2], albumId: m[1] };
    m = href.match(/\/track\/(\d+)/);
    if (m) return { trackId: m[1], albumId: null };
    return null;
  }

  function extractTrackTitle(el) {
    const t = el.querySelector('[class*="Meta_title"], .d-track__title');
    const a = el.querySelector('[class*="Meta_artist"], .d-track__artists');
    return { title: t?.textContent?.trim() || '', artist: a?.textContent?.trim() || '' };
  }

  function parseCurrentUrl() {
    const p = window.location.pathname;
    let m = p.match(/\/album\/(\d+)\/track\/(\d+)/);
    if (m) return { type: 'track', albumId: m[1], trackId: m[2] };
    m = p.match(/\/album\/(\d+)/);
    if (m) return { type: 'album', albumId: m[1] };
    m = p.match(/\/users\/([^/]+)\/playlists\/(\d+)/);
    if (m) return { type: 'playlist', owner: m[1], kinds: m[2] };
    // Новый формат: /playlists/{uuid} (в т.ч. с префиксом lk./dm.)
    m = p.match(/\/playlists\/((?:[a-z]{1,4}\.)?[a-f0-9-]{32,40})/i);
    if (m) return { type: 'playlist', uuid: m[1] };
    return null;
  }

  // ═══════════════════════════════════════
  // AUDIO URL RESOLUTION (via Yandex adapter)
  // ═══════════════════════════════════════

  function getCapturedAudio() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'getCapturedAudio' }, resp => {
        resolve(resp?.success ? resp.url : null);
      });
    });
  }

  // ═══════════════════════════════════════
  // DOWNLOAD
  // ═══════════════════════════════════════

  async function downloadFile(url, filename) {
    console.log('[YMD] Download:', url.substring(0, 80), '→', filename);
    showNotification('Скачиваю: ' + filename, 'loading');
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'download', url, filename }, resp => {
        if (resp?.success) { resolve({ success: true, filename }); return; }
        // Fallback: fetch + blob (works for CORS-friendly URLs)
        fetch(url)
          .then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
          .then(blob => {
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl; a.download = filename; a.style.display = 'none';
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(blobUrl); a.remove(); }, 3000);
            resolve({ success: true, filename });
          })
          .catch(() => { window.open(url, '_blank'); resolve({ success: true, filename }); });
      });
    });
  }

  async function dispatchDownload(result, filename, track, dlOpts) {
    // result либо строка (прямой URL), либо {url, key, encrypted} для AES-CTR.
    // track содержит {trackId, title, artist, album, coverUri, _codec, ...} —
    // прокидываем в background чтобы вшил ID3v2+обложку (для MP3).
    const url = typeof result === 'string' ? result : result?.url;
    const key = (typeof result === 'object') ? result.key : null;
    if (!url) return { success: false, error: 'нет URL' };

    const prefs = await new Promise(r => {
      try { chrome.storage.local.get(['yamFlacNative', 'saveAs'], d => r(d || {})); }
      catch { r({}); }
    });
    const flacNative = prefs.yamFlacNative !== false;
    // saveAs только для одиночных скачиваний — в batch диалог на каждый трек не нужен
    const saveAs = !!prefs.saveAs && !(dlOpts && dlOpts.batch);

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'downloadAndTag',
        url, key, filename,
        codec: (track && track._codec) || (result && result.codec) || '',
        coverUri: (track && track.coverUri) || '',
        title: (track && track.title) || '',
        artist: (track && track.artist) || '',
        album: (track && track.album) || '',
        albumArtist: (track && track.albumArtist) || '',
        year: (track && track.year) || '',
        genre: (track && track.genre) || '',
        trackNum: (track && track.trackNum) || 0,
        trackTotal: (track && track.trackTotal) || 0,
        discNum: (track && track.discNum) || 0,
        lyrics: (track && track.lyrics) || '',
        flacNative,
        saveAs,
      }, (resp) => {
        if (resp?.debug) {
          const d = resp.debug;
          console.log('[YMD] tag debug — codec:', d.codec, '| container:', d.container,
            '| remuxed:', d.remuxed, '| via:', d.via, '| filename:', d.filename,
            '| coverBytes:', d.coverBytes, '| tagged:', d.tagged,
            d.coverError ? '| coverError: ' + d.coverError : '',
            d.tagError ? '| tagError: ' + d.tagError : '',
            d.remuxError ? '| remuxError: ' + d.remuxError : '');
        }
        if (chrome.runtime.lastError) { console.error('[YMD] download error:', chrome.runtime.lastError.message); resolve({ success: false, error: chrome.runtime.lastError.message }); }
        else if (resp?.ok) resolve({ success: true, filename });
        else resolve({ success: false, error: resp?.error || 'download failed' });
      });
    });
  }

  async function downloadCurrentTrack() {
    const info = getCurrentPlayerInfo();
    if (!info.trackId) { showNotification('Включите трек', 'error'); return { success: false, error: 'Нет трека' }; }
    try {
      showNotification('Получаю аудио...', 'loading');
      const track = { trackId: info.trackId, albumId: info.albumId, title: info.title, artist: info.artist, origin: ORIGIN };
      const result = await yandex.getAudioUrl(track, { preferCaptured: true, getCapturedAudio });
      if (!result) {
        showNotification('Нет URL. Переключите трек и попробуйте снова.', 'error');
        return { success: false, error: 'Нет URL. Переключите трек.' };
      }
      // Дозаполняем coverUri/album/year для тэгов
      try { const wantLyrics = await new Promise(r => { try { chrome.storage.local.get("yamLyrics", d => r(!!(d && d.yamLyrics))); } catch { r(false); } }); await yandex.enrichTrack(track, { wantLyrics }); } catch {}
      const fn = yandex.getFilename(track) || `track_${info.trackId}.mp3`;
      const dl = await dispatchDownload(result, fn, track);
      if (!dl.success) {
        showNotification('Ошибка скачки: ' + (dl.error || ''), 'error');
        return dl;
      }
      const qualityLabel = track._codec ? ` [${String(track._codec).toUpperCase()}${track._bitrate ? ' ' + track._bitrate : ''}]` : '';
      showNotification('✓ ' + fn + qualityLabel, 'success');
      return { success: true, filename: fn };
    } catch (err) {
      showNotification('Ошибка: ' + err.message, 'error');
      return { success: false, error: err.message };
    }
  }

  async function downloadTrackById(trackId, albumId, titleInfo, dlOpts) {
    try {
      showNotification('Получаю ссылку...', 'loading');
      const track = { trackId, albumId, title: titleInfo?.title || '', artist: titleInfo?.artist || '',
        coverUri: titleInfo?.coverUri || '', album: titleInfo?.album || '', year: titleInfo?.year || '', origin: ORIGIN };
      const result = await yandex.getAudioUrl(track, {});
      if (result) {
        try { const wantLyrics = await new Promise(r => { try { chrome.storage.local.get("yamLyrics", d => r(!!(d && d.yamLyrics))); } catch { r(false); } }); await yandex.enrichTrack(track, { wantLyrics }); } catch {}
        const fn = yandex.getFilename(track) || `track_${trackId}.mp3`;
        const dl = await dispatchDownload(result, fn, track, dlOpts);
        if (!dl.success) {
          showNotification('Ошибка: ' + (dl.error || ''), 'error');
          return dl;
        }
        const qualityLabel = track._codec ? ` [${String(track._codec).toUpperCase()}]` : '';
        showNotification('✓ ' + fn + qualityLabel, 'success');
        return { success: true, filename: fn };
      }
      showNotification('Включите этот трек, затем нажмите скачать снова', 'error');
      return { success: false, error: 'Включите трек' };
    } catch (err) {
      showNotification('Ошибка: ' + err.message, 'error');
      return { success: false, error: err.message };
    }
  }

  async function downloadBatch(parsed) {
    let tracks;
    try { tracks = await yandex.listTracks({ ...parsed, origin: ORIGIN }); }
    catch (err) { showNotification('Ошибка: ' + err.message, 'error'); return { downloaded: 0, total: 0 }; }
    if (!tracks.length) { showNotification('Нет треков', 'error'); return { downloaded: 0, total: 0 }; }
    let downloaded = 0;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      showNotification(`${i + 1}/${tracks.length}: ${t.artist} - ${t.title}`, 'loading');
      try { await downloadTrackById(t.trackId, t.albumId, t, { batch: true }); downloaded++; } catch { /* skip */ }
      await sleep(800);
    }
    showNotification(`✓ Скачано ${downloaded}/${tracks.length}`, 'success');
    return { downloaded, total: tracks.length };
  }

  // ═══════════════════════════════════════
  // UI
  // ═══════════════════════════════════════

  function createFAB() {
    const fab = document.createElement('button');
    fab.id = 'ymd-fab';
    fab.title = 'Скачать текущий трек (зажмите и тяните, чтобы переместить)';
    fab.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    document.body.appendChild(fab);

    const FAB_SIZE = 48, MARGIN = 8, DRAG_THRESHOLD = 4;

    function applyPos(left, top) {
      const maxL = window.innerWidth - FAB_SIZE - MARGIN;
      const maxT = window.innerHeight - FAB_SIZE - MARGIN;
      left = Math.max(MARGIN, Math.min(maxL, left));
      top  = Math.max(MARGIN, Math.min(maxT, top));
      fab.style.left = left + 'px';
      fab.style.top  = top + 'px';
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
    }

    try {
      const saved = JSON.parse(localStorage.getItem('ymd-fab-pos') || 'null');
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) applyPos(saved.left, saved.top);
    } catch { /* ignore */ }

    window.addEventListener('resize', () => {
      if (fab.style.left) applyPos(parseFloat(fab.style.left), parseFloat(fab.style.top));
    });

    let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    fab.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true; moved = false;
      sx = e.clientX; sy = e.clientY;
      const r = fab.getBoundingClientRect(); ox = r.left; oy = r.top;
      fab.setPointerCapture(e.pointerId); e.preventDefault();
    });
    fab.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      moved = true; fab.classList.add('ymd-dragging'); applyPos(ox + dx, oy + dy);
    });
    fab.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false; fab.classList.remove('ymd-dragging');
      try { fab.releasePointerCapture(e.pointerId); } catch {}
      if (moved) {
        try { localStorage.setItem('ymd-fab-pos', JSON.stringify({ left: parseFloat(fab.style.left), top: parseFloat(fab.style.top) })); } catch {}
      }
    });
    fab.addEventListener('click', async (e) => {
      if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; return; }
      fab.classList.add('ymd-loading');
      await downloadCurrentTrack();
      fab.classList.remove('ymd-loading');
    });
  }

  function createTrackButton(trackId, albumId, trackEl) {
    const btn = document.createElement('button');
    btn.className = 'ymd-dl-btn'; btn.innerHTML = DOWNLOAD_SVG; btn.title = 'Скачать';
    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      btn.classList.add('ymd-loading');
      const result = await downloadTrackById(trackId, albumId, extractTrackTitle(trackEl));
      btn.classList.remove('ymd-loading');
      if (result?.success) { btn.classList.add('ymd-success'); setTimeout(() => btn.classList.remove('ymd-success'), 3000); }
      else { btn.classList.add('ymd-error'); setTimeout(() => btn.classList.remove('ymd-error'), 3000); }
    });
    return btn;
  }

  function injectTrackButtons() {
    document.querySelectorAll(`[class*="CommonTrack_root"]:not([${PROCESSED}])`).forEach(track => {
      track.setAttribute(PROCESSED, '1');
      const info = extractTrackInfo(track);
      if (!info) return;
      const btn = createTrackButton(info.trackId, info.albumId, track);
      const controls = track.querySelector('[class*="CommonControlsBar"]');
      if (controls) controls.appendChild(btn);
      else { track.style.position = track.style.position || 'relative'; btn.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%)'; track.appendChild(btn); }
    });
  }

  function injectPageButton() {
    const pageInfo = parseCurrentUrl();
    if (!pageInfo || pageInfo.type === 'track') {
      // ушли со страницы альбома/плейлиста — убрать старую кнопку
      const old = document.querySelector('.ymd-page-btn');
      if (old) old.remove();
      return;
    }
    if (document.querySelector('.ymd-page-btn')) return;
    // Ищем заголовок страницы — селекторы Я.Музыки меняются, берём широко
    const header = document.querySelector(
      '[class*="PageHeaderPlaylist"], [class*="PageHeaderBase"], [class*="CommonPageHeader"], ' +
      '[class*="PageAlbum"], [class*="PageHeader"], [class*="Header_root"], ' +
      '[data-test-id*="HEADER"], main h1, [class*="d-generic-page-head"]'
    );
    const label = pageInfo.type === 'album' ? 'Скачать альбом' : 'Скачать плейлист';
    const btn = document.createElement('button');
    btn.className = 'ymd-page-btn';
    btn.innerHTML = `${DOWNLOAD_SVG} <span>${label}</span>`;
    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (btn.classList.contains('ymd-loading')) return;
      btn.classList.add('ymd-loading');
      btn.querySelector('span').textContent = 'Загрузка...';
      const result = await downloadBatch(pageInfo);
      btn.classList.remove('ymd-loading'); btn.classList.add('ymd-success');
      btn.querySelector('span').textContent = `Скачано ${result.downloaded}/${result.total}`;
      setTimeout(() => { btn.classList.remove('ymd-success'); btn.querySelector('span').textContent = label; }, 5000);
    });
    if (header) {
      header.appendChild(btn);
    } else {
      // Хедер не нашли — показываем плавающую кнопку (всегда доступна)
      btn.style.cssText = 'position:fixed;bottom:150px;right:20px;z-index:999999;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
      document.body.appendChild(btn);
    }
  }

  function showNotification(text, type) {
    let el = document.getElementById('ymd-notif');
    if (!el) { el = document.createElement('div'); el.id = 'ymd-notif'; document.body.appendChild(el); }
    el.textContent = text; el.className = 'ymd-notif ymd-notif-' + type; el.style.display = 'block';
    if (type !== 'loading') setTimeout(() => { el.style.display = 'none'; }, 4000);
  }

  // ═══════════════════════════════════════
  // MESSAGES
  // ═══════════════════════════════════════

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getPlayerInfo') {
      const info = getCurrentPlayerInfo();
      sendResponse({ ...info, success: !!info.trackId });
      return true;
    }
    if (message.action === 'dlCurrentTrack') {
      downloadCurrentTrack().then(r => sendResponse(r)).catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
  });

  // ═══════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════

  function start() {
    injectTrackButtons(); injectPageButton();
    new MutationObserver(() => { injectTrackButtons(); injectPageButton(); })
      .observe(document.body, { childList: true, subtree: true });
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        document.querySelectorAll('.ymd-page-btn').forEach(b => b.remove());
        setTimeout(() => { injectTrackButtons(); injectPageButton(); }, 1500);
      }
    }, 500);
  }

  // ═══════════════════════════════════════
  // YANDEX MUSIC TOKEN AUTO-CAPTURE
  // ═══════════════════════════════════════
  // Я.Музыка снесла свой старый веб-API в 2026 — теперь API на api.music.yandex.net
  // требует OAuth-токен. inject/yam-fetch-hook.js (MAIN world, document_start)
  // оборачивает fetch+XHR на странице, перехватывает Authorization-токен из
  // реальных вызовов залогиненного юзера и шлёт сюда через postMessage.

  function setupTokenListener() {
    window.addEventListener('message', (e) => {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || d.type !== 'ymd-yam-fetch-token' || !d.token) return;
      try {
        chrome.storage.local.get(['yamToken', 'yamTokenSource'], (cur) => {
          if (cur && cur.yamToken === d.token) return;
          // НЕ перезаписываем ручной/OAuth-токен — он может быть мобильным
          // (с доступом к FLAC), а fetch-hook ловит web-токен (без FLAC).
          const protect = ['manual', 'manual-url', 'oauth-redirect'];
          if (cur && protect.includes(cur.yamTokenSource)) {
            console.log('[YMD] fetch-hook token ignored (есть ручной/OAuth)');
            return;
          }
          chrome.storage.local.set({
            yamToken: d.token,
            yamTokenSource: 'fetch-hook:' + (d.source || ''),
            yamTokenAt: Date.now(),
          }, () => {
            console.log('[YMD] auto-captured Yandex Music token (', d.source, ')');
          });
        });
      } catch {}
    }, false);
  }

  console.log('[YMD] v3.2.1 loaded');
  setupTokenListener();
  createFAB();
  start();
})();
