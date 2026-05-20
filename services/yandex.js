// Yandex Music adapter
(function () {
  const SIGN_SALT = 'XGRlBW9FXlekgbPrRHuSiA';
  const DEFAULT_ORIGIN = 'https://music.yandex.ru';
  const DOMAINS = [
    'music.yandex.ru', 'music.yandex.com', 'music.yandex.kz',
    'music.yandex.by', 'music.yandex.ua',
  ];

  function parseUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    if (!DOMAINS.some(d => u.hostname === d || u.hostname.endsWith('.' + d))) return null;
    const p = u.pathname;
    let m = p.match(/\/album\/(\d+)\/track\/(\d+)/);
    if (m) return { type: 'track', albumId: m[1], trackId: m[2], origin: u.origin };
    m = p.match(/\/podcast\/(\d+)\/episode\/(\d+)/);
    if (m) return { type: 'track', albumId: m[1], trackId: m[2], origin: u.origin };
    m = p.match(/\/track\/(\d+)/);
    if (m) return { type: 'track', albumId: null, trackId: m[1], origin: u.origin };
    m = p.match(/\/album\/(\d+)/);
    if (m) return { type: 'album', albumId: m[1], origin: u.origin };
    m = p.match(/\/podcast\/(\d+)/);
    if (m) return { type: 'album', albumId: m[1], origin: u.origin };
    m = p.match(/\/users\/([^/]+)\/playlists\/(\d+)/);
    if (m) return { type: 'playlist', owner: m[1], kinds: m[2], origin: u.origin };
    return null;
  }

  async function fetchAlbumTracks(albumId, origin) {
    const resp = await fetch(`${origin}/handlers/album/${albumId}/full.jsx`, {
      credentials: 'include', headers: { 'X-Retpath-Y': origin + '/' },
    });
    if (!resp.ok) throw new Error('Не удалось получить треки альбома');
    const data = await resp.json();
    // API sometimes wraps album data under data.album, sometimes at data root
    const album = data.album || data;
    const showTitle = album.title || data.title || '';
    console.log('[YMD] fetchAlbumTracks', albumId, 'showTitle:', showTitle, 'volumes:', album.volumes?.length ?? data.volumes?.length);
    const out = [];
    for (const vol of (album.volumes || data.volumes || [])) {
      // vol is always an array (one per disk), but guard anyway
      const tracks = Array.isArray(vol) ? vol : [vol];
      for (const t of tracks) {
        if (!t?.id) continue;
        const artists = (t.artists || []).map(a => a.name).join(', ');
        out.push({
          trackId: String(t.id),
          albumId: String(t.albums?.[0]?.id || albumId),
          title: t.title || '',
          artist: artists || showTitle,
          trackNumber: t.albums?.[0]?.trackPosition || null,
          origin,
        });
      }
    }
    return out;
  }

  async function fetchPlaylistTracks(owner, kinds, origin) {
    const resp = await fetch(`${origin}/handlers/playlist/${owner}/${kinds}/full.jsx`, {
      credentials: 'include', headers: { 'X-Retpath-Y': origin + '/' },
    });
    if (!resp.ok) throw new Error('Не удалось получить треки плейлиста');
    const data = await resp.json();
    const pl = data.playlist || data;
    return (pl.tracks || []).map(t => {
      const tr = t.track || t;
      const artists = (tr.artists || []).map(a => a.name).join(', ');
      const showTitle = tr.albums?.[0]?.title || '';
      return {
        trackId: String(tr.id),
        albumId: String(tr.albums?.[0]?.id || ''),
        title: tr.title || '',
        artist: artists || showTitle,
        trackNumber: tr.albums?.[0]?.trackPosition || null,
        origin,
      };
    }).filter(t => t.trackId);
  }

  async function fetchSingleTrack(trackId, albumId, origin) {
    if (albumId) {
      try {
        const all = await fetchAlbumTracks(albumId, origin);
        const found = all.find(t => t.trackId === String(trackId));
        if (found) return found;
      } catch { /* fall through */ }
    }
    try {
      const resp = await fetch(`${origin}/handlers/track.jsx?track=${trackId}${albumId ? ':' + albumId : ''}`, {
        credentials: 'include', headers: { 'X-Retpath-Y': origin + '/' },
      });
      if (resp.ok) {
        const data = await resp.json();
        const tr = data.track || data;
        const artists = (tr.artists || []).map(a => a.name).join(', ');
        const showTitle = data.album?.title || tr.albums?.[0]?.title || '';
        return {
          trackId: String(trackId),
          albumId: String(tr.albums?.[0]?.id || albumId || ''),
          title: tr.title || '',
          artist: artists || showTitle,
          trackNumber: tr.albums?.[0]?.trackPosition || null,
          origin,
        };
      }
    } catch { /* fall through */ }
    return { trackId: String(trackId), albumId: albumId ? String(albumId) : '', title: '', artist: '', origin };
  }

  async function listTracks(parsed) {
    const origin = parsed.origin || DEFAULT_ORIGIN;
    if (parsed.type === 'track') return [await fetchSingleTrack(parsed.trackId, parsed.albumId, origin)];
    if (parsed.type === 'album') return await fetchAlbumTracks(parsed.albumId, origin);
    if (parsed.type === 'playlist') return await fetchPlaylistTracks(parsed.owner, parsed.kinds, origin);
    return [];
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
    const sign = globalThis.YMD_MD5(SIGN_SALT + path.substring(1) + s);
    return `https://${host}/get-mp3/${sign}/${ts}${path}`;
  }

  async function getApiDownloadUrl(trackId, albumId, origin) {
    const endpoints = [];
    if (albumId) endpoints.push(`${origin}/api/v2.1/handlers/track/${trackId}:${albumId}/web-album_track-track-track-main/download/m?hq=1&external-domain=${new URL(origin).hostname}&overembed=no`);
    endpoints.push(`${origin}/api/v2.1/handlers/track/${trackId}/web-album_track-track-track-main/download/m?hq=1&external-domain=${new URL(origin).hostname}&overembed=no`);
    for (const ep of endpoints) {
      try {
        const resp = await fetch(ep, { credentials: 'include', headers: { 'X-Retpath-Y': origin + '/' } });
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

  async function getAudioUrl(track, ctx) {
    const origin = track.origin || DEFAULT_ORIGIN;

    // In-page mode: try captured URL first (only valid for currently playing track)
    if (ctx?.preferCaptured && ctx.getCapturedAudio) {
      try {
        const captured = await ctx.getCapturedAudio();
        if (captured) return captured;
      } catch { /* fall through */ }
    }

    return await getApiDownloadUrl(track.trackId, track.albumId, origin);
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
