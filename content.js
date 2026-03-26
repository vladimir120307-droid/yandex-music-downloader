// Yandex Music Downloader — Content Script v2.0

(function () {
  'use strict';

  const DOWNLOAD_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
  const PROCESSED = 'data-ymd-done';
  const ORIGIN = window.location.origin;
  const SIGN_SALT = 'XGRlBW9FXlekgbPrRHuSiA';

  // ═══════════════════════════════════════
  // MD5
  // ═══════════════════════════════════════

  function md5(string) {
    function md5cycle(x,k){var a=x[0],b=x[1],c=x[2],d=x[3];
    a=ff(a,b,c,d,k[0],7,-680876936);d=ff(d,a,b,c,k[1],12,-389564586);c=ff(c,d,a,b,k[2],17,606105819);b=ff(b,c,d,a,k[3],22,-1044525330);
    a=ff(a,b,c,d,k[4],7,-176418897);d=ff(d,a,b,c,k[5],12,1200080426);c=ff(c,d,a,b,k[6],17,-1473231341);b=ff(b,c,d,a,k[7],22,-45705983);
    a=ff(a,b,c,d,k[8],7,1770035416);d=ff(d,a,b,c,k[9],12,-1958414417);c=ff(c,d,a,b,k[10],17,-42063);b=ff(b,c,d,a,k[11],22,-1990404162);
    a=ff(a,b,c,d,k[12],7,1804603682);d=ff(d,a,b,c,k[13],12,-40341101);c=ff(c,d,a,b,k[14],17,-1502002290);b=ff(b,c,d,a,k[15],22,1236535329);
    a=gg(a,b,c,d,k[1],5,-165796510);d=gg(d,a,b,c,k[6],9,-1069501632);c=gg(c,d,a,b,k[11],14,643717713);b=gg(b,c,d,a,k[0],20,-373897302);
    a=gg(a,b,c,d,k[5],5,-701558691);d=gg(d,a,b,c,k[10],9,38016083);c=gg(c,d,a,b,k[15],14,-660478335);b=gg(b,c,d,a,k[4],20,-405537848);
    a=gg(a,b,c,d,k[9],5,568446438);d=gg(d,a,b,c,k[14],9,-1019803690);c=gg(c,d,a,b,k[3],14,-187363961);b=gg(b,c,d,a,k[8],20,1163531501);
    a=gg(a,b,c,d,k[13],5,-1444681467);d=gg(d,a,b,c,k[2],9,-51403784);c=gg(c,d,a,b,k[7],14,1735328473);b=gg(b,c,d,a,k[12],20,-1926607734);
    a=hh(a,b,c,d,k[5],4,-378558);d=hh(d,a,b,c,k[8],11,-2022574463);c=hh(c,d,a,b,k[11],16,1839030562);b=hh(b,c,d,a,k[14],23,-35309556);
    a=hh(a,b,c,d,k[1],4,-1530992060);d=hh(d,a,b,c,k[4],11,1272893353);c=hh(c,d,a,b,k[7],16,-155497632);b=hh(b,c,d,a,k[10],23,-1094730640);
    a=hh(a,b,c,d,k[13],4,681279174);d=hh(d,a,b,c,k[0],11,-358537222);c=hh(c,d,a,b,k[3],16,-722521979);b=hh(b,c,d,a,k[6],23,76029189);
    a=hh(a,b,c,d,k[9],4,-640364487);d=hh(d,a,b,c,k[12],11,-421815835);c=hh(c,d,a,b,k[15],16,530742520);b=hh(b,c,d,a,k[2],23,-995338651);
    a=ii(a,b,c,d,k[0],6,-198630844);d=ii(d,a,b,c,k[7],10,1126891415);c=ii(c,d,a,b,k[14],15,-1416354905);b=ii(b,c,d,a,k[5],21,-57434055);
    a=ii(a,b,c,d,k[12],6,1700485571);d=ii(d,a,b,c,k[3],10,-1894986606);c=ii(c,d,a,b,k[10],15,-1051523);b=ii(b,c,d,a,k[1],21,-2054922799);
    a=ii(a,b,c,d,k[8],6,1873313359);d=ii(d,a,b,c,k[15],10,-30611744);c=ii(c,d,a,b,k[6],15,-1560198380);b=ii(b,c,d,a,b,k[13],21,1309151649);
    a=ii(a,b,c,d,k[4],6,-145523070);d=ii(d,a,b,c,k[11],10,-1120210379);c=ii(c,d,a,b,k[2],15,718787259);b=ii(b,c,d,a,k[9],21,-343485551);
    x[0]=add32(a,x[0]);x[1]=add32(b,x[1]);x[2]=add32(c,x[2]);x[3]=add32(d,x[3]);}
    function cmn(q,a,b,x,s,t){a=add32(add32(a,q),add32(x,t));return add32((a<<s)|(a>>>(32-s)),b);}
    function ff(a,b,c,d,x,s,t){return cmn((b&c)|((~b)&d),a,b,x,s,t);}
    function gg(a,b,c,d,x,s,t){return cmn((b&d)|(c&(~d)),a,b,x,s,t);}
    function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t);}
    function ii(a,b,c,d,x,s,t){return cmn(c^(b|(~d)),a,b,x,s,t);}
    function md51(s){var n=s.length,state=[1732584193,-271733879,-1732584194,271733878],i;
    for(i=64;i<=s.length;i+=64)md5cycle(state,md5blk(s.substring(i-64,i)));
    s=s.substring(i-64);var tail=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    for(i=0;i<s.length;i++)tail[i>>2]|=s.charCodeAt(i)<<((i%4)<<3);
    tail[i>>2]|=0x80<<((i%4)<<3);if(i>55){md5cycle(state,tail);for(i=0;i<16;i++)tail[i]=0;}
    tail[14]=n*8;md5cycle(state,tail);return state;}
    function md5blk(s){var md5blks=[],i;for(i=0;i<64;i+=4)md5blks[i>>2]=s.charCodeAt(i)+(s.charCodeAt(i+1)<<8)+(s.charCodeAt(i+2)<<16)+(s.charCodeAt(i+3)<<24);return md5blks;}
    var hex_chr='0123456789abcdef'.split('');
    function rhex(n){var s='',j=0;for(;j<4;j++)s+=hex_chr[(n>>(j*8+4))&0x0F]+hex_chr[(n>>(j*8))&0x0F];return s;}
    function hex(x){for(var i=0;i<x.length;i++)x[i]=rhex(x[i]);return x.join('');}
    function add32(a,b){return(a+b)&0xFFFFFFFF;}
    return hex(md51(string));
  }

  // ═══════════════════════════════════════
  // ПОЛУЧЕНИЕ АУДИО URL
  // ═══════════════════════════════════════

  async function getCapturedAudioUrl() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'getCapturedAudio' }, resp => {
        if (resp?.success) resolve(resp.url);
        else resolve(null);
      });
    });
  }

  async function getApiDownloadUrl(trackId, albumId) {
    const endpoints = [];
    if (albumId) {
      endpoints.push(`${ORIGIN}/api/v2.1/handlers/track/${trackId}:${albumId}/web-album_track-track-track-main/download/m?hq=1&external-domain=${location.hostname}&overembed=no`);
    }
    endpoints.push(`${ORIGIN}/api/v2.1/handlers/track/${trackId}/web-album_track-track-track-main/download/m?hq=1&external-domain=${location.hostname}&overembed=no`);

    for (const ep of endpoints) {
      try {
        const resp = await fetch(ep, { credentials: 'include', headers: { 'X-Retpath-Y': ORIGIN + '/' } });
        if (!resp.ok) continue;
        const data = await resp.json();
        const xmlUrl = data.src || data.result?.src;
        if (!xmlUrl) continue;
        const mp3 = await resolveXmlToMp3(xmlUrl);
        if (mp3) return mp3;
      } catch { /* next */ }
    }
    return null;
  }

  async function resolveXmlToMp3(xmlUrl) {
    let url = xmlUrl;
    if (!url.includes('format=')) url += (url.includes('?') ? '&' : '?') + 'format=json';
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) return null;
    const text = await resp.text();
    let host, path, ts, s;
    try {
      const json = JSON.parse(text);
      host = json.host; path = json.path; ts = json.ts; s = json.s;
    } catch {
      host = text.match(/<host>(.*?)<\/host>/)?.[1];
      path = text.match(/<path>(.*?)<\/path>/)?.[1];
      ts = text.match(/<ts>(.*?)<\/ts>/)?.[1];
      s = text.match(/<s>(.*?)<\/s>/)?.[1];
    }
    if (!host || !path) return null;
    const sign = md5(SIGN_SALT + path.substring(1) + s);
    return `https://${host}/get-mp3/${sign}/${ts}${path}`;
  }

  // ═══════════════════════════════════════
  // ИНФОРМАЦИЯ О ПЛЕЕРЕ
  // ═══════════════════════════════════════

  function getCurrentPlayerInfo() {
    let trackId = null, albumId = null, title = '', artist = '';

    const selectors = [
      '[class*="PlayerBarDesktop"] a[href*="/track/"]',
      '[class*="PlayerBar"] a[href*="/track/"]',
      '.player-controls a[href*="/track/"]',
    ];
    for (const sel of selectors) {
      for (const link of document.querySelectorAll(sel)) {
        const m = link.getAttribute('href')?.match(/\/album\/(\d+)\/track\/(\d+)/);
        if (m) { albumId = m[1]; trackId = m[2]; break; }
        const m2 = link.getAttribute('href')?.match(/\/track\/(\d+)/);
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

  function sanitize(s) { return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim(); }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ═══════════════════════════════════════
  // СКАЧИВАНИЕ
  // ═══════════════════════════════════════

  async function downloadFile(url, filename) {
    console.log('[YMD] Download:', url.substring(0, 80), '→', filename);
    showNotification('Скачиваю: ' + filename, 'loading');

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'download', url, filename }, resp => {
        if (resp?.success) {
          resolve({ success: true, filename });
        } else {
          console.warn('[YMD] chrome.downloads failed, fallback to fetch+blob');
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
            .catch(() => {
              window.open(url, '_blank');
              resolve({ success: true, filename });
            });
        }
      });
    });
  }

  async function downloadCurrentTrack() {
    const info = getCurrentPlayerInfo();
    if (!info.trackId) {
      showNotification('Включите трек', 'error');
      return { success: false, error: 'Нет трека' };
    }

    const fn = (info.artist && info.title)
      ? `${sanitize(info.artist)} - ${sanitize(info.title)}.mp3`
      : `track_${info.trackId}.mp3`;

    try {
      showNotification('Получаю аудио...', 'loading');
      let audioUrl = await getCapturedAudioUrl();

      if (!audioUrl) {
        console.log('[YMD] No captured URL, trying API...');
        audioUrl = await getApiDownloadUrl(info.trackId, info.albumId);
      }

      if (!audioUrl) {
        showNotification('Нет URL. Переключите трек и попробуйте снова.', 'error');
        return { success: false, error: 'Нет URL. Переключите трек.' };
      }

      await downloadFile(audioUrl, fn);
      showNotification('✓ ' + fn, 'success');
      return { success: true, filename: fn };
    } catch (err) {
      showNotification('Ошибка: ' + err.message, 'error');
      return { success: false, error: err.message };
    }
  }

  async function downloadTrackById(trackId, albumId, titleInfo) {
    const fn = (titleInfo?.artist && titleInfo?.title)
      ? `${sanitize(titleInfo.artist)} - ${sanitize(titleInfo.title)}.mp3`
      : `track_${trackId}.mp3`;

    try {
      showNotification('Получаю ссылку...', 'loading');
      const apiUrl = await getApiDownloadUrl(trackId, albumId);
      if (apiUrl) {
        await downloadFile(apiUrl, fn);
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

  // ═══════════════════════════════════════
  // АЛЬБОМЫ/ПЛЕЙЛИСТЫ
  // ═══════════════════════════════════════

  async function fetchAlbumTracks(albumId) {
    const resp = await fetch(`${ORIGIN}/handlers/album/${albumId}/full.jsx`, {
      credentials: 'include', headers: { 'X-Retpath-Y': ORIGIN + '/' },
    });
    if (resp.ok) {
      const data = await resp.json();
      const tracks = [];
      for (const vol of (data.volumes || [])) {
        for (const t of vol) {
          tracks.push({ trackId: String(t.id), albumId: String(t.albums?.[0]?.id || albumId), title: t.title || '', artist: (t.artists || []).map(a => a.name).join(', ') || '' });
        }
      }
      if (tracks.length) return tracks;
    }
    throw new Error('Не удалось получить треки альбома');
  }

  async function fetchPlaylistTracks(owner, kinds) {
    const resp = await fetch(`${ORIGIN}/handlers/playlist/${owner}/${kinds}/full.jsx`, {
      credentials: 'include', headers: { 'X-Retpath-Y': ORIGIN + '/' },
    });
    if (resp.ok) {
      const data = await resp.json();
      const pl = data.playlist || data;
      return (pl.tracks || []).map(t => {
        const track = t.track || t;
        return { trackId: String(track.id), albumId: String(track.albums?.[0]?.id || ''), title: track.title || '', artist: (track.artists || []).map(a => a.name).join(', ') || '' };
      }).filter(t => t.trackId);
    }
    throw new Error('Не удалось получить треки плейлиста');
  }

  async function downloadBatch(type, id, extra) {
    let tracks;
    try {
      if (type === 'album') tracks = await fetchAlbumTracks(id);
      else tracks = await fetchPlaylistTracks(extra.owner, extra.kinds);
    } catch (err) { showNotification('Ошибка: ' + err.message, 'error'); return { downloaded: 0, total: 0 }; }

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
    fab.title = 'Скачать текущий трек';
    fab.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    fab.addEventListener('click', async () => {
      fab.classList.add('ymd-loading');
      await downloadCurrentTrack();
      fab.classList.remove('ymd-loading');
    });
    document.body.appendChild(fab);
  }

  function createTrackButton(trackId, albumId, trackEl) {
    const btn = document.createElement('button');
    btn.className = 'ymd-dl-btn';
    btn.innerHTML = DOWNLOAD_SVG;
    btn.title = 'Скачать';
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
      const result = await downloadBatch(pageInfo.type, pageInfo.type === 'album' ? pageInfo.albumId : pageInfo.kinds, pageInfo);
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
    el.textContent = text;
    el.className = 'ymd-notif ymd-notif-' + type;
    el.style.display = 'block';
    if (type !== 'loading') setTimeout(() => { el.style.display = 'none'; }, 4000);
  }

  // ═══════════════════════════════════════
  // СООБЩЕНИЯ
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

  function startObserver() {
    injectTrackButtons(); injectPageButton();
    const observer = new MutationObserver(() => { injectTrackButtons(); injectPageButton(); });
    observer.observe(document.body, { childList: true, subtree: true });
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        document.querySelectorAll('.ymd-page-btn').forEach(b => b.remove());
        setTimeout(() => { injectTrackButtons(); injectPageButton(); }, 1500);
      }
    }, 500);
  }

  console.log('[YMD] v2.0 loaded');
  createFAB();
  startObserver();
})();
