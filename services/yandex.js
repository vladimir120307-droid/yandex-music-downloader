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
    // Лучшее качество mp3
    const mp3s = dlInfo.filter(i => i.codec === 'mp3');
    const pick = (mp3s.length ? mp3s : dlInfo).reduce((a, b) =>
      (b.bitrateInKbps || 0) > (a.bitrateInKbps || 0) ? b : a, dlInfo[0]);

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
      return globalThis.YMD.utils.makeFilename(track.artist, track.title, 'mp3') ||
        `track_${track.trackId}.mp3`;
    },
  });
})();
