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

  async function downloadCurrentTrack() {
    const info = getCurrentPlayerInfo();
    if (!info.trackId) { showNotification('Включите трек', 'error'); return { success: false, error: 'Нет трека' }; }
    try {
      showNotification('Получаю аудио...', 'loading');
      const track = { trackId: info.trackId, albumId: info.albumId, title: info.title, artist: info.artist, origin: ORIGIN };
      const audioUrl = await yandex.getAudioUrl(track, { preferCaptured: true, getCapturedAudio });
      if (!audioUrl) {
        showNotification('Нет URL. Переключите трек и попробуйте снова.', 'error');
        return { success: false, error: 'Нет URL. Переключите трек.' };
      }
      const fn = yandex.getFilename(track) || `track_${info.trackId}.mp3`;
      await downloadFile(audioUrl, fn);
      const qualityLabel = track._codec ? ` [${String(track._codec).toUpperCase()}${track._bitrate ? ' ' + track._bitrate : ''}]` : '';
      showNotification('✓ ' + fn + qualityLabel, 'success');
      return { success: true, filename: fn };
    } catch (err) {
      showNotification('Ошибка: ' + err.message, 'error');
      return { success: false, error: err.message };
    }
  }

  async function downloadTrackById(trackId, albumId, titleInfo) {
    try {
      showNotification('Получаю ссылку...', 'loading');
      const track = { trackId, albumId, title: titleInfo?.title || '', artist: titleInfo?.artist || '', origin: ORIGIN };
      const audioUrl = await yandex.getAudioUrl(track, {});
      if (audioUrl) {
        const fn = yandex.getFilename(track) || `track_${trackId}.mp3`;
        await downloadFile(audioUrl, fn);
        showNotification('✓ ' + fn, 'success');
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
      try { await downloadTrackById(t.trackId, t.albumId, t); downloaded++; } catch { /* skip */ }
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
    if (document.querySelector('.ymd-page-btn')) return;
    const pageInfo = parseCurrentUrl();
    if (!pageInfo || pageInfo.type === 'track') return;
    const header = document.querySelector('[class*="PageHeaderPlaylist"], [class*="PageHeaderBase"], [class*="CommonPageHeader"], [class*="PageAlbum"]');
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
    if (header) header.appendChild(btn);
    else { btn.style.cssText = 'position:fixed;bottom:150px;right:20px;z-index:999999;'; document.body.appendChild(btn); }
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
