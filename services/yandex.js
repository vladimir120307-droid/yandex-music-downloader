// Yandex Music adapter — api.music.yandex.net (новый API после смерти /handlers/*.jsx)
//
// Аутентификация: OAuth-токен. Берётся из chrome.storage.local.yamToken.
// Токен попадает туда либо автоматически (грабер на странице music.yandex.ru,
// см. content.js → tryGrabYandexToken), либо вручную (попап → поле «Токен»).
//
// Без токена работает только получение метаданных (албом/треки) — для скачивания
// нужен токен, потому что /tracks/{id}/download-info требует авторизации.
(function () {
  const API_BASE = 'https://api.music.yandex.net';
  const SIGN_SALT = 'XGRlBW9FXlekgbPrRHuSiA';
  const DOMAINS = [
    'music.yandex.ru', 'music.yandex.com', 'music.yandex.kz',
    'music.yandex.by', 'music.yandex.ua',
  ];

  function parseUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    if (!DOMAINS.some(d => u.hostname === d || u.hostname.endsWith('.' + d))) return null;
    const p = u.pathname;
    let m = p.match(/\/album\/(\d+)\/track\/(\d+)/);
    if (m) return { type: 'track', albumId: m[1], trackId: m[2] };
    m = p.match(/\/track\/(\d+)/);
    if (m) return { type: 'track', albumId: null, trackId: m[1] };
    m = p.match(/\/album\/(\d+)/);
    if (m) return { type: 'album', albumId: m[1] };
    m = p.match(/\/users\/([^/]+)\/playlists\/(\d+)/);
    if (m) return { type: 'playlist', owner: m[1], kinds: m[2] };
    // Новый формат: /playlists/{uuid}  (например 01a6eb8c-578e-8e47-b4b4-bab9aae9da0b)
    m = p.match(/\/playlists\/([a-f0-9-]{32,40})/i);
    if (m) return { type: 'playlist', uuid: m[1] };
    return null;
  }

  async function getToken() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get('yamToken', d => resolve((d && d.yamToken) || ''));
      } catch { resolve(''); }
    });
  }

  async function getQualityPref() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get('yamQuality', d => resolve((d && d.yamQuality) || 'auto'));
      } catch { resolve('auto'); }
    });
  }

  function extForCodec(codec) {
    switch ((codec || '').toLowerCase()) {
      case 'flac': return 'flac';
      case 'aac':
      case 'he-aac': return 'aac';
      case 'opus': return 'opus';
      case 'mp3':
      default: return 'mp3';
    }
  }

  // HMAC-ключ для V2 (/get-file-info) — из публичных yandex-music API реверсов
  const V2_HMAC_KEY = 'p93jhgh689SBReK6ghtw62';

  async function hmacSha256Hex(keyStr, msgStr) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(keyStr),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msgStr));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function getFileInfoV2(trackId, token, quality) {
    // Новый эндпоинт api.music.yandex.net/get-file-info с HMAC-подписью.
    // Возвращает прямой URL (без MD5-sign дополнительного), и поддерживает FLAC
    // для мобильных OAuth-токенов (web-токен → 403 not-allowed).
    const ts = Math.floor(Date.now() / 1000);
    const codecs = 'flac,aac,mp3';
    const transports = 'raw';
    const sign = await hmacSha256Hex(V2_HMAC_KEY, `${ts}${trackId}${codecs}${transports}`);
    const url = `${API_BASE}/get-file-info?ts=${ts}&trackId=${trackId}` +
      `&quality=${encodeURIComponent(quality)}` +
      `&codecs=${encodeURIComponent(codecs)}` +
      `&transports=${encodeURIComponent(transports)}` +
      `&sign=${sign}`;
    const resp = await fetch(url, { headers: authHeaders(token) });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      let name = '';
      try { name = JSON.parse(text).result?.name || ''; } catch {}
      throw new Error(`/get-file-info ${resp.status} ${name || text.slice(0, 100)}`);
    }
    const data = await resp.json();
    return data.result || data;
  }

  function normCodec(s) { return String(s || '').toLowerCase(); }
  function isFlac(item) {
    const c = normCodec(item.codec);
    return c === 'flac' || c === 'flacflac' || c === 'los' || c === 'lossless';
  }
  function isMp3(item) { return normCodec(item.codec) === 'mp3'; }

  function pickStream(dlInfo, quality) {
    if (!Array.isArray(dlInfo) || !dlInfo.length) return null;
    const byBitrateDesc = (a, b) => (b.bitrateInKbps || 0) - (a.bitrateInKbps || 0);

    if (quality === 'auto' || !quality) {
      // FLAC → MP3 320 → лучшее
      const flac = dlInfo.find(isFlac);
      if (flac) return flac;
      const mp3_320 = dlInfo.find(i => isMp3(i) && i.bitrateInKbps === 320);
      if (mp3_320) return mp3_320;
      return [...dlInfo].sort(byBitrateDesc)[0];
    }
    if (quality === 'flac') {
      return dlInfo.find(isFlac) || null;  // null = строго FLAC, нет — пусть звонит выше
    }
    if (quality === 'mp3-320') {
      const exact = dlInfo.find(i => isMp3(i) && i.bitrateInKbps === 320);
      if (exact) return exact;
      const mp3s = dlInfo.filter(isMp3).sort(byBitrateDesc);
      if (mp3s.length) return mp3s[0];
      return [...dlInfo].sort(byBitrateDesc)[0];
    }
    return [...dlInfo].sort(byBitrateDesc)[0];
  }

  function authHeaders(token) {
    // X-Yandex-Music-Client мимикает мобильное приложение — открывает FLAC
    // в /download-info для Plus-подписчиков (web-плеер сам по себе FLAC не отдаёт).
    const h = {
      'Accept': 'application/json',
      'X-Yandex-Music-Client': 'YandexMusicAndroid/24023621',
    };
    if (token) h['Authorization'] = 'OAuth ' + token;
    return h;
  }

  async function apiGet(path, token) {
    const resp = await fetch(API_BASE + path, { headers: authHeaders(token) });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`api.music.yandex.net${path}: HTTP ${resp.status} ${txt.slice(0, 200)}`);
    }
    const data = await resp.json();
    return data.result !== undefined ? data.result : data;
  }

  async function apiPost(path, body, token) {
    const headers = authHeaders(token);
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const resp = await fetch(API_BASE + path, { method: 'POST', headers, body });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`api.music.yandex.net${path}: HTTP ${resp.status} ${txt.slice(0, 200)}`);
    }
    const data = await resp.json();
    return data.result !== undefined ? data.result : data;
  }

  function shapeTrack(t, defaultAlbumId) {
    return {
      trackId: String(t.id || t.realId || ''),
      albumId: String(((t.albums || [])[0] || {}).id || defaultAlbumId || ''),
      title: t.title || '',
      artist: (t.artists || []).map(a => a.name).filter(Boolean).join(', '),
      version: t.version || '',
    };
  }

  async function fetchAlbumTracks(albumId, token) {
    const data = await apiGet(`/albums/${albumId}/with-tracks`, token);
    const out = [];
    for (const vol of (data.volumes || [])) {
      for (const t of vol) {
        const tr = shapeTrack(t, albumId);
        if (tr.trackId) out.push(tr);
      }
    }
    return out;
  }

  async function fetchPlaylistTracks(owner, kinds, token) {
    const pl = await apiGet(`/users/${owner}/playlists/${kinds}`, token);
    const items = pl.tracks || [];
    return items.map(entry => shapeTrack(entry.track || entry)).filter(t => t.trackId);
  }

  async function fetchPlaylistByUuid(uuid, token) {
    const pl = await apiGet(`/playlist/${uuid}`, token);
    const items = pl.tracks || [];
    return items.map(entry => shapeTrack(entry.track || entry)).filter(t => t.trackId);
  }

  async function fetchSingleTrack(trackId, albumId, token) {
    const list = await apiPost('/tracks', 'track-ids=' + encodeURIComponent(trackId), token);
    const t = (list || [])[0];
    if (t) return shapeTrack(t, albumId);
    return { trackId: String(trackId), albumId: albumId || '', title: '', artist: '' };
  }

  async function listTracks(parsed) {
    const token = await getToken();
    if (parsed.type === 'track') return [await fetchSingleTrack(parsed.trackId, parsed.albumId, token)];
    if (parsed.type === 'album') return await fetchAlbumTracks(parsed.albumId, token);
    if (parsed.type === 'playlist') {
      if (parsed.uuid) return await fetchPlaylistByUuid(parsed.uuid, token);
      return await fetchPlaylistTracks(parsed.owner, parsed.kinds, token);
    }
    return [];
  }

  async function getAudioUrl(track, ctx) {
    const quality = await getQualityPref();
    const token = await getToken();

    if (token) {
      // Для FLAC и Auto — сначала пробуем V2 эндпоинт /get-file-info (даёт прямой
      // URL для FLAC). Если токен мобильный (OAuth client_id Яндекс.Музыки) —
      // получим lossless. Если web-токен — будет 403 not-allowed, фоллбек на V1.
      if (quality === 'flac' || quality === 'auto' || !quality) {
        try {
          const v2 = await getFileInfoV2(track.trackId, token, 'lossless');
          const v2url = v2?.urls?.[0] || v2?.downloadInfoUrl;
          const v2codec = normCodec(v2?.codec);
          if (v2url && v2codec) {
            // Если запросили строго FLAC и получили его — отдаём
            // Если Auto — отдаём что есть (это лучшее что V2 выдал)
            if (quality !== 'flac' || v2codec === 'flac') {
              track._codec = v2.codec;
              track._bitrate = v2.bitrate;
              console.log('[YMD] V2 endpoint:', v2.codec, v2.bitrate, 'kbps · direct URL');
              return v2url;
            }
            console.log('[YMD] V2 вернул не-FLAC (' + v2.codec + '), хотя запросили FLAC. Fallback на V1.');
          }
        } catch (err) {
          console.warn('[YMD] V2 endpoint failed:', err.message);
          if (quality === 'flac') {
            // Строгий FLAC — без V2 не получится. Внятная ошибка.
            const isAuth = /403|not-allowed/i.test(err.message);
            throw new Error(
              isAuth
                ? 'FLAC недоступен: текущий токен не имеет доступа к lossless. ' +
                  'Нажми в попапе «Открыть страницу для получения токена» — это ' +
                  'мобильный OAuth-флоу, он даёт нужный scope для FLAC. ' +
                  '(Авто-захваченный токен с music.yandex.ru — это web-сессия, у неё нет FLAC.)'
                : 'FLAC недоступен: ' + err.message
            );
          }
          // Для Auto — продолжаем в V1 path
        }
      }

      // V1 path — /tracks/X/download-info (для MP3 и как fallback)
      const dlInfo = await apiGet(`/tracks/${track.trackId}/download-info`, token);
      if (!Array.isArray(dlInfo) || !dlInfo.length) throw new Error('Я.Музыка не вернула download-info');

      console.log('[YMD] V1 download-info for', track.trackId,
        '— available:', dlInfo.map(i => `${i.codec}/${i.bitrateInKbps}kbps`).join(', '),
        '· requested quality:', quality);

      const pick = pickStream(dlInfo, quality);
      if (!pick) throw new Error('Я.Музыка: подходящий поток не найден');
      track._codec = pick.codec;
      track._bitrate = pick.bitrateInKbps;
      console.log('[YMD] picked stream:', pick.codec, pick.bitrateInKbps, 'kbps');
      return await resolveDownloadInfoUrl(pick.downloadInfoUrl);
    }

    // Без токена — фоллбек на captured URL (FAB при заходе на свежую страницу
    // когда токен ещё не пойман). Качество — какое играл плеер.
    if (ctx?.preferCaptured && ctx.getCapturedAudio) {
      try {
        const captured = await ctx.getCapturedAudio();
        if (captured) {
          // Не знаем реальный codec — ставим mp3 как наиболее вероятный.
          track._codec = track._codec || 'mp3';
          return captured;
        }
      } catch { /* fall through */ }
    }

    throw new Error(
      'Нет токена Я.Музыки. Открой music.yandex.ru и залогинься — расширение ' +
      'поймает токен автоматически. Или вставь вручную в попапе → «Токен Я.Музыки».'
    );
  }

  async function resolveDownloadInfoUrl(downloadInfoUrl) {
    // storage.mds.yandex.net не отдаёт CORS — fetch через background.
    const sep = downloadInfoUrl.includes('?') ? '&' : '?';
    const proxyUrl = downloadInfoUrl + sep + 'format=json';
    const txt = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'corsProxyFetch', url: proxyUrl, headers: {} },
        (resp) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!resp || !resp.ok) return reject(new Error(resp?.error || 'corsProxyFetch failed'));
          resolve(resp.body || '');
        }
      );
    });
    let host, path, ts, s;
    try {
      const j = JSON.parse(txt);
      host = j.host; path = j.path; ts = j.ts; s = j.s;
    } catch {
      host = txt.match(/<host>(.*?)<\/host>/)?.[1];
      path = txt.match(/<path>(.*?)<\/path>/)?.[1];
      ts = txt.match(/<ts>(.*?)<\/ts>/)?.[1];
      s = txt.match(/<s>(.*?)<\/s>/)?.[1];
    }
    if (!host || !path || s == null || ts == null) return null;
    const sign = globalThis.YMD_MD5(SIGN_SALT + path.substring(1) + s);
    return `https://${host}/get-mp3/${sign}/${ts}${path}`;
  }

  globalThis.YMD.registry.register({
    name: 'yandex',
    displayName: 'Яндекс Музыка',
    domains: DOMAINS,
    parseUrl,
    listTracks,
    getAudioUrl,
    getFilename(track) {
      const ext = extForCodec(track && track._codec);
      return globalThis.YMD.utils.makeFilename(track.artist, track.title, ext) ||
        `track_${track.trackId}.${ext}`;
    },
  });
})();
