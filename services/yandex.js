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

  function pickStream(dlInfo, quality) {
    if (!Array.isArray(dlInfo) || !dlInfo.length) return null;
    const byBitrateDesc = (a, b) => (b.bitrateInKbps || 0) - (a.bitrateInKbps || 0);
    const byBitrateAsc = (a, b) => (a.bitrateInKbps || 0) - (b.bitrateInKbps || 0);

    if (quality === 'smallest') {
      return [...dlInfo].sort(byBitrateAsc)[0];
    }
    if (quality === 'auto' || !quality) {
      // FLAC если есть → иначе MP3 320 → иначе лучшее доступное
      const flac = dlInfo.find(i => i.codec === 'flac');
      if (flac) return flac;
      const mp3_320 = dlInfo.find(i => i.codec === 'mp3' && i.bitrateInKbps === 320);
      if (mp3_320) return mp3_320;
      return [...dlInfo].sort(byBitrateDesc)[0];
    }
    if (quality === 'flac') {
      const flac = dlInfo.find(i => i.codec === 'flac');
      if (flac) return flac;
      // Фоллбек на лучшее (для не-Плюс юзеров)
      return [...dlInfo].sort(byBitrateDesc)[0];
    }
    // Формат 'codec-bitrate': mp3-320, mp3-192, aac-256, aac-128, ...
    const m = String(quality).match(/^([a-z]+)-(\d+)$/i);
    if (m) {
      const codec = m[1].toLowerCase();
      const target = parseInt(m[2], 10);
      const exact = dlInfo.find(i => i.codec === codec && i.bitrateInKbps === target);
      if (exact) return exact;
      const sameCodec = dlInfo.filter(i => i.codec === codec);
      if (sameCodec.length) {
        return sameCodec.sort((a, b) =>
          Math.abs((a.bitrateInKbps || 0) - target) - Math.abs((b.bitrateInKbps || 0) - target)
        )[0];
      }
    }
    // Fallback — best
    return [...dlInfo].sort(byBitrateDesc)[0];
  }

  function authHeaders(token) {
    const h = { 'Accept': 'application/json' };
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
    // 1. Try captured URL (in-page mode — наш фоновый webRequest перехватчик)
    if (ctx?.preferCaptured && ctx.getCapturedAudio) {
      try {
        const captured = await ctx.getCapturedAudio();
        if (captured) return captured;
      } catch { /* fall through */ }
    }

    // 2. API-путь через api.music.yandex.net + OAuth токен
    const token = await getToken();
    if (!token) {
      throw new Error(
        'Нет токена Я.Музыки. Зайди на music.yandex.ru (расширение попробует поймать ' +
        'токен автоматически) или вставь вручную в попапе → «Токен».'
      );
    }

    const dlInfo = await apiGet(`/tracks/${track.trackId}/download-info`, token);
    if (!Array.isArray(dlInfo) || !dlInfo.length) throw new Error('Я.Музыка не вернула download-info');

    const quality = await getQualityPref();
    const pick = pickStream(dlInfo, quality);
    if (!pick) throw new Error('Я.Музыка: подходящий поток не найден');
    // Запоминаем codec на треке, чтоб getFilename выбрал правильное расширение
    track._codec = pick.codec;
    track._bitrate = pick.bitrateInKbps;

    // storage.mds.yandex.net не отдаёт CORS — fetch через background.
    const sep = pick.downloadInfoUrl.includes('?') ? '&' : '?';
    const proxyUrl = pick.downloadInfoUrl + sep + 'format=json';
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
