// SoundCloud adapter — uses public api-v2 with extracted client_id
(function () {
  let cachedClientId = null;
  let cachedClientIdAt = 0;
  const CLIENT_ID_TTL = 24 * 60 * 60 * 1000;

  async function getClientId() {
    if (cachedClientId && Date.now() - cachedClientIdAt < CLIENT_ID_TTL) return cachedClientId;
    const html = await (await fetch('https://soundcloud.com/', { credentials: 'omit' })).text();
    const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)]
      .map(m => m[1]);
    if (!scripts.length) throw new Error('SoundCloud: bundle scripts не найдены');
    // Try last script first (usually contains client_id)
    for (let i = scripts.length - 1; i >= 0; i--) {
      try {
        const js = await (await fetch(scripts[i], { credentials: 'omit' })).text();
        const m = js.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{20,})"/);
        if (m) { cachedClientId = m[1]; cachedClientIdAt = Date.now(); return cachedClientId; }
      } catch { /* try next */ }
    }
    throw new Error('SoundCloud: client_id не извлечён');
  }

  function parseUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    if (u.hostname !== 'soundcloud.com' && !u.hostname.endsWith('.soundcloud.com')) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const reserved = new Set(['discover', 'search', 'stations', 'feed', 'you', 'upload', 'pages', 'imprint']);
    if (reserved.has(parts[0])) return null;
    if (parts[1] === 'sets' && parts[2]) return { type: 'playlist', url: 'https://soundcloud.com' + u.pathname.replace(/\/$/, '') };
    return { type: 'track', url: 'https://soundcloud.com' + u.pathname.replace(/\/$/, '') };
  }

  async function apiGet(path) {
    const cid = await getClientId();
    const sep = path.includes('?') ? '&' : '?';
    const url = `https://api-v2.soundcloud.com${path}${sep}client_id=${cid}`;
    const resp = await fetch(url, { credentials: 'omit' });
    if (resp.status === 401 || resp.status === 403) {
      // client_id may have rotated — refresh once
      cachedClientId = null;
      const cid2 = await getClientId();
      const url2 = `https://api-v2.soundcloud.com${path}${sep}client_id=${cid2}`;
      const r2 = await fetch(url2, { credentials: 'omit' });
      if (!r2.ok) throw new Error(`SoundCloud API: ${r2.status}`);
      return await r2.json();
    }
    if (!resp.ok) throw new Error(`SoundCloud API: ${resp.status}`);
    return await resp.json();
  }

  function shapeTrack(t) {
    return {
      id: t.id,
      title: t.title || '',
      artist: t.user?.username || '',
      transcodings: t.media?.transcodings || [],
      isHlsOnly: !(t.media?.transcodings || []).some(x => x.format?.protocol === 'progressive'),
    };
  }

  async function listTracks(parsed) {
    const data = await apiGet(`/resolve?url=${encodeURIComponent(parsed.url)}`);
    if (data.kind === 'track') return [shapeTrack(data)];
    if (data.kind === 'playlist' || data.kind === 'system_playlist') {
      const partials = data.tracks || [];
      const full = [];
      // Tracks come with id but possibly without media — batch-fetch missing
      const needFetch = partials.filter(t => !t.media || !t.title).map(t => t.id);
      const ready = partials.filter(t => t.media && t.title);
      for (const t of ready) full.push(shapeTrack(t));
      // Batch fetch in chunks of 25
      for (let i = 0; i < needFetch.length; i += 25) {
        const ids = needFetch.slice(i, i + 25).join(',');
        try {
          const chunk = await apiGet(`/tracks?ids=${ids}`);
          for (const t of chunk) full.push(shapeTrack(t));
        } catch { /* skip chunk */ }
      }
      return full;
    }
    if (data.kind === 'user') throw new Error('SoundCloud: ссылка на пользователя не поддерживается, дайте трек или плейлист');
    throw new Error('SoundCloud: неизвестный тип ' + data.kind);
  }

  async function getAudioUrl(track) {
    if (!track.transcodings?.length) throw new Error('SoundCloud: стримы не найдены');
    const progressive = track.transcodings.find(t => t.format?.protocol === 'progressive');
    if (!progressive) throw new Error('SoundCloud: только HLS-стрим (пока не поддерживается)');
    const cid = await getClientId();
    const sep = progressive.url.includes('?') ? '&' : '?';
    const resp = await fetch(progressive.url + sep + 'client_id=' + cid, { credentials: 'omit' });
    if (!resp.ok) throw new Error(`SoundCloud stream: ${resp.status}`);
    const data = await resp.json();
    return data.url;
  }

  globalThis.YMD.registry.register({
    name: 'soundcloud',
    displayName: 'SoundCloud',
    domains: ['soundcloud.com'],
    parseUrl,
    listTracks,
    getAudioUrl,
    getFilename(track) {
      return globalThis.YMD.utils.makeFilename(track.artist, track.title, 'mp3');
    },
  });
})();
