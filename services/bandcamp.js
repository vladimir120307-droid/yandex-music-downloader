// Bandcamp adapter — public mp3-128 URLs in page data-tralbum
(function () {
  function parseUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    if (!u.hostname.endsWith('.bandcamp.com') && u.hostname !== 'bandcamp.com') return null;
    const p = u.pathname;
    if (p.startsWith('/track/')) return { type: 'track', url: u.origin + p };
    if (p.startsWith('/album/')) return { type: 'album', url: u.origin + p };
    if (p === '/' || p === '/music') return { type: 'discography', url: u.origin + '/music' };
    return null;
  }

  function decodeHtmlEntities(s) {
    return String(s)
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  function extractTralbum(html) {
    // Format 1: <... data-tralbum="{...}" ...>
    const m1 = html.match(/data-tralbum="([^"]+)"/);
    if (m1) {
      try { return JSON.parse(decodeHtmlEntities(m1[1])); } catch { /* try next */ }
    }
    // Format 2: var TralbumData = {...};
    const m2 = html.match(/var\s+TralbumData\s*=\s*(\{[\s\S]*?\});\s*\n/);
    if (m2) {
      try { return JSON.parse(m2[1]); } catch { /* try next */ }
    }
    return null;
  }

  function normalizeUrl(u) {
    if (!u) return null;
    if (u.startsWith('//')) return 'https:' + u;
    if (u.startsWith('http')) return u;
    return null;
  }

  async function fetchPage(url) {
    const resp = await fetch(url, { credentials: 'omit' });
    if (!resp.ok) throw new Error(`Bandcamp: HTTP ${resp.status}`);
    return await resp.text();
  }

  function tralbumToTracks(data) {
    if (!data?.trackinfo) return [];
    const albumArtist = data.artist || data.current?.artist || '';
    const albumTitle = data.current?.title || '';
    return data.trackinfo
      .map(t => {
        const file = t.file || {};
        const audioUrl = normalizeUrl(file['mp3-128'] || file['mp3-v0'] || file['mp3-320']);
        if (!audioUrl) return null;
        return {
          id: String(t.track_id || t.id || t.track_num),
          title: t.title || `Track ${t.track_num}`,
          artist: albumArtist,
          album: albumTitle,
          audioUrl,
        };
      })
      .filter(Boolean);
  }

  async function listTracks(parsed) {
    if (parsed.type === 'discography') {
      // Get all album/track URLs from discography page, then fetch each album
      const html = await fetchPage(parsed.url);
      const links = [...html.matchAll(/href="(\/(?:album|track)\/[^"#?]+)"/g)]
        .map(m => new URL(m[1], parsed.url).href);
      const unique = [...new Set(links)];
      const all = [];
      for (const link of unique) {
        try {
          const sub = await fetchPage(link);
          const data = extractTralbum(sub);
          if (data) all.push(...tralbumToTracks(data));
        } catch { /* skip */ }
        await globalThis.YMD.utils.sleep(300);
      }
      return all;
    }
    const html = await fetchPage(parsed.url);
    const data = extractTralbum(html);
    if (!data) throw new Error('Bandcamp: данные трека не найдены на странице');
    return tralbumToTracks(data);
  }

  async function getAudioUrl(track) {
    return track.audioUrl;
  }

  globalThis.YMD.registry.register({
    name: 'bandcamp',
    displayName: 'Bandcamp',
    domains: ['bandcamp.com'],
    parseUrl,
    listTracks,
    getAudioUrl,
    getFilename(track) {
      return globalThis.YMD.utils.makeFilename(track.artist, track.title, 'mp3');
    },
  });
})();
